import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeSessionStore } from './runtime-session-store.js';
import { readDownMigration, readMigrations } from './migrations.js';
const owner = '11111111-2222-3333-4444-555555555555';
const claim = { ownerObjectId: owner, sessionId: '42', sourceMessageId: '43', claimId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
const target = { model: 'model', effort: 'high', agentName: 'agent', version: '1', fingerprint: 'a'.repeat(64) };
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
    await expect(store.bindNativeConversation({ ...claim, nativeConversationId: 'opaque/ABC' })).resolves.toBe(true);
    expect(input).toHaveBeenCalledWith('nativeId', sql.NVarChar(512), 'opaque/ABC');
    const statement = query.mock.calls[0]![0];
    for (const predicate of ['r.owner_object_id = @owner', "r.runtime_test = N'copilot'",
      's.ended_at IS NULL', 'r.native_conversation_id IS NULL', 'DATALENGTH(@nativeId)', "t.status = N'active'", 't.claim_id = @claimId', 't.source_message_id = @sourceId']) expect(statement).toContain(predicate);
    expect(query).toHaveBeenCalledOnce();
  });
  it('reports binding conflict/foreign/ended session without pretending success', async () => {
    await expect(fixture().store.bindNativeConversation({ ...claim, nativeConversationId: 'other' })).resolves.toBe(false);
  });
  it('rejects malformed input before SQL and propagates persistence failure', async () => {
    const { store, query } = fixture();
    await expect(store.getSession('untrusted', '42')).rejects.toThrow();
    await expect(store.bindNativeConversation({ ...claim, nativeConversationId: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    query.mockRejectedValueOnce(new Error('unavailable'));
    await expect(store.bindNativeConversation({ ...claim, nativeConversationId: 'opaque' })).rejects.toThrow('unavailable');
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


describe('durable managed turn claims', () => {
  function transactionFixture(kind: string) {
    const query = vi.fn().mockResolvedValue({ recordset: [{ kind, native_conversation_id: 'opaque' }], rowsAffected: [1] });
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const transaction = { begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), request: vi.fn(() => request) };
    const constructor = vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction; } as unknown as typeof sql.Transaction);
    return { store: createRuntimeSessionStore({} as sql.ConnectionPool), transaction, constructor, query, request };
  }
  it('claims under a persisted session lock with verified source and immutable target in one transaction', async () => {
    const data = transactionFixture('claimed');
    try {
      const result = await data.store.claimTurn({ ...claim, target });
      expect(result).toMatchObject({ kind: 'claimed', nativeConversationId: 'opaque' });
      if (result.kind === 'claimed') expect(result.claimId).toMatch(/^[a-f0-9-]{36}$/u);
      expect(data.transaction.commit).toHaveBeenCalledOnce();
      expect(data.transaction.rollback).not.toHaveBeenCalled();
      const statement = data.query.mock.calls[0]![0];
      for (const fragment of ['UPDLOCK, HOLDLOCK', 'role = N\'dan\'', 'jarvis_session_id = @sessionId',
        'r.owner_object_id = @owner', 's.ended_at IS NULL', 'target_fingerprint <> @fingerprint',
        'source_already_claimed', 'session_busy', 'INSERT INTO dbo.session_runtime_turns', 'INSERT INTO dbo.session_runtime_sources', 'ELSE IF EXISTS (SELECT 1 FROM dbo.session_runtime_sources']) expect(statement).toContain(fragment);
      expect(data.request.input).toHaveBeenCalledWith('fingerprint', sql.VarChar(64), target.fingerprint);
    } finally { data.constructor.mockRestore(); }
  });
  it.each(['unavailable', 'source_already_claimed', 'session_busy', 'target_mismatch'])('rolls back %s without exposing a claim capability or native reference', async (kind) => {
    const data = transactionFixture(kind);
    try {
      await expect(data.store.claimTurn({ ...claim, target })).resolves.toEqual({ kind });
      expect(data.transaction.rollback).toHaveBeenCalledOnce();
      expect(data.transaction.commit).not.toHaveBeenCalled();
    } finally { data.constructor.mockRestore(); }
  });
  it('does not retry uncertain commit or storage failures', async () => {
    const data = transactionFixture('claimed');
    try {
      data.transaction.commit.mockRejectedValueOnce(new Error('commit outcome uncertain'));
      await expect(data.store.claimTurn({ ...claim, target })).rejects.toThrow('commit outcome uncertain');
      expect(data.query).toHaveBeenCalledOnce();
      expect(data.transaction.rollback).toHaveBeenCalledOnce();
    } finally { data.constructor.mockRestore(); }
  });
  it('rejects malformed source or target before beginning a transaction', async () => {
    const data = transactionFixture('claimed');
    try {
      await expect(data.store.claimTurn({ ...claim, sourceMessageId: '0', target })).rejects.toThrow();
      await expect(data.store.claimTurn({ ...claim, target: { ...target, fingerprint: 'A'.repeat(64) } })).rejects.toThrow();
      expect(data.transaction.begin).not.toHaveBeenCalled();
    } finally { data.constructor.mockRestore(); }
  });
  it('completes only exact active claims and never reports a replay as success', async () => {
    const data = fixture([], [1]);
    await expect(data.store.completeTurn({ ...claim, outcome: 'failed' })).resolves.toBe(true);
    const statement = data.query.mock.calls[0]![0];
    for (const predicate of ['t.claim_id = @claimId', 't.source_message_id = @sourceId', "t.status = N'active'", 'r.owner_object_id = @owner']) expect(statement).toContain(predicate);
    await expect(fixture().store.completeTurn({ ...claim, outcome: 'succeeded' })).resolves.toBe(false);
  });
});


it('ships durable source uniqueness and one active claim per session with guarded rollback', async () => {
  const migration = (await readMigrations()).find((item) => item.name === '0069_runtime_test_sessions.sql')!;
  expect(migration.sql).toContain('PRIMARY KEY (jarvis_session_id, source_message_id)');
  expect(migration.sql).toContain("WHERE status = N'active'");
  expect(migration.sql).toContain("status IN (N'active', N'succeeded', N'failed')");
  expect(migration.sql).toContain('CONSTRAINT UQ_session_runtime_turns_claim UNIQUE (claim_id)');
  const down = await readDownMigration(migration.name);
  expect(down.sql.indexOf('THROW')).toBeLessThan(down.sql.indexOf('DROP TABLE dbo.session_runtime_turns'));
});


describe('consumed steering source attachment', () => {
  function fixtureAttachment(attached: boolean) {
    const query = vi.fn().mockResolvedValue({ recordset: [{ attached }] });
    const request = { input: vi.fn(), query };
    request.input.mockReturnValue(request);
    const transaction = { begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), request: vi.fn(() => request) };
    const constructor = vi.spyOn(sql, 'Transaction').mockImplementation(function () { return transaction; } as unknown as typeof sql.Transaction);
    return { store: createRuntimeSessionStore({} as sql.ConnectionPool), transaction, constructor, query, request };
  }
  it('persists only verified later user messages under the exact active root capability', async () => {
    const data = fixtureAttachment(true);
    try {
      await expect(data.store.attachSource({ ...claim, additionalSourceMessageId: '44' })).resolves.toBe(true);
      expect(data.transaction.commit).toHaveBeenCalledOnce();
      expect(data.transaction.rollback).not.toHaveBeenCalled();
      expect(data.request.input).toHaveBeenCalledWith('additionalSourceId', sql.BigInt, 44n);
      const statement = data.query.mock.calls[0]![0];
      for (const fragment of ['UPDLOCK, HOLDLOCK', 't.source_message_id = @sourceId', 't.claim_id = @claimId',
        "t.status = N'active'", 'r.owner_object_id = @owner', "r.runtime_test = N'copilot'", 's.ended_at IS NULL',
        '@additionalSourceId <= @sourceId', "role = N'dan'", 'jarvis_session_id = @sessionId',
        'source_message_id = @additionalSourceId AND claim_id = @claimId', 'INSERT INTO dbo.session_runtime_sources']) expect(statement).toContain(fragment);
    } finally { data.constructor.mockRestore(); }
  });
  it('rolls back denied attachment and never retries an uncertain outcome', async () => {
    const data = fixtureAttachment(false);
    try {
      await expect(data.store.attachSource({ ...claim, additionalSourceMessageId: '44' })).resolves.toBe(false);
      expect(data.transaction.commit).not.toHaveBeenCalled();
      expect(data.transaction.rollback).toHaveBeenCalledOnce();
      data.query.mockRejectedValueOnce(new Error('uncertain'));
      await expect(data.store.attachSource({ ...claim, additionalSourceMessageId: '44' })).rejects.toThrow('uncertain');
      expect(data.query).toHaveBeenCalledTimes(2);
    } finally { data.constructor.mockRestore(); }
  });
  it('rejects malformed capability or source before transaction', async () => {
    const data = fixtureAttachment(true);
    try {
      await expect(data.store.attachSource({ ...claim, additionalSourceMessageId: 'invalid' })).rejects.toThrow();
      await expect(data.store.attachSource({ ...claim, claimId: 'invalid', additionalSourceMessageId: '44' })).rejects.toThrow();
      expect(data.transaction.begin).not.toHaveBeenCalled();
    } finally { data.constructor.mockRestore(); }
  });
});
