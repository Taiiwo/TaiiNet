import { describe, expect, it } from "vitest";

import { BacklogSubscription } from "../src/BacklogSubscription.js";
import { Subscription } from "../src/Subscription.js";
import { EventBase } from "../src/EventBase.js";
import { createSwarmStub, FakeChannel, FakeSignaller } from "./helpers.js";

class FakeOwner extends EventBase<{ socket: (socket: { id: string; query: Record<string, unknown> }) => void }> {
  constructor(readonly signaller: FakeSignaller) {
    super();
  }
}

describe("Subscription", () => {
  it("registers its query and requests matching sockets", () => {
    const signaller = new FakeSignaller();
    const owner = new FakeOwner(signaller);
    const swarm = createSwarmStub();

    new Subscription(owner, swarm as never, { type: "tweet" });

    expect(signaller.emitted).toEqual([
      {
        event: "socket_broadcast",
        payload: [{ id: "socket-1", query: { type: "tweet" } }],
      },
      {
        event: "get_sockets",
        payload: { query: { type: "tweet" } },
      },
    ]);
  });

  it("connects to matching peers and filters incoming data", () => {
    const signaller = new FakeSignaller();
    const owner = new FakeOwner(signaller);
    const swarm = createSwarmStub();
    const subscription = new Subscription(owner, swarm as never, { type: "tweet" });
    const received: Array<Record<string, unknown>> = [];

    subscription.on("data", (data) => received.push(data));

    owner.trigger("socket", { id: "peer-1", query: { type: "tweet" } });
    owner.trigger("socket", { id: "peer-2", query: { type: "post" } });
    swarm.dataHandler?.(
      { type: "data", data: { type: "tweet", body: "hello" } },
      { sid: "peer-1", rawEvent: { data: "" } },
    );
    swarm.dataHandler?.(
      { type: "data", data: { type: "post", body: "ignored" } },
      { sid: "peer-2", rawEvent: { data: "" } },
    );

    expect(swarm.connectCalls).toEqual([{ id: "peer-1", query: { type: "tweet" }, via: undefined }]);
    expect(received).toEqual([{ type: "tweet", body: "hello" }]);
  });
});

describe("BacklogSubscription", () => {
  it("stores sent messages and serves backlog queries", () => {
    const signaller = new FakeSignaller();
    const owner = new FakeOwner(signaller);
    const swarm = createSwarmStub();
    const peer = new FakeChannel();
    peer.sid = "peer-1";
    peer.query = { type: "tweet" };
    swarm.connected_peers["peer-1"] = peer;

    const subscription = new BacklogSubscription(owner, swarm as never, { type: "tweet" });
    subscription.send({ type: "tweet", body: "stored" });

    subscription.handle_data(
      { type: "backlog_query", data: { query: { type: "tweet" } } },
      { sid: "peer-1", rawEvent: { data: "" } },
    );

    expect(peer.sent).toContain(JSON.stringify({ type: "backlog", data: { type: "tweet", body: "stored" } }));
  });
});
