export interface EventHub<T> {
  publish(event: T): void;
  subscribe(listener: (event: T) => void): () => void;
  close(): void;
}

export function createEventHub<T>(): EventHub<T> {
  const listeners = new Set<(event: T) => void>();
  let closed = false;

  return {
    publish(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          listeners.delete(listener);
        }
      }
    },
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}
