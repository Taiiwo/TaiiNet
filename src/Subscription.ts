import { EventBase } from "./EventBase.js";
import { match_queries, query_match_data } from "./query.js";
import type { ConnectedPeer, QueryRecord, SignallerSocketLike, SwarmDataEvent } from "./types.js";
import type { Swarm } from "./Swarm.js";

interface SubscriptionOwner {
  signaller: SignallerSocketLike;
  on(event: "socket", callback: (socket: { id: string; query: QueryRecord }) => void): void;
}

interface SubscriptionEvents {
  data: (data: QueryRecord, event: SwarmDataEvent) => void;
  "peer-connected": (peer: ConnectedPeer) => void;
  "upstream-peer": (peer: ConnectedPeer) => void;
  "downstream-peer": (peer: ConnectedPeer) => void;
}

export interface SubscriptionOptions {
  backlog?: boolean;
}

export class Subscription extends EventBase<SubscriptionEvents> {
  maximum_upstream_peers = 3;
  upstream_peers: ConnectedPeer[] = [];
  upstream_connections = new Set<string>();
  downstream_peers: ConnectedPeer[] = [];
  connection_pool: Array<[string, QueryRecord, string | undefined]> = [];
  messages: string[] = [];

  constructor(
    readonly sn: SubscriptionOwner,
    readonly swarm: Swarm,
    readonly query: QueryRecord,
    readonly options: SubscriptionOptions = {},
  ) {
    super();

    for (const peer of Object.values(this.swarm.all_peers)) {
      if (peer.query && match_queries(this.query, peer.query)) {
        this.offer_connection(peer.sid ?? "", peer.query);
      }
    }

    const registerSocket = () => {
      if (!this.sn.signaller.id) {
        return;
      }

      this.sn.signaller.emit("socket_broadcast", [
        {
          id: this.sn.signaller.id,
          query: this.query,
        },
      ]);
      this.sn.signaller.emit("get_sockets", { query: this.query });
    };

    registerSocket();
    this.sn.signaller.on("connect", registerSocket);

    this.sn.on("socket", (socket) => {
      if (socket.id === this.sn.signaller.id) {
        return;
      }

      this.offer_connection(socket.id, socket.query);
    });

    this.swarm.on("peer-connected", (peer) => {
      if (!peer.query || !match_queries(this.query, peer.query)) {
        return;
      }

      this.trigger("peer-connected", peer);

      if (peer.sid && this.upstream_connections.has(peer.sid)) {
        this.upstream_connections.delete(peer.sid);
        if (!this.upstream_peers.some((connectedPeer) => connectedPeer.sid === peer.sid)) {
          this.upstream_peers.push(peer);
        }
        this.trigger("upstream-peer", peer);
        return;
      }

      if (!this.downstream_peers.some((connectedPeer) => connectedPeer.sid === peer.sid)) {
        this.downstream_peers.push(peer);
      }
      this.trigger("downstream-peer", peer);
    });

    this.swarm.on("peer-disconnected", (deadPeer) => {
      this.upstream_connections.delete(deadPeer.sid ?? "");
      this.upstream_peers = this.upstream_peers.filter((peer) => peer.sid !== deadPeer.sid);
      this.downstream_peers = this.downstream_peers.filter((peer) => peer.sid !== deadPeer.sid);

      const nextPeer = this.connection_pool.shift();
      if (nextPeer) {
        this.offer_connection(...nextPeer);
      }
    });

    this.swarm.on("data", (data, event) => {
      if (!query_match_data(this.query, data.data)) {
        return;
      }

      this.handle_data(data, event);
    });
  }

  handle_data(data: { type: string; data: QueryRecord }, event: SwarmDataEvent): void {
    this.trigger("data", data.data, event);
  }

  offer_connection(id: string, query: QueryRecord, via?: string): void {
    if (!id || !match_queries(query, this.query)) {
      return;
    }

    if (this.upstream_peers.length + this.upstream_connections.size < this.maximum_upstream_peers) {
      this.swarm.connect(id, query, via);
      this.upstream_connections.add(id);
      return;
    }

    this.connection_pool.push([id, query, via]);
  }

  send(data: QueryRecord): void {
    this.swarm.send(data);
  }
}
