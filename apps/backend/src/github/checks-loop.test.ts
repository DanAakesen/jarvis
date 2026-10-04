import { describe, expect, it, vi } from 'vitest';
import type { SettingsStore } from '../core/settings.js';
import type { ChecksLoopBlobStore } from '../database/checks-loop-blob.js';
import type { ChecksLoopEventType, ChecksLoopStore, FailedCheckRun } from '../database/checks-loop-store.js';
import type { TaskControlCommand, TaskControlResult, TaskEventRecord, TaskRecord, TaskStore } from '../factory/task-store.js';
import { createChecksLoop } from './checks-loop.js';
import type { GithubWebhookMapping } from './webhook-mapping.js';

const run: FailedCheckRun = {
  repository: 'DanAakesen/jarvis-test-target',
  runId: 71,
  workflow: 'CI',
  pullRequestNumber: 19,
  taskId: '42',
  taskState: 'Running',
  failedRunCount: 1,
  logArtifact: null,
};

const failedWorkflow: GithubWebhookMapping = {
  kind: 'workflow_run',
  repository: run.repository,
  id: run.runId,
  name: run.workflow,
  event: 'pull_request',
  branch: 'jarvis/task-42',
  headSha: 'a'.repeat(40),
  runNumber: 8,
  pullRequestNumbers: [run.pullRequestNumber],
  status: 'completed',
  conclusion: 'failure',
  startedAt: '2026-10-04T12:00:00.000Z',
  completedAt: '2026-10-04T12:01:00.000Z',
};

function setup(options: {
  maxCheckAttempts?: number;
  failedRunCount?: number;
  taskState?: string;
  controllerResult?: TaskControlResult['kind'];
  started?: boolean;
  steered?: boolean;
  logsUnavailable?: boolean;
  log?: Buffer;
} = {}) {
  const currentRun: FailedCheckRun = {
    ...run,
    failedRunCount: options.failedRunCount ?? 1,
    taskState: options.taskState ?? 'Running',
  };
  const events = new Set<ChecksLoopEventType>();
  if (options.started) events.add('checks_retry_started');
  if (options.steered) events.add('steered');
  const store: ChecksLoopStore = {
    getFailedRun: vi.fn(async () => ({ ...currentRun })),
    listPendingFailedRuns: vi.fn(async () => [{ ...currentRun }]),
    hasEvent: vi.fn(async (_taskId, _runId, type) => events.has(type)),
    setLogArtifact: vi.fn(async (_repository, _runId, name) => { currentRun.logArtifact = name; }),
  };
  const tasks: Pick<TaskStore, 'transition' | 'recordEvent'> = {
    transition: vi.fn(async (_taskId, state) => {
      currentRun.taskState = state;
      return { kind: 'ok' as const, task: {} as TaskRecord };
    }),
    recordEvent: vi.fn(async (event) => {
      events.add(event.type as ChecksLoopEventType);
      return {
        id: '1',
        taskId: event.taskId,
        type: event.type,
        summary: event.summary ?? null,
        payload: event.payload ?? null,
        payloadTruncated: false,
        source: event.source,
        at: '2026-10-04T12:02:00.000Z',
      } satisfies TaskEventRecord & { taskId: string };
    }),
  };
  const controller = {
    control: vi.fn(async (taskId: string, command: TaskControlCommand): Promise<TaskControlResult> => {
      expect(taskId).toBe(run.taskId);
      expect(command.action).toBe('steer');
      if (options.controllerResult === 'ok' || options.controllerResult === undefined) {
        events.add('steered');
        return { kind: 'ok', task: {} as TaskRecord };
      }
      return { kind: options.controllerResult };
    }),
  };
  const logs = {
    downloadFailedJobLogs: vi.fn(async () => {
      if (options.logsUnavailable) throw new Error('GitHub Actions logs are unavailable');
      return {
        content: options.log ?? Buffer.from('AssertionError: expected 2 to equal 1'),
        jobs: ['Backend tests'],
      };
    }),
  };
  const blobs: ChecksLoopBlobStore = { upload: vi.fn(async () => {}) };
  const settings: SettingsStore = {
    read: vi.fn(async () => ({
      'global.max_check_attempts': JSON.stringify(options.maxCheckAttempts ?? 3),
    })),
    write: vi.fn(async () => {}),
  };
  const loop = createChecksLoop({
    store,
    logs,
    blobs,
    settings,
    tasks,
    controller,
  });
  return { loop, store, tasks, controller, logs, blobs, currentRun };
}

describe('checks loop', () => {
  it('stores the failed-job log and steers the same task with a bounded diagnostic and reference', async () => {
    const fullLog = Buffer.from(`AssertionError: expected 2 to equal 1\n${'detail '.repeat(3000)}`);
    const { loop, store, tasks, controller, logs, blobs } = setup({ log: fullLog });

    await loop.handleMapping(failedWorkflow);

    expect(logs.downloadFailedJobLogs).toHaveBeenCalledWith(run.repository, run.runId, expect.any(AbortSignal));
    expect(blobs.upload).toHaveBeenCalledWith(`check-logs/${run.taskId}/${run.runId}.log`, fullLog, expect.any(AbortSignal));
    expect(controller.control).toHaveBeenCalledOnce();
    expect(controller.control.mock.calls[0]?.[0]).toBe(run.taskId);
    const command = controller.control.mock.calls[0]?.[1];
    expect(command?.action).toBe('steer');
    if (command?.action !== 'steer') throw new Error('Checks loop did not issue a steer command');
    expect(command.message).toContain(`JARVIS_CHECK_RUN_ID=${run.runId}`);
    expect(command.message).toContain(`check-logs/${run.taskId}/${run.runId}.log`);
    expect(command.message).toContain('AssertionError: expected 2 to equal 1');
    expect(command.message.length).toBeLessThan(16_000);
    expect(command.message).not.toContain('actions-read-token');
    expect(store.setLogArtifact).toHaveBeenCalledWith(run.repository, run.runId, `check-logs/${run.taskId}/${run.runId}.log`);
    expect(tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      taskId: run.taskId,
      type: 'checks_retry_started',
      source: 'backend',
    }));
  });

  it('moves the task to NeedsAttention when the configured number of repair attempts is exhausted', async () => {
    const { loop, tasks, controller, blobs, store } = setup({ failedRunCount: 4, maxCheckAttempts: 3 });

    await loop.handleMapping(failedWorkflow);

    expect(blobs.upload).toHaveBeenCalledOnce();
    expect(controller.control).not.toHaveBeenCalled();
    expect(tasks.transition).toHaveBeenCalledWith(run.taskId, 'NeedsAttention');
    expect(tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'checks_attempts_exhausted',
      payload: expect.objectContaining({ attempt: 3, maxAttempts: 3 }),
    }));
    expect(store.setLogArtifact).toHaveBeenCalledOnce();
  });

  it('allows the configured zero-attempt setting to disable automatic repair', async () => {
    const { loop, tasks, controller } = setup({ maxCheckAttempts: 0 });

    await loop.handleMapping(failedWorkflow);

    expect(controller.control).not.toHaveBeenCalled();
    expect(tasks.transition).toHaveBeenCalledWith(run.taskId, 'NeedsAttention');
    expect(tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'checks_attempts_exhausted',
      payload: expect.objectContaining({ attempt: 0, maxAttempts: 0 }),
    }));
  });

  it('does not steer a task that is no longer running and records the failed check', async () => {
    const { loop, tasks, controller } = setup({ taskState: 'NeedsAttention' });

    await loop.handleMapping(failedWorkflow);

    expect(controller.control).not.toHaveBeenCalled();
    expect(tasks.transition).not.toHaveBeenCalled();
    expect(tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'checks_retry_failed',
      payload: expect.objectContaining({ reason: 'task_not_running' }),
    }));
  });

  it('does not repeat a steer after an interrupted repair attempt', async () => {
    const { loop, tasks, controller, logs } = setup({ started: true });

    await loop.handleMapping(failedWorkflow);

    expect(logs.downloadFailedJobLogs).not.toHaveBeenCalled();
    expect(controller.control).not.toHaveBeenCalled();
    expect(tasks.transition).toHaveBeenCalledWith(run.taskId, 'NeedsAttention');
    expect(tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'checks_retry_failed',
      payload: expect.objectContaining({ reason: 'check_repair_interrupted' }),
    }));
  });

  it('moves to NeedsAttention when the existing steer path refuses the repair', async () => {
    const { loop, tasks, controller, store } = setup({ controllerResult: 'unavailable' });

    await loop.handleMapping(failedWorkflow);

    expect(controller.control).toHaveBeenCalledOnce();
    expect(tasks.transition).toHaveBeenCalledWith(run.taskId, 'NeedsAttention');
    expect(store.setLogArtifact).toHaveBeenCalledOnce();
  });

  it('moves to NeedsAttention when it cannot retrieve the failed-job log', async () => {
    const { loop, tasks, controller, blobs, store } = setup({ logsUnavailable: true });

    await loop.handleMapping(failedWorkflow);
    await loop.handleMapping(failedWorkflow);

    expect(tasks.transition).toHaveBeenCalledWith(run.taskId, 'NeedsAttention');
    expect(tasks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'checks_retry_failed',
      payload: expect.objectContaining({ reason: 'check_log_unavailable' }),
    }));
    expect(controller.control).not.toHaveBeenCalled();
    expect(blobs.upload).not.toHaveBeenCalled();
    expect(store.setLogArtifact).not.toHaveBeenCalled();
  });

  it('ignores successful or non-pull-request workflow runs', async () => {
    const { loop, logs, controller } = setup();
    const successful = { ...failedWorkflow, conclusion: 'success' as const };
    const push = { ...failedWorkflow, event: 'push' };

    await loop.handleMapping(successful);
    await loop.handleMapping(push);

    expect(logs.downloadFailedJobLogs).not.toHaveBeenCalled();
    expect(controller.control).not.toHaveBeenCalled();
  });

  it('recovers pending failed runs at startup', async () => {
    const { loop, controller } = setup();

    await loop.start();

    expect(controller.control).toHaveBeenCalledOnce();
    await loop.stop();
  });
});
