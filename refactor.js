// a list of signallers to use by default. These are signallers the author trusts
// a malicious signal node could only DoS the network by refusing to intiate requests
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

// Represents a data subscription to the network
//  tn: a TaiiNet instance - Obj(TaiiNet)
// query: the data query - Obj(Object)
// backlog: whether or not we want a backlog of old messages - Boolean
function Subscription(tn, query, backlog) {
    this.tn = tn;
    this.backlog = backlog || false;
    this.relevant_sockets = [];
    this.query = query;
    this.min_connections = 3;
    this.max_downstream_peers = 3;
    this.downstream_peers = 0;
    this.connections = [];
    this.messages = [];
    this.callbacks = {};
    // tell the tn object we exist
    tn.track_subscription(this);

    // add callback funcitonality
    this.on = function(event, callback) {
        if (this.callbacks[event] == undefined) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }
    this.trigger = function(event, data) {
        // quick recursive call to have an event that triggers when any other event triggers
        if (event != "trigger"){
            this.trigger("trigger", {event: event, data: data});
        }
        for (var i in this.callbacks[event]) {
            this.callbacks[event][i](data);
        }
    }

    // offer a socket to this sub. Returns true if socket should be connected to
    this.offer_socket = function(socket) {
        // are we at our connection limit?
        if (this.downstream_peers < this.max_downstream_peers) {
            this.downstream_peers++;
            return true;
        }
        else {
            // store the socket for later use
            this.add_relevant_socket(socket);
            return false;
        }
    }

    // Placeholder function for if you wanted to prioritize the socket queue order
    this.add_relevant_socket = function(socket) {
        this.relevant_sockets.push(socket);
    }

    // add our hooks for a new connection
    this.add_connection = function(id, peer){
            this.trigger("new-connection", {id:id, peer:peer});
        // run handle message every time we get new data
        peer.on("data", function(data) {
            this.handle_message(data, peer);
        }.bind(this));
        // if we need backlogs, wait until we're fully connected, and then ask for them
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
            if (this.downstream_peers > 0) {
                this.downstream_peers--;
            }
        }.bind(this);
        peer.on("close", disconnect);
        peer.on("error", disconnect);
        // keep a list of active connections
        this.connections.push(peer);
    }

    // hashing function
    this.hash = function(text) {
        var hasher = new jsSHA("SHA-512", "TEXT");
        hasher.update(text);
        return hasher.getHash("B64");
    }

    // send a message to peers subscribing to that data
    this.send = function(message){
        if (match_queries(message, this.query) < 1.0) {
            console.error("You cannot send a message that does not match this sub's query");
        }
        this.messages.push(message);
        this.connections.forEach(function(peer){
            if (peer._channelReady) {
                peer.send(JSON.stringify({
                    type: "message",
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
                return;
            }
        });
        return seen;
    }

    this.handle_message = function(data, from_peer) {
        var data = JSON.parse(data);
        this.trigger("data", {data: data, from_peer: from_peer});
        if (data.type == "message") {
            if (match_queries(data.data, this.query) == 1.0) {
                if (!this.seen_message(data.data)) {
                    this.trigger("message", data.data);
                    // send the message to other peers
                    this.send(data.data);
                }
            }
        }
        else if (data.type == "backlog_request") {
            // make a list of all the messages we've recived that match the request
            var backlogs = [];
            this.messages.forEach(function(backlog) {
                if (match_queries(backlog, data.query) == 1.0) {
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
                    this.messages.push(backlog);
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
        for (var i = 0; i < this.min_connections - this.connections.length; i++) {
            // connect to the last socket on the list and remove it
            if (this.relevant_sockets.length > 0) {
                this.tn.initiate_connection(this.relevant_sockets.pop());
            }
        }
    }
}

function TaiiNet() {
    // gets a random signaller.
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
                    if (match_queries(sub.query, message.data.query) == 1.0) {
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

// does query match data
function query_match_data(query, data) {
    return new mingo.Query({"a": query}).test({"a": data});
}

function query_match_query(q1, q2){
    var relevancy = 1.0;
    // there were too many variables in this function to name them all, sorry :\
    // iterate the keys in the first query
    for (var k1 in q1) {
        var v1 = q1[k1];
        // iterate keys in the second query
        for (var k2 in q2) {
            var v2 = q2[k2];
            // make an array of tests to do
            var a = [
                [k1, v1, v2],
                [k2, v2, v1]
            ]
            var r = [];
            // interate the test array
            for (var i in a) {
                var d = a[i];
                // if it works with this method
                var compatible_keys;
                compatible_keys = ["$lt", "$gt", "$ne", "$eq"];
                if (compatible_keys.indexOf(d[0]) >= 0) {
                    var k = d[0];
                    r.push(query_match_data({k: d[1]}, d[2]));
                }
            }
            if (r[0]) {
                if (r[1]) {
                    continue
                }
                relevancy /= 2;
                continue
            }
            return 0.0;
        }
    }
    return relevancy;
}

// is query1 encompassed by query2
function match_queries(q1, q2) {
    relevancy = 1.0
    for (var k1 in q1) {
        var v1 = q1[k1];
        if (q2[k1] != undefined) {
            // this key is in both queries
            if (typeof(q1[k1]) == "object") {
                if (typeof(q2[k1]) == "object") {
                    // both values are smart queries
                    relevancy *= query_match_query(q1[k1], q2[k1]);
                }
                else {
                    // v1 is a query but v2 is data
                    if (query_match_data(q1[k1], q2[k1])) {
                        relevancy /= 2;
                        continue;
                    }
                    return 0.0;
                }
            }
            else {
                if (typeof(q2[k1]) == "object") {
                    // v1 is data but v2 is a query
                    if (!query_match_data(q2[k1], q1[k1])) {
                        return 0.0;
                    }
                    continue;
                }
                else {
                    // both values are data
                    if (q1[k1] != q2[k1]) {
                        return 0.0;
                    }
                    continue;
                }
            }
        }
    }
    // for each key q2 has that q1 doesn't, lower relevancy
    for (var k2 in q2) {
        if (q1[k2] == undefined) {
            relevancy /= 2;
        }
    }
    return relevancy;
}
