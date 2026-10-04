import { randomUUID } from 'node:crypto';
import { defaultSettings, type SettingsStore } from '../core/settings.js';
import { FoundryClientError, type CodingAgent, type FoundryClient, type TaskRequest } from '../foundry/client.js';
import type { SandboxHeartbeat } from './heartbeat.js';
import type { TaskEventHub, TaskEventMessage, TaskStore } from './task-store.js';

export interface DispatchClaim {
  taskId: string;
  projectId: string;
  title: string;
  request: string;
  agent: CodingAgent;
  modelOverride: string | null;
  reasoningOverride: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  sandboxSize: '1x2' | '2x4';
  tech: string;
}

export type DispatchClaimResult =
  | { kind: 'claimed'; task: DispatchClaim }
  | { kind: 'idle'; nextAttemptAt: string | null };

export interface DispatcherStore {
  claimNext(owner: string, leaseSeconds: number, maxAttempts: number): Promise<DispatchClaimResult>;
  deferClaim(owner: string, task: DispatchClaim, delayMs: number): Promise<void>;
  failStart(owner: string, task: DispatchClaim, retryAt: string | null, reason: string): Promise<void>;
  recordStarted(owner: string, task: DispatchClaim, agentName: string, accepted: {
    sessionId: string;
    invocationId: string;
  }): Promise<string>;
  endTaskSessions(taskId: string, state: string): Promise<string[]>;
}

export interface DispatcherOptions {
  leaseSeconds?: number;
  maxAttempts?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}

const defaultLeaseSeconds = 120;
const defaultMaxAttempts = 3;
const firstRetryDelayMs = 15_000;
const maxRetryDelayMs = 5 * 60_000;
const maxSettingsModelLength = 100;
const maxSettingsReasoningLength = 32;

function configuredValue(value: unknown, fallback: string, limit: number): string {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string' && parsed.length > 0 && parsed.length <= limit) return parsed;
  } catch { /* Missing or malformed settings fall back to the validated defaults. */ }
  return fallback;
}

function retryableStartFailure(error: unknown): boolean {
  return error instanceof FoundryClientError &&
    (error.kind === 'auth' || (error.kind === 'http' && error.statusCode === 429));
}

function agentName(task: DispatchClaim): string {
  const image = task.tech.startsWith('dotnet') ? 'dotnet' : 'base';
  return `jarvis-runner-${image}-${task.sandboxSize}`;
}

function isCredentialWait(kind: string): boolean {
  return kind === 'renewal-active';
}

function isCredentialFailure(kind: string): boolean {
  return kind === 'credential-unavailable';
}

export class TaskDispatcher {
  private readonly owner = randomUUID();
  private readonly leaseSeconds: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private started = false;
  private wakePending = false;
  private pumping: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly store: DispatcherStore,
    private readonly tasks: TaskStore,
    private readonly settings: SettingsStore,
    private readonly clientFor: (agentName: string) => Pick<FoundryClient, 'startTask' | 'deleteSession'>,
    private readonly heartbeat: SandboxHeartbeat,
    private readonly events: TaskEventHub,
    options: DispatcherOptions = {},
  ) {
    this.leaseSeconds = options.leaseSeconds ?? defaultLeaseSeconds;
    this.maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.events.subscribe((event) => this.onTaskEvent(event));
    this.wake();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.wakePending = false;
    await this.pumping;
  }

  private onTaskEvent(event: TaskEventMessage): void {
    if (event.type === 'state_changed') {
      const payload = event.payload;
      const state = typeof payload === 'object' && payload !== null && 'to' in payload
        ? (payload as { to?: unknown }).to
        : undefined;
      if (state === 'Paused' || state === 'NeedsAttention' || state === 'Done' || state === 'Cancelled') {
        void this.store.endTaskSessions(event.taskId, state)
          .then((sessionIds) => sessionIds.forEach((id) => this.heartbeat.untrack(id)))
          .catch(this.onError);
      }
    }
    if (event.type === 'created' || event.type === 'state_changed' || event.type === 'dispatch_retry') {
      this.wake();
    }
  }

  private wake(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pumping) {
      this.wakePending = true;
      return;
    }
    this.pumping = this.pump().catch(this.onError).finally(() => {
      this.pumping = undefined;
      if (this.wakePending && this.started) {
        this.wakePending = false;
        this.wake();
      }
    });
  }

  private async pump(): Promise<void> {
    while (this.started) {
      const result = await this.store.claimNext(this.owner, this.leaseSeconds, this.maxAttempts);
      if (result.kind === 'idle') {
        this.schedule(result.nextAttemptAt);
        return;
      }
      try {
        await this.startClaim(result.task);
      } catch (error) {
        this.onError(error);
        this.schedule(new Date(this.now() + this.leaseSeconds * 1000).toISOString());
        return;
      }
    }
  }

  private async startClaim(task: DispatchClaim): Promise<void> {
    const transition = await this.tasks.transition(task.taskId, 'Running');
    if (transition.kind !== 'ok') {
      const kind: string = transition.kind;
      if (isCredentialWait(kind)) {
        await this.store.deferClaim(this.owner, task, firstRetryDelayMs);
      } else if (isCredentialFailure(kind)) {
        await this.store.failStart(this.owner, task, null, 'credential_unavailable');
      } else {
        await this.store.deferClaim(this.owner, task, firstRetryDelayMs);
      }
      return;
    }

    let request: TaskRequest;
    try {
      request = await this.taskRequest(task);
    } catch (error) {
      await this.fail(task, error, true);
      return;
    }

    const runnerName = agentName(task);
    let accepted: Awaited<ReturnType<FoundryClient['startTask']>>;
    try {
      accepted = await this.clientFor(runnerName).startTask(request);
    } catch (error) {
      await this.fail(task, error, retryableStartFailure(error));
      return;
    }

    let sandboxSessionId: string;
    try {
      sandboxSessionId = await this.store.recordStarted(this.owner, task, runnerName, accepted);
    } catch (error) {
      try { await this.clientFor(runnerName).deleteSession(accepted.sessionId); }
      catch (cleanupError) { this.onError(cleanupError); }
      await this.store.failStart(this.owner, task, null, 'session_persistence_failed');
      this.onError(error);
      return;
    }
    this.heartbeat.track({
      sandboxSessionId,
      foundrySessionId: accepted.sessionId,
      agentName: runnerName,
      invocationId: accepted.invocationId,
    });
  }

  private async taskRequest(task: DispatchClaim): Promise<TaskRequest> {
    const stored = await this.settings.read();
    const providerSettings = task.agent === 'codex'
      ? defaultSettings.codex
      : defaultSettings.copilot;
    const model = task.modelOverride ??
      configuredValue(stored[`${task.agent}.model`], providerSettings.model, maxSettingsModelLength);
    const request: TaskRequest = task.agent === 'codex'
      ? {
        agent: 'codex',
        task: task.request,
        ...(model === 'default' ? {} : { model }),
        ...((task.reasoningOverride ??
          configuredValue(stored['codex.reasoning_effort'], defaultSettings.codex.reasoning, maxSettingsReasoningLength)) === 'default'
          ? {}
          : { reasoning: task.reasoningOverride ??
            configuredValue(stored['codex.reasoning_effort'], defaultSettings.codex.reasoning, maxSettingsReasoningLength) }),
      }
      : {
        agent: 'copilot',
        task: task.request,
        ...(model === 'default' ? {} : { model }),
      };
    return request;
  }

  private async fail(task: DispatchClaim, error: unknown, retryable: boolean): Promise<void> {
    if (retryable && task.attemptCount < this.maxAttempts) {
      const delay = Math.min(firstRetryDelayMs * 2 ** (task.attemptCount - 1), maxRetryDelayMs);
      const retryAt = new Date(this.now() + delay).toISOString();
      await this.store.failStart(this.owner, task, retryAt, 'foundry_start_rejected');
      this.schedule(retryAt);
    } else {
      await this.store.failStart(this.owner, task, null, 'foundry_start_failed');
    }
    this.onError(error);
  }

  private schedule(nextAttemptAt: string | null): void {
    if (!this.started || nextAttemptAt === null) return;
    const delay = Math.max(0, Date.parse(nextAttemptAt) - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.wake();
    }, delay);
    this.timer.unref();
  }
}
