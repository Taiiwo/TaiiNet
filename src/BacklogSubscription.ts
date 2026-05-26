import { query_match_data } from "./query.js";
import { Subscription } from "./Subscription.js";
import type { QueryRecord, SwarmDataEvent } from "./types.js";

export class BacklogSubscription extends Subscription {
  constructor(...args: ConstructorParameters<typeof Subscription>) {
    super(...args);

    this.on("upstream-peer", (peer) => {
      this.swarm.send_direct(peer, { query: this.query }, "backlog_query");
    });
  }

  override handle_data(data: { type: string; data: QueryRecord }, event: SwarmDataEvent): void {
    const serializedMessage = JSON.stringify(data.data);

    if (data.type === "message") {
      if (this.messages.includes(serializedMessage)) {
        return;
      }

      this.messages.push(serializedMessage);
      this.trigger("data", data.data, event);

      for (const peer of this.downstream_peers) {
        if (peer.sid !== event.sid && query_match_data(peer.query ?? {}, data.data)) {
          this.swarm.send_direct(peer, data.data, "backlog");
        }
      }

      return;
    }

    if (data.type === "backlog") {
      if (!this.messages.includes(serializedMessage)) {
        this.messages.push(serializedMessage);
      }
      this.trigger("data", data.data, event);
      return;
    }

    if (data.type === "backlog_query") {
      const requestingPeer = this.swarm.connected_peers[event.sid];

      if (!requestingPeer) {
        return;
      }

      for (const message of this.messages) {
        this.swarm.send_direct(requestingPeer, JSON.parse(message) as QueryRecord, "backlog");
      }

      return;
    }

    super.handle_data(data, event);
  }

  override send(data: QueryRecord): void {
    const serializedMessage = JSON.stringify(data);

    if (!this.messages.includes(serializedMessage)) {
      this.messages.push(serializedMessage);
    }

    this.swarm.send(data, "message");
  }
}
