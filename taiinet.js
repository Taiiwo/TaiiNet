// a list of signallers to use by default. These are signallers the author trusts
// a malicious signal node could DoS the network by refusing to intiate requests
var signallers = [
    //"ws://167.160.189.251:5000/api/1",
    "ws://localhost:5000/api/1"
];



var debug = true;
function log(thing) {
    if (debug) {
        console.log(thing);
    }
}

function Subscription(tn, query, backlog) {
    this.tn = tn;
    this.backlog = backlog || false;
    this.relevant_sockets = [];
    this.query = query;
    this.max_connections = 4;
    this.connections = [];
    this.messages = [];
    this.callbacks = {};
    tn.track_subscription(this);

    this.on = function(event, callback) {
        if (this.callbacks[event] == undefined) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    this.trigger = function(event, data) {
        for (var i in this.callbacks[event]) {
            this.callbacks[event][i](data);
        }
    }

    // offer a socket to this sub. Returns true if socket should be connected to
    this.offer_socket = function(socket) {
        if (this.connections.length < this.max_connections) {
            return true;
        }
        else {
            this.add_relevant_socket(socket);
        }
    }

    // Placeholder function for if you wanted to prioritize the socket queue order
    this.add_relevant_socket = function(socket) {
        this.relevant_sockets.push(socket);
    }

    this.add_connection = function(id, peer){
        peer.on("data", function(data) {
            this.handle_message(data, peer);
        }.bind(this));
        if (this.backlog) {
            if (peer.connected) {
                peer.send(JSON.stringify({
                    type: "backlog_request",
                    query: this.query
                }));
            }
            else {
                // a hack to fix a simplepeer bug
                // basically, sometimes the "connect" event isn't called even though the
                // datachannel is connected. To combat this, we just set a new
                // ondatachannel callback, and manually call the original callback
                var simplepeer_callback = peer._pc.ondatachannel;
                peer._pc.ondatachannel = function (event){
                    simplepeer_callback(event);
                    // a timeout is needed here to drop the send method to the end of the
                    // call stack. Note that the timeout duration is 0ms and should not cause
                    // timing issues
                    setTimeout(function(){
                        peer.send(JSON.stringify({
                            type: "backlog_request",
                            query: this.query
                        }));
                    }.bind(this), 0);
                }.bind(this)
            }
        }
        var disconnect = function() {
            // we lost a peer connection
            // make new connections to replace the lost connection
            this.heal();
        }.bind(this);
        peer.on("close", disconnect);
        peer.on("error", disconnect);
        this.connections.push(peer);
    }

    this.hash = function(text) {
        var hasher = new jsSHA("SHA-512", "TEXT");
        hasher.update(text);
        return hasher.getHash("B64");
    }

    this.send = function(message){
        if (this.seen_message(message)) {
            return 0;
        }
        if (match_queries(message, this.query) < 100) {
            console.error("You cannot send a message that does not match this sub's query");
        }
        message._hash = this.current_hash;
        this.messages.push(message);
        this.current_hash = this.hash(JSON.stringify(message));
        this.connections.forEach(function(peer){
            if (peer._channelReady) {
                peer.send(JSON.stringify({
                    type: "data",
                    data: message
                }));
            }
            else {
                this.heal();
            }
        }.bind(this))
    }

    this.seen_message = function(message) {
        var seen = false;
        this.messages.forEach(function(log) {
            if (JSON.stringify(log) == JSON.stringify(message)) {
                seen = true;
            }
        });
        return seen;
    }

    this.handle_message = function(data, from_peer) {
        var message = JSON.parse(data);
        if (message.type == "data") {
            if (match_queries(message.data, this.query) == 100) {
                if (!this.seen_message(message.data)) {
                    if (message.data._hash != this.current_hash) {
                        log("got fake message!");
                        return 0;
                    }
                    this.trigger("message", message.data);
                    // send the message to other peers
                    this.send(message.data);
                }
            }
        }
        else if (message.type == "backlog_request") {
            // make a list of all the messages we've recived that match the request
            var backlogs = [];
            this.messages.forEach(function(backlog) {
                if (match_queries(backlog, message.query) == 100) {
                    backlogs.push(backlog);
                }
            }.bind(this));
            from_peer.send(JSON.stringify({
                type: "backlog",
                backlog: this.messages
            }));
        }
        else if (message.type == "backlog") {
            message.backlog.forEach(function(backlog){
                if (!this.seen_message(backlog)) {
                    if (backlog._hash != this.current_hash) {
                        log("got fake backlog!");
                        return 0;
                    }
                    this.messages.push(backlog);
                    this.current_hash = this.hash(JSON.stringify(backlog));
                    this.trigger("backlog", backlog);
                }
            }.bind(this));
        }
    }

    this.heal = function() {
        // Remove all dead connections
        for (var i in this.connections) {
            var peer = this.connections[i];
            if (!peer._channelReady) {
                this.connections.splice(i,1);
            }
        }
        // Connect to new peers
        // while we have less than the desired amount of peers
        for (var i = 0; i < this.max_connections - this.connections.length; i++) {
            // connect to the last socket on the list and remove it
            if (this.relevant_sockets.length > 0) {
                this.tn.initiate_connection(this.relevant_sockets.pop());
            }
        }
    }
}

function TaiiNet() {
    this.get_signaller = function(callbacks) {
        log("getting signaller");
        // select random signaller
        var host = signallers[Math.floor(Math.random()*signallers.length)];
        this.signaller = io(host);
        // add all the callbacks from the previous signaller
        if (callbacks) {
            this.signaller._callbacks = callbacks;
        }
        this.signaller.on("disconnect", function() {
            var callbacks = this.signaller._callbacks;
            log("Signaller is down, retrying");
            setTimeout(function(){
                this.get_signaller(callbacks);
            }.bind(this), 1000)
        }.bind(this));
    }
    this.get_signaller();
    // a list of the subscriptions we need to offer connections to
    this.subscriptions = [];
    this.pcs = {};

    // Returns an initialized subscription object for the given query
    this.subscribe = function(query, backlog) {
        var sub = new Subscription(this, query, backlog);
        return sub;
    }

    // Signs a subscription object up for updates
    this.track_subscription = function(sub) {
        this.subscriptions.push(sub);
        this.signaller.on("connect", function() {
            // tell the this.signaller to send us new sockets
            this.signaller.emit("get_sockets", {
                query: sub.query
            });
            // tell people we're subscribing
            // there's a bit of polling fuckery here because socketio tells us it's ready
            // sometimes when it doesn't have an id
            var when_id_poll = function(){
                if (this.signaller.id != undefined) {
                    this.signaller.emit("socket_broadcast", [{
                        query: sub.query,
                        id: this.signaller.id
                    }]);
                }
                else {
                    setTimeout(function(){
                        when_id_poll();
                    }.bind(this), 1000)
                }
            }.bind(this);
            when_id_poll();
        }.bind(this));
    }

    // when a new socket makes itsself available
    this.signaller.on("socket_broadcast", function(socket) {
        // connect to the socket if required
        this.initiate_connection(socket);
    }.bind(this))

    // initiates a peer connection
    this.initiate_connection = function(socket) {
        // get a list of all the relevant subscriptions
        var subs = [];
        this.subscriptions.forEach(function(sub) {
            if (socket.id != this.signaller.id && match_queries(sub.query, socket.query)) {
                // offer this socket to the sub
                if (sub.offer_socket(socket)) {
                    subs.push(sub);
                }
            }
        }.bind(this));
        if (subs.length <= 0) {
            // if this peer is not relevant to any subs, why connect to it?
            // (I mean, you could also ask why initiate a connection, but I think this way
            // stops more mistakes)
            return false;
        }
        // make a new connection if no connection exists
        if (this.pcs[socket.id] == undefined) {
            var peer = new SimplePeer({initiator: true});
            this.add_peer_callbacks(peer, socket.id, socket.query, subs);
            this.pcs[socket.id] = peer;
        }
        else {
            var peer = this.pcs[socket.id];
        }
        // notify the subs
        subs.forEach(function(sub) {
            sub.add_connection(socket.id, peer);
        })
    }

    this.signal = function(to_id, data, type) {
        data.type = type || "message";
        this.signaller.emit("send_message", {
            to_id : to_id,
            from_id: this.signaller.id,
            data: data
        });
    }

    // adds the callbacks to initialize a peer
    this.add_peer_callbacks = function(peer, id, query) {
        peer.on("signal", function(data) {
            log("sending signal");
            this.signal(id, {
                signal_data: data,
                query: query
            }, "signal");
        }.bind(this));
        // handle disconnections
        var remove_peer = function(e) {
            delete this.pcs[id];
        }
        peer.on("close", remove_peer.bind(this));
        peer.on("error", remove_peer.bind(this));
    }

    this.signaller.on("message", function(message) {
        if (message.data.type == "signal") {
            if (this.pcs[message.from_id] == undefined) {
                // this is the first signal from this id
                var peer = new SimplePeer();
                this.add_peer_callbacks(peer, message.from_id, message.data.query);
                this.pcs[message.from_id] = peer;
                // add this connection to relevant subs
                this.subscriptions.forEach(function(sub) {
                    if (match_queries(sub.query, message.data.query) == 100) {
                        sub.add_connection(message.from_id, peer);
                    }
                })
            }
            else {
                var  peer = this.pcs[message.from_id];
            }
            log("got signal");
            peer.signal(message.data.signal_data);
        }
    }.bind(this))
}

function all_keys_start_with(obj) {
    var all = true;
    for (var key in obj) {
        if (key[0] != "$") {
            all = false;
            break
        }
    }
    return all;
}

function no_keys_start_with(obj) {
    var none = true;
    for (var key in obj) {
        if (key[0] == "$") {
            none = false;
            break
        }
    }
    return none;
}
// Returns true if query 1 matches query 2
// aka: data that matches query1 can also match query2
// aka: query1 matches a more specific criteria of data that also matches query2
function match_queries(query1, query2){
    var matches = true;
    var relevancy = 100;
    for (var q1_key in query1) {
        var q1_value = query1[q1_key];
        if (query2[q1_key] != undefined) {
            var q2_value = query2[q1_key];
            // query2 also specifies this q1_key, so we need to make sure that
            // query2 has some or all of the data query1 specifies
            if (q1_value == q2_value){
                // keys and values are the same, move on
                continue
            }
            else {
                // values are different, so we need to check if q2 includes q1
                // if either value is a dict
                if (typeof(q1_value) == "object" && !Array.isArray(q1_value)) {
                    if (typeof(q2_value) == "object" && !Array.isArray(q2_value)){
                        // dicts are different, evaluate their conditions recursively
                        // if value1 is condition (checks if all keys start with $)
                        if (all_keys_start_with(q1_value)) {
                            // q1 is a condition
                            if (all_keys_start_with(q2_value)) {
                                // both dics are smart queries, resolve them
                                relevancy *= resolve_conditions(q1_value, q2_value);
                            }
                            else if (no_keys_start_with(q2_value)) {
                                // q2 is a regular dict, but q1 is a condition
                                if (eval_condition(q1_value, q2_value)) {
                                    relevancy /= 2;
                                }
                            }
                            else {
                                // value2 contains a mixture of conditions and
                                // regular keys, throw an error or something
                                return 0;
                            }
                        }
                        else if (no_keys_start_with(q1_value)) {
                            // q1 is a regular dict
                            if (all_keys_start_with(q2_value)) {
                                // q2 is a smart condition
                                if (!eval_condition(q2_value, q1_value)) {
                                    relevancy /= 2;
                                }
                            }
                            else if (no_keys_start_with(q2_value)) {
                                // both queries are regular dicts
                                if (!eval_condition(q2_value, q1_value)){
                                    relevancy /= 2;
                                }
                            }
                            else {
                                // value2 contains a mixture of conditions and
                                // regular keys, throw an error or something
                                return 0;
                            }
                        }
                        else {
                            // value2 contains a mixture of conditions and
                            // regular keys, throw an error or something
                            return 0;
                        }
                    }
                    else {
                        // q1 is a condition, q2 is a value
                        relevancy *= eval_condition(q1_value, q2_value);
                    }
                }
                else {
                    // q1 is a value
                    if (typeof(q2_value) == "object" && !Array.isArray(q2_value)) {
                        // q1 is a value and q2 is a dict
                        if (eval_condition(q2_value, q1_value)){
                            // q1 is matched entirely by q2 for this key
                            continue;
                        }
                        else {
                            // value does not match q2's condition.
                            // aka q2 does not have what q1 is looking for
                            return 0;
                        }
                    }
                    else {
                        // queries are just different values
                        return 0;
                    }
                }
            }
            // value is an int or string, so we can just do a regular comparison
        }
        else {
            // the key is in query1 but not specified by query2, meaning query2
            // will match all data for this key, so it doesn't matter what query1
            // specifies, query2 will have it, so we can skip this key
            continue;
        }
    }
    // halve the relevancy for each missing key. This assumes statistically
    // normal data, and does not represent probability of sucess with real data
    // That being said, it's perfectly useful as a priority indicator
    for (var key in query2) {
        var value = query2[key];
        if (query1[key] == undefined && key[0] != "$") {
            relevancy /= 2
        }
    }

    if (matches) {
        return relevancy;
    }
    else {
        return 0;
    }
}

// Helper function - Checks one value against a smart condition
function eval_condition(condition, value) {
    for (var key in condition) {
        var comparitor = condition[key];
        if (key[0] != "$") {
            // this dict is not a query, so it can't match a single value
            return 0.0;
        }
        else {
            if (key == "$lt") {
                if (value >= comparitor) {
                    return 0.0;
                }
            }
            else if (key == "$gt") {
                if (value <= comparitor) {
                    return 0.0;
                }
            }
            else if (key == "$in") {
                if (value instanceof Array) {
                    var c = 0;
                    for (var i in comparitor){
                        var element = comparitor[i];
                        if (value != element) {
                            c += 1;
                        }
                    }
                    if (c > 0) {
                        return 1.0 / (2 * c);
                    }
                    else {
                        return 0
                    }
                }
            }
            else if (key == "$contains") {   // We're differing from mongo a bit here
                // if the specified value is and array and contains this or any of these
                // eg1: {ids: {$contains: "4"}} matches: {ids: [1,2,3,4]}
                // eg2: {ids: {$contains: [1, 2]}} matches:
                // {ids:[1,2,3]}, but not {ids:[1,3]} because we default to and
                // if you want to or, you'll have to use eg1 in an $or
                if (typeof(comparitor) == "object") {
                    var c = False;
                    for (var i in comparitor) {
                        var contain = comparitor[i];
                        if (value[contain] != undefined) {
                            c = true;
                        }
                    }
                    if (!c) {
                        return 0.0;
                    }
                }
                else {
                    if (comparitor[value] == undefined) {
                        return 0.0;
                    }
                }
            }
            else if (key == "$and") {
                var a = true;
                for (var k1 in comparitor) {
                    var v1 = comparitor[k1];
                    var and_condition = {k1: v1};
                    if (eval_condition(and_condition, value) < 1) {
                        a = false;
                    }
                }
                // a will only be true if all and conditions are true
                if (!a) {
                    return 0.0;
                }
            }
            else if (key == "$or") {
                var o = false;
                for (var k1 in comparitor) {
                    var v1 = comparitor[k1];
                    var or_condition = {k1: v1};
                    if (eval_condition(or_condition, value) > 0) {
                        var o = true;
                        break;
                    }
                }
                // o is only true if any of the or conditions are true
                if (!o) {
                    return 0.0;
                }
            // TODO: Add nor, xor, and nand
            }
        }
    }
    return 1.0;
}

/*
Gives the relevancy of conditions in query2 to conditions in query1
*/
function resolve_conditions(query1, query2) {
    var relevancy = 1.0;
    // handle each combination of conditions
    for (var key1 in query1) {
        var value1 = query1[key1];
        for (var key2 in query2) {
            var value2 = query2[key2];
            // we can ignore matching values, this is probably caught earlier
            if (key1 == key2 && value1 == value2) {
                continue;
            }
            var values = {};
            values[key1] = value1;
            values[key2] = value2;
            if (values.length == 1) {
                // both keys are the same
                if (values["$lt"] != undefined) {
                    // lt vs lt
                    // if the q1 upper bound is higher than q2
                    if (value1 > value2) {
                        // q2 matches more data than q1
                        continue;
                    }
                    else {
                        // q2 matches less data than q1
                        relevancy /= 2;
                    }
                }
                else if (values["$gt"] != undefined) {
                    // gt vs gt
                    // if q2 lower bounds is less than q1 lower bound
                    if (value2 < value1) {
                        // data matching q2 matches q2
                        continue;
                    }
                    else {
                        // some data is cut off by the higher bound of q2
                        relevancy /= 2;
                    }
                }
                else if (values["$in"] != undefined) {
                    // what % of values in value1 are in value2
                    var c = 0;
                    for (var i in value1) {
                        var value = value1[i];
                        if (value2[value] != undefined) {
                            c += 1;
                        }
                    }
                    relevancy *= c / value1.length;
                }
                else if (values["$and"] != undefined || values["$or"] != undefined) {
                    for (var k1 in value1) {
                        var v1 = value2[k1];
                        for (var k2 in value2) {
                            var v2 = value2[k2];
                            relevancy *= match_queries({k1: v1}, {k2: v2});
                        }
                    }
                }
            }
            else {
                // keys are different
                // lt vs gt
                if (values["$gt"] != undefined && values["$lt"] != undefined) {
                    // if the q2 lo`wer bound is less than the q1 upper bound
                    if (values["$gt"] < values["$lt"]) {
                        // there is a section of data between the gt and lt
                        // that will match both queries, but not all
                        relevancy /=2;
                    }
                    else {
                        // the two queries are out of bounds of eachother
                        // No chance of matching
                        return 0;
                    }
                }
                else if (values["$in"] != undefined && (values["$lt"] != undefined || values["$gt"] != undefined)) {
                    var c = 0;
                    for (var a in values["$in"]){
                        var i = values["$in"][a];
                        if (values["$lt"] != undefined) {
                            if (i < values["$lt"]) {
                                c += 1;
                            }
                        }
                        else if (i > values["$gt"]) {
                            c += 1;
                        }
                    }
                    if (c > 0) {
                        // some values match
                        relevancy /= 2;
                    }
                    else {
                        // no values matched
                        return 0;
                    }
                }
                else if (values["$and"] != undefined && values["$or"] != undefined) {
                    for (var k1 in value1) {
                        var v1 = value1[k1];
                        for (var k2 in value2) {
                            var v2 = value2[k2];
                            relevancy *= match_queries({k1: v1}, {k2: v2});
                        }
                    }
                }
                else if (values["$and"] != undefined) {
                    var oq;
                    if (key1 == "$and") {
                        oq = query2;
                    }
                    else {
                        oq = query1;
                    }
                    for (var k1 in values["$and"]) {
                        var v1 = values["$and"][k1];
                        relevancy *= match_queries({k1: v1}, oq);
                    }
                }
                else if (values["$or"] != undefined) {
                    var oq;
                    if (key1 == "$or") {
                        oq = query2;
                    }
                    else {
                        oq = query1;
                    }
                    for (var k1 in values["$or"]) {
                        var v1 = values["$or"][k1];
                        relevancy *= match_queries({k1: v1}, oq);
                    }
                }
            }
        }
    }
    return relevancy;
}
