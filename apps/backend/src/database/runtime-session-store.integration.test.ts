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
  it('persists immutable choice, enforces owner lookup, and atomically binds exactly one native reference', async () => {
    const owner = randomUUID();
    const foreign = randomUUID();
    const store = createRuntimeSessionStore(pool);
    const created = await store.createSession({ ownerObjectId: owner, language: 'en', runtimeTest: 'copilot' });
    await expect(store.getSession(foreign, created.session.id)).resolves.toBeNull();
    const attempts = await Promise.all(['native-A', 'native-B'].map((native) =>
      store.bindNativeConversation(owner, created.session.id, native)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const restored = await createRuntimeSessionStore(pool).getSession(owner, created.session.id);
    const winner = restored!.nativeConversationId!;
    expect(winner).toBe(attempts[0] ? 'native-A' : 'native-B');
    await expect(store.bindNativeConversation(owner, created.session.id, winner)).resolves.toBe(true);
    await expect(store.bindNativeConversation(owner, created.session.id, `${winner} `)).resolves.toBe(false);
    await expect(store.bindNativeConversation(foreign, created.session.id, winner)).resolves.toBe(false);
    const current = await store.createSession({ ownerObjectId: owner, language: 'en', runtimeTest: 'current' });
    await expect(store.bindNativeConversation(owner, current.session.id, 'native')).resolves.toBe(false);
    await createConversationStore(pool).endSession(created.session.id);
    await expect(store.bindNativeConversation(owner, created.session.id, winner)).resolves.toBe(false);
    expect((await store.getSession(owner, created.session.id))?.runtimeTest).toBe('copilot');
  });
  it('keeps normal history compatible and test messages available only through explicit session scope', async () => {
    const store = createConversationStore(pool);
    const normal = await store.createSession({ channel: 'chat', language: 'en' });
    const test = await store.createSession({ channel: 'chat', language: 'en', runtimeTest: 'current', ownerObjectId: randomUUID() });
    expect(normal).not.toHaveProperty('runtimeTest');
    expect(test.runtimeTest).toBe('current');
    const ordinaryMessage = await store.addMessage({ sessionId: normal.id, role: 'dan', text: 'Normal fixture', model: null });
    const testMessage = await store.addMessage({ sessionId: test.id, role: 'dan', text: 'Test fixture', model: null });
    const history = await store.getHistory({ limit: 50 });
    expect(history.messages.map((item) => item.id)).toContain(ordinaryMessage!.id);
    expect(history.messages.map((item) => item.id)).not.toContain(testMessage!.id);
    const scoped = await store.getHistory({ limit: 50, sessionId: test.id });
    expect(scoped.messages.map((item) => item.id)).toEqual([testMessage!.id]);
    await expect(createRuntimeSessionStore(pool).getSession(randomUUID(), normal.id)).resolves.toBeNull();
  });
});
