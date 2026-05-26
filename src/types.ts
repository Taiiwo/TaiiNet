export type QueryValue =
  | string
  | number
  | boolean
  | null
  | QueryRecord
  | QueryValue[];

export interface QueryRecord {
  [key: string]: QueryValue | undefined;
}

export interface SignallerSocketLike {
  id?: string;
  on(event: string, callback: (...args: any[]) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface SocketBroadcast {
  id: string;
  query: QueryRecord;
  relevancy?: number;
}

export interface SignalPayload {
  signal_data: unknown;
  query: QueryRecord;
}

export interface SignalMessage {
  from_id: string;
  to_id?: string;
  data: SignalPayload;
  type: string;
}

export interface PeerMessageEvent {
  data: string;
}

export interface PeerConnectionLike {
  ondatachannel?: ((event: { channel: ConnectedPeer }) => void) | null;
}

export interface ConnectedPeer {
  sid?: string;
  query?: QueryRecord;
  onmessage?: (event: PeerMessageEvent) => void;
  send(data: string): void;
}

export interface PeerLike {
  _channel?: ConnectedPeer;
  _pc?: PeerConnectionLike;
  message_queue: string[];
  query?: QueryRecord;
  sid?: string;
  status?: string;
  on(event: string, callback: (...args: any[]) => void): void;
  signal(data: unknown): void;
}

export interface SwarmDataEvent {
  sid: string;
  rawEvent: PeerMessageEvent;
}
