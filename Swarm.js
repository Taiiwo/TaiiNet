//import 'simple-peer';
import { EventBase } from './EventBase.js';
import { query_match_data } from './TaiiNet.js';

// Represents a connection to a group of peers
export class Swarm extends EventBase {
    constructor(signaller) {
        super();
        this.signaller = signaller;
        this.all_peers = {};
        this.connected_peers = {};

        // handle signal messages from the signal server
        this.signaller.on("signal", function (signal) {
            console.log(signal);
            if (this.all_peers[signal.from_id] == undefined) {
                // this signal is from a new peer
                var peer = this.create_peer(
                    signal.from_id, signal.data.query, this.signaller.signal.bind(this.signaller), false);
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
    }

    // creates a new simple peer object, and adds the hooks it needs to auto connect
    create_peer(sid, query, signal, initiator) {
        // initiate peer object
        var initiator = initiator || undefined;
        var peer = new SimplePeer({ initiator: initiator });
        peer.message_queue = [];
        // handle peer signals by proxying them through the signaller
        peer.on("signal", function (data) {
            signal.bind(this.signaller)(sid, {
                signal_data: data,
                query: query
            }, "signal");
        }.bind(this));
        peer.on("connect", function (data) {
            peer._channel.query = query;
            this.handle_datachannel(sid, peer._channel);
        }.bind(this));
        // a hack to fix a simplepeer bug
        // basically, sometimes the "connect" event isn't called even though the
        // datachannel is connected. To combat this, we just set a new
        // ondatachannel callback, and manually call the original callback
        var simplepeer_callback = peer._pc.ondatachannel;
        peer._pc.ondatachannel = function (event) {
            //simplepeer_callback(event);
            // a timeout is needed here to drop the send method to the end of the
            // call stack. Note that the timeout duration is 0ms and should not cause
            // timing issues
            setTimeout(function () {
                console.log("firing peer-connected from signaller");
                event.channel.query = query;
                this.handle_datachannel(sid, event.channel);
            }.bind(this), 0);
        }.bind(this);

        var disconnect = function () {
            // purge the disconnected peer from the swarm
            for (var i in this.all_peers) {
                if (this.all_peers[i].status == "disconnected") {
                    var dead_peer = this.all_peers[i];
                    this.all_peers = this.all_peers.splice(
                        this.all_peers.indexOf(dead_peer), 1
                    );
                    this.connected_peers = this.connected_peers.splice(
                        this.connected_peers.indexOf(dead_peer), 1
                    );
                    break;
                }
            }
            // we lost a peer connection
            this.trigger("peer-disconnected", dead_peer);
        }.bind(this);

        peer.on("close", disconnect);
        peer.on("error", disconnect);
        return peer;
    }

    // connect to a given socket
    connect(sid, query, via) {
        if (this.all_peers[sid] == undefined) {
            // create hooks
            if (via == undefined) {
                var peer = this.create_peer(sid, query, this.signaller.signal, true);
            }
            else {
                // not implemented
                //var peer = this.create_peer(sid, query, this.connected_peers[via].send_direct, true);
            }
            // file our new connection for later use
            this.all_peers[sid] = peer;
        }
        else {
            var peer = this.all_peers[sid];
        }
        return peer;
    }

    // event handler for when a datachannel has finished connecting
    handle_datachannel(sid, peer) {
        // add the peer to the list of connected peers
        console.log(peer);
        peer.onmessage = this.handle_data.bind(this);
        this.connected_peers[sid] = peer;
        this.trigger("peer-connected", peer);
        // if any messages were sent when there were no connected peers, send
        // them all now
        for (var q in peer.message_queue) {
            var message = peer.message_queue[q];
            peer.send(message);
        }
    }

    // when we get new data from a node on the network
    handle_data(e) {
        // is it data or a signal
        var data = JSON.parse(e.data)
        if (data.type == "data") {
            this.trigger("data", data, e);
        }
        else if (data.type == "signal") {
            // TODO: implement via peer signalling
        }
    }

    // send data directly to a connected peer,
    send_direct(peer, data, type) {
        var payload = JSON.stringify({
            type: type,
            data: data
        });
        peer.send(payload);
    }

    // sends data to all relevant connected peers
    send(data, type, peers) {
        var type = type || "data";
        var peers = peers || this.connected_peers;
        for (var p in peers) {
            var peer = peers[p];
            if (query_match_data(peer.query, data)) {
                this.send_direct(peer, data, type);
            }
        }
    }
}
