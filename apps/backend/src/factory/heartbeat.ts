import { FoundryClientError, type InvocationSnapshot, type RequestOptions } from '../foundry/client.js';

export interface RunningSandbox {
  sandboxSessionId: string;
  foundrySessionId: string;
  agentName: string;
  invocationId: string;
  invocationCompleted?: boolean;
}

export interface SandboxHeartbeatStore {
  listRunning(): Promise<RunningSandbox[]>;
  recordHeartbeat(sandboxSessionId: string, invocationId?: string, invocationCompleted?: boolean): Promise<void>;
  markNeedsAttention(
    sandboxSessionId: string,
    question?: string,
    invocationId?: string,
    invocationCompleted?: boolean,
  ): Promise<'crashed' | 'idle_expired' | 'needs_attention' | false>;
  resolvePause(sandboxSessionId: string, state: 'Running' | 'Paused'): Promise<boolean>;
}

export interface SandboxStatusClient {
  status(invocationId: string, options?: RequestOptions): Promise<InvocationSnapshot>;
}

interface HeartbeatOptions {
  intervalMs?: number;
  failureConfirmMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
  onDecision?: (decision: HeartbeatDecision) => void;
}

export interface HeartbeatDecision {
  sandboxSessionId: string;
  invocationId: string;
  httpStatus: number | null;
  decision: string;
}

interface TrackedSandbox {
  sandbox: RunningSandbox;
  failures: number;
  failureSince: number | undefined;
  timer: NodeJS.Timeout | undefined;
  controller: AbortController | undefined;
  pending: Promise<void> | undefined;
  invocationCompleted: boolean;
  completionHandled: boolean;
}

export const heartbeatIntervalMs = 60_000;
export const heartbeatFailureConfirmMs = 30_000;

export function isSandboxCrashResponse(error: unknown): error is FoundryClientError {
  return error instanceof FoundryClientError && error.kind === 'http' &&
    (error.statusCode === 404 || error.statusCode === 424 ||
      (error.statusCode !== undefined && error.statusCode >= 500 && error.statusCode < 600));
}

export class SandboxHeartbeat {
  private readonly tracked = new Map<string, TrackedSandbox>();
  private readonly intervalMs: number;
  private readonly failureConfirmMs: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private readonly onDecision: (decision: HeartbeatDecision) => void;
  private completionHandler: ((sandbox: RunningSandbox) => Promise<boolean>) | undefined;
  private started = false;

  constructor(
    private readonly store: SandboxHeartbeatStore,
    private readonly clientFor: (agentName: string) => SandboxStatusClient,
    options: HeartbeatOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? heartbeatIntervalMs;
    this.failureConfirmMs = options.failureConfirmMs ?? heartbeatFailureConfirmMs;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
    this.onDecision = options.onDecision ?? (() => {});
  }

  async start(): Promise<void> {
    if (this.started) return;
    const active = await this.store.listRunning();
    this.started = true;
    for (const sandbox of active) this.track(sandbox);
  }

  track(sandbox: RunningSandbox): void {
    const previous = this.tracked.get(sandbox.sandboxSessionId);
    if (previous) this.cancel(previous);
    const entry: TrackedSandbox = {
      sandbox, failures: 0, failureSince: undefined, timer: undefined, controller: undefined, pending: undefined,
      invocationCompleted: sandbox.invocationCompleted ?? false, completionHandled: false,
    };
    this.tracked.set(sandbox.sandboxSessionId, entry);
    if (this.started) this.poll(entry);
  }

  setCompletionHandler(handler: (sandbox: RunningSandbox) => Promise<boolean>): void {
    this.completionHandler = handler;
  }

  untrack(sandboxSessionId: string): void {
    const entry = this.tracked.get(sandboxSessionId);
    if (entry) this.cancel(entry);
    this.tracked.delete(sandboxSessionId);
  }

  async stop(): Promise<void> {
    this.started = false;
    const pending = [...this.tracked.values()].flatMap((entry) => {
      this.cancel(entry);
      return entry.pending ? [entry.pending] : [];
    });
    await Promise.all(pending);
  }

  private poll(entry: TrackedSandbox): void {
    if (!this.started || this.tracked.get(entry.sandbox.sandboxSessionId) !== entry) return;
    const controller = new AbortController();
    entry.controller = controller;
    entry.pending = this.pollOnce(entry, controller.signal).finally(() => {
      if (entry.controller === controller) entry.controller = undefined;
      if (this.started && this.tracked.get(entry.sandbox.sandboxSessionId) === entry && !entry.timer) {
        this.schedule(entry, this.intervalMs);
      }
    });
  }

  private async pollOnce(entry: TrackedSandbox, signal: AbortSignal): Promise<void> {
    let httpStatus: number | null = null;
    const log = (decision: string) => this.onDecision({
      sandboxSessionId: entry.sandbox.sandboxSessionId,
      invocationId: entry.sandbox.invocationId,
      httpStatus,
      decision,
    });
    try {
      const result = await this.clientFor(entry.sandbox.agentName).status(entry.sandbox.invocationId, {
        signal, onResponse: (statusCode) => { httpStatus = statusCode; },
      });
      if (signal.aborted) { log('cancelled'); return; }
      if (result.sessionId !== entry.sandbox.foundrySessionId) {
        throw new Error('Foundry status did not match the tracked session');
      }
      await this.store.recordHeartbeat(
        entry.sandbox.sandboxSessionId, entry.sandbox.invocationId, result.status === 'completed',
      );
      if (signal.aborted) { log('cancelled'); return; }
      entry.failures = 0;
      entry.failureSince = undefined;
      if (result.status === 'paused') {
        const paused = await this.store.resolvePause(entry.sandbox.sandboxSessionId, 'Paused');
        log(paused ? 'paused' : 'pause_unchanged');
        if (paused && !signal.aborted) this.untrack(entry.sandbox.sandboxSessionId);
      } else if (result.status === 'running' || result.status === 'queued') {
        await this.store.resolvePause(entry.sandbox.sandboxSessionId, 'Running');
        log(result.status);
      } else if (result.status === 'completed') {
        entry.invocationCompleted = true;
        if (this.completionHandler && !entry.completionHandled) {
          const handled = await this.completionHandler(entry.sandbox);
          entry.completionHandled = true;
          if (handled && !signal.aborted) this.untrack(entry.sandbox.sandboxSessionId);
        }
        log('completed');
      } else if (result.status === 'needs_attention') {
        const decision = await this.store.markNeedsAttention(
          entry.sandbox.sandboxSessionId, result.error ?? undefined, entry.sandbox.invocationId, entry.invocationCompleted,
        );
        log(decision || 'unchanged');
        if (!signal.aborted) this.untrack(entry.sandbox.sandboxSessionId);
      } else if (result.status === 'failed') {
        const decision = await this.store.markNeedsAttention(
          entry.sandbox.sandboxSessionId, undefined, entry.sandbox.invocationId, entry.invocationCompleted,
        );
        log(decision || 'unchanged');
        if (!signal.aborted) this.untrack(entry.sandbox.sandboxSessionId);
      } else {
        log(result.status);
      }
    } catch (error) {
      if (error instanceof FoundryClientError) httpStatus = error.statusCode ?? httpStatus;
      if (signal.aborted) { log('cancelled'); return; }
      if (isSandboxCrashResponse(error)) {
        entry.failureSince ??= this.now();
        entry.failures += 1;
        if (entry.failures >= 2 || this.now() - entry.failureSince >= this.failureConfirmMs) {
          try {
            const decision = await this.store.markNeedsAttention(
              entry.sandbox.sandboxSessionId, undefined, entry.sandbox.invocationId, entry.invocationCompleted,
            );
            log(decision || 'unchanged');
            if (!signal.aborted) this.untrack(entry.sandbox.sandboxSessionId);
          } catch (storeError) {
            log('persistence_failed');
            this.onError(storeError);
          }
          return;
        }
        log('confirm_failure');
        this.schedule(entry, this.failureConfirmMs);
        return;
      }
      entry.failures = 0;
      entry.failureSince = undefined;
      log('poll_failed');
      this.onError(error);
    }
  }

  private schedule(entry: TrackedSandbox, delayMs: number): void {
    if (!this.started || this.tracked.get(entry.sandbox.sandboxSessionId) !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      this.poll(entry);
    }, delayMs);
    entry.timer.unref();
  }

  private cancel(entry: TrackedSandbox): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.controller?.abort();
  }
}
