import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationStore } from './conversation-store.js';
import { createRuntimeSessionStore } from './runtime-session-store.js';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readMigrations } from './migrations.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_runtime_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
  await applyMigrations(pool, await readMigrations());
});
afterAll(async () => {
  await pool.close();
  if (administrator.connected) {
    await administrator.request().batch(`IF DB_ID(N'${database}') IS NOT NULL BEGIN
      ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${database}]; END;`);
  }
  await administrator.close();
});

describe('durable runtime session isolation', () => {
  it('serializes concurrent turns, retains source terminal receipts and permits only claim-owned native binding', async () => {
    const owner = randomUUID();
    const foreign = randomUUID();
    const store = createRuntimeSessionStore(pool);
    const conversations = createConversationStore(pool);
    const target = { model: 'fixture-model', effort: 'high', agentName: 'fixture-agent', version: '1', fingerprint: 'a'.repeat(64) };
    const created = await store.createSession({ ownerObjectId: owner, language: 'en', runtimeTest: 'copilot' });
    const sessionId = created.session.id;
    const source = async (role: 'dan' | 'jarvis' = 'dan', id = sessionId) => {
      const message = await conversations.addMessage({ sessionId: id, role, text: 'Synthetic source', model: null });
      return message!.id;
    };
    const first = await source();
    const second = await source();
    const claim = (sourceMessageId: string) => ({ ownerObjectId: owner, sessionId, sourceMessageId, target });
    await expect(store.claimTurn({ ...claim(first), ownerObjectId: foreign })).resolves.toEqual({ kind: 'unavailable' });
    await expect(store.claimTurn(claim(await source('jarvis')))).resolves.toEqual({ kind: 'unavailable' });
    const normal = await conversations.createSession({ channel: 'chat', language: 'en' });
    await expect(store.claimTurn(claim(await source('dan', normal.id)))).resolves.toEqual({ kind: 'unavailable' });
    const outcomes = await Promise.all([store.claimTurn(claim(first)), store.claimTurn(claim(second))]);
    expect(outcomes.map((item) => item.kind).sort()).toEqual(['claimed', 'session_busy']);
    const winnerIndex = outcomes.findIndex((item) => item.kind === 'claimed');
    const won = outcomes[winnerIndex]!;
    if (won.kind !== 'claimed') throw new Error('Missing claim');
    expect(won.nativeConversationId).toBeNull();
    const winningSource = winnerIndex === 0 ? first : second;
    const losingSource = winnerIndex === 0 ? second : first;
    const capability = { ownerObjectId: owner, sessionId, sourceMessageId: winningSource, claimId: won.claimId };
    await expect(store.claimTurn(claim(winningSource))).resolves.toEqual({ kind: 'source_already_claimed' });
    await expect(store.bindNativeConversation({ ...capability, claimId: randomUUID(), nativeConversationId: 'native' })).resolves.toBe(false);
    await expect(store.bindNativeConversation({ ...capability, sourceMessageId: losingSource, nativeConversationId: 'native' })).resolves.toBe(false);
    await expect(store.bindNativeConversation({ ...capability, ownerObjectId: foreign, nativeConversationId: 'native' })).resolves.toBe(false);
    const binds = await Promise.all(['native-A', 'native-B'].map((nativeConversationId) => store.bindNativeConversation({ ...capability, nativeConversationId })));
    expect(binds.filter(Boolean)).toHaveLength(1);
    const nativeConversationId = binds[0] ? 'native-A' : 'native-B';
    await expect(store.bindNativeConversation({ ...capability, nativeConversationId: `${nativeConversationId} ` })).resolves.toBe(false);
    await expect(store.completeTurn({ ...capability, claimId: randomUUID(), outcome: 'failed' })).resolves.toBe(false);
    await expect(store.completeTurn({ ...capability, outcome: 'failed' })).resolves.toBe(true);
    await expect(store.completeTurn({ ...capability, outcome: 'succeeded' })).resolves.toBe(false);
    await expect(store.bindNativeConversation({ ...capability, nativeConversationId })).resolves.toBe(false);
    await expect(store.claimTurn(claim(winningSource))).resolves.toEqual({ kind: 'source_already_claimed' });
    for (const field of ['model', 'effort', 'agentName', 'version', 'fingerprint']) {
      const changed = { ...target, [field]: field === 'fingerprint' ? 'b'.repeat(64) : 'changed' };
      await expect(store.claimTurn({ ...claim(losingSource), target: changed })).resolves.toEqual({ kind: 'target_mismatch' });
    }
    const next = await createRuntimeSessionStore(pool).claimTurn(claim(losingSource));
    expect(next.kind).toBe('claimed');
    if (next.kind !== 'claimed') throw new Error('Missing next claim');
    expect(next.nativeConversationId).toBe(nativeConversationId);
    // A new process sees the persistent active claim; there is no timer or implicit recovery.
    const third = await source();
    await expect(createRuntimeSessionStore(pool).claimTurn(claim(third))).resolves.toEqual({ kind: 'session_busy' });
    await expect(store.completeTurn({ ownerObjectId: owner, sessionId, sourceMessageId: losingSource, claimId: next.claimId, outcome: 'succeeded' })).resolves.toBe(true);
    await expect(store.claimTurn(claim(losingSource))).resolves.toEqual({ kind: 'source_already_claimed' });
    await conversations.endSession(sessionId);
    await expect(store.claimTurn(claim(third))).resolves.toEqual({ kind: 'unavailable' });
    const current = await store.createSession({ ownerObjectId: owner, language: 'en', runtimeTest: 'current' });
    await expect(store.claimTurn({ ...claim(await source('dan', current.session.id)), sessionId: current.session.id })).resolves.toEqual({ kind: 'unavailable' });
    await expect(store.claimTurn({ ...claim(await source('dan', normal.id)), sessionId: normal.id })).resolves.toEqual({ kind: 'unavailable' });
  });
  it('allows exactly one concurrent claimant for a source and never replays a failed source', async () => {
    const ownerObjectId = randomUUID();
    const store = createRuntimeSessionStore(pool);
    const session = await store.createSession({ ownerObjectId, language: 'en', runtimeTest: 'copilot' });
    const message = await createConversationStore(pool).addMessage({ sessionId: session.session.id, role: 'dan', text: 'Synthetic duplicate', model: null });
    const input = { ownerObjectId, sessionId: session.session.id, sourceMessageId: message!.id,
      target: { model: 'fixture', effort: 'high', agentName: 'fixture', version: '1', fingerprint: 'a'.repeat(64) } };
    const results = await Promise.all([store.claimTurn(input), store.claimTurn(input)]);
    expect(results.map((item) => item.kind).sort()).toEqual(['claimed', 'source_already_claimed']);
    const winner = results.find((item) => item.kind === 'claimed')!;
    if (winner.kind !== 'claimed') throw new Error('Missing claim');
    await expect(store.completeTurn({ ...input, claimId: winner.claimId, outcome: 'failed' })).resolves.toBe(true);
    await expect(store.claimTurn(input)).resolves.toEqual({ kind: 'source_already_claimed' });
  });
  it('retains every consumed steering source against replay across terminal turns', async () => {
    const ownerObjectId = randomUUID();
    const store = createRuntimeSessionStore(pool);
    const conversations = createConversationStore(pool);
    const target = { model: 'fixture', effort: 'high', agentName: 'fixture', version: '1', fingerprint: 'a'.repeat(64) };
    const session = await store.createSession({ ownerObjectId, language: 'en', runtimeTest: 'copilot' });
    const sessionId = session.session.id;
    const source = async (role: 'dan' | 'jarvis' = 'dan', targetSession = sessionId) => (await conversations.addMessage({ sessionId: targetSession, role, text: 'Steering fixture', model: null }))!.id;
    const earlier = await source();
    const root = await source();
    const consumed = await source();
    const assistant = await source('jarvis');
    const foreignSession = await conversations.createSession({ channel: 'chat', language: 'en' });
    const foreignMessage = await source('dan', foreignSession.id);
    const result = await store.claimTurn({ ownerObjectId, sessionId, sourceMessageId: root, target });
    if (result.kind !== 'claimed') throw new Error('Missing claim');
    const capability = { ownerObjectId, sessionId, sourceMessageId: root, claimId: result.claimId };
    for (const additionalSourceMessageId of [root, earlier, assistant, foreignMessage]) {
      await expect(store.attachSource({ ...capability, additionalSourceMessageId })).resolves.toBe(false);
    }
    await expect(store.attachSource({ ...capability, ownerObjectId: randomUUID(), additionalSourceMessageId: consumed })).resolves.toBe(false);
    await expect(store.attachSource({ ...capability, claimId: randomUUID(), additionalSourceMessageId: consumed })).resolves.toBe(false);
    await expect(Promise.all([store.attachSource({ ...capability, additionalSourceMessageId: consumed }),
      store.attachSource({ ...capability, additionalSourceMessageId: consumed })])).resolves.toEqual([true, true]);
    await expect(store.claimTurn({ ownerObjectId, sessionId, sourceMessageId: consumed, target })).resolves.toEqual({ kind: 'source_already_claimed' });
    await expect(store.completeTurn({ ...capability, outcome: 'succeeded' })).resolves.toBe(true);
    await expect(store.attachSource({ ...capability, additionalSourceMessageId: consumed })).resolves.toBe(false);
    await expect(createRuntimeSessionStore(pool).claimTurn({ ownerObjectId, sessionId, sourceMessageId: consumed, target })).resolves.toEqual({ kind: 'source_already_claimed' });
    const nextSource = await source();
    const next = await store.claimTurn({ ownerObjectId, sessionId, sourceMessageId: nextSource, target });
    if (next.kind !== 'claimed') throw new Error('Missing next claim');
    await expect(store.attachSource({ ownerObjectId, sessionId, sourceMessageId: nextSource, claimId: next.claimId, additionalSourceMessageId: consumed })).resolves.toBe(false);
    // A later source consumed by another (earlier-ID root) claim cannot be reclaimed as steering.
    const later = await source();
    await expect(store.attachSource({ ownerObjectId, sessionId, sourceMessageId: nextSource, claimId: next.claimId, additionalSourceMessageId: later })).resolves.toBe(true);
    await expect(store.completeTurn({ ownerObjectId, sessionId, sourceMessageId: nextSource, claimId: next.claimId, outcome: 'failed' })).resolves.toBe(true);
    const olderRoot = await store.claimTurn({ ownerObjectId, sessionId, sourceMessageId: earlier, target });
    if (olderRoot.kind !== 'claimed') throw new Error('Missing older source claim');
    await expect(store.attachSource({ ownerObjectId, sessionId, sourceMessageId: earlier, claimId: olderRoot.claimId, additionalSourceMessageId: later })).resolves.toBe(false);
    await expect(store.claimTurn({ ownerObjectId, sessionId, sourceMessageId: later, target })).resolves.toEqual({ kind: 'source_already_claimed' });
  });
  it('keeps normal history compatible and test messages available only through explicit session scope', async () => {
    const store = createConversationStore(pool);
    const normal = await store.createSession({ channel: 'chat', language: 'en' });
    const test = await store.createSession({ channel: 'chat', language: 'en', runtimeTest: 'current', ownerObjectId: randomUUID() });
    expect(normal).not.toHaveProperty('runtimeTest');
    expect(test.runtimeTest).toBe('current');
    const ordinaryMessage = await store.addMessage({ sessionId: normal.id, role: 'dan', text: 'Normal fixture', model: null });
    const testMessage = await store.addMessage({ sessionId: test.id, role: 'dan', text: 'Test fixture', model: null });
    const history = await store.getHistory({ limit: 50, excludeRuntimeTests: true });
    expect(history.messages.map((item) => item.id)).toContain(ordinaryMessage!.id);
    expect(history.messages.map((item) => item.id)).not.toContain(testMessage!.id);
    const scoped = await store.getHistory({ limit: 50, sessionId: test.id });
    expect(scoped.messages.map((item) => item.id)).toEqual([testMessage!.id]);
    await expect(createRuntimeSessionStore(pool).getSession(randomUUID(), normal.id)).resolves.toBeNull();
  });
});
