import { beforeEach, describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { SqlHealthProcessor } from './processor.js';
import { sha256, HealthUnavailable } from '../health-upload/contracts.js';
import { createDailyChanges } from '../revisions.js';

const db = vi.hoisted(() => ({
  query: vi.fn(), commit: vi.fn(), rollback: vi.fn(), transactions: 0,
}));
vi.mock('../health-upload/sql-transaction.js', () => ({
  healthSqlQuery: (_request: unknown, query: string) => db.query(query),
  healthSqlTransaction: async <T>(_pool: unknown, _owner: string, signal: AbortSignal,
    action: (tx: sql.Transaction, signal: AbortSignal) => Promise<T>) => {
    const current = ++db.transactions;
    try {
      const result = await action({} as sql.Transaction, signal);
      await db.commit(current);
      return result;
    } catch (error) {
      await db.rollback(current);
      throw error;
    }
  },
}));
const owner = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-10-16T08:00:00Z');
function fixture(kind = 'upload', payload: unknown = { data: { metrics: [] } }, prior = false,
  options: { attempts?: number; current?: 'processed' | 'expired'; empty?: boolean } = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const changes = createDailyChanges(); const listener = vi.fn(); changes.subscribe(listener);
  db.query.mockImplementation(async (query: string) => {
    let rows: Record<string, unknown>[] = [];
    if (query.includes('SELECT TOP(1) acceptance_id') && !options.empty) rows = [{
      acceptance_id: '22222222-2222-4222-8222-222222222222', checksum: sha256(raw), byte_count: raw.length, raw_bytes: raw,
      kind, automation_id: 'synthetic-automation', session_id: 'synthetic-session', accepted_at: new Date(now - 60000), processing_attempts: options.attempts ?? 0,
    }];
    if (query.includes('SELECT processing_status')) rows = [{ checksum: sha256(raw),
      processing_status: options.current === 'processed' ? 'processed' : 'pending', processing_attempts: 1,
      processing_next_attempt_at: new Date(now + (options.current === 'expired' ? -1 : 120000)) }];
    if (query.includes('SELECT id,automation_id') && prior) rows = [{ automation_id: 'synthetic-automation', session_id: 'synthetic-session', checksum: sha256(raw), status: 'succeeded', content_bytes: raw.length }];
    return { recordset: rows };
  });
  return { processor: new SqlHealthProcessor({} as sql.ConnectionPool, owner, () => now, changes), listener };
}
beforeEach(() => { vi.clearAllMocks(); db.transactions = 0; db.commit.mockResolvedValue(undefined); db.rollback.mockResolvedValue(undefined); });
describe('health commit-to-invalidation boundary (synthetic transaction double, not SQL)', () => {
  it('publishes normalized sources only after final domain transaction commit, never after claim alone', async () => {
    const f = fixture(); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    db.commit.mockImplementation(async (transaction: number) => { if (transaction === 2) { entered(); await gate; } });
    const pending = f.processor.processNext(new AbortController().signal);
    await started; expect(f.listener).not.toHaveBeenCalled();
    release(); expect(await pending).toMatchObject({ state: 'processed' });
    expect(f.listener).toHaveBeenCalledExactlyOnceWith({ owner, sources: [sources.sync, sources.metrics, sources.sleep] });
  });
  it('invalidates workout/detail/minute series together without touching metrics', async () => {
    const f = fixture('upload', { data: { workouts: [] } });
    expect(await f.processor.processNext(new AbortController().signal)).toMatchObject({ state: 'processed' });
    expect(f.listener).toHaveBeenCalledExactlyOnceWith({ owner, sources: [sources.sync, sources.workouts, sources.workout, sources.heartRate] });
  });
  it('heartbeat invalidates only sync evidence, never health-feed freshness', async () => {
    const f = fixture('heartbeat', { shortcutName: 'Synthetic', checkedFeeds: ['metrics'] });
    await f.processor.processNext(new AbortController().signal);
    expect(f.listener).toHaveBeenCalledExactlyOnceWith({ owner, sources: [sources.sync] });
  });
  it('does not publish uncertain finalization as new health data', async () => {
    const f = fixture();
    db.commit.mockImplementation(async (transaction: number) => { if (transaction === 2) throw new HealthUnavailable(); });
    expect(await f.processor.processNext(new AbortController().signal)).toMatchObject({ state: 'retry' });
    expect(f.listener).not.toHaveBeenCalled();
  });
  const diagnostics = [
    { name: 'poison quarantine', make: () => fixture('upload', { invalid: 'synthetic' }), commit: 2, state: 'quarantined' },
    { name: 'retry exhaustion', make: () => fixture('upload', undefined, false, { attempts: 3 }), commit: 1, state: 'quarantined' },
    { name: 'pending retained-lineage replay', make: () => fixture('upload', undefined, true), commit: 2, state: 'processed' },
  ];
  it.each(diagnostics)('publishes sync only after acknowledged $name commit', async ({ make, commit, state }) => {
    const f = make(); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    db.commit.mockImplementation(async (transaction: number) => { if (transaction === commit) { entered(); await gate; } });
    const pending = f.processor.processNext(new AbortController().signal);
    await started; expect(f.listener).not.toHaveBeenCalled();
    release(); expect(await pending).toMatchObject({ state });
    expect(f.listener).toHaveBeenCalledExactlyOnceWith({ owner, sources: [sources.sync] });
    expect(db.query.mock.calls.some(([query]) => /INSERT daily.health_ingestions/u.test(query as string))).toBe(false);
  });
  it.each(diagnostics)('never notifies an unacknowledged $name transaction', async ({ make, commit, state }) => {
    const f = make();
    db.commit.mockImplementation(async (transaction: number) => { if (transaction === commit) throw new HealthUnavailable(); });
    const pending = f.processor.processNext(new AbortController().signal);
    if (state === 'processed') expect(await pending).toMatchObject({ state: 'retry' });
    else await expect(pending).rejects.toBeInstanceOf(HealthUnavailable);
    expect(f.listener).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledExactlyOnceWith(commit);
  });
  it.each([
    { name: 'empty inbox', options: { empty: true }, state: 'idle' },
    { name: 'already completed row', options: { current: 'processed' as const }, state: 'processed' },
    { name: 'expired claim', options: { current: 'expired' as const }, state: 'retry' },
  ])('does not notify a $name no-op', async ({ options, state }) => {
    const f = fixture('upload', undefined, false, options);
    expect(await f.processor.processNext(new AbortController().signal)).toMatchObject({ state });
    expect(f.listener).not.toHaveBeenCalled();
  });
  it('contains a failing notification sink without failing an acknowledged row or replaying SQL side effects', async () => {
    fixture();
    const publish = vi.fn(() => { throw new TypeError('synthetic notification failure'); });
    const processor = new SqlHealthProcessor({} as sql.ConnectionPool, owner, () => now, { publish });
    expect(await processor.processNext(new AbortController().signal)).toMatchObject({ state: 'processed' });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(db.transactions).toBe(2);
    expect(db.query.mock.calls.filter(([query]) => /INSERT daily.health_ingestions/u.test(query as string))).toHaveLength(1);
    expect(db.query.mock.calls.some(([query]) => /processing_status='quarantined'/u.test(query as string))).toBe(false);
  });
});
