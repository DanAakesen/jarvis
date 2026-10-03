export interface EventHub<T> {
  publish(event: T): void;
  subscribe(listener: (event: T) => void): () => void;
}

export function createEventHub<T>(): EventHub<T> {
  const listeners = new Set<(event: T) => void>();

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
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
