import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

import { EventBase } from "../src/EventBase.js";
import { useTaiiNet, type UseTaiiNetResult } from "../src/useTaiiNet.js";
import type { ConnectedPeer, QueryRecord, SignalMessage, SocketBroadcast } from "../src/types.js";
import type { Subscription } from "../src/Subscription.js";
import type { TaiiNet } from "../src/TaiiNet.js";

class FakeSubscription extends EventBase<{
  data: (data: QueryRecord, event: { sid: string; rawEvent: { data: string } }) => void;
  "peer-connected": (peer: ConnectedPeer) => void;
  "upstream-peer": (peer: ConnectedPeer) => void;
  "downstream-peer": (peer: ConnectedPeer) => void;
}> {
  upstream_peers: ConnectedPeer[] = [];
  downstream_peers: ConnectedPeer[] = [];
  send = vi.fn();
}

class FakeSwarm extends EventBase<{
  "peer-connected": (peer: ConnectedPeer) => void;
  "peer-disconnected": (peer: ConnectedPeer) => void;
}> {
  send = vi.fn();
}

class FakeClient extends EventBase<{
  signal: (message: SignalMessage) => void;
  socket: (socket: SocketBroadcast) => void;
}> {
  signaller = {
    disconnect: vi.fn(),
  };
  swarm = new FakeSwarm();
  subscriptions: FakeSubscription[] = [];
  signal = vi.fn();

  subscribe(): Subscription {
    const subscription = new FakeSubscription();
    this.subscriptions.push(subscription);
    return subscription as unknown as Subscription;
  }
}

function Harness({
  client,
  onValue,
}: {
  client: FakeClient;
  onValue: (value: UseTaiiNetResult) => void;
}) {
  const value = useTaiiNet({
    createClient: () => client as unknown as TaiiNet,
  });

  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return null;
}

describe("useTaiiNet", () => {
  it("exposes network events and subscription helpers", () => {
    const client = new FakeClient();
    const onValue = vi.fn<(value: UseTaiiNetResult) => void>();
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(<Harness client={client} onValue={onValue} />);
    });

    const hook = onValue.mock.lastCall?.[0];
    if (!hook) {
      throw new Error("Hook result was not captured");
    }

    const { subscription, unsubscribe } = hook.subscribe(
      { type: "tweet" },
      { backlog: true },
      { onData: vi.fn() },
    );

    hook.send({ body: "hello" }, subscription);
    hook.signal("peer-1", { ok: true }, "signal");

    act(() => {
      client.trigger("signal", {
        from_id: "peer-2",
        type: "signal",
        data: {
          signal_data: {},
          query: {},
        },
      });
      client.trigger("socket", { id: "peer-2", query: { type: "tweet" } });
      client.swarm.trigger("peer-connected", { sid: "peer-2", send() {} });
    });

    const updatedHook = onValue.mock.lastCall?.[0];
    expect(updatedHook?.signals).toHaveLength(1);
    expect(updatedHook?.sockets).toHaveLength(1);
    expect(updatedHook?.connectedPeers).toHaveLength(1);
    expect(client.signal).toHaveBeenCalledWith("peer-1", { ok: true }, "signal");
    expect((subscription as unknown as FakeSubscription).send).toHaveBeenCalledWith({
      body: "hello",
    });

    unsubscribe();

    act(() => {
      renderer?.unmount();
    });

    expect(client.signaller.disconnect).toHaveBeenCalledOnce();
  });
});
