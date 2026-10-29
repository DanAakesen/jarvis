import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeSessionStore } from './runtime-session-store.js';
const owner = '11111111-2222-3333-4444-555555555555';
function fixture(recordset: unknown[] = [], rowsAffected = [0]) {
  const query = vi.fn(async (text: string) => { expect(text).not.toBe(''); return { recordset, rowsAffected }; });
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { store: createRuntimeSessionStore(pool), query, input };
}
describe('persisted runtime sessions', () => {
  it('scopes every lookup to authenticated owner and returns no row for normal/foreign sessions', async () => {
    const { store, query, input } = fixture();
    await expect(store.getSession(owner, '42')).resolves.toBeNull();
    expect(input).toHaveBeenCalledWith('owner', sql.UniqueIdentifier, owner);
    expect(input).toHaveBeenCalledWith('sessionId', sql.BigInt, 42n);
    expect(query.mock.calls[0]?.[0]).toContain('r.owner_object_id = @owner');
    expect(query.mock.calls[0]?.[0]).toContain('JOIN dbo.session_runtime_tests');
  });
  it('restores selection and opaque binding from durable metadata', async () => {
    const started = new Date();
    const { store } = fixture([{ id: '42', language: 'en', started_at: started, ended_at: null,
      runtime_test: 'copilot', native_conversation_id: 'opaque/ABC' }]);
    await expect(store.getSession(owner, '42')).resolves.toEqual({
      session: { id: '42', channel: 'chat', language: 'en', startedAt: started, endedAt: null },
      runtimeTest: 'copilot', nativeConversationId: 'opaque/ABC',
    });
  });
  it('uses one conditional update for copilot binding, with exact replay and owner predicates', async () => {
    const { store, query, input } = fixture([], [1]);
    await expect(store.bindNativeConversation(owner, '42', 'opaque/ABC')).resolves.toBe(true);
    expect(input).toHaveBeenCalledWith('nativeId', sql.NVarChar(512), 'opaque/ABC');
    const statement = query.mock.calls[0]![0];
    for (const predicate of ['r.owner_object_id = @owner', "r.runtime_test = N'copilot'",
      's.ended_at IS NULL', 'r.native_conversation_id IS NULL', 'DATALENGTH(@nativeId)']) expect(statement).toContain(predicate);
    expect(query).toHaveBeenCalledOnce();
  });
  it('reports binding conflict/foreign/ended session without pretending success', async () => {
    await expect(fixture().store.bindNativeConversation(owner, '42', 'other')).resolves.toBe(false);
  });
  it('rejects malformed input before SQL and propagates persistence failure', async () => {
    const { store, query } = fixture();
    await expect(store.getSession('untrusted', '42')).rejects.toThrow();
    await expect(store.bindNativeConversation(owner, '42', '')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    query.mockRejectedValueOnce(new Error('unavailable'));
    await expect(store.bindNativeConversation(owner, '42', 'opaque')).rejects.toThrow('unavailable');
  });
});


describe('atomic test session creation', () => {
  it('commits chat and runtime metadata together and rolls back failed metadata writes', async () => {
    const row = { id: '42', language: 'en', started_at: new Date(), ended_at: null,
      runtime_test: 'copilot', native_conversation_id: null };
    const query = vi.fn().mockResolvedValue({ recordset: [row] });
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const transaction = { begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), request: vi.fn(() => request) };
    const constructor = vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction; } as unknown as typeof sql.Transaction);
    try {
      const store = createRuntimeSessionStore({} as sql.ConnectionPool);
      const created = await store.createSession({ ownerObjectId: owner, language: 'en', runtimeTest: 'copilot' });
      expect(created.runtimeTest).toBe('copilot');
      expect(transaction.begin).toHaveBeenCalledOnce();
      expect(transaction.commit).toHaveBeenCalledOnce();
      expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO dbo.jarvis_sessions');
      expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO dbo.session_runtime_tests');
      query.mockRejectedValueOnce(new Error('metadata unavailable'));
      await expect(store.createSession({ ownerObjectId: owner, language: 'en', runtimeTest: 'current' })).rejects.toThrow('metadata unavailable');
      expect(transaction.rollback).toHaveBeenCalledOnce();
      expect(transaction.commit).toHaveBeenCalledOnce();
    } finally { constructor.mockRestore(); }
  });
});
