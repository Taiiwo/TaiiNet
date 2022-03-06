import { match_queries, query_match_data } from './TaiiNet.js';
import { EventBase } from "./EventBase.js";

export class Subscription extends EventBase {
    constructor(sn, swarm, query, backlog) {
        super();
        this.query = query;
        this.maximum_upstream_peers = 3;
        this.upstream_peers = [];
        this.upstream_connections = [];
        this.downstream_peers = [];
        this.sn = sn;
        this.swarm = swarm;
        this.connection_pool = [];
        this.messages = [];
        this.backlog = backlog;

        // add all the peers from the swarm that have all the data we need for this
        // subscription to our list of peers
        for (var i in swarm.all_peers) {
            if (match_queries(this.query, this.swarm.all_peers[i].query)) {
                this.offer_connection(this.swarm.all_peers[i]);
            }
        }

        // send ourselves to existing clients
        this.sn.signaller.emit("socket_broadcast", [{
            query: this.query
        }]);

        // every single socket we get notified about from the signaller
        this.sn.signaller.on("socket_broadcast", function (socket) {
            console.log("got socket");
            console.log(socket);
            this.offer_connection(socket.id, socket.query);
        }.bind(this));

        swarm.on("peer-connected", function (peer) {
            console.log("swarm fires peer-connected");
            // if peer is one we're interested in
            if (match_queries(this.query, peer.query)) {
                this.trigger("peer-connected", peer);
                // did we initiate this connection?
                if (this.upstream_connections.indexOf(peer)) {
                    this.upstream_peers.push(peer);
                    // remove it from the pool of upstream connections
                    this.upstream_connections = this.upstream_connections.splice(
                        this.upstream_connections.indexOf(peer), 1
                    );
                    this.trigger('upstream-peer', peer);
                }
                else {
                    // request the backlog from this peer
                    this.downstream_peers.push(peer);
                    this.trigger('downstream-peer', peer);
                }
            }
        }.bind(this));

        swarm.on("peer-disconnected", function (dead_peer) {
            console.log("peer-disconnected");
            // remove peer from our lists
            if (this.upstream_connections.indexOf(dead_peer)) {
                this.upstream_connections = this.upstream_connections.splice(
                    this.upstream_connections.indexOf(dead_peer), 1
                );
            }
            if (this.upstream_peers.indexOf(dead_peer)) {
                this.upstream_peers = this.upstream_peers.splice(
                    this.upstream_peers.indexOf(dead_peer), 1
                );
            }
            if (this.downstream_peers.indexOf(dead_peer)) {
                this.downstream_peers = this.downstream_peers.splice(
                    this.downstream_peers.indexOf(dead_peer), 1
                );
            }
        }.bind(this));

        // when we get data in from the swarm
        swarm.on("data", function (data, e) {
            if (!query_match_data(this.query, data.data))
                return;
            this.handle_data(data, e);
        }.bind(this));

        // supply this function with all the peers we know about, and it will
        // connect to them if needed, and store them for later if not
    }

    // handles what the subscription does on receipt of data
    handle_data(data, e) {
        this.trigger("data", data.data, e);
    }

    offer_connection(id, query, via) {
        // check if this socket's query matches the query for this subscription
        if (match_queries(query, this.query)) {
            // if we still need more peers
            if (this.upstream_peers.length + this.upstream_connections.length < this.maximum_upstream_peers) {
                // initiate a connection to this peer
                var peer = this.swarm.connect(id, query, via);
                this.upstream_connections.push(peer);
            }
            else {
                this.connection_pool.push([id, query, via]);
            }
        }
    };

    send(data) {
        this.swarm.send(data);
    }
}
