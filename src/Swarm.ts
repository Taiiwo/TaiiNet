import SimplePeer from "simple-peer";

import { EventBase } from "./EventBase.js";
import { query_match_data } from "./query.js";
import type {
  ConnectedPeer,
  PeerLike,
  QueryRecord,
  SignalMessage,
  SwarmDataEvent,
} from "./types.js";

type PeerFactory = (options: { initiator?: boolean }) => PeerLike;
type SignalFn = (toId: string, data: unknown, type: string) => void;

interface SwarmOwner {
  on(event: "signal", callback: (signal: SignalMessage) => void): void;
  signal(toId: string, data: unknown, type: string): void;
}

interface SwarmEvents {
  "peer-connected": (peer: ConnectedPeer) => void;
  "peer-disconnected": (peer: ConnectedPeer) => void;
  data: (data: { type: string; data: QueryRecord }, event: SwarmDataEvent) => void;
}

export class Swarm extends EventBase<SwarmEvents> {
  readonly all_peers: Record<string, PeerLike> = {};
  readonly connected_peers: Record<string, ConnectedPeer> = {};

  constructor(
    private readonly signaller: SwarmOwner,
    private readonly peerFactory: PeerFactory = (options) =>
      new (SimplePeer as unknown as new (options: { initiator?: boolean }) => PeerLike)(options),
  ) {
    super();

    this.signaller.on("signal", (signal) => {
      let peer = this.all_peers[signal.from_id];

      if (!peer) {
        peer = this.create_peer(
          signal.from_id,
          signal.data.query,
          this.signaller.signal.bind(this.signaller),
          false,
        );
        this.all_peers[signal.from_id] = peer;
      }

      peer.signal(signal.data.signal_data);
    });
  }

  create_peer(
    sid: string,
    query: QueryRecord,
    signal: SignalFn,
    initiator = false,
  ): PeerLike {
    const peer = this.peerFactory({ initiator });
    peer.message_queue = [];
    peer.query = query;
    peer.sid = sid;

    peer.on("signal", (data) => {
      signal(sid, { signal_data: data, query }, "signal");
    });

    peer.on("connect", () => {
      if (peer._channel) {
        peer._channel.query = query;
        peer._channel.sid = sid;
        this.handle_datachannel(sid, peer._channel, peer);
      }
    });

    const simplePeerCallback = peer._pc?.ondatachannel;
    if (peer._pc) {
      peer._pc.ondatachannel = (event) => {
        simplePeerCallback?.(event);

        setTimeout(() => {
          event.channel.query = query;
          event.channel.sid = sid;
          this.handle_datachannel(sid, event.channel, peer);
        }, 0);
      };
    }

    const disconnect = () => {
      const deadPeer = this.connected_peers[sid];
      delete this.all_peers[sid];
      delete this.connected_peers[sid];

      if (deadPeer) {
        this.trigger("peer-disconnected", deadPeer);
      }
    };

    peer.on("close", disconnect);
    peer.on("error", disconnect);

    return peer;
  }

  connect(sid: string, query: QueryRecord, via?: string): PeerLike {
    const existingPeer = this.all_peers[sid];

    if (existingPeer) {
      return existingPeer;
    }

    if (via) {
      throw new Error("Peer relay connections are not implemented");
    }

    const peer = this.create_peer(sid, query, this.signaller.signal.bind(this.signaller), true);
    this.all_peers[sid] = peer;
    return peer;
  }

  handle_datachannel(sid: string, peer: ConnectedPeer, sourcePeer?: PeerLike): void {
    peer.onmessage = (event) => this.handle_data(sid, event);
    this.connected_peers[sid] = peer;
    this.trigger("peer-connected", peer);

    const queue = sourcePeer?.message_queue ?? [];
    for (const message of queue) {
      peer.send(message);
    }
    if (sourcePeer) {
      sourcePeer.message_queue = [];
    }
  }

  handle_data(sid: string, event: { data: string }): void {
    const data = JSON.parse(event.data) as { type: string; data: QueryRecord };

    if (data.type === "data" || data.type === "message" || data.type === "backlog" || data.type === "backlog_query") {
      this.trigger("data", data, { sid, rawEvent: event });
    }
  }

  send_direct(peer: ConnectedPeer, data: QueryRecord, type = "data"): void {
    peer.send(
      JSON.stringify({
        type,
        data,
      }),
    );
  }

  send(
    data: QueryRecord,
    type = "data",
    peers: Record<string, ConnectedPeer> = this.connected_peers,
  ): void {
    for (const peer of Object.values(peers)) {
      if (query_match_data(peer.query ?? {}, data)) {
        this.send_direct(peer, data, type);
      }
    }
  }
}
