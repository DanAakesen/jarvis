import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenFrameUsageStore, WATCH_FRAME_PENDING_COST_DKK } from './screen-usage-store.js';

afterEach(() => { vi.restoreAllMocks(); });

const at = new Date('2026-10-06T14:00:00.000Z');
const frame = {
  sessionId: '42', eventId: 'watch:screen:00000000-0000-4000-8000-000000000001',
  source: 'screen' as const, limitDkk: 6.5785, at,
};

function fixture() {
  const request = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockResolvedValue({ recordset: [{ outcome: 'reserved', usedDkk: WATCH_FRAME_PENDING_COST_DKK }], rowsAffected: [1] }),
  };
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const transaction = {
    begin: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    request: vi.fn(() => request),
  };
  vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction as unknown as sql.Transaction; });
  return { request, transaction, store: createScreenFrameUsageStore(pool) };
}

describe('SQL screen and watch usage store', () => {
  it('serializes watch admission on the existing UTC day lock and persists a pending cost', async () => {
    const { request, transaction, store } = fixture();
    expect(WATCH_FRAME_PENDING_COST_DKK).toBe(0.1);
    expect(await store.reserveWatchFrame(frame)).toEqual({ outcome: 'reserved', usedDkk: 0.1 });
    expect(transaction.begin).toHaveBeenCalledWith(sql.ISOLATION_LEVEL.SERIALIZABLE);
    expect(request.input).toHaveBeenCalledWith('sessionId', sql.BigInt, 42n);
    expect(request.input).toHaveBeenCalledWith('eventId', expect.anything(), `screen:${frame.eventId}`);
    expect(request.input).toHaveBeenCalledWith('lockResource', expect.anything(), 'jarvis.screen-frame-cap:2026-10-06');
    expect(request.input).toHaveBeenCalledWith('dayStart', sql.DateTime2, new Date('2026-10-06T00:00:00.000Z'));
    expect(request.input).toHaveBeenCalledWith('dayEnd', sql.DateTime2, new Date('2026-10-07T00:00:00.000Z'));
    expect(request.input).toHaveBeenCalledWith('pendingCostDkk', expect.anything(), WATCH_FRAME_PENDING_COST_DKK);
    const query = request.query.mock.calls[0]![0] as string;
    expect(query).toContain('sys.sp_getapplock');
    expect(query).toContain('SUM(cost_dkk)');
    expect(query).toContain('ended_at IS NULL');
    expect(query).toContain('@usedDkk + @pendingCostDkk > @limitDkk');
    expect(query).toContain("N'screen_frames', 1, @pendingCostDkk");
    expect(query).not.toContain('@dailyCap');
    expect(query).not.toContain('COUNT_BIG');
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  it.each(['screen', 'camera'] as const)('throttles only watch %s frames in the same session for 2500ms', async (source) => {
    const { request, store } = fixture();
    await store.reserveWatchFrame({ ...frame, source, eventId: `watch:${source}:frame` });
    expect(request.input).toHaveBeenCalledWith('sourcePrefix', expect.anything(), `screen:watch:${source}:%`);
    const query = request.query.mock.calls[0]![0] as string;
    expect(query).toContain('jarvis_session_id = @sessionId');
    expect(query).toContain('source_event_id LIKE @sourcePrefix');
    expect(query).toContain('at > DATEADD(millisecond, -2500, @at)');
  });

  it.each(['rate-limited', 'limit', 'inactive'] as const)('returns %s without fabricating success', async (outcome) => {
    const { request, store } = fixture();
    request.query.mockResolvedValue({ recordset: [{ outcome, usedDkk: 2.5 }], rowsAffected: [] });
    expect(await store.reserveWatchFrame(frame)).toEqual({ outcome, usedDkk: 2.5 });
  });

  it('preserves zero budgets and rounds fractional DKK limits down at the SQL boundary', async () => {
    const { request, store } = fixture();
    await store.reserveWatchFrame({ ...frame, limitDkk: 0 });
    expect(request.input).toHaveBeenCalledWith('limitDkk', expect.anything(), 0);
    await store.reserveWatchFrame({ ...frame, limitDkk: 1.23459 });
    expect(request.input).toHaveBeenCalledWith('limitDkk', expect.anything(), 1.2345);
  });

  it.each([
    { limitDkk: 6.5785, usedDkk: 6.4785, outcome: 'reserved' },
    { limitDkk: 6.5785, usedDkk: 6.4786, outcome: 'limit' },
    { limitDkk: 0.0999, usedDkk: 0, outcome: 'limit' },
    { limitDkk: 0, usedDkk: 0, outcome: 'limit' },
    { limitDkk: 0.1, usedDkk: 0, outcome: 'reserved' },
    { limitDkk: 0.1, usedDkk: 0.1, outcome: 'limit' },
  ] as const)('preserves strict admission near the budget and for micro budgets: %j', async ({ limitDkk, usedDkk, outcome }) => {
    const { request, store } = fixture();
    const persistedCost = outcome === 'reserved' ? usedDkk + WATCH_FRAME_PENDING_COST_DKK : usedDkk;
    request.query.mockResolvedValue({ recordset: [{ outcome, usedDkk: persistedCost }], rowsAffected: [] });
    expect(await store.reserveWatchFrame({ ...frame, limitDkk })).toEqual({ outcome, usedDkk: persistedCost });
    expect(request.input).toHaveBeenCalledWith('pendingCostDkk', expect.anything(), 0.1);
    expect(request.input).toHaveBeenCalledWith('limitDkk', expect.anything(), Math.floor(limitDkk * 10_000) / 10_000);
    const query = request.query.mock.calls[0]![0] as string;
    expect(query.indexOf('ELSE IF @usedDkk + @pendingCostDkk > @limitDkk'))
      .toBeLessThan(query.indexOf('INSERT INTO dbo.usage'));
    expect(query).toContain("SELECT N'limit' AS outcome, @usedDkk AS usedDkk");
  });

  it('keeps an unknown-cost hold in its original day and excludes it only on the next UTC day', async () => {
    const { request, store } = fixture();
    const nextDay = new Date('2026-10-07T00:00:00.000Z');
    await store.recordTokens({
      sessionId: frame.sessionId, eventId: frame.eventId, inputTokens: 0, outputTokens: 0,
      costDkk: null, costUsd: null, costStatus: 'unverified', model: 'gpt-6-luna', at: nextDay,
    });
    expect(request.query.mock.calls[0]![0]).toContain('SET cost_dkk = COALESCE(@costDkk, cost_dkk)');
    expect(request.query.mock.calls[0]![0]).not.toContain('DELETE');
    request.query.mockResolvedValueOnce({ recordset: [{ outcome: 'limit', usedDkk: 0.1 }], rowsAffected: [] });
    expect(await store.reserveWatchFrame({ ...frame, limitDkk: 0.1 })).toEqual({ outcome: 'limit', usedDkk: 0.1 });
    request.query.mockResolvedValueOnce({ recordset: [{ outcome: 'reserved', usedDkk: 0.1 }], rowsAffected: [1] });
    expect(await store.reserveWatchFrame({ ...frame, at: nextDay, limitDkk: 0.1 }))
      .toEqual({ outcome: 'reserved', usedDkk: 0.1 });
    expect(request.input).toHaveBeenCalledWith('dayStart', sql.DateTime2, nextDay);
    expect(request.input).toHaveBeenCalledWith('lockResource', expect.anything(), 'jarvis.screen-frame-cap:2026-10-07');
    expect(request.query.mock.calls[2]![0]).toContain('at >= @dayStart AND at < @dayEnd');
  });

  it.each([-1, NaN, Infinity, 100_000_000])('rejects unsafe DKK limits: %s', async (limitDkk) => {
    const { request, store } = fixture();
    await expect(store.reserveWatchFrame({ ...frame, limitDkk })).rejects.toThrow('Invalid watch frame reservation');
    expect(request.query).not.toHaveBeenCalled();
  });

  it('rejects mismatched source IDs and invalid dates before opening a transaction', async () => {
    const { request, transaction, store } = fixture();
    await expect(store.reserveWatchFrame({ ...frame, eventId: 'watch:camera:frame' })).rejects.toThrow('Invalid watch frame');
    await expect(store.reserveWatchFrame({ ...frame, at: new Date(NaN) })).rejects.toThrow('Invalid watch frame');
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(request.query).not.toHaveBeenCalled();
  });

  it.each([[], [{ outcome: 'reserved', usedDkk: NaN }], [{ outcome: 'reserved', usedDkk: -1 }]])(
    'rolls back missing or invalid watch reservation results', async (recordset) => {
      const { request, transaction, store } = fixture();
      request.query.mockResolvedValue({ recordset, rowsAffected: [] });
      await expect(store.reserveWatchFrame(frame)).rejects.toThrow('Watch usage could not be reserved');
      expect(transaction.rollback).toHaveBeenCalledOnce();
      expect(transaction.commit).not.toHaveBeenCalled();
    },
  );

  it('sanitizes SQL failures and leaves failed reconciliation holds intact through rollback', async () => {
    const { request, transaction, store } = fixture();
    request.query.mockRejectedValue(new Error('private SQL connection details'));
    await expect(store.reserveWatchFrame(frame)).rejects.toThrow('Watch usage could not be reserved');
    await expect(store.recordTokens({
      sessionId: frame.sessionId, eventId: frame.eventId, inputTokens: 5, outputTokens: 2,
      costDkk: 0.001, costUsd: 0.000152, costStatus: 'estimated', model: 'gpt-6-luna', at,
    })).rejects.toThrow('Screen usage could not be recorded');
    expect(transaction.rollback).toHaveBeenCalledTimes(2);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('counts persisted daily costs across all sessions and on-demand frames without token double-counting', async () => {
    const { request, store } = fixture();
    request.query.mockResolvedValue({ recordset: [{ usedDkk: 2.1234 }], rowsAffected: [] });
    expect(await store.readWatchBudget(at)).toBe(2.1234);
    const query = request.query.mock.calls[0]![0] as string;
    expect(query).toContain('COALESCE(SUM(cost_dkk), 0)');
    expect(query).toContain("source = N'jarvis_model' AND metric = N'screen_frames'");
    expect(query).toContain('at >= @dayStart AND at < @dayEnd');
    expect(query).not.toContain('jarvis_session_id');
    expect(query).not.toContain('source_event_id');
  });

  it.each([[], [{ usedDkk: NaN }], [{ usedDkk: -1 }]])('fails closed on invalid budget reads', async (recordset) => {
    const { request, store } = fixture();
    request.query.mockResolvedValue({ recordset, rowsAffected: [] });
    await expect(store.readWatchBudget(at)).rejects.toThrow('Watch budget could not be read');
  });

  it('keeps on-demand caps and stores a pending cost under the same lock', async () => {
    const { request, store } = fixture();
    expect(await store.reserveFrame({ sessionId: '42', eventId: 'demand-frame', dailyCap: 300, at })).toBe('reserved');
    expect(request.input).toHaveBeenCalledWith('eventId', expect.anything(), 'screen:demand-frame');
    expect(request.input).toHaveBeenCalledWith('pendingCostDkk', expect.anything(), WATCH_FRAME_PENDING_COST_DKK);
    const query = request.query.mock.calls[0]![0] as string;
    expect(query).toContain('COUNT_BIG(*)');
    expect(query).toContain('>= @dailyCap');
    expect(query).toContain('DATEADD(millisecond, -3000, @at)');
    expect(query).toContain('jarvis_sessions');
  });

  it('excludes watch rows from both on-demand limits while preserving null event IDs and boundaries', async () => {
    const { request, store } = fixture();
    await store.reserveFrame({ sessionId: '42', eventId: 'demand-frame', dailyCap: 300, at });
    const query = request.query.mock.calls[0]![0] as string;
    const throttle = query.slice(query.indexOf('ELSE IF EXISTS'), query.indexOf('ELSE IF ('));
    const count = query.slice(query.indexOf('SELECT COUNT_BIG(*)'), query.indexOf(') >= @dailyCap'));
    const excludeWatch = "(source_event_id IS NULL OR source_event_id NOT LIKE N'screen:watch:%')";
    expect(throttle).toContain(excludeWatch);
    expect(throttle).toContain('jarvis_session_id = @sessionId');
    expect(throttle).toContain('at > DATEADD(millisecond, -3000, @at)');
    expect(count).toContain(excludeWatch);
    expect(count).toContain('at >= @dayStart AND at < @dayEnd');
    expect(count).not.toContain('jarvis_session_id = @sessionId');
    expect(query).toContain(') >= @dailyCap');
    expect(request.input).toHaveBeenCalledWith('dailyCap', sql.Int, 300);
    expect(request.input).toHaveBeenCalledWith('at', sql.DateTime2, at);
    expect(request.input).toHaveBeenCalledWith('dayStart', sql.DateTime2, new Date('2026-10-06T00:00:00.000Z'));
    expect(request.input).toHaveBeenCalledWith('dayEnd', sql.DateTime2, new Date('2026-10-07T00:00:00.000Z'));

    await store.reserveWatchFrame(frame);
    expect(request.query.mock.calls[1]![0]).not.toContain('NOT LIKE');
    request.query.mockResolvedValueOnce({ recordset: [{ usedDkk: 0.2 }], rowsAffected: [] });
    await store.readWatchBudget(at);
    expect(request.query.mock.calls[2]![0]).not.toContain('source_event_id');
  });

  it.each([0.0123, null])('reconciles known costs and keeps pending costs when unknown: %s', async (costDkk) => {
    const { request, transaction, store } = fixture();
    await store.recordTokens({
      sessionId: frame.sessionId, eventId: frame.eventId, inputTokens: 5, outputTokens: 2, costDkk,
      costUsd: costDkk === null ? null : 0.0018, costStatus: costDkk === null ? 'unverified' : 'estimated',
      model: 'gpt-6-luna',
      at: new Date('2026-10-07T00:00:00.000Z'),
    });
    const query = request.query.mock.calls[0]![0] as string;
    expect(query).toContain('SELECT @frameAt = at');
    expect(query).toContain("N'jarvis.screen-frame-cap:' + CONVERT(nvarchar(10), @frameAt, 23)");
    expect(query).toContain('sys.sp_getapplock');
    expect(query).toContain('SET cost_dkk = COALESCE(@costDkk, cost_dkk)');
    expect(query).toContain('cost_usd = COALESCE(@costUsd, cost_usd)');
    expect(query).toContain('role = N\'vision\', model = @model');
    expect(query).toContain('jarvis_session_id = @sessionId');
    expect(request.input).toHaveBeenCalledWith('costDkk', expect.anything(), costDkk);
    expect(request.input).toHaveBeenCalledWith('costUsd', expect.anything(), costDkk === null ? null : 0.0018);
    expect(request.input.mock.calls.filter(([key]) => key === 'eventId').map(([, , value]) => value))
      .toEqual([`screen:${frame.eventId}`, `screen:${frame.eventId}`, `screen:${frame.eventId}`]);
    expect(request.query).toHaveBeenCalledTimes(3);
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  it('rejects missing frame reservations and skips zero token rows', async () => {
    const { request, transaction, store } = fixture();
    request.query.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });
    const tokens = {
      sessionId: '42', eventId: 'frame', inputTokens: 0, outputTokens: 0,
      costDkk: null, costUsd: null, costStatus: 'unverified' as const, model: 'gpt-6-luna', at,
    };
    await expect(store.recordTokens(tokens)).rejects.toThrow('Screen usage could not be recorded');
    expect(transaction.rollback).toHaveBeenCalledOnce();
    await store.recordTokens(tokens);
    expect(request.query).toHaveBeenCalledTimes(2);
  });
});
