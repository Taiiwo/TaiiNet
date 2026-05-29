import { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { EventBase } from "../src/EventBase.js";
import { TaiiNetProvider, useTaiiNet, type UseSubscriptionResult, type UseTaiiNetResult } from "../src/useTaiiNet.js";
import type { Subscription } from "../src/Subscription.js";
import type { TaiiNet } from "../src/TaiiNet.js";
import type { ConnectedPeer, QueryRecord, SignalMessage, SocketBroadcast } from "../src/types.js";

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

type TweetData = {
  type: "tweet";
  body: string;
};

function Harness({
  onHookValue,
  onSubscriptionValue,
}: {
  onHookValue: (value: UseTaiiNetResult<{ tweet: TweetData }>) => void;
  onSubscriptionValue: (value: UseSubscriptionResult<TweetData>) => void;
}) {
  const hookValue = useTaiiNet<{ tweet: TweetData }>();
  const subscriptionValue = hookValue.useSubscription({ type: "tweet" }, { backlog: true });

  useEffect(() => {
    onHookValue(hookValue);
  }, [hookValue, onHookValue]);

  useEffect(() => {
    onSubscriptionValue(subscriptionValue);
  }, [onSubscriptionValue, subscriptionValue]);

  return null;
}

describe("useTaiiNet", () => {
  it("supports provider setup and stateful typed subscriptions", () => {
    const client = new FakeClient();
    const onHookValue = vi.fn<(value: UseTaiiNetResult<{ tweet: TweetData }>) => void>();
    const onSubscriptionValue = vi.fn<(value: UseSubscriptionResult<TweetData>) => void>();
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(
        <TaiiNetProvider createClient={() => client as unknown as TaiiNet}>
          <Harness onHookValue={onHookValue} onSubscriptionValue={onSubscriptionValue} />
        </TaiiNetProvider>,
      );
    });

    const hook = onHookValue.mock.lastCall?.[0];
    const initialSubscription = onSubscriptionValue.mock.lastCall?.[0];
    if (!hook || !initialSubscription) {
      throw new Error("Hook values were not captured");
    }

    const { subscription, unsubscribe } = hook.subscribe({ type: "tweet" }, { backlog: true }, { onData: vi.fn() });

    hook.signal("peer-1", { ok: true }, "signal");
    hook.send({ body: "hello" }, subscription);
    initialSubscription.sendData({ type: "tweet", body: "from-hook" });

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
      client.subscriptions[0].trigger(
        "data",
        { type: "tweet", body: "incoming" },
        { sid: "peer-2", rawEvent: { data: "raw" } },
      );
    });

    const updatedHook = onHookValue.mock.lastCall?.[0];
    const updatedSubscription = onSubscriptionValue.mock.lastCall?.[0];
    expect(updatedHook?.signals).toHaveLength(1);
    expect(updatedHook?.sockets).toHaveLength(1);
    expect(updatedHook?.connectedPeers).toHaveLength(1);
    expect(client.signal).toHaveBeenCalledWith("peer-1", { ok: true }, "signal");
    expect((subscription as unknown as FakeSubscription).send).toHaveBeenCalledWith({ body: "hello" });
    expect(client.subscriptions[0].send).toHaveBeenCalledWith({ type: "tweet", body: "from-hook" });
    expect(updatedSubscription?.data).toEqual([{ type: "tweet", body: "incoming" }]);

    act(() => {
      updatedSubscription?.clearData();
    });
    expect(onSubscriptionValue.mock.lastCall?.[0].data).toEqual([]);

    unsubscribe();

    act(() => {
      renderer?.unmount();
    });

    expect(client.signaller.disconnect).toHaveBeenCalledOnce();
  });
});
