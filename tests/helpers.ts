import type { QueryRecord, SignallerSocketLike } from "../src/types.js";

export class FakeSignaller implements SignallerSocketLike {
  id = "socket-1";
  readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
  readonly emitted: Array<{ event: string; payload?: unknown }> = [];

  on(event: string, callback: (...args: any[]) => void): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(callback);
    this.handlers.set(event, handlers);
  }

  emit(event: string, payload?: unknown): void {
    this.emitted.push({ event, payload });
  }

  trigger(event: string, ...args: any[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

export class FakeChannel {
  sid?: string;
  query?: QueryRecord;
  sent: string[] = [];
  onmessage?: (event: { data: string }) => void;

  send(data: string): void {
    this.sent.push(data);
  }
}

export function createSwarmStub() {
  return {
    all_peers: {} as Record<string, { sid?: string; query?: QueryRecord }>,
    connected_peers: {} as Record<string, FakeChannel>,
    connectCalls: [] as Array<{ id: string; query: QueryRecord; via?: string }>,
    dataHandler: undefined as
      | ((data: { type: string; data: QueryRecord }, event: { sid: string; rawEvent: { data: string } }) => void)
      | undefined,
    peerConnectedHandler: undefined as ((peer: FakeChannel) => void) | undefined,
    peerDisconnectedHandler: undefined as ((peer: FakeChannel) => void) | undefined,
    connect(id: string, query: QueryRecord, via?: string) {
      this.connectCalls.push({ id, query, via });
      return { sid: id, query, message_queue: [], on() {}, signal() {} };
    },
    on(event: string, callback: (...args: any[]) => void) {
      if (event === "data") {
        this.dataHandler = callback;
      } else if (event === "peer-connected") {
        this.peerConnectedHandler = callback;
      } else if (event === "peer-disconnected") {
        this.peerDisconnectedHandler = callback;
      }
    },
    send() {},
    send_direct(peer: FakeChannel, data: QueryRecord, type = "data") {
      peer.send(JSON.stringify({ type, data }));
    },
  };
}
