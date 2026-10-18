import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FindingWriteGuard } from '../proactive/store.js';
import { createProactiveStore } from './proactive-store.js';

afterEach(() => { vi.restoreAllMocks(); });

const owner = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-20T05:00:00.000Z');
const finding = {
  dedupeKey: 'fixture:deadline', title: 'Synthetic deadline', body: 'Synthetic evidence.',
  category: 'deadline' as const, urgency: 'normal' as const, dueAt: null,
  evidence: [], runId, language: 'en' as const,
};
const savedRow = {
  id: '33333333-3333-4333-8333-333333333333', kind: 'finding', ...finding,
  due_at: null, evidence_json: '[]', state: 'new', snoozed_until: null,
  feedback: null, run_id: runId, todo_added: false, created_at: now,
};
const runningRow = {
  status: 'running', claim_generation: 1, lease_until: new Date(now.getTime() + 600_000),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type Stage = 'lease' | 'lock' | 'existing' | 'write';
function fixture(options: {
  run?: (Omit<typeof runningRow, 'claim_generation'> & { claim_generation: number | string }) | null;
  hold?: Stage;
  afterWrite?: () => void;
} = {}) {
  const controller = new AbortController();
  const guard: FindingWriteGuard = {
    runId, generation: 1, signal: controller.signal, check: vi.fn(), now: () => now,
  };
  const transaction = {
    begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  };
  const started = deferred<void>();
  const release = deferred<void>();
  const requests: { stage: Stage; input: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
  const statements: string[] = [];
  vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction as unknown as sql.Transaction; });
  vi.spyOn(sql, 'Request').mockImplementation(function () {
    const request = {
      stage: 'lease' as Stage,
      input: vi.fn().mockReturnThis(),
      cancel: vi.fn(),
      query: vi.fn(async (statement: string) => {
        statements.push(statement);
        request.stage = statement.includes('FROM dbo.proactive_runs') ? 'lease'
          : statement.includes('sp_getapplock') ? 'lock'
            : statement.includes('SELECT TOP (1)') ? 'existing' : 'write';
        if (options.hold === request.stage) {
          started.resolve();
          await release.promise;
          controller.signal.throwIfAborted();
        }
        if (request.stage === 'lease') {
          return { recordset: options.run === null ? [] : [options.run ?? runningRow] };
        }
        if (request.stage === 'lock') return { recordset: [{ result: 0 }] };
        if (request.stage === 'existing') return { recordset: [] };
        options.afterWrite?.();
        return { recordset: [savedRow] };
      }),
    };
    requests.push(request);
    return request as unknown as sql.Request;
  });
  const store = createProactiveStore({} as sql.ConnectionPool, owner);
  return { store, guard, controller, transaction, requests, statements, started, release };
}

describe('SQL guarded proactive finding writes', () => {
  it('locks the owner/run row in the write transaction and commits only a current guard', async () => {
    const { store, guard, transaction, requests, statements } = fixture();
    const remove = vi.spyOn(guard.signal, 'removeEventListener');
    await expect(store.items.upsertFinding(finding, guard)).resolves.toMatchObject({ runId });
    expect(statements[0]).toContain('FROM dbo.proactive_runs WITH (UPDLOCK, HOLDLOCK)');
    expect(statements[0]).toContain('WHERE owner_object_id = @owner AND id = @runId');
    expect(requests[0]!.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(requests[0]!.input).toHaveBeenCalledWith('runId', sql.UniqueIdentifier, runId);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each([
    ['missing', null],
    ['generation', { ...runningRow, claim_generation: 2 }],
    ['finished', { ...runningRow, status: 'done' }],
    ['expired', { ...runningRow, lease_until: now }],
  ])('rolls back a %s lease without writing an item', async (_reason, run) => {
    const { store, guard, transaction, statements } = fixture({ run });
    await expect(store.items.upsertFinding(finding, guard)).rejects.toThrow('lease_lost');
    expect(statements).toHaveLength(1);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it('accepts SQL bigint claim generations returned as strings', async () => {
    const { store, guard, transaction } = fixture({ run: { ...runningRow, claim_generation: '1' } });
    await expect(store.items.upsertFinding(finding, guard)).resolves.toMatchObject({ runId });
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it.each(['lease', 'lock', 'existing', 'write'] as const)(
    'cancels the active %s request and waits for cancellation and rollback before settling', async (stage) => {
      const { store, guard, controller, transaction, requests, started, release } = fixture({ hold: stage });
      const rollbackStarted = deferred<void>();
      const rollbackDone = deferred<void>();
      transaction.rollback.mockImplementationOnce(async () => {
        rollbackStarted.resolve();
        await rollbackDone.promise;
      });
      const remove = vi.spyOn(guard.signal, 'removeEventListener');
      let settled = false;
      const outcome = store.items.upsertFinding(finding, guard).then(
        () => { settled = true; return undefined; },
        (error: unknown) => { settled = true; return error; },
      );
      await started.promise;
      controller.abort(new Error('run_cancelled'));
      expect(requests.at(-1)!.cancel).toHaveBeenCalledOnce();
      expect(requests.slice(0, -1).every((request) => request.cancel.mock.calls.length === 0)).toBe(true);
      expect(transaction.rollback).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      release.resolve();
      await rollbackStarted.promise;
      expect(settled).toBe(false);
      expect(transaction.commit).not.toHaveBeenCalled();
      rollbackDone.resolve();
      expect(await outcome).toEqual(new Error('run_cancelled'));
      expect(transaction.rollback).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    },
  );

  it('rolls back when quiet hours start after the write but before commit', async () => {
    let quiet = false;
    const { store, guard, transaction } = fixture({ afterWrite: () => { quiet = true; } });
    guard.check = () => { if (quiet) throw new Error('quiet_hours'); };
    await expect(store.items.upsertFinding(finding, guard)).rejects.toThrow('quiet_hours');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('checks policy again after a pending read and before writing', async () => {
    const { store, guard, transaction, statements, started, release } = fixture({ hold: 'existing' });
    let quiet = false;
    guard.check = () => { if (quiet) throw new Error('quiet_hours'); };
    const outcome = store.items.upsertFinding(finding, guard);
    const rejected = expect(outcome).rejects.toThrow('quiet_hours');
    await started.promise;
    quiet = true;
    release.resolve();
    await rejected;
    expect(statements).toHaveLength(3);
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rolls back when a request fails without an abort', async () => {
    const { store, guard, transaction } = fixture({
      afterWrite: () => { throw new Error('database_unavailable'); },
    });
    await expect(store.items.upsertFinding(finding, guard)).rejects.toThrow('database_unavailable');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rolls back if the signal aborts when the write completes', async () => {
    const state = fixture({ afterWrite: () => { state.controller.abort(new Error('run_cancelled')); } });
    await expect(state.store.items.upsertFinding(finding, state.guard)).rejects.toThrow('run_cancelled');
    expect(state.transaction.rollback).toHaveBeenCalledOnce();
    expect(state.transaction.commit).not.toHaveBeenCalled();
  });

  it('rechecks lease expiry immediately before commit', async () => {
    let current = now;
    const { store, guard, transaction } = fixture({
      afterWrite: () => { current = runningRow.lease_until; },
    });
    guard.now = () => current;
    await expect(store.items.upsertFinding(finding, guard)).rejects.toThrow('lease_lost');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects pre-aborted guards before beginning a transaction and releases the listener', async () => {
    const { store, guard, controller, transaction, requests } = fixture();
    const remove = vi.spyOn(guard.signal, 'removeEventListener');
    controller.abort(new Error('run_cancelled'));
    await expect(store.items.upsertFinding(finding, guard)).rejects.toThrow('run_cancelled');
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('preserves direct unguarded writes without querying run leases', async () => {
    const { store, transaction, statements } = fixture();
    await expect(store.items.upsertFinding({ ...finding, runId: null })).resolves.toMatchObject({ kind: 'finding' });
    expect(statements.some((statement) => statement.includes('dbo.proactive_runs'))).toBe(false);
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
});
