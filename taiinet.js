'use strict';


var cfg = {'iceServers': [
    {'urls': 'stun:23.21.150.121'},
    {
        'urls': 'turn:rick.mita.me:3478',
        username: "ayylmao",
        credential: "ayylmao"
    }
]}
var con = { 'optional': [{'DtlsSrtpKeyAgreement': true}]}
var debug = function(log) {
    if (true) {
        console.log(log);
    }
}

var signallers = [
    "ws://167.160.189.251:5000/api/1"
];

function get_signaller(tn){
    var host = signallers[Math.floor(Math.random()*signallers.length)];
    var signaller = io(host);
    signaller.on("disconnect", function() {
        var callbacks = false;
        if (this.signaller != undefined) {
            callbacks = this.signaller._callbacks;
        }
        get_signaller(this);
        if (callbacks) {
            this.signaller._callbacks = callbacks;
        }
        console.log("Signaller is down, retrying");
    }.bind(tn))
    tn.signaller = signaller;
}

// represents a subscription to some data
function Subscription(query, tn){
    this.query = query;
    this.tn = tn;
    this.connections = {};
    this.seed_limit = 6;
    this.seeding = 0;
    this.min_relevancy = 100;
    this.messages = [];
    this.backlog_requesters = [];
    this.ready = false;
    this.missed_messages = [];
    this.out = 0;
    this.tot = 0;

    // called when new sockets are available
    this.add_socket = function(socket) {
        // only send out connection requests to a certain number of people
        if (this.seeding < this.seed_limit && socket.id != this.tn.signaller.id){
            // check if the query matches ours
            // check if the query matches ours
            if (match_queries(this.query, socket.query) >= this.min_relevancy){
                /*
                var dc = this.tn.create_connection(socket);
                this.add_dc(socket.id, socket.query, dc);
                this.seeding++;
                */
                if (this.out < 3 && this.tot < 7){
                    this.out++;
                    console.log("getting status")
                    this.tn.signal(socket.id, {
                        type: "get_status",
                        query: this.query
                    })
                }
            }
        }
    }

    // called when a new dc is made
    this.add_dc = function(id, query, dc) {
        this.tot++;
        dc.onclose = function() {
            this.seeding--;
            // if the last DC leaves, start caching messages for when we connect
            if (this.tn.clients < 1) {
                this.ready = false;
            }
        }.bind(this)
        var onopen = function() {
            this.connections[id] = dc;
            if (!this.ready) {
                // when the first datachannel opens
                this.trigger("ready");
                this.missed_messages.forEach(function(message){
                    this.send(message);
                }.bind(this));
                this.missed_messages = [];
                this.ready = true;
                // ask for the message we missed
                if (this.get_backlog) {
                    this.send({}, "request_backlog")
                }
            }
        }.bind(this)
        if (dc.readyState == "open") {
            onopen()
        }
        else {
            dc.onopen = onopen;
        }
        // data channel MailRoom
        dc.onmessage = function(message){
            var data = JSON.parse(message.data);
            // if we've seen this message before
            if (data._type == "message") {
                if (this.messages.indexOf(message.data) >= 0) {
                    return;
                }
                // if the message doesn't match our query
                if (match_queries(data, this.query) < this.min_relevancy) {
                    return;
                }
                this.trigger("data", message);
                // tell the other connections
                this.send(data);
            }
            else if (data._type == "request_backlog") {
                console.log("peer requests backlog")
                this.backlog_requesters.push(message.target);
                // request backlogs if we haven't already
                if (this.got_backlog == undefined) {
                    this.send({query: this.query}, "request_backlog");
                    this.got_backlog = true;
                }
                // send the requester all of our logs
                this.messages.forEach(function(backlog) {
                    var backlog = JSON.parse(backlog);
                    if (backlog._type == "message") {
                        message.target.send(JSON.stringify({
                            _type: "backlog", backlog: backlog
                        }));
                    }
                })
            }
            else if (data._type == "backlog") {
                if (this.messages.indexOf(message.data) >= 0) {
                    return;
                }
                // have we seen this message before
                if (this.messages.indexOf(data.backlog) >= 0) {
                    return;
                }
                if (this.messages.indexOf(JSON.parse(message.data).backlog) < 0) {
                    // send the message to our backlog requesters
                    for (var i in this.backlog_requesters) {
                        var requester = this.backlog_requesters[i];
                        if (requester.readyState == "open") {
                            requester.send(message.data);
                        }
                        else {
                          // remove the dc if it's not open
                          delete this.backlog_requesters[i];
                        }
                    }
                }
                this.messages.push(JSON.stringify(JSON.parse(message.data).backlog))
                // call the blacklog event
                this.trigger("backlog", message);
            }
            this.messages.push(message.data);
        }.bind(this)
        this.trigger("new_connection", {id:id, dc:dc, sub:this});
    }

    this.send = function(data, type) {
      data._type = type || "message";
      // if we try to send a message before the first connection, just add it
      // to a list and send it when we connect
      if (!this.ready) {
          this.missed_messages.push(data);
          return;
      }
      // tell the other connections
      for (var i in this.connections) {
        var connection = this.connections[i];
        if (connection.readyState == "open") {
            connection.send(JSON.stringify(data));
        }
        else {
          // remove the dc if it's not open
          delete this.connections[i];
        }
      }
      this.messages.push(JSON.stringify(data));
    }

    this.events = [];
    this.on = function(event, callback){
        if (this.events[event] == undefined){
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    this.trigger = function(event, data){
        if (this.events[event] != undefined){
            for (var i in this.events[event]){
                var callback = this.events[event][i];
                callback(data);
            }
        }
    }
}

// Handles connections to and from peer connections via the signaller
function TaiiNet(){
    get_signaller(this);
    this.subscriptions = [];
    this.pcs = {};
    this.clients = 0;
    this.max_clients = 7;

    this.signaller.on("socket_broadcast", function(socket) {
        console.log("got broadcast")
        this.subscriptions.forEach(function(sub){
            sub.add_socket(socket);
        });
    }.bind(this))

    // returns a subscription object to the query
    this.subscribe = function(query, get_backlog) {
        var sub = new Subscription(query, this);
        sub.get_backlog = get_backlog || false;
        this.subscriptions.push(sub);
        this.signaller.on("connect", function(){
            // tell the this.signaller to send us new sockets
            this.signaller.emit("get_sockets", {
                query: query
            });
            // tell people we're subscribing
            this.signaller.emit("socket_broadcast", [{
                query: query,
                id: this.signaller.id
            }]);
        }.bind(this))
        return sub;
    }

    // initiates a connection to the node at the specified socket
    // returns a datachannel to that node
    this.create_connection = function(socket) {
        // SCTP is supported from Chrome 31 and is supported in FF.
        // No need to pass DTLS constraint as it is on by default in Chrome 31.
        // For SCTP, reliable and ordered is true by default.
        // Add localConnection to global scope to make it visible
        // from the browser console.
        var localConnection = new RTCPeerConnection(cfg);
        this.pcs[socket.id] = localConnection;

        localConnection.onicecandidate = function(e) {
            this.signal(socket.id, {
                type: "ice_candidate",
                candidate: e.candidate
            });
        }.bind(this);

        var sendChannel = localConnection.createDataChannel('sendDataChannel');

        localConnection.createOffer().then(function(desc){
            this.pcs[socket.id].setLocalDescription(desc);
            this.signal(socket.id, {
                type: "offer",
                offer: desc,
                query: socket.query
            })
            console.log("sending offer to " + socket.id)
        }.bind(this));

        return sendChannel;
    }

    // The MailRoom
    // handle messages from other nodes.
    this.signaller.on("message", function(message) {
        console.log("got " + message.data.type)
        if (message.data.type == "get_status") {
            console.log("getting status")
            this.signal(message.from_id, {
                type: "status",
                available: this.clients < this.max_clients,
                query: message.data.query
            })
        }
        if (message.data.type == "status") {
            if (message.data.available) {
                var dc = this.create_connection({
                    id: message.from_id,
                    query: message.data.query
                });
                this.subscriptions.forEach(function(sub) {
                    sub.add_dc(message.from_id, message.data.query, dc);
                    sub.seeding++;
                })
                this.clients++;
            }
        }
        if (message.data.type == "offer") {
            var remoteConnection = new RTCPeerConnection(cfg);
            this.pcs[message.from_id] = remoteConnection;
            this.clients++;
            // offer the resulting datachannel to all the subs when connected
            remoteConnection.ondatachannel = function(dc){
                this.subscriptions.forEach(function(sub) {
                    sub.seeding++;
                    if (match_queries(sub.query, message.data.query) >= sub.min_relevancy) {
                        sub.add_dc(
                            message.from_id,
                            message.data.query,
                            dc.channel || dc
                        );
                    }
                })
            }.bind(this)
            remoteConnection.onicecandidate = function(e) {
                this.signal(message.from_id, {
                    type: "ice_candidate",
                    candidate: e.candidate
                });
            }.bind(this);
            remoteConnection.setRemoteDescription(
                new RTCSessionDescription(message.data.offer)
            ).then(function(){
                remoteConnection.createAnswer().then(function(answer) {
                    remoteConnection.setLocalDescription(answer);
                    this.signal(message.from_id, {
                        type: "answer",
                        answer: answer
                    })
                }.bind(this))
            }.bind(this))
        }
        else if (message.data.type == "answer") {
            this.pcs[message.from_id].setRemoteDescription(
                new RTCSessionDescription(message.data.answer)
            ).catch(console.log)
        }
        else if (message.data.type == "ice_candidate") {
            var pc = this.pcs[message.from_id];
            pc.addIceCandidate(message.data.candidate);
        }
    }.bind(this))
    this.signal = function(id, data){
        this.signaller.emit("send_message", {
            to_id: id,
            from_id: this.signaller.id,
            data: data
        })
    }
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
// aka: query1 matches a smaller criteria of data that also matches query2
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
        if (query1[key] == undefined) {
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
