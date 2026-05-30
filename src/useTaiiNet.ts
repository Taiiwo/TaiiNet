import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { TaiiNet, type TaiiNetOptions } from "./TaiiNet.js";
import type { Subscription, SubscriptionOptions } from "./Subscription.js";
import type { ConnectedPeer, QueryRecord, SignalMessage, SocketBroadcast, SwarmDataEvent } from "./types.js";

export interface UseTaiiNetOptions extends TaiiNetOptions {
  createClient?: (options: TaiiNetOptions) => TaiiNet;
}

export interface TaiiNetProviderProps extends UseTaiiNetOptions {
  children?: ReactNode;
}

export interface SubscriptionHandlers {
  onData?: (data: QueryRecord, event: SwarmDataEvent) => void;
  onPeerConnected?: (peer: ConnectedPeer) => void;
  onUpstreamPeer?: (peer: ConnectedPeer) => void;
  onDownstreamPeer?: (peer: ConnectedPeer) => void;
}

export interface UseSubscriptionResult<TData extends QueryRecord> {
  data: TData[];
  sendData: (data: TData) => void;
  clearData: () => void;
  subscription: Subscription;
}

export type SubscriptionTypeMap = Record<string, QueryRecord>;

export type UseSubscriptionHook = {
  <TSubscriptions extends SubscriptionTypeMap, TType extends keyof TSubscriptions & string>(
    query: QueryRecord & { type: TType },
    options?: SubscriptionOptions,
  ): UseSubscriptionResult<TSubscriptions[TType]>;
  <TData extends QueryRecord = QueryRecord>(
    query: QueryRecord,
    options?: SubscriptionOptions,
  ): UseSubscriptionResult<TData>;
};

interface TaiiNetContextValue {
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
  removeSubscription: (subscription: Subscription) => void;
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
  useSubscription: UseSubscriptionHook;
}

const TaiiNetContext = createContext<TaiiNetContextValue | null>(null);

export function TaiiNetProvider({
  children,
  createClient,
  ...taiiNetOptions
}: TaiiNetProviderProps) {
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

  const removeSubscription = useCallback((subscription: Subscription) => {
    subscriptionsRef.current.delete(subscription);
  }, []);

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
        removeSubscription(subscription);
      };

      return { subscription, unsubscribe };
    },
    [createSubscription, removeSubscription],
  );

  const send = useCallback(
    (data: QueryRecord, subscription?: Subscription) => {
      if (subscription) {
        subscription.send(data);
        return;
      }

      client.swarm.send(data);
    },
    [client],
  );

  const signal = useCallback(
    (toId: string, data: unknown, type: string) => {
      client.signal(toId, data, type);
    },
    [client],
  );

  const contextValue = useMemo<TaiiNetContextValue>(
    () => ({
      client,
      signals,
      sockets,
      connectedPeers,
      signal,
      createSubscription,
      subscribe,
      send,
      removeSubscription,
    }),
    [client, connectedPeers, createSubscription, removeSubscription, send, signal, signals, sockets, subscribe],
  );

  return createElement(TaiiNetContext.Provider, { value: contextValue }, children);
}

export function useTaiiNet(): UseTaiiNetResult {
  const context = useContext(TaiiNetContext);

  if (!context) {
    throw new Error("useTaiiNet must be used inside TaiiNetProvider");
  }

  const { createSubscription, removeSubscription } = context;

  const useSubscription = useCallback(
    <TData extends QueryRecord = QueryRecord>(query: QueryRecord, options: SubscriptionOptions = {}) => {
      const queryKey = JSON.stringify(query);
      const optionsKey = JSON.stringify(options);
      const stableQuery = useMemo(() => query, [queryKey]);
      const stableOptions = useMemo(() => options, [optionsKey]);
      const subscription = useMemo(
        () => createSubscription(stableQuery, stableOptions),
        [createSubscription, stableOptions, stableQuery],
      );
      const [data, setData] = useState<TData[]>([]);

      useEffect(() => {
        setData([]);

        const onData = (payload: QueryRecord) => {
          setData((current) => [...current, payload as TData]);
        };

        subscription.on("data", onData);

        return () => {
          subscription.off("data", onData);
          subscription.upstream_peers = [];
          subscription.downstream_peers = [];
          removeSubscription(subscription);
        };
      }, [removeSubscription, subscription]);

      const sendData = useCallback(
        (payload: TData) => {
          subscription.send(payload);
        },
        [subscription],
      );

      const clearData = useCallback(() => {
        setData([]);
      }, []);

      return {
        data,
        sendData,
        clearData,
        subscription,
      };
    },
    [createSubscription, removeSubscription],
  ) as UseSubscriptionHook;

  return {
    client: context.client,
    signals: context.signals,
    sockets: context.sockets,
    connectedPeers: context.connectedPeers,
    signal: context.signal,
    createSubscription: context.createSubscription,
    subscribe: context.subscribe,
    send: context.send,
    useSubscription,
  };
}
