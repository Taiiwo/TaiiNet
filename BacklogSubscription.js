import { Subscription } from "./Subscription";

class BacklogSubscription extends Subscription {
    handle_data(data) {
        if (data.type == "message") {
            // ignore messages we've seen before
            if (this.messages.indexOf(data.data) >= 0) {
                return false;
            }
            else {
                this.messages.push(data.data);
            }
            // we've not seen this message so trigger an event
            this.trigger("message", JSON.parse(data.data));
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
                this.swarm.connected_peers[data.from_id].send(backlog);
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
            this.offer_connection(data.data.sid, data.data.query, data.from_id);
        }

    }
}