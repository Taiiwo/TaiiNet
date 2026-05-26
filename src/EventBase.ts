type EventHandler = (...args: any[]) => void;

export class EventBase<EventMap extends { [K in keyof EventMap]: EventHandler }> {
  private callbacks: Partial<{ [K in keyof EventMap]: EventMap[K][] }> = {};

  on<K extends keyof EventMap>(event: K, callback: EventMap[K]): void {
    const handlers = this.callbacks[event] ?? [];
    handlers.push(callback);
    this.callbacks[event] = handlers;
  }

  off<K extends keyof EventMap>(event: K, callback: EventMap[K]): void {
    const handlers = this.callbacks[event];

    if (!handlers) {
      return;
    }

    this.callbacks[event] = handlers.filter((handler) => handler !== callback);
  }

  trigger<K extends keyof EventMap>(
    event: K,
    ...data: Parameters<EventMap[K]>
  ): void {
    const handlers = this.callbacks[event] ?? [];

    for (const handler of handlers) {
      handler(...data);
    }
  }
}
