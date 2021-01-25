var signallers = [
    //"ws://167.160.189.251:5000/api/1",
    "ws://localhost:5000/api/1"
];

// represents a connection to the signal server
function SignalNet() {
    this.get_signaller = function(callbacks) {
        // select random signaller
        var host = signallers[Math.floor(Math.random()*signallers.length)];
        this.signaller = io(host);
        // add all the callbacks from the previous signaller
        if (callbacks) {
            this.signaller._callbacks = callbacks;
        }
        this.signaller.on("disconnect", function() {
            var callbacks = this.signaller._callbacks;
            setTimeout(function(){
                this.get_signaller(callbacks);
            }.bind(this), 1000)
        }.bind(this));
    }
    this.get_signaller();

    // add callback funcitonality
    this.callbacks = [];
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

    // sends a signal to the server to pass on to a specific client
    this.signal = function(to_id, data, type) {
        console.log("sending message");
        this.signaller.emit("send_message", {
            to_id: to_id,
            data: data,
            type: type
        });
    }.bind(this);

    // handle messages from signal network
    this.signaller.on("message", function(message) {
        console.log(message);
        // we could handle other message types from the signaller here
        if (message.type == "signal") {
            this.trigger("signal", message);
        }
    }.bind(this))

    // when another client wants to initiate a connection with us, trigger an event
    this.signaller.on("socket_broadcast", function(socket) {
        console.log("got socket broadcast");
        this.trigger("socket", socket);
    }.bind(this));

    // create a swarm for connections made using this object
    this.swarm = new Swarm(this);

    // creates a subscription object
    this.sub = function(query) {
        return new Subscription(this, this.swarm, query);
    }
}

// Represents a connection to a group of peers
function Swarm(signaller) {
    this.signaller = signaller;
    this.all_peers = {};
    this.connected_peers = {};

    // add callback funcitonality
    this.callbacks = [];
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

    // creates a new simple peer object, and adds the hooks it needs to auto connect
    this.create_peer = function(sid, signal, initiator) {
        // initiate peer object
        var initiator = initiator || undefined;
        var peer = new SimplePeer({initiator: initiator});
        // handle peer signals by proxying them through the signaller
        peer.on("signal", function(data) {
            signal(sid, {
                signal_data: data
            }, "signal");
        }.bind(this));
        // trigger an event when this peer gets a message
        peer.on("data", function (data) {
            this.trigger("data", data);
        }.bind(this));
        peer.on("connect", function(data) {
            this.handle_datachannel(peer);
        }.bind(this));
        // a hack to fix a simplepeer bug
        // basically, sometimes the "connect" event isn't called even though the
        // datachannel is connected. To combat this, we just set a new
        // ondatachannel callback, and manually call the original callback
        var simplepeer_callback = peer._pc.ondatachannel;
        peer._pc.ondatachannel = function (event){
            //simplepeer_callback(event);
            // a timeout is needed here to drop the send method to the end of the
            // call stack. Note that the timeout duration is 0ms and should not cause
            // timing issues
            setTimeout(function(){
                console.log("firing peer-connected from signaller")
                this.connected_peers[event.sid] = event;
                this.handle_datachannel(event);
            }.bind(this), 0);
        }.bind(this);

        var disconnect = function() {
            // purge the disconnected peer from the swarm
            for (var i in this.all_peers) {
                if (this.all_peers[i].status == "disconnected") {
                    var dead_peer = this.all_peers[i];
                    delete this.all_peers[i];
                    break;
                }
            }
            // we lost a peer connection
            this.trigger("peer-disconnected", dead_peer)
        }.bind(this);

        peer.on("close", disconnect);
        //peer.on("error", disconnect);
        return peer;
    }

    // handle signal messages from the signal server
    this.signaller.on("signal", function(signal){
        console.log(signal);
        if (this.all_peers[signal.from_id] == undefined) {
            // this signal is from a new peer
            var peer = this.create_peer(signal.from_id, this.signaller.signal, false);
            // add it to the list of peers to mark that we're already connecting
            this.all_peers[signal.from_id] = peer;
        }
        else {
            // we already know this peer
            var peer = this.all_peers[signal.from_id];
        }
        // give this peer our signal
        peer.signal(signal.data.signal_data);
    }.bind(this));

    // connect to a given socket
    this.connect = function(sid, via) {
        if (this.all_peers[sid] == undefined) {
            // create hooks
            if (via == undefined) {
                var peer = this.create_peer(sid, this.signaller.signal, true)
            }
            else {
                var peer = this.create_peer(sid, this.connected_peers[via].send_direct, true)
            }
            // file our new connection for later use
            this.all_peers[sid] = peer;
        }
        else {
            var peer = this.all_peers[sid];
        }
        return peer;
    };

    // event handler for when a datachannel has finished connecting
    this.handle_datachannel = function(peer) {
        // add the peer to the list of connected peers
        this.connected_peers[peer.sid] = peer;
        this.trigger("peer-connected", peer);
        // if any messages were sent when there were no connected peers, send
        // them all now
        for (var q in peer.message_queue) {
            var message = peer.message_queue[q];
            peer.send(message);
        }
    }

    // send data directly to a connected peer,
    this.send_direct = function(peer, data, type) {
        var payload = JSON.stringify({
            type: type,
            data: data
        });
        if (peer.connected) {
            peer.send(payload);
        }
        else {
            peer.message_queue.push(payload);
        }
    }

    this.handle_data = function(data) {
        this.trigger("data", data)
    }
}

function Subscription(sn, swarm, query) {
    this.query = query;
    this.maximum_peers = 3;
    this.all_peers = [];
    this.sn = sn;
    this.swarm = swarm;
    this.connection_pool = [];

    // add all the peers from the swarm that have all the data we need for this
    // subscription to our list of peers
    for (var i in swarm.all_peers) {
        if (match_queries(this.query, swarm.all_peers[i].query)) {
            this.all_peers.push(swarm.all_peers[i])
        }
    }

    // send ourselves to existing clients
    this.sn.signaller.emit("socket_broadcast", [{
        query: this.query
    }]);

    // every single socket we get notified about from the signaller
    this.sn.signaller.on("socket_broadcast", function(socket) {
        console.log("got socket");
        console.log(socket);
        this.offer_connection(socket.id, socket.query);
    }.bind(this));

    swarm.on("peer-connected", function(peer) {
        console.log("swarm fires peer-connected");
        if (this.all_peers.indexOf(peer) >= 0) {
            console.log("subscription firing peer-connected");
            this.trigger("peer-connected");
        }
        if (this.all_peers.length >= this.maximum_peers) {
            this.signaller.disconnect();
        }
    }.bind(this));

    swarm.on("peer-disconnected", function(dead_peer) {
        console.log("peer-disconnected");
        delete this.all_peers[this.all_peers.indexOf(dead_peer)];
    }.bind(this));

    // when we get data in from the swarm
    swarm.on("data", function(data) {
        if (data.type == "message") {
            // ignore messages we've seen before
            var seen = false;
            for (var i in this.messages) {
                var message = this.messages[i];
                if (data.data == message) {
                    seen = true;
                }
            }
            if (seen) {
                return false;
            }
            else {
                this.messages.push(data.data);
            }
            // we've not seen this message so trigger an event
            this.trigger("message", data);
            // tell all the people that have requested this data from us
            for (var i in this.downstream_peers) {
                var peer = this.downstream_peers[i];
                if (query_match_data(peer.query, data)) {
                    peer.send(data);
                }
            }
        }
        // peer is requesting our backlog
        else if (data.type == "backlog_query") {
            for (var i in this.messages) {
                var backlog = this.messages[i];
                backlog.type = "backlog";
                this.swarm.all_peers[data.from_id].send(backlog);
            }
        }
        else if (data.type == "backlog") {
            this.trigger("backlog", data);
        }
        else if (data.type == "peer_request") {
            // a peer is requesting that we send them all our connected peers
            // that match their query
            for (var i in this.connected_peers) {
                if (match_queries(data.query, this.connected_peers[i])) {
                    swarm.send_direct(data.from_id, this.connected_peers[i].sid, "peer_broadcast");
                }
            }
        }
        else if (data.type == "peer_broadcast") {
            // message is a response to a peer request we sent
            this.offer_connection(data.data.sid, data.data.query, data.from_id)
        }
    });

    // supply this function with all the peers we know about, and it will
    // connect to them if needed, and store them for later if not
    this.offer_connection = function(id, query, via) {
        // if we still need more peers
        if (this.all_peers.length < this.maximum_peers) {
            // check if this socket's query matches the query for this subscription
            if (new mingo.Query(query).test(this.query)) {
                // initiate a connection to this peer
                var peer = this.swarm.connect(id, via);
                this.all_peers.push(peer);
            }
        }
        else {
            this.connection_pool.push([id, query, via]);
        }
    }

    this.send = function(data) {
        this.swarm.send(data);
    }

    // add callback funcitonality
    this.callbacks = [];
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
