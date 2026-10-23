export interface OwnerSessionConnectionVerifier {
  isConnectionSessionActive(sessionId: string): Promise<boolean>;
}

export interface OwnerSessionConnectionRegistryOptions {
  readonly verifier: OwnerSessionConnectionVerifier;
  readonly intervalMs?: number;
  readonly jitterMs?: number;
  readonly random?: () => number;
}

export class OwnerSessionConnectionRegistry {
  private readonly verifier: OwnerSessionConnectionVerifier;
  private readonly intervalMs: number;
  private readonly jitterMs: number;
  private readonly random: () => number;
  private readonly connections = new Map<string, Set<() => void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(options: OwnerSessionConnectionRegistryOptions) {
    this.verifier = options.verifier;
    this.intervalMs = options.intervalMs ?? 5 * 60_000;
    this.jitterMs = options.jitterMs ?? 30_000;
    this.random = options.random ?? Math.random;
  }

  register(sessionId: string, close: () => void): () => void {
    if (this.closed) return () => {};
    let sessionConnections = this.connections.get(sessionId);
    if (!sessionConnections) {
      sessionConnections = new Set();
      this.connections.set(sessionId, sessionConnections);
    }
    sessionConnections.add(close);
    this.schedule();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const connections = this.connections.get(sessionId);
      connections?.delete(close);
      if (connections?.size === 0) this.connections.delete(sessionId);
      if (this.connections.size === 0) this.clearTimer();
    };
  }

  closeSession(sessionId: string): void {
    const connections = this.connections.get(sessionId);
    if (!connections) return;
    this.connections.delete(sessionId);
    for (const close of connections) {
      try { close(); } catch { /* The revoke must succeed even if a socket has already failed. */ }
    }
    if (this.connections.size === 0) this.clearTimer();
  }

  closeAll(): void {
    const connections = [...this.connections.values()].flatMap((sessionConnections) => [...sessionConnections]);
    this.connections.clear();
    this.clearTimer();
    for (const close of connections) {
      try { close(); } catch { /* The revoke must succeed even if a socket has already failed. */ }
    }
  }

  close(): void {
    this.closed = true;
    this.connections.clear();
    this.clearTimer();
  }

  private schedule(): void {
    if (this.closed || this.timer !== undefined || this.connections.size === 0) return;
    const jitter = (this.random() * 2 - 1) * this.jitterMs;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.reverify().finally(() => this.schedule());
    }, Math.max(1, this.intervalMs + jitter));
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async reverify(): Promise<void> {
    const sessionIds = [...this.connections.keys()];
    await Promise.all(sessionIds.map(async (sessionId) => {
      if (!this.connections.has(sessionId)) return;
      try {
        if (!await this.verifier.isConnectionSessionActive(sessionId)) this.closeSession(sessionId);
      } catch {
        // Store errors are not a verdict; keep the connection and retry on the next tick.
      }
    }));
  }
}
