import { io } from "socket.io-client";

import { BacklogSubscription } from "./BacklogSubscription.js";
import { EventBase } from "./EventBase.js";
import { Subscription, type SubscriptionOptions } from "./Subscription.js";
import { Swarm } from "./Swarm.js";
import type { QueryRecord, SignalMessage, SignallerSocketLike, SocketBroadcast } from "./types.js";

const DEFAULT_SIGNALLERS = ["ws://localhost:5000/api/1"];

interface TaiiNetEvents {
  signal: (message: SignalMessage) => void;
  socket: (socket: SocketBroadcast) => void;
}

export interface TaiiNetOptions {
  createSocket?: (url: string) => SignallerSocketLike;
  reconnectDelayMs?: number;
  signallers?: string[];
  swarmFactory?: (taiiNet: TaiiNet) => Swarm;
}

export class TaiiNet extends EventBase<TaiiNetEvents> {
  readonly Subscription = Subscription;
  readonly BacklogSubscription = BacklogSubscription;
  readonly signallers: string[];
  readonly reconnectDelayMs: number;
  readonly createSocket: (url: string) => SignallerSocketLike;

  signaller!: SignallerSocketLike;
  swarm: Swarm;

  constructor(options: TaiiNetOptions = {}) {
    super();
    this.signallers = options.signallers ?? DEFAULT_SIGNALLERS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.createSocket = options.createSocket ?? ((url) => io(url));

    this.connect_signaller();
    this.swarm = options.swarmFactory?.(this) ?? new Swarm(this);
  }

  new<T extends typeof Subscription>(
    type: T,
    query: QueryRecord,
    options?: SubscriptionOptions,
  ): InstanceType<T> {
    return new type(this, this.swarm, query, options) as InstanceType<T>;
  }

  subscribe(query: QueryRecord, options: SubscriptionOptions = {}): Subscription {
    return options.backlog
      ? new BacklogSubscription(this, this.swarm, query, options)
      : new Subscription(this, this.swarm, query, options);
  }

  connect_signaller(): void {
    const host = this.signallers[Math.floor(Math.random() * this.signallers.length)];
    const socket = this.createSocket(host);

    socket.on("message", (message: SignalMessage) => {
      if (message.type === "signal") {
        this.trigger("signal", message);
      }
    });

    socket.on("socket_broadcast", (socketBroadcast: SocketBroadcast) => {
      this.trigger("socket", socketBroadcast);
    });

    socket.on("disconnect", () => {
      setTimeout(() => this.connect_signaller(), this.reconnectDelayMs);
    });

    this.signaller = socket;
  }

  signal(to_id: string, data: unknown, type: string): void {
    this.signaller.emit("send_message", {
      to_id,
      data,
      type,
    });
  }
}
