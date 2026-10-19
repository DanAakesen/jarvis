import { randomUUID } from 'node:crypto';
import { vaultMirrorStatusSchema } from '@jarvis/contracts';
import { planReconcile } from '../engine/index.js';
import type { Action, FileRecord, Plan, ReconcileInput } from '../engine/types.js';
import { GitHubMirrorError } from './github.js';
import { mergeThreeWay } from './merge.js';
import { ObCommandError } from './obsidian.js';
import { checksum, decodeState, emptyState, encodeState, mapBaseRecords, recordForState, type MirrorState, type PendingWrite, type StoredFile } from './state.js';
import { StateCorruptError } from './storage.js';
import { emptyCounts, isMirrorReason, OVERALL_RUN_MS, type MirrorReason, type RunDependencies, type RunOptions, type RunResult, type StateLease } from './types.js';
import { deleteWorkspaceFile, restoreWorkspace, samePaths, snapshotWorkspace, workspaceDiff, writeWorkspaceFile, type WorkspaceSnapshot } from './workspace.js';
import type { ValidatedPolicy } from '../engine/policy.js';

class RunFailure extends Error {
  constructor(readonly reason: MirrorReason, readonly outcome: 'failed' | 'needs-attention' = 'failed') {
    super('Vault mirror run failed');
  }
}

function stored(text: string, record: FileRecord): StoredFile {
  return recordForState(text, record);
}

function pendingAction(action: Action): PendingWrite | undefined {
  if (action.kind === 'createOnO' || action.kind === 'updateOnO') {
    return { kind: 'write', file: stored(action.text, action.record) };
  }
  if (action.kind === 'deleteOnO') return { kind: 'delete' };
  return undefined;
}

function obActions(actions: readonly Action[]): Action[] {
  return actions.filter(action =>
    action.kind === 'createOnO' || action.kind === 'updateOnO' || action.kind === 'deleteOnO');
}

function githubActions(actions: readonly Action[]): Action[] {
  return actions.filter(action =>
    action.kind === 'createOnG' || action.kind === 'updateOnG' || action.kind === 'deleteOnG');
}

function actionPaths(actions: readonly Action[]): Set<string> {
  return new Set(actions.map(action => action.path));
}

function applyBaseActions(state: MirrorState, actions: readonly Action[]): void {
  for (const action of actions) {
    if (action.kind === 'recordBase' && !state.pendingWriteBack[action.path]) {
      state.base[action.path] = stored(action.text, action.record);
      delete state.conflictFirstSeenAt[action.path];
    } else if (action.kind === 'forgetBase' && !state.pendingWriteBack[action.path]) {
      delete state.base[action.path];
      delete state.conflictFirstSeenAt[action.path];
    }
  }
}

function syncConflictState(state: MirrorState, plan: Plan): string[] {
  const conflictRows = plan.skipped.filter(item => item.reason === 'conflict');
  const conflicts = new Set(conflictRows.map(item => item.path));
  for (const path of Object.keys(state.conflictFirstSeenAt)) {
    if (!conflicts.has(path)) delete state.conflictFirstSeenAt[path];
  }
  for (const item of conflictRows) {
    if (item.conflictFirstSeenAt !== undefined) state.conflictFirstSeenAt[item.path] = item.conflictFirstSeenAt;
  }
  return [...conflicts].filter(path => path.length <= 1024).slice(0, 10);
}

function statusReason(plan: Plan): MirrorReason | undefined {
  if (plan.reason === 'guard-tripped') return 'guard-tripped';
  if (plan.reason === 'conflict') return 'conflict';
  if (plan.reason === 'secret-match') return 'secret-match';
  return undefined;
}

function reasonFor(error: unknown, signal: AbortSignal, leaseLost: boolean): MirrorReason {
  if (error instanceof RunFailure) return error.reason;
  if (error instanceof ObCommandError) return error.reason;
  if (error instanceof GitHubMirrorError) return error.reason;
  if (error instanceof StateCorruptError) return 'state-corrupt';
  if (leaseLost) return 'unexpected';
  if (signal.aborted) return 'timeout';
  if (error && typeof error === 'object') {
    const details = error as { name?: unknown; code?: unknown; statusCode?: unknown };
    if (details.name === 'TimeoutError' || details.name === 'AbortError' ||
      details.code === 'ETIMEDOUT' || details.statusCode === 408) return 'timeout';
  }
  if (error instanceof Error && isMirrorReason(error.message)) return error.message;
  return 'unexpected';
}

function parseNow(now: number): string {
  return new Date(now).toISOString();
}

async function planWithReaders(
  state: MirrorState,
  writeBack: RunOptions['config']['writeBack'],
  limits: { maxChanged: number; maxDeletes: number },
  policy: ValidatedPolicy,
  ours: WorkspaceSnapshot,
  github: Awaited<ReturnType<ReturnType<RunDependencies['createGitHub']>['snapshot']>>,
  now: number,
  pendingPaths: ReadonlySet<string>,
): Promise<Plan> {
  const O = new Map([...ours.files].filter(([path]) => !pendingPaths.has(path)).map(([path, file]) => [path, file.record]));
  const G = new Map([...github.files].filter(([path]) => !pendingPaths.has(path)).map(([path, file]) => [path, file]));
  const B = new Map([...mapBaseRecords(state)].filter(([path]) => !pendingPaths.has(path)));
  const input: ReconcileInput = {
    policy,
    writeBack,
    limits,
    now,
    baseFreshlyInitialized: !state.initialized,
    O,
    G,
    B,
    conflictFirstSeenAt: new Map(Object.entries(state.conflictFirstSeenAt)
      .filter(([path]) => !pendingPaths.has(path))),
    readContent(side, path) {
      if (side === 'O') {
        const text = ours.files.get(path)?.text;
        if (text === undefined) throw new Error('content-unavailable');
        return text;
      }
      if (side === 'G') {
        const file = github.files.get(path);
        if (file?.text === undefined) throw new Error('content-unavailable');
        return file.text;
      }
      const text = state.base[path]?.text;
      if (text === undefined) throw new Error('content-unavailable');
      return text;
    },
    merge: mergeThreeWay,
  };
  return planReconcile(input);
}

async function bidirectionalUpload(
  obsidian: ReturnType<RunDependencies['createObsidian']>,
  assertLease: () => Promise<void>,
): Promise<void> {
  let failure: unknown;
  try { await obsidian.sync('bidirectional', 'upload', assertLease); }
  catch (error) { failure = error; }
  try { await obsidian.setMode('pull-only', assertLease); }
  catch (error) { failure ??= error; }
  if (failure !== undefined) throw new RunFailure(failedUploadReason(failure));
}

async function applyPending(
  state: MirrorState,
  workingCopy: string,
  obsidian: ReturnType<RunDependencies['createObsidian']>,
  assertLease: () => Promise<void>,
): Promise<void> {
  const entries = Object.entries(state.pendingWriteBack);
  if (entries.length === 0) return;
  const before = await snapshotWorkspace(workingCopy);
  const applied: [string, PendingWrite][] = [];
  for (const [path, pending] of entries) {
    await assertLease();
    const current = before.files.get(path)?.record;
    const base = state.base[path];
    const matches = (record: FileRecord | undefined, expected: StoredFile | undefined): boolean =>
      record === undefined ? expected === undefined :
        expected !== undefined && record.hash === expected.hash && record.mode === expected.mode;
    if (pending.kind === 'write') {
      if (matches(current, pending.file)) {
        state.base[path] = pending.file;
        delete state.pendingWriteBack[path];
      } else if (matches(current, base)) {
        await writeWorkspaceFile(workingCopy, path, pending.file.text);
        applied.push([path, pending]);
      } else {
        delete state.pendingWriteBack[path];
      }
    } else if (current === undefined) {
      delete state.base[path];
      delete state.pendingWriteBack[path];
    } else if (matches(current, base)) {
      await deleteWorkspaceFile(workingCopy, path);
      applied.push([path, pending]);
    } else {
      delete state.pendingWriteBack[path];
    }
  }
  if (applied.length === 0) return;
  await bidirectionalUpload(obsidian, assertLease);
  const after = await snapshotWorkspace(workingCopy);
  for (const [path, pending] of applied) {
    if (pending.kind === 'delete') {
      if (after.files.has(path)) throw new RunFailure('upload-failed');
      delete state.base[path];
    } else {
      const result = after.files.get(path);
      if (!result || result.record.hash !== pending.file.hash || result.record.size !== pending.file.size) {
        await writeWorkspaceFile(workingCopy, path, pending.file.text);
        throw new RunFailure('upload-failed');
      }
      state.base[path] = pending.file;
    }
    delete state.pendingWriteBack[path];
  }
}

function failedUploadReason(error: unknown): MirrorReason {
  if (error instanceof RunFailure) return error.reason;
  if (error instanceof ObCommandError) return error.reason;
  return 'unexpected';
}

export async function runMirror(options: RunOptions): Promise<RunResult> {
  const dependencies = options.dependencies;
  const now = dependencies.now ?? Date.now;
  const startedMs = now();
  const runId = dependencies.newRunId?.() ?? randomUUID();
  const startedAt = parseNow(startedMs);
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(new Error('deadline')), OVERALL_RUN_MS);
  deadlineTimer.unref();
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, deadlineController.signal]);
  const counts = emptyCounts();
  let outcome: RunResult['status']['outcome'] = 'failed';
  let reason: MirrorReason | undefined;
  let lastSuccessAt: string | null = null;
  let consecutiveFailures = 0;
  let failureCounted = false;
  let conflictPaths: string[] = [];
  let state: MirrorState | undefined;
  let stateLoaded = false;
  let stateCorrupt = false;
  let lease: StateLease | undefined;
  let workspace: Awaited<ReturnType<RunDependencies['createWorkspace']>> | undefined;
  let leaseLost = false;
  let renewTimer: NodeJS.Timeout | undefined;
  let ownedPlan: Plan | undefined;
  let approvedPending = 0;

  const status = (): RunResult['status'] => vaultMirrorStatusSchema.parse({
    runId,
    startedAt,
    finishedAt: parseNow(now()),
    outcome,
    ...(reason ? { reason } : {}),
    writeBack: options.config.writeBack,
    ...counts,
    consecutiveFailures,
    lastSuccessAt,
    conflictPaths,
  });
  const log = (current: RunResult['status']): void => {
    try {
      dependencies.log?.({
        runId: current.runId,
        outcome: current.outcome,
        ...(current.reason ? { reason: current.reason } : {}),
        durationMs: Math.max(0, now() - startedMs),
        approved: current.approved,
        pushed: current.pushed,
        writtenBack: current.writtenBack,
        deleted: current.deleted,
        conflicts: current.conflicts,
        skipped: current.skipped,
        credentialMatches: current.credentialMatches,
        pendingWriteBack: current.pendingWriteBack,
      });
    } catch { /* Logging cannot change the mirror result. */ }
  };
  const assertLease = async (): Promise<void> => {
    if (!lease || leaseLost || signal.aborted) {
      throw new RunFailure(leaseLost ? 'unexpected' : signal.aborted ? 'timeout' : 'unexpected');
    }
    try { await lease.renew(signal); }
    catch {
      leaseLost = true;
      throw new RunFailure('unexpected');
    }
    if (leaseLost || signal.aborted) throw new RunFailure(leaseLost ? 'unexpected' : 'timeout');
  };
  const writeState = async (): Promise<void> => {
    if (!state || !workspace || !lease) return;
    await assertLease();
    let archive: Uint8Array;
    try { archive = await encodeState(state, workspace.workingCopy, workspace.configHome); }
    catch {
      stateCorrupt = true;
      throw new RunFailure('state-corrupt');
    }
    if (archive.byteLength > 200 * 1024 * 1024) {
      stateCorrupt = true;
      throw new RunFailure('state-corrupt');
    }
    await lease.upload(archive, checksum(archive), signal);
  };

  try {
    try {
      const previousStatus = await dependencies.storage.readStatus();
      if (previousStatus) {
        lastSuccessAt = previousStatus.lastSuccessAt;
        consecutiveFailures = previousStatus.consecutiveFailures;
      }
    } catch { /* Status history is best-effort. */ }
    const secrets = await dependencies.readSecrets(signal);
    const github = dependencies.createGitHub(secrets.githubPrivateKey, secrets.policy);
    await github.verifyRepository(signal);
    const acquired = await dependencies.storage.acquireLease(signal);
    if (acquired.busy) {
      outcome = 'skipped-busy';
      return { status: status(), exitCode: 0 };
    }
    lease = acquired.lease;
    renewTimer = setInterval(() => {
      if (!lease || leaseLost || signal.aborted) return;
      void lease.renew(signal).catch(() => {
        leaseLost = true;
        deadlineController.abort(new Error('lease-lost'));
      });
    }, 20_000);
    renewTimer.unref();
    await assertLease();
    if (lease.archive === null) {
      state = emptyState();
    } else {
      try {
        if (lease.archive.byteLength > 200 * 1024 * 1024) throw new Error('too-large');
        workspace = await dependencies.createWorkspace(signal);
        state = await decodeState(lease.archive, workspace.workingCopy, workspace.configHome);
      } catch {
        stateCorrupt = true;
        throw new RunFailure('state-corrupt');
      }
    }
    stateLoaded = true;
    if (state.lastSuccessAt && (!lastSuccessAt || Date.parse(state.lastSuccessAt) > Date.parse(lastSuccessAt))) {
      lastSuccessAt = state.lastSuccessAt;
    }
    consecutiveFailures = Math.max(consecutiveFailures, state.consecutiveFailures);
    state.lastSuccessAt = lastSuccessAt;
    state.consecutiveFailures = consecutiveFailures;
    workspace ??= await dependencies.createWorkspace(signal);
    const obsidian = dependencies.createObsidian({
      token: secrets.obsidianToken,
      ...(secrets.vaultPassword === undefined ? {} : { password: secrets.vaultPassword }),
      workingCopy: workspace.workingCopy,
      configHome: workspace.configHome,
      signal,
      remainingMs: () => Math.max(0, OVERALL_RUN_MS - (now() - startedMs)),
    });
    if (!state.setupComplete) {
      try { await obsidian.setup(secrets.vaultName, assertLease); }
      catch (error) {
        if (error instanceof ObCommandError) throw new RunFailure(error.reason);
        throw error;
      }
      state.setupComplete = true;
    }
    try { await obsidian.sync('pull-only', 'pull', assertLease); }
    catch (error) {
      if (error instanceof ObCommandError) throw new RunFailure(error.reason);
      throw error;
    }
    try { await encodeState(state, workspace.workingCopy, workspace.configHome); }
    catch {
      stateCorrupt = true;
      throw new RunFailure('state-corrupt');
    }
    if (Object.keys(state.pendingWriteBack).length > 0 && options.config.writeBack === 'on') {
      await applyPending(state, workspace.workingCopy, obsidian, assertLease);
    }
    const before = await snapshotWorkspace(workspace.workingCopy);
    const githubSnapshot = await github.snapshot(signal);
    const pendingPaths = new Set(options.config.writeBack === 'dry-run'
      ? Object.keys(state.pendingWriteBack)
      : []);
    let plan = await planWithReaders(
      state, options.config.writeBack,
      { maxChanged: options.config.maxChanged, maxDeletes: options.config.maxDeletes },
      secrets.policy, before, githubSnapshot, now(), pendingPaths,
    );
    conflictPaths = syncConflictState(state, plan);
    ownedPlan = plan;
    const setCounts = (): void => {
      counts.approved = plan.counters.approved;
      counts.skipped = plan.counters.skipped;
      counts.conflicts = plan.counters.conflicts;
      counts.credentialMatches = plan.counters.credentialMatches;
      approvedPending = plan.counters.pendingWriteBack;
    };
    setCounts();
    let committedGithubActions: Action[] = [];
    if (plan.verdict === 'guard-tripped') {
      outcome = 'needs-attention';
      reason = 'guard-tripped';
    } else {
      const githubChanges = githubActions(plan.actions);
      if (githubChanges.length > 0) {
        try {
          await github.commit(githubSnapshot, githubChanges, signal, assertLease);
          committedGithubActions = githubChanges;
        } catch (error) {
          if (!(error instanceof GitHubMirrorError) || error.reason !== 'push-rejected') throw error;
          const retrySnapshot = await github.snapshot(signal);
          plan = await planWithReaders(
            state, options.config.writeBack,
            { maxChanged: options.config.maxChanged, maxDeletes: options.config.maxDeletes },
            secrets.policy, before, retrySnapshot, now(), pendingPaths,
          );
          conflictPaths = syncConflictState(state, plan);
          ownedPlan = plan;
          setCounts();
          if (plan.verdict === 'guard-tripped') {
            outcome = 'needs-attention';
            reason = 'guard-tripped';
          } else {
            const retryChanges = githubActions(plan.actions);
            if (retryChanges.length > 0) {
              await github.commit(retrySnapshot, retryChanges, signal, assertLease);
              committedGithubActions = retryChanges;
            }
          }
        }
      }
      if (outcome !== 'needs-attention') {
        const writesToObsidian = obActions(plan.actions);
        for (const action of writesToObsidian) {
          const pending = pendingAction(action);
          if (pending) state.pendingWriteBack[action.path] = pending;
        }
        if (options.config.writeBack === 'on' && writesToObsidian.length > 0) {
          for (const action of writesToObsidian) {
            await assertLease();
            if (action.kind === 'createOnO' || action.kind === 'updateOnO') {
              await writeWorkspaceFile(workspace.workingCopy, action.path, action.text);
            } else if (action.kind === 'deleteOnO') {
              await deleteWorkspaceFile(workspace.workingCopy, action.path);
            }
          }
          await dependencies.afterWriteBack?.(workspace.workingCopy);
          const changed = workspaceDiff(before, await snapshotWorkspace(workspace.workingCopy));
          const expected = actionPaths(writesToObsidian);
          if (!samePaths(changed, expected)) {
            await restoreWorkspace(workspace.workingCopy, before);
            for (const action of writesToObsidian) delete state.pendingWriteBack[action.path];
            throw new RunFailure('guard-tripped', 'needs-attention');
          }
          await bidirectionalUpload(obsidian, assertLease);
          const uploaded = await snapshotWorkspace(workspace.workingCopy);
          const changedAfterUpload = workspaceDiff(before, uploaded);
          if (!samePaths(changedAfterUpload, expected) ||
            writesToObsidian.some(action => {
              const file = uploaded.files.get(action.path);
              if (action.kind === 'deleteOnO') return file !== undefined;
              return !file || !('record' in action) || file.record.hash !== action.record.hash;
            })) throw new RunFailure('upload-failed');
          for (const action of writesToObsidian) delete state.pendingWriteBack[action.path];
          counts.writtenBack = writesToObsidian.filter(action =>
            action.kind === 'createOnO' || action.kind === 'updateOnO').length;
        }
        counts.pushed = committedGithubActions.filter(action =>
          action.kind === 'createOnG' || action.kind === 'updateOnG').length;
        counts.deleted = committedGithubActions.filter(action => action.kind === 'deleteOnG').length +
          (options.config.writeBack === 'on' && Object.keys(state.pendingWriteBack).length === 0
            ? writesToObsidian.filter(action => action.kind === 'deleteOnO').length
            : 0);
        applyBaseActions(state, plan.actions);
        state.initialized = true;
        const planReason = statusReason(plan);
        if (plan.verdict === 'needs-attention') {
          outcome = 'needs-attention';
          reason = planReason;
        } else {
          outcome = plan.actions.length > 0 || counts.pushed > 0 || counts.writtenBack > 0
            ? 'ok' : 'ok-noop';
          reason = undefined;
        }
      }
    }
    if (outcome === 'ok' || outcome === 'ok-noop') {
      lastSuccessAt = parseNow(now());
      state.lastSuccessAt = lastSuccessAt;
      state.consecutiveFailures = 0;
      consecutiveFailures = 0;
    } else {
      state.consecutiveFailures = Math.max(state.consecutiveFailures, consecutiveFailures) + 1;
      consecutiveFailures = state.consecutiveFailures;
      failureCounted = true;
    }
    counts.pendingWriteBack = Object.keys(state.pendingWriteBack).length + approvedPending;
    await writeState();
  } catch (error) {
    reason = reasonFor(error, signal, leaseLost);
    outcome = error instanceof RunFailure ? error.outcome : 'failed';
    if (reason === 'guard-tripped') outcome = 'needs-attention';
    if (reason === 'auth' || reason === 'policy-missing' || reason === 'repo-not-private' ||
      reason === 'state-corrupt' || reason === 'pull-failed' || reason === 'upload-failed' ||
      reason === 'push-rejected' || reason === 'timeout') outcome = 'failed';
    if (ownedPlan) {
      counts.approved = ownedPlan.counters.approved;
      counts.skipped = ownedPlan.counters.skipped;
      counts.conflicts = ownedPlan.counters.conflicts;
      counts.credentialMatches = ownedPlan.counters.credentialMatches;
    }
    counts.pendingWriteBack = (state ? Object.keys(state.pendingWriteBack).length : 0) + approvedPending;
    if (stateLoaded && state && !stateCorrupt) {
      if (!failureCounted) {
        state.consecutiveFailures = Math.max(state.consecutiveFailures, consecutiveFailures) + 1;
        consecutiveFailures = state.consecutiveFailures;
      }
      if (!signal.aborted && !leaseLost) {
        try { await writeState(); }
        catch {
          reason = 'upload-failed';
          outcome = 'failed';
        }
      }
    } else if (!failureCounted && reason !== undefined) {
      consecutiveFailures++;
    }
  } finally {
    clearTimeout(deadlineTimer);
    if (renewTimer) clearInterval(renewTimer);
    if (workspace) await workspace.cleanup().catch(() => undefined);
    let finalStatus = status();
    try {
      await dependencies.storage.writeStatus(finalStatus, AbortSignal.timeout(10_000));
    } catch {
      reason = 'unexpected';
      outcome = 'failed';
      finalStatus = status();
      await dependencies.storage.writeStatus(finalStatus, AbortSignal.timeout(3_000)).catch(() => undefined);
    }
    if (lease) await lease.release(AbortSignal.timeout(3_000)).catch(() => undefined);
    log(finalStatus);
  }
  return { status: status(), exitCode: outcome === 'ok' || outcome === 'ok-noop' ? 0 : 1 };
}
