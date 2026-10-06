import { randomUUID } from 'node:crypto';
import { defaultSettings, type SettingsStore } from '../core/settings.js';
import type { GitHubDeliveryResult, TaskCompletionGate } from '../github/delivery.js';
import {
  FoundryClientError, type CodingAgent, type FoundryClient, type InvocationAccepted, type TaskRequest, type TaskWorkspace,
} from '../foundry/client.js';
import type { RunningSandbox, SandboxHeartbeat } from './heartbeat.js';
import type { RecoveryClaimResult, TaskRecoveryStore } from './recovery-store.js';
import type {
  TaskControlCommand, TaskControlResult, TaskController, TaskDetail, TaskEventHub, TaskEventMessage, TaskRecord, TaskStore,
} from './task-store.js';

export interface DispatchClaim extends TaskWorkspace {
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

export interface StaleRunningTask extends RunningSandbox {
  taskId: string;
  sessionStatus: 'Active' | 'Ended';
}

export interface DispatcherStore {
  claimNext(owner: string, leaseSeconds: number, maxAttempts: number): Promise<DispatchClaimResult>;
  listStaleRunning(heartbeatBefore: Date, limit: number): Promise<StaleRunningTask[]>;
  recordHeartbeat(sandboxSessionId: string, invocationId: string, invocationCompleted: boolean): Promise<void>;
  deferClaim(owner: string, task: DispatchClaim, delayMs: number): Promise<void>;
  failStart(owner: string, task: DispatchClaim, retryAt: string | null, reason: string): Promise<void>;
  recordStarted(owner: string, task: DispatchClaim, agentName: string, accepted: {
    sessionId: string;
    invocationId: string;
  }): Promise<string>;
  getControlTarget(taskId: string): Promise<TaskControlTarget | null>;
  withTaskPolicyLock<T>(taskId: string, operation: () => Promise<T>): Promise<T>;
  hasPendingProjectPolicyMerge(taskId: string): Promise<boolean>;
  recordControlTurn(target: TaskControlTarget, accepted: InvocationAccepted, message: string): Promise<boolean>;
  recordResumedTurn(target: TaskControlTarget, accepted: InvocationAccepted): Promise<RunningSandbox>;
  endTaskSessions(taskId: string, state: string, invocationCompleted?: boolean): Promise<string[]>;
}

export interface TaskControlTarget extends RunningSandbox, TaskWorkspace {
  taskId: string;
  agent: CodingAgent;
  request: string;
  modelOverride: string | null;
  reasoningOverride: string | null;
  sandboxSize: '1x2' | '2x4';
  image: string;
  sessionStatus: 'Active' | 'Idle';
}

export interface DispatcherOptions {
  leaseSeconds?: number;
  maxAttempts?: number;
  reconciliationIntervalMs?: number;
  staleHeartbeatMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
  onReconciliation?: (decision: TaskReconciliationDecision) => void;
  recoveryStore?: TaskRecoveryStore;
  workspaceFor?: (task: TaskRecord) => Promise<TaskWorkspace | null>;
  verifyDelivery?: (
    workspace: TaskWorkspace,
    task: Pick<TaskRecord, 'id' | 'title'>,
    gate?: TaskCompletionGate,
  ) => Promise<GitHubDeliveryResult>;
}

export interface TaskReconciliationDecision {
  taskId: string;
  sandboxSessionId: string;
  invocationId: string;
  status: string;
  decision: string;
}

const defaultLeaseSeconds = 120;
const defaultMaxAttempts = 3;
const firstRetryDelayMs = 15_000;
const maxRetryDelayMs = 5 * 60_000;
const reconciliationIntervalMs = 5 * 60_000;
const staleHeartbeatMs = 5 * 60_000;
const maxStaleTasksPerPass = 5;
const reconciliationRequestTimeoutMs = 15_000;
const maxSettingsModelLength = 100;
const maxSettingsReasoningLength = 32;
const recoveryEventLimit = 100;
const recoverySummaryEventLimit = 30;
const recoverySteeringLimit = 20;
const recoverySummaryLineLength = 240;
const maxRecoveryPromptLength = 65_000;

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

function transitionResult(kind: string): TaskControlResult {
  if (kind === 'not-found') return { kind: 'not-found' };
  if (kind === 'invalid-transition') return { kind: 'invalid-transition' };
  return { kind: 'failed' };
}

function clipped(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : value;
}

function recoveryPrompt(task: TaskDetail): string {
  const steering = task.events
    .filter((event) => event.type === 'steered' && event.source === 'dan' && event.summary)
    .slice(-recoverySteeringLimit)
    .map((event) => `- ${clipped(event.summary ?? '', recoverySummaryLineLength)}`);
  const events = task.events
    .slice(-recoverySummaryEventLimit)
    .map((event) => `- ${event.at} [${event.source}/${event.type}] ${clipped(event.summary ?? '', recoverySummaryLineLength)}`);
  const prompt = [
    'Continue the existing task from the configured task branch. Do not recreate work already present there.',
    `Original task:\n${task.request}`,
    `Prior steering messages:\n${steering.length > 0 ? steering.join('\n') : 'None recorded.'}`,
    `Task event summary:\n${events.length > 0 ? events.join('\n') : 'No events recorded.'}`,
  ].join('\n\n');
  return clipped(prompt, maxRecoveryPromptLength);
}

function recoveryFailureResult(result: RecoveryClaimResult): TaskControlResult | null {
  if (result.kind === 'claimed') return null;
  if (result.kind === 'not-found') return { kind: 'not-found' };
  if (result.kind === 'invalid-transition') return { kind: 'invalid-transition' };
  return { kind: 'unavailable' };
}

export class TaskDispatcher implements TaskController {
  private readonly owner = randomUUID();
  private readonly leaseSeconds: number;
  private readonly maxAttempts: number;
  private readonly reconciliationIntervalMs: number;
  private readonly staleHeartbeatMs: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private readonly onReconciliation: (decision: TaskReconciliationDecision) => void;
  private readonly recoveryStore: TaskRecoveryStore | undefined;
  private readonly workspaceFor: DispatcherOptions['workspaceFor'];
  private readonly verifyDelivery: DispatcherOptions['verifyDelivery'];
  private started = false;
  private wakePending = false;
  private pumping: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private reconciliationTimer: NodeJS.Timeout | undefined;
  private reconciling: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly store: DispatcherStore,
    private readonly tasks: TaskStore,
    private readonly settings: SettingsStore,
    private readonly clientFor: (agentName: string) => Pick<FoundryClient,
      'startTask' | 'steer' | 'pause' | 'resume' | 'cancel' | 'deleteSession' | 'status'>,
    private readonly heartbeat: SandboxHeartbeat,
    private readonly events: TaskEventHub,
    options: DispatcherOptions = {},
  ) {
    this.leaseSeconds = options.leaseSeconds ?? defaultLeaseSeconds;
    this.maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
    this.reconciliationIntervalMs = options.reconciliationIntervalMs ?? reconciliationIntervalMs;
    this.staleHeartbeatMs = options.staleHeartbeatMs ?? staleHeartbeatMs;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
    this.onReconciliation = options.onReconciliation ?? (() => {});
    this.recoveryStore = options.recoveryStore;
    this.workspaceFor = options.workspaceFor;
    this.verifyDelivery = options.verifyDelivery;
    this.heartbeat.setCompletionHandler((sandbox) => this.acceptCompleted(sandbox));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.events.subscribe((event) => this.onTaskEvent(event));
    this.scheduleReconciliation(0, true);
    this.wake();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.reconciliationTimer) clearTimeout(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    this.wakePending = false;
    await Promise.all([this.pumping, this.reconciling]);
  }

  private scheduleReconciliation(delayMs: number, allowIdle = false): void {
    if (!this.started || (!allowIdle && !this.heartbeat.hasTrackedSessions())) return;
    this.reconciliationTimer = setTimeout(() => {
      this.reconciliationTimer = undefined;
      this.reconciling = this.reconcileStaleTasks().catch(this.onError).finally(() => {
        this.reconciling = undefined;
        this.scheduleReconciliation(this.reconciliationIntervalMs);
      });
    }, delayMs);
    this.reconciliationTimer.unref();
  }

  private async reconcileStaleTasks(): Promise<void> {
    const heartbeatBefore = new Date(this.now() - this.staleHeartbeatMs);
    const stale = await this.store.listStaleRunning(heartbeatBefore, maxStaleTasksPerPass);
    await Promise.all(stale.map(async (task) => {
      try {
        await this.reconcileTask(task);
      } catch (error) {
        this.onError(error);
        this.onReconciliation({
          taskId: task.taskId,
          sandboxSessionId: task.sandboxSessionId,
          invocationId: task.invocationId,
          status: 'unavailable',
          decision: 'reconciliation_failed',
        });
      }
    }));
  }

  private async reconcileTask(task: StaleRunningTask): Promise<void> {
    const log = (status: string, decision: string) => this.onReconciliation({
      taskId: task.taskId,
      sandboxSessionId: task.sandboxSessionId,
      invocationId: task.invocationId,
      status,
      decision,
    });
    let snapshot;
    try {
      snapshot = await this.clientFor(task.agentName).status(task.invocationId, {
        signal: AbortSignal.timeout(reconciliationRequestTimeoutMs),
      });
    } catch (error) {
      this.onError(error);
      const changed = await this.moveToNeedsAttention(
        task.taskId,
        'Jarvis could not verify the task runner after its heartbeat stopped. Review the task before retrying.',
        'runner_status_unavailable',
      );
      log('unavailable', changed ? 'needs_attention' : 'unchanged');
      return;
    }

    if (snapshot.invocationId !== task.invocationId || snapshot.sessionId !== task.foundrySessionId) {
      const changed = await this.moveToNeedsAttention(
        task.taskId,
        'Foundry returned a different runner session than the one recorded for this task. Review the task before retrying.',
        'runner_session_mismatch',
      );
      log(snapshot.status, changed ? 'needs_attention' : 'unchanged');
      return;
    }

    if (snapshot.status === 'running' || snapshot.status === 'queued') {
      if (task.sessionStatus === 'Active') {
        await this.store.recordHeartbeat(task.sandboxSessionId, task.invocationId, false);
        log(snapshot.status, 'runner_alive');
      } else {
        const changed = await this.moveToNeedsAttention(
          task.taskId,
          'Foundry reports that the task runner is still active, but its saved sandbox session has already ended. Review the task before retrying.',
          'ended_session_still_running',
        );
        log(snapshot.status, changed ? 'needs_attention' : 'unchanged');
      }
      return;
    }

    if (snapshot.status === 'completed') {
      await this.store.recordHeartbeat(task.sandboxSessionId, task.invocationId, true);
      await this.acceptCompleted(task, task.taskId);
      const current = await this.tasks.get(task.taskId, 1, 0);
      if (current?.state === 'Running') {
        const changed = await this.moveToNeedsAttention(
          task.taskId,
          'Foundry confirms the runner completed, but GitHub and task policy did not confirm a reviewable completion. Review the pull request and task.',
          'completed_without_verified_delivery',
        );
        log(snapshot.status, changed ? 'needs_attention' : 'unchanged');
      } else {
        log(snapshot.status, current?.state === 'Done' ? 'done' : current?.state ?? 'task_missing');
      }
      return;
    }

    const reason = snapshot.status === 'failed'
      ? 'Foundry reports that the task runner failed. Review its task history, then recover the task.'
      : snapshot.status === 'needs_attention'
        ? 'Foundry reports that the task runner needs input. Review the task history before continuing.'
        : 'Jarvis could not determine the task runner status. Review the task before retrying.';
    const changed = await this.moveToNeedsAttention(task.taskId, reason, `foundry_${snapshot.status}`);
    log(snapshot.status, changed ? 'needs_attention' : 'unchanged');
  }

  private async moveToNeedsAttention(taskId: string, reason: string, reasonCode: string): Promise<boolean> {
    return this.store.withTaskPolicyLock(taskId, async () => {
      const current = await this.tasks.get(taskId, 1, 0);
      if (!current || current.state !== 'Running') return false;
      const result = await this.tasks.transition(taskId, 'NeedsAttention', false, reasonCode, reason);
      if (result.kind !== 'ok') return false;
      const ended = await this.store.endTaskSessions(taskId, 'NeedsAttention');
      ended.forEach((sandboxSessionId) => this.heartbeat.untrack(sandboxSessionId));
      return true;
    });
  }

  async control(taskId: string, command: TaskControlCommand): Promise<TaskControlResult> {
    let task = await this.tasks.get(taskId, 1, 0);
    if (!task) return { kind: 'not-found' };
    const continueWithSteering = command.action === 'steer' && task.latestSessionEndReason === 'idle_expired';
    if (command.action === 'recover' || continueWithSteering) {
      if (task.state === 'Running' && task.latestSessionEndReason === 'idle_expired') {
        const attention = await this.tasks.transition(taskId, 'NeedsAttention');
        if (attention.kind !== 'ok') return transitionResult(attention.kind);
        task = { ...task, ...attention.task };
      }
      return this.recover(task, command.action === 'steer' ? command.message : undefined);
    }
    let target = await this.store.getControlTarget(taskId);
    if (task.state === 'Paused' && target?.sessionStatus === 'Active') {
      const ended = await this.store.endTaskSessions(taskId, 'Paused');
      ended.forEach((id) => this.heartbeat.untrack(id));
      target = await this.store.getControlTarget(taskId);
    }
    const activeTurn = task.state === 'Running' && target?.sessionStatus === 'Active' && target.invocationId;
    const pausedSession = task.state === 'Paused' && target?.sessionStatus === 'Idle';

    if (command.action === 'steer') {
      if (!activeTurn || !target) return { kind: 'invalid-transition' };
      let accepted: InvocationAccepted | undefined;
      try {
        accepted = await this.clientFor(target.agentName).steer(
          target.foundrySessionId, task.agent, command.message, { taskId },
        );
        if (!await this.store.recordControlTurn(target, accepted, command.message)) {
          await this.clientFor(target.agentName).cancel(accepted.invocationId).catch(this.onError);
          return { kind: 'invalid-transition' };
        }
        this.heartbeat.track({ ...target, invocationId: accepted.invocationId });
        this.scheduleReconciliation(this.reconciliationIntervalMs);
        return { kind: 'ok', task };
      } catch {
        if (accepted) await this.clientFor(target.agentName).cancel(accepted.invocationId).catch(this.onError);
        return { kind: 'failed' };
      }
    }

    if (command.action === 'pause') {
      if (!activeTurn || !target) return { kind: 'invalid-transition' };
      const requested = await this.tasks.transition(taskId, 'PauseRequested');
      if (requested.kind !== 'ok') return transitionResult(requested.kind);
      try {
        const acknowledgement = await this.clientFor(target.agentName).pause(target.foundrySessionId);
        if (acknowledgement.status === 'idle') {
          const paused = await this.tasks.transition(taskId, 'Paused');
          if (paused.kind !== 'ok') return transitionResult(paused.kind);
          const ended = await this.store.endTaskSessions(taskId, 'Paused');
          ended.forEach((id) => this.heartbeat.untrack(id));
          return { kind: 'ok', task: paused.task };
        }
        return { kind: 'ok', task: requested.task };
      } catch {
        return { kind: 'failed' };
      }
    }

    if (command.action === 'resume') {
      if (!pausedSession || !target) return { kind: 'invalid-transition' };
      const resumed = await this.tasks.transition(taskId, 'Running');
      if (resumed.kind !== 'ok') return transitionResult(resumed.kind);
      let accepted: InvocationAccepted | undefined;
      try {
        accepted = await this.clientFor(target.agentName).resume(
          target.foundrySessionId,
          await this.taskRequest(taskId, { ...task, ...target }),
        );
        const running = await this.store.recordResumedTurn(target, accepted);
        this.heartbeat.track(running);
        this.scheduleReconciliation(this.reconciliationIntervalMs);
        return { kind: 'ok', task: resumed.task };
      } catch {
        if (accepted) await this.clientFor(target.agentName).cancel(accepted.invocationId).catch(this.onError);
        await this.tasks.transition(taskId, 'NeedsAttention').catch(this.onError);
        return { kind: 'failed' };
      }
    }

    if (task.state !== 'Ready' && task.state !== 'Running' && task.state !== 'Paused') {
      return { kind: 'invalid-transition' };
    }
    if (task.state === 'Running' && (!activeTurn || !target)) return { kind: 'unavailable' };
    if (task.state === 'Paused' && !target) return { kind: 'unavailable' };
    const cancellation = await this.store.withTaskPolicyLock(taskId, async () => {
      const latestTask = await this.tasks.get(taskId, 1, 0);
      if (!latestTask || latestTask.state !== task.state) return { kind: 'state-changed' as const };
      if (await this.store.hasPendingProjectPolicyMerge(taskId)) return { kind: 'merge-pending' as const };
      if (task.state === 'Running' && target) {
        try {
          await this.clientFor(target.agentName).cancel(target.invocationId);
        } catch {
          return { kind: 'cancel-failed' as const };
        }
      }
      return { kind: 'transitioned' as const, result: await this.tasks.transition(taskId, 'Cancelled') };
    });
    if (cancellation.kind === 'cancel-failed') return { kind: 'failed' };
    if (cancellation.kind === 'state-changed' || cancellation.kind === 'merge-pending') {
      return { kind: 'invalid-transition' };
    }
    const cancelled = cancellation.result;
    if (cancelled.kind !== 'ok') return transitionResult(cancelled.kind);
    let cleanupFailed = false;
    if (target) {
      try {
        await this.endSession(target, 'Cancelled');
      } catch (error) {
        cleanupFailed = true;
        this.heartbeat.untrack(target.sandboxSessionId);
        this.onError(error);
      }
      try {
        await this.clientFor(target.agentName).deleteSession(target.foundrySessionId);
      } catch (error) {
        cleanupFailed = true;
        this.onError(error);
      }
    }
    return cleanupFailed ? { kind: 'failed' } : { kind: 'ok', task: cancelled.task };
  }

  private async recover(task: TaskDetail, steering?: string): Promise<TaskControlResult> {
    if (task.state !== 'NeedsAttention') return { kind: 'invalid-transition' };
    const recoveryStore = this.recoveryStore;
    const workspaceFor = this.workspaceFor;
    if (!recoveryStore || !workspaceFor) return { kind: 'unavailable' };
    const workspace = await workspaceFor(task);
    if (!workspace?.repository || !workspace.defaultBranch || !workspace.branch) return { kind: 'unavailable' };

    const claimResult = await recoveryStore.claimRecovery(task.id, this.owner, this.leaseSeconds);
    const failure = recoveryFailureResult(claimResult);
    if (failure) return failure;
    if (claimResult.kind !== 'claimed') return { kind: 'unavailable' };
    const claim = claimResult.task;
    let accepted: InvocationAccepted | undefined;
    try {
      if (steering) {
        await this.tasks.recordEvent({
          taskId: task.id, type: 'steered', summary: steering.slice(0, 2000),
          payload: { message: steering }, source: 'dan',
        });
      }
      const history = await this.tasks.get(task.id, recoveryEventLimit, 0);
      if (!history) {
        await this.store.failStart(this.owner, claim, null, 'recovery_task_missing');
        return { kind: 'not-found' };
      }
      const request = await this.taskRequest(task.id, {
        ...claim,
        ...workspace,
        request: clipped([
          ...(steering ? [`New steering message:\n${steering}`] : []),
          recoveryPrompt(history),
        ].join('\n\n'), maxRecoveryPromptLength),
      });
      const runnerName = agentName(claim);
      accepted = await this.clientFor(runnerName).startTask(request);
      const sandboxSessionId = await this.store.recordStarted(this.owner, claim, runnerName, accepted);
      this.heartbeat.track({
        sandboxSessionId,
        foundrySessionId: accepted.sessionId,
        agentName: runnerName,
        invocationId: accepted.invocationId,
      });
      this.scheduleReconciliation(this.reconciliationIntervalMs);
      return { kind: 'ok', task: { ...task, state: 'Running' } };
    } catch (error) {
      if (accepted) {
        await this.clientFor(agentName(claim)).deleteSession(accepted.sessionId).catch(this.onError);
      }
      await this.store.failStart(this.owner, claim, null, 'recovery_start_failed').catch(this.onError);
      this.onError(error);
      return { kind: 'failed' };
    }
  }

  private async acceptCompleted(sandbox: RunningSandbox, knownTaskId?: string): Promise<boolean> {
    const taskId = knownTaskId ?? await this.recoveryStore?.getRunningTaskForSession(sandbox);
    if (!this.recoveryStore) return true;
    if (!taskId) return false;
    const detail = await this.tasks.get(taskId, recoveryEventLimit, 0);
    if (!detail) return false;
    if (detail.state === 'NeedsAttention') return false;
    if (detail.state !== 'Running') return true;
    const gate: TaskCompletionGate = async (operation) => this.store.withTaskPolicyLock(taskId, async () => {
      const latestTask = await this.tasks.get(taskId, 1, 0);
      if (!latestTask || latestTask.state !== 'Running') return { kind: 'not_running' as const };
      return { kind: 'ran' as const, value: await operation() };
    });
    const workspace = await this.workspaceFor?.(detail) ?? null;
    const result = workspace && this.verifyDelivery
      ? await this.verifyDelivery(workspace, detail, gate)
      : {
        kind: 'refused' as const,
        reason: 'The task repository or branch could not be verified.',
      };
    if (result.kind === 'not_running') return true;
    return this.store.withTaskPolicyLock(taskId, async () => {
      const latestTask = await this.tasks.get(taskId, recoveryEventLimit, 0);
      if (!latestTask) return false;
      if (latestTask.state !== 'Running') return true;
      if (result.kind === 'refused') {
        await this.tasks.recordEvent({
          taskId,
          type: 'pull_request_open_refused',
          summary: result.reason,
          payload: { reason: result.reason },
          source: 'backend',
        });
        const transition = await this.tasks.transition(taskId, 'NeedsAttention', false, 'pull_request_open_refused');
        if (transition.kind !== 'ok') return false;
        const ended = await this.store.endTaskSessions(taskId, 'NeedsAttention', true);
        ended.forEach((id) => this.heartbeat.untrack(id));
        return true;
      }
      const ended = await this.store.endTaskSessions(taskId, 'Done', true);
      ended.forEach((id) => this.heartbeat.untrack(id));
      return true;
    });
  }

  private async endSession(target: TaskControlTarget, state: 'Paused' | 'Cancelled' = 'Paused'): Promise<void> {
    const ids = await this.store.endTaskSessions(target.taskId, state);
    ids.forEach((id) => this.heartbeat.untrack(id));
  }

  private onTaskEvent(event: TaskEventMessage): void {
    if (event.type === 'state_changed') {
      const payload = event.payload;
      const state = typeof payload === 'object' && payload !== null && 'to' in payload
        ? (payload as { to?: unknown }).to
        : undefined;
      const reason = typeof payload === 'object' && payload !== null && 'reason' in payload
        ? (payload as { reason?: unknown }).reason
        : undefined;
      const keepCompletedQuestionSession = state === 'NeedsAttention' && reason === 'session_question';
      if (!keepCompletedQuestionSession &&
        (state === 'Paused' || state === 'NeedsAttention' || state === 'Done' || state === 'Cancelled')) {
        void this.store.endTaskSessions(event.taskId, state, reason === 'pull_request_open_refused')
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
      request = await this.taskRequest(task.taskId, task);
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
    this.scheduleReconciliation(this.reconciliationIntervalMs);
  }

  private async taskRequest(
    taskId: string,
    task: Pick<TaskRecord, 'agent' | 'request' | 'modelOverride' | 'reasoningOverride'> & TaskWorkspace,
  ): Promise<TaskRequest> {
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
        taskId,
        repository: task.repository,
        defaultBranch: task.defaultBranch,
        branch: task.branch,
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
        taskId,
        repository: task.repository,
        defaultBranch: task.defaultBranch,
        branch: task.branch,
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
