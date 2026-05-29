import { useCallback, useEffect, useRef, useState } from "react";

import { TaiiNet, type TaiiNetOptions } from "./TaiiNet.js";
import type { ConnectedPeer, QueryRecord, SignalMessage, SocketBroadcast, SwarmDataEvent } from "./types.js";
import type { Subscription, SubscriptionOptions } from "./Subscription.js";

export interface UseTaiiNetOptions extends TaiiNetOptions {
  createClient?: (options: TaiiNetOptions) => TaiiNet;
}

export interface SubscriptionHandlers {
  onData?: (data: QueryRecord, event: SwarmDataEvent) => void;
  onPeerConnected?: (peer: ConnectedPeer) => void;
  onUpstreamPeer?: (peer: ConnectedPeer) => void;
  onDownstreamPeer?: (peer: ConnectedPeer) => void;
}

export interface UseTaiiNetResult {
  client: TaiiNet;
  signals: SignalMessage[];
  sockets: SocketBroadcast[];
  connectedPeers: ConnectedPeer[];
  signal: (toId: string, data: unknown, type: string) => void;
  createSubscription: (query: QueryRecord, options?: SubscriptionOptions) => Subscription;
  subscribe: (
    query: QueryRecord,
    options?: SubscriptionOptions,
    handlers?: SubscriptionHandlers,
  ) => { subscription: Subscription; unsubscribe: () => void };
  send: (data: QueryRecord, subscription?: Subscription) => void;
}

export function useTaiiNet(options: UseTaiiNetOptions = {}): UseTaiiNetResult {
  const { createClient, ...taiiNetOptions } = options;
  const [signals, setSignals] = useState<SignalMessage[]>([]);
  const [sockets, setSockets] = useState<SocketBroadcast[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<ConnectedPeer[]>([]);
  const subscriptionsRef = useRef<Set<Subscription>>(new Set());
  const clientRef = useRef<TaiiNet | null>(null);

  if (!clientRef.current) {
    clientRef.current = createClient ? createClient(taiiNetOptions) : new TaiiNet(taiiNetOptions);
  }

  const client = clientRef.current;

  useEffect(() => {
    const onSignal = (message: SignalMessage) => {
      setSignals((current) => [...current, message]);
    };

    const onSocket = (socket: SocketBroadcast) => {
      setSockets((current) => [...current, socket]);
    };

    const onPeerConnected = (peer: ConnectedPeer) => {
      setConnectedPeers((current) => {
        if (current.some((existing) => existing.sid === peer.sid)) {
          return current;
        }
        return [...current, peer];
      });
    };

    const onPeerDisconnected = (peer: ConnectedPeer) => {
      setConnectedPeers((current) => current.filter((existing) => existing.sid !== peer.sid));
    };

    client.on("signal", onSignal);
    client.on("socket", onSocket);
    client.swarm.on("peer-connected", onPeerConnected);
    client.swarm.on("peer-disconnected", onPeerDisconnected);

    return () => {
      client.off("signal", onSignal);
      client.off("socket", onSocket);
      client.swarm.off("peer-connected", onPeerConnected);
      client.swarm.off("peer-disconnected", onPeerDisconnected);

      for (const subscription of subscriptionsRef.current) {
        subscription.upstream_peers = [];
        subscription.downstream_peers = [];
      }
      subscriptionsRef.current.clear();
      client.signaller.disconnect?.();
    };
  }, [client]);

  const createSubscription = useCallback(
    (query: QueryRecord, subscriptionOptions: SubscriptionOptions = {}) => {
      const subscription = client.subscribe(query, subscriptionOptions);
      subscriptionsRef.current.add(subscription);
      return subscription;
    },
    [client],
  );

  const subscribe = useCallback(
    (query: QueryRecord, subscriptionOptions: SubscriptionOptions = {}, handlers: SubscriptionHandlers = {}) => {
      const subscription = createSubscription(query, subscriptionOptions);

      if (handlers.onData) {
        subscription.on("data", handlers.onData);
      }
      if (handlers.onPeerConnected) {
        subscription.on("peer-connected", handlers.onPeerConnected);
      }
      if (handlers.onUpstreamPeer) {
        subscription.on("upstream-peer", handlers.onUpstreamPeer);
      }
      if (handlers.onDownstreamPeer) {
        subscription.on("downstream-peer", handlers.onDownstreamPeer);
      }

      const unsubscribe = () => {
        if (handlers.onData) {
          subscription.off("data", handlers.onData);
        }
        if (handlers.onPeerConnected) {
          subscription.off("peer-connected", handlers.onPeerConnected);
        }
        if (handlers.onUpstreamPeer) {
          subscription.off("upstream-peer", handlers.onUpstreamPeer);
        }
        if (handlers.onDownstreamPeer) {
          subscription.off("downstream-peer", handlers.onDownstreamPeer);
        }
        subscriptionsRef.current.delete(subscription);
      };

      return { subscription, unsubscribe };
    },
    [createSubscription],
  );

  const send = useCallback((data: QueryRecord, subscription?: Subscription) => {
    if (subscription) {
      subscription.send(data);
      return;
    }

    client.swarm.send(data);
  }, [client]);

  const signal = useCallback((toId: string, data: unknown, type: string) => {
    client.signal(toId, data, type);
  }, [client]);

  return {
    client,
    signals,
    sockets,
    connectedPeers,
    signal,
    createSubscription,
    subscribe,
    send,
  };
}
