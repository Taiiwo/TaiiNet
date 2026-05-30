import { describe, expect, it, vi } from "vitest";

import { EventBase } from "../src/EventBase.js";

describe("EventBase", () => {
  it("registers and triggers callbacks", () => {
    const events = new EventBase<{ ping: (value: string) => void }>();
    const handler = vi.fn();

    events.on("ping", handler);
    events.trigger("ping", "pong");

    expect(handler).toHaveBeenCalledWith("pong");
  });

  it("removes callbacks", () => {
    const events = new EventBase<{ ping: () => void }>();
    const handler = vi.fn();

    events.on("ping", handler);
    events.off("ping", handler);
    events.trigger("ping");

    expect(handler).not.toHaveBeenCalled();
  });
});
