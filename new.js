var signallers = [
    //"ws://167.160.189.251:5000/api/1",
    "ws://172.245.155.114:5000/api/1"
];

// represents a connection to the signal server
function SignalNet() {
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

    // add callback funcitonality
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

    // sends a signal to the server
    this.signal = function(to_id, data, type) {
        data.type = type || "message";
        this.signaller.emit("send_message", {
            to_id : to_id,
            from_id: this.signaller.id,
            data: data
        });
    }

    this.signaller.on("message", function(message) {
        if (message.type == "signal") {
            this.trigger("signal", message);
        }
    })

    this.get_signaller();
    // trigger an event when we get a socket
    this.signaller.on("socket_broadcast", function(socket) {
        this.trigger("socket", socket);
    });

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
    this.all_peers_array = [];
    this.connected_peers = {};
    this.connected_peers_array = [];

    // add callback funcitonality
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

    // handle signal messages from the signal server
    this.signaller.on("signal", function(signal){
        if (this.all_peers[signal.from_id] == undefined) {
            // this signal is from a new peer
            var peer = new SimplePeer();
            // when we have a new signal to send, send it with the signalller
            peer.on("signal", function(signal) {
                this.signaller.signal(signal.from_id, {
                    signal_data: signal.data.query
                }, "signal");
            });
            // trigger an event when this peer gets a message
            peer.on("data", function (data) {
                this.trigger("data", data, signal.from_id);
            }.bind(this));
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
                    this.trigger("peer_connected", event);
                    this.handle_datachannel(event.dc, signal.from_id);
                }.bind(this), 0);
            }.bind(this);
            // add it to the list of peers
            this.all_peers[signal.from_id] = peer;
            this.all_peers_array.push(peer)
        }
        else {
            // we already know this peer
            var peer = this.all_peers[signal.from_id];
        }
        // give this peer our signal
        peer.signal(signal.data.signal);
    });

    // connect to a given socket
    this.connect = function(socket) {
        if (this.all_peers[socket.id] == undefined) {
            // initiate peer object
            var peer = new SimplePeer({initiator: true});
            // handle peer signals by proxying them through the signaller
            peer.on("signal", function(data) {
                this.signaller.signal(socket.id, {
                    signal_data: data
                }, "signal");
            }.bind(this));
            // trigger an event when this peer gets a message
            peer.on("data", function (data) {
                this.trigger("data", data);
            }.bind(this));
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
                    this.trigger("peer_connected", event);
                    this.handle_datachannel(event.dc, socket);
                }.bind(this), 0);
            }.bind(this);
            // file our new connection for later use
            this.all_peers[socket.id] = peer;
            this.all_peers_array.push(peer);
        }
        else {
            var peer = this.all_peers[socket.id];
        }
        return peer;
    };

    this.handle_datachannel = function(peer, socket) {
        this.connected_peers[socket.id] = peer;
        this.connected_peers_array.push(peer);
        for (var q in peer.message_queue) {
            var message = peer.message_queue[q];
            peer.send(message);
        }
    }

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

function Subscription(signaller, swarm, query) {
    this.query = query;

    // add callback funcitonality
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

    // send ourselves to existing clients
    signaller.emit("socket_broadcast", [{
        query: this.query,
        id: this.signaller.id
    }]);

    // tell the signaller what sockets we're interested in
    signaller.emit("get_sockets", {
        query: this.query
    });

    // every single socket we get notified about from the signaller
    signaller.on("socket", function(socket) {
        // check if this socket's query matches the query for this subscription
        if (new Query(socket.query).match(this.query)) {
            // initiate a connection to this peer
            var peer = this.swarm.connect(socket);
            // send this peer a request for information
            this.send_direct(peer, {
                query: query
            }, "data_query");
        }
    });

    this.requests = [
        //  [ peer, query ]
    ];

    // when we get data in from the swarm
    swarm.on("data", function(data) {
        if (data.type == "data_query") {
            // someone is requesting that we send them some data
            this.requests.push([data.data.query])
        }
        else if (data.type == "message") {
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
            for (var i in this.requests) {
                var request = this.request[i];
                if (new Query(request[1]).match(data)) {
                    request[0].send(data);
                }
            }
        }
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
    });
}

function WaterfallSubscription(sub) {
    // an array of our downstream peers
    this.downstream = [];
    this.upstream = false;
    sub.swarm.on("connect", function(peer){
        if (!this.upstream && !this.upstream.connected) {
            // This is probably our first connection, they are our upstream
            peer.send({
                type: "upstream_request"
            });
        }
    })
    sub.swarm.on("data", function(data) {
        if (data.type == "data") {
            // we got some data, send it down stream
        }
        else if (data.type == "")
    }.bind(this));
}

var sn = new SignalNet();
