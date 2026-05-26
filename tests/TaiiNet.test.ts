import { describe, expect, it } from "vitest";

import { BacklogSubscription } from "../src/BacklogSubscription.js";
import { TaiiNet } from "../src/TaiiNet.js";
import { FakeSignaller } from "./helpers.js";

describe("TaiiNet", () => {
  it("emits send_message payloads through the signaller", () => {
    const signaller = new FakeSignaller();
    const taiiNet = new TaiiNet({
      createSocket: () => signaller,
      swarmFactory: () => ({ on() {} } as never),
    });

    taiiNet.signal("peer-1", { ok: true }, "signal");

    expect(signaller.emitted.at(-1)).toEqual({
      event: "send_message",
      payload: {
        to_id: "peer-1",
        data: { ok: true },
        type: "signal",
      },
    });
  });

  it("creates backlog subscriptions from subscribe()", () => {
    const signaller = new FakeSignaller();
    const taiiNet = new TaiiNet({
      createSocket: () => signaller,
      swarmFactory: () =>
        ({
          all_peers: {},
          connected_peers: {},
          on() {},
          connect() {
            return { message_queue: [], on() {}, signal() {} };
          },
          send() {},
          send_direct() {},
        }) as never,
    });

    const subscription = taiiNet.subscribe({ type: "tweet" }, { backlog: true });

    expect(subscription).toBeInstanceOf(BacklogSubscription);
  });
});
