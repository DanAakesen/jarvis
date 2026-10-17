import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationSummaryStore } from './conversation-summary-store.js';

const owner = '8D1A0E29-2A4C-4F5C-9D3E-0B6F6C4C7A11';
const created = new Date('2026-10-18T08:00:00.000Z');

function summaryRow(version: number, through: string) {
  return {
    version, from_message_id: '1', through_message_id: through, message_count: Number(through),
    summary: 'Earlier chat', open_items: 'Call back', model: 'summary-model', created_at: created,
  };
}

function fakeDatabase(...results: (unknown[] | Error)[]) {
  const query = vi.fn();
  for (const result of results) {
    if (result instanceof Error) query.mockRejectedValueOnce(result);
    else query.mockResolvedValueOnce({ recordset: result });
  }
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const transaction = {
    begin: vi.fn(async () => {}), request: vi.fn(() => request),
    commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}),
  };
  vi.spyOn(sql, 'Transaction').mockImplementation(function () {
    return transaction as unknown as sql.Transaction;
  });
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { pool, input, query, transaction };
}

const appendInput = {
  ownerObjectId: owner, baseVersion: 1, fromMessageId: '1', throughMessageId: '40', messageCount: 40,
  summary: 'Rolled up', openItems: '', model: 'summary-model', dailyLimit: 24,
};

describe('SQL conversation summary store', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the newest owner-scoped summary with string ids and a UTC timestamp', async () => {
    const data = fakeDatabase([summaryRow(3, '120')], []);
    const store = createConversationSummaryStore(data.pool);
    await expect(store.latest(owner)).resolves.toEqual({
      version: 3, fromMessageId: '1', throughMessageId: '120', messageCount: 120, summary: 'Earlier chat',
      openItems: 'Call back', model: 'summary-model', createdAt: '2026-10-18T08:00:00.000Z',
    });
    expect(data.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner.toLowerCase());
    expect(data.query.mock.calls[0]?.[0]).toContain('ORDER BY version DESC');
    expect(data.query.mock.calls[0]?.[0]).not.toContain('UPDLOCK');
    await expect(store.latest(owner)).resolves.toBeNull();
    await expect(store.latest('not-a-guid')).rejects.toThrow(TypeError);
  });

  it('counts owner rows in the requested window, 24 hours by default', async () => {
    const data = fakeDatabase([{ used: 5 }], [{ used: 2 }]);
    const store = createConversationSummaryStore(data.pool);
    await expect(store.usedSince(owner)).resolves.toBe(5);
    expect(data.input).toHaveBeenCalledWith('hours', sql.Int, 24);
    expect(data.query.mock.calls[0]?.[0]).toContain('DATEADD(hour, -@hours, SYSUTCDATETIME())');
    await expect(store.usedSince(owner, 48)).resolves.toBe(2);
    expect(data.input).toHaveBeenCalledWith('hours', sql.Int, 48);
  });

  it('appends the next version under a lock, prunes old versions and commits', async () => {
    const data = fakeDatabase([summaryRow(1, '20')], [{ used: 3 }], [summaryRow(2, '40')], []);
    const result = await createConversationSummaryStore(data.pool).append(appendInput);
    expect(result).toEqual({
      status: 'saved', record: expect.objectContaining({ version: 2, throughMessageId: '40' }), usedLast24h: 4,
    });
    expect(data.query.mock.calls[0]?.[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(data.query.mock.calls[2]?.[0]).toContain('INSERT dbo.conversation_summaries');
    expect(data.query.mock.calls[3]?.[0]).toContain('DELETE dbo.conversation_summaries');
    expect(data.input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner.toLowerCase());
    expect(data.input).toHaveBeenCalledWith('version', sql.Int, 2);
    expect(data.input).toHaveBeenCalledWith('fromId', sql.BigInt, 1n);
    expect(data.input).toHaveBeenCalledWith('throughId', sql.BigInt, 40n);
    expect(data.input).toHaveBeenCalledWith('oldest', sql.Int, -197);
    expect(data.transaction.commit).toHaveBeenCalledOnce();
    expect(data.transaction.rollback).not.toHaveBeenCalled();
  });

  it('creates version 1 when the owner has no summary yet', async () => {
    const data = fakeDatabase([], [{ used: 0 }], [summaryRow(1, '40')], []);
    const result = await createConversationSummaryStore(data.pool).append({ ...appendInput, baseVersion: 0 });
    expect(result).toMatchObject({ status: 'saved', record: { version: 1 }, usedLast24h: 1 });
    expect(data.input).toHaveBeenCalledWith('version', sql.Int, 1);
  });

  const rejectedAppends: { name: string; latest: ReturnType<typeof summaryRow>; overrides: object; expected: object }[] = [
    { name: 'a stale base version', latest: summaryRow(3, '20'), overrides: { baseVersion: 1 }, expected: { status: 'conflict', latestVersion: 3 } },
    { name: 'a range that does not extend the latest summary', latest: summaryRow(1, '40'), overrides: {}, expected: { status: 'invalid_range' } },
    { name: 'a range that starts after the first summarised message', latest: summaryRow(1, '20'), overrides: { fromMessageId: '5' }, expected: { status: 'invalid_range' } },
  ];

  it.each(rejectedAppends)('rolls back without inserting for $name', async ({ latest, overrides, expected }) => {
    const data = fakeDatabase([latest]);
    await expect(createConversationSummaryStore(data.pool).append({ ...appendInput, ...overrides })).resolves.toEqual(expected);
    expect(data.query).toHaveBeenCalledOnce();
    expect(data.transaction.rollback).toHaveBeenCalledOnce();
    expect(data.transaction.commit).not.toHaveBeenCalled();
  });

  it.each([[24, 24], [0, 0]])('reports the limit when %i recent rows meet a daily limit of %i', async (used, dailyLimit) => {
    const data = fakeDatabase([summaryRow(1, '20')], [{ used }]);
    await expect(createConversationSummaryStore(data.pool).append({ ...appendInput, dailyLimit }))
      .resolves.toEqual({ status: 'limit', used });
    expect(data.query).toHaveBeenCalledTimes(2);
    expect(data.transaction.rollback).toHaveBeenCalledOnce();
    expect(data.transaction.commit).not.toHaveBeenCalled();
  });

  it('treats a duplicate-key failure as a version conflict', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { number: 2627 });
    const data = fakeDatabase([summaryRow(1, '20')], [{ used: 0 }], duplicate, [summaryRow(2, '30')]);
    await expect(createConversationSummaryStore(data.pool).append(appendInput))
      .resolves.toEqual({ status: 'conflict', latestVersion: 2 });
    expect(data.transaction.rollback).toHaveBeenCalledOnce();
  });

  it('rolls back and rethrows unexpected database failures', async () => {
    const data = fakeDatabase(new Error('connection lost'));
    await expect(createConversationSummaryStore(data.pool).append(appendInput)).rejects.toThrow('connection lost');
    expect(data.transaction.rollback).toHaveBeenCalledOnce();
  });

  it('rejects invalid input before touching the database', async () => {
    const data = fakeDatabase();
    const store = createConversationSummaryStore(data.pool);
    await expect(store.append({ ...appendInput, ownerObjectId: 'someone' })).rejects.toThrow(TypeError);
    await expect(store.append({ ...appendInput, throughMessageId: '9223372036854775808' })).rejects.toThrow(TypeError);
    await expect(store.append({ ...appendInput, dailyLimit: Number.NaN })).rejects.toThrow(TypeError);
    expect(data.transaction.begin).not.toHaveBeenCalled();
  });
});
