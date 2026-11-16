import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, type Migration } from './migrations.js';
import { createWatchCredentialStore, WatchCredentials } from '../auth/watch-credential.js';
import { createInboxIndexStore } from './inbox-index-store.js';
import { createInboxOpsStore } from './inbox-ops-store.js';
import { createPiStore } from './pi-store.js';
import { createInboxCaptureCredentialStore, InboxCaptureCredentialLimit, InboxCaptureCredentials } from '../auth/inbox-capture-credential.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
function migration(name: string, text: string): Migration {
  return { name, sql: text, checksum: createHash('sha256').update(text).digest('hex') };
}
const first = migration('0001_fixture.sql', `CREATE TABLE dbo.migration_fixture (id int NOT NULL PRIMARY KEY, value nvarchar(32) NOT NULL);
  INSERT dbo.migration_fixture VALUES (1, N'original');`);

beforeAll(async () => {
  await administrator.connect();
  await administrator.request().batch(`CREATE DATABASE [${database}];`);
  await pool.connect();
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

describe('real SQL Server migration contract', () => {
  it('serializes concurrent backend replicas and applies the same migration exactly once', async () => {
    const other = new sql.ConnectionPool({ ...configuration, database });
    try {
      await other.connect();
      const results = await Promise.all([applyMigrations(pool, [first]), applyMigrations(other, [first])]);
      expect(results.flat()).toEqual([first.name]);
      const rows = await pool.request().query('SELECT id, value FROM dbo.migration_fixture');
      expect(rows.recordset).toEqual([{ id: 1, value: 'original' }]);
      expect((await pool.request().query('SELECT name FROM dbo.schema_migrations')).recordset).toEqual([{ name: first.name }]);
    } finally { await other.close(); }
  });

  describe('persistent Watch-only credentials', () => {
    it('stores hashes only and preserves rotation, revocation and expiry across database clients', async () => {
      const schema = await readFile(new URL('../../../../db/migrations/0079_watch_credentials.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0079_watch_credentials.sql', import.meta.url), 'utf8');
      await pool.request().batch(schema);
      const other = new sql.ConnectionPool({ ...configuration, database });
      const owner = randomUUID();
      const first = new WatchCredentials(createWatchCredentialStore(pool), owner);
      try {
        await other.connect();
        const restarted = new WatchCredentials(createWatchCredentialStore(other), owner);
        const issued = await first.issue();
        expect(await restarted.verify(issued.credential)).toBe(true);
        const stored = await pool.request().query<{ credential_hash: Buffer; created_at: Date; expires_at: Date }>(
          'SELECT credential_hash, created_at, expires_at FROM dbo.watch_credentials');
        expect(stored.recordset[0]?.credential_hash).toEqual(createHash('sha256').update(issued.credential).digest());
        expect(stored.recordset[0]!.expires_at.getTime() - stored.recordset[0]!.created_at.getTime()).toBe(86_400_000);
        expect(await new WatchCredentials(createWatchCredentialStore(other), randomUUID()).verify(issued.credential)).toBe(false);
        const rotated = await restarted.issue();
        expect(await first.verify(issued.credential)).toBe(false);
        expect(await first.verify(rotated.credential)).toBe(true);
        await first.revoke();
        expect(await restarted.verify(rotated.credential)).toBe(false);
        const concurrent = await Promise.all([first.issue(), restarted.issue()]);
        const active = await Promise.all(concurrent.map(value => restarted.verify(value.credential)));
        expect(active.filter(Boolean)).toHaveLength(1);
        expect((await pool.request().query('SELECT * FROM dbo.watch_credentials')).recordset).toHaveLength(1);
        await expect(pool.request().query('UPDATE dbo.watch_credentials SET expires_at = DATEADD(hour, 25, created_at)')).rejects.toThrow();
        await pool.request().query(`DECLARE @now datetime2(7) = SYSUTCDATETIME();
          UPDATE dbo.watch_credentials SET created_at = DATEADD(day, -2, @now), expires_at = DATEADD(day, -1, @now);`);
        for (const value of concurrent) expect(await first.verify(value.credential)).toBe(false);
      } finally {
        await other.close();
        await pool.request().batch(down);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.watch_credentials', N'U') AS id")).recordset).toEqual([{ id: null }]);
    });
  });
  describe('inbox index', () => {
    it('keeps reservations, nudges and thumbs per item, and enforces its constraints', async () => {
      const schema = await readFile(new URL('../../../../db/migrations/0081_inbox_items.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0081_inbox_items.sql', import.meta.url), 'utf8');
      const nudgeSchema = await readFile(new URL('../../../../db/migrations/0084_inbox_nudge_item.sql', import.meta.url), 'utf8');
      const nudgeDown = await readFile(new URL('../../../../db/migrations/down/0084_inbox_nudge_item.sql', import.meta.url), 'utf8');
      await pool.request().batch(schema);
      await pool.request().batch(nudgeSchema);
      const signal = new AbortController().signal;
      const store = createInboxIndexStore(pool);
      const at = new Date('2026-11-15T10:00:00.000Z');
      try {
        const [first, second] = await Promise.all([store.reserve('aaaaaaaa', signal), store.reserve('aaaaaaaa', signal)]);
        expect([first.inserted, second.inserted].sort()).toEqual([false, true]);
        expect(await store.get('aaaaaaaa', signal)).toMatchObject({ itemId: 'aaaaaaaa', path: null, sha: null, lastNudgedAt: null });
        await store.upsert({ itemId: 'aaaaaaaa', path: 'Inbox/2026-11-15 Idea.md', sha: 'a'.repeat(40), lastNudgedAt: at }, signal);
        expect((await store.get('aaaaaaaa', signal))?.lastNudgedAt).toBeNull();
        await store.upsert({ itemId: 'bbbbbbbb', path: 'Inbox/b.md', sha: 'b'.repeat(40), lastNudgedAt: at }, signal);
        expect((await store.get('bbbbbbbb', signal))?.lastNudgedAt).toEqual(at);
        expect(await store.markNudged('aaaaaaaa', at, signal, 'ABCDEF01-0000-4000-8000-000000000001')).toBe(true);
        expect((await store.get('aaaaaaaa', signal))?.lastNudgeItemId).toBe('abcdef01-0000-4000-8000-000000000001');
        expect(await store.setFeedback('aaaaaaaa', 'down', at, signal)).toBe(true);
        expect(await store.setFeedback('cccccccc', 'up', at, signal)).toBe(false);
        await store.upsert({ itemId: 'aaaaaaaa', path: 'Inbox/renamed.md', sha: 'c'.repeat(40) }, signal);
        expect(await store.get('aaaaaaaa', signal)).toMatchObject({
          path: 'Inbox/renamed.md', sha: 'c'.repeat(40), lastNudgedAt: at, lastFeedback: 'down', lastFeedbackAt: at,
        });
        await expect(pool.request().query("INSERT dbo.inbox_items (item_id) VALUES ('NOT-HEX!!')")).rejects.toThrow();
        await expect(pool.request().query("INSERT dbo.inbox_items (item_id, path) VALUES ('dddddddd', 'Inbox/x.md')")).rejects.toThrow();
        await expect(pool.request().query("UPDATE dbo.inbox_items SET last_feedback='sideways', last_feedback_at=SYSUTCDATETIME()")).rejects.toThrow();
        await store.upsertMany([
          { itemId: 'bbbbbbbb', path: 'Inbox/b2.md', sha: 'd'.repeat(40), lastNudgedAt: null },
          { itemId: 'eeeeeeee', path: 'Inbox/e.md', sha: 'e'.repeat(40), lastNudgedAt: at },
        ], signal);
        expect(await store.get('bbbbbbbb', signal)).toMatchObject({ path: 'Inbox/b2.md', lastNudgedAt: at });
        expect(await store.get('eeeeeeee', signal)).toMatchObject({ path: 'Inbox/e.md', lastNudgedAt: at });
        await expect(store.upsertMany([
          { itemId: 'ffffffff', path: 'Inbox/f.md', sha: 'f'.repeat(40) },
          { itemId: 'NOT-HEX!!', path: 'Inbox/g.md', sha: 'a'.repeat(40) },
        ], signal)).rejects.toThrow();
        expect(await store.get('ffffffff', signal)).toBeNull();
        await store.remove(['eeeeeeee'], signal);
        await store.remove(['aaaaaaaa', 'cccccccc'], signal);
        expect((await store.all(signal)).map((row) => row.itemId)).toEqual(['bbbbbbbb']);
      } finally {
        await pool.request().batch(nudgeDown);
        await pool.request().batch(down);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.inbox_items', N'U') AS id")).recordset).toEqual([{ id: null }]);
    });
  });
  describe('inbox operational state and spend', () => {
    it('keeps small state, adds spend per day and kind, and enforces its constraints', async () => {
      const schema = await readFile(new URL('../../../../db/migrations/0085_inbox_ops.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0085_inbox_ops.sql', import.meta.url), 'utf8');
      await pool.request().batch(schema);
      const signal = new AbortController().signal;
      const ops = createInboxOpsStore(pool);
      try {
        expect(await ops.getState('nudge_style', signal)).toBeNull();
        await Promise.all([ops.setState('nudge_style', 'first', signal), ops.setState('nudge_style', 'second', signal)]);
        expect(['first', 'second']).toContain(await ops.getState('nudge_style', signal));
        await ops.setState('nudge_style', 'Foretrækker weekendforslag om morgenen', signal);
        expect(await ops.getState('nudge_style', signal)).toBe('Foretrækker weekendforslag om morgenen');
        await ops.deleteState('nudge_style', signal);
        expect(await ops.getState('nudge_style', signal)).toBeNull();
        await expect(pool.request().query("INSERT dbo.inbox_state (state_key, state_value) VALUES ('Bad-Key', 'x')")).rejects.toThrow();

        await Promise.all(Array.from({ length: 6 }, () => ops.addSpend('2026-11-15', 'review', { calls: 1, inputTokens: 1000, outputTokens: 100, estimatedDkk: 0.0125 }, signal)));
        await ops.addSpend('2026-11-15', 'audit', { calls: 1, inputTokens: 2000, outputTokens: 200, estimatedDkk: 0.04 }, signal);
        await ops.addSpend('2026-11-10', 'triage', { calls: 2, inputTokens: 10, outputTokens: 5, estimatedDkk: 0.002 }, signal);
        expect(await ops.spendSince('2026-11-12', signal)).toEqual([
          { day: '2026-11-15', kind: 'audit', calls: 1, inputTokens: 2000, outputTokens: 200, estimatedDkk: 0.04 },
          { day: '2026-11-15', kind: 'review', calls: 6, inputTokens: 6000, outputTokens: 600, estimatedDkk: 0.075 },
        ]);
        await expect(ops.addSpend('2026-11-15', 'other' as never, { calls: 1, inputTokens: 1, outputTokens: 1, estimatedDkk: 0 }, signal)).rejects.toThrow();
      } finally {
        await pool.request().batch(down);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.inbox_spend', N'U') AS id")).recordset).toEqual([{ id: null }]);
    });
  });
  describe('PI conversation and turn ledger', () => {
    it('binds one conversation per owner, re-binds on a new agent, and sums spend by month', async () => {
      const schema = await readFile(new URL('../../../../db/migrations/0086_pi_chat.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0086_pi_chat.sql', import.meta.url), 'utf8');
      const brainSchema = await readFile(new URL('../../../../db/migrations/0087_pi_brain.sql', import.meta.url), 'utf8');
      const brainDown = await readFile(new URL('../../../../db/migrations/down/0087_pi_brain.sql', import.meta.url), 'utf8');
      await pool.request().batch(schema);
      await pool.request().batch(brainSchema);
      const signal = new AbortController().signal;
      const store = createPiStore(pool);
      const owner = randomUUID();
      try {
        expect(await store.getConversation(owner, signal)).toBeNull();
        const first = await store.bindConversation(owner, 'jarvis-pi', 'conv_1', signal);
        expect(first).toMatchObject({ agentName: 'jarvis-pi', conversationId: 'conv_1', warmedAt: null, contextHash: null });
        expect((await store.bindConversation(owner, 'jarvis-pi', 'conv_2', signal)).conversationId).toBe('conv_1');
        const at = new Date('2026-11-15T10:00:00Z');
        await store.markWarm(owner, 'a'.repeat(64), at, signal);
        expect(await store.getConversation(owner, signal)).toMatchObject({ warmedAt: at, contextHash: 'a'.repeat(64) });
        const moved = await store.bindConversation(owner, 'jarvis-pi-2', 'conv_3', signal);
        expect(moved).toMatchObject({ agentName: 'jarvis-pi-2', conversationId: 'conv_3', warmedAt: null });
        await store.dropConversation(owner, signal);
        expect(await store.getConversation(owner, signal)).toBeNull();

        const turn = { messageId: '42', model: 'gpt-6.1-terra', inputTokens: 11000, cachedTokens: 9000, outputTokens: 20, costDkk: 0.0731, firstTextMs: 1900, totalMs: 2400, outcome: 'ok' as const };
        await store.recordTurn({ ...turn, kind: 'chat' }, signal);
        await store.recordTurn({ ...turn, kind: 'warm', messageId: null, firstTextMs: null }, signal);
        await expect(store.recordTurn({ ...turn, kind: 'other' as never }, signal)).rejects.toThrow();
        await expect(store.recordTurn({ ...turn, kind: 'chat', outcome: 'maybe' as never }, signal)).rejects.toThrow();
        const chatKinds = ['chat', 'warm', 'smoke'] as const;
        const spent = await store.spendSince(new Date(Date.now() - 60_000), chatKinds, signal);
        expect(spent.turns).toBe(2);
        expect(spent.costDkk).toBeCloseTo(0.1462, 6);
        expect(await store.spendSince(new Date(Date.now() + 60_000), chatKinds, signal)).toEqual({ costDkk: 0, turns: 0 });
        expect(await store.lastTurn(chatKinds, signal)).toMatchObject({ kind: 'warm', messageId: null, cachedTokens: 9000, outcome: 'ok' });
        expect((await store.recentTurns(5, chatKinds, signal)).map((row) => row.kind)).toEqual(['warm', 'chat']);
        expect(await store.recentTurns(1, chatKinds, signal)).toHaveLength(1);

        // The brain's wakes are a kind of their own: they never count against the chat cap, nor show as the last chat turn.
        await store.recordTurn({ ...turn, kind: 'brain', messageId: null, costDkk: 0.2 }, signal);
        expect((await store.spendSince(new Date(Date.now() - 60_000), chatKinds, signal)).turns).toBe(2);
        expect(await store.spendSince(new Date(Date.now() - 60_000), ['brain'], signal)).toMatchObject({ turns: 1 });
        expect(await store.lastTurn(chatKinds, signal)).toMatchObject({ kind: 'warm' });
        expect(await store.lastTurn(['brain'], signal)).toMatchObject({ kind: 'brain', costDkk: 0.2 });

        expect(await store.readBrainSwitch(owner, signal)).toEqual({ enabled: false, updatedAt: null });
        await store.writeBrainSwitch(owner, true, at, signal);
        expect(await store.readBrainSwitch(owner, signal)).toEqual({ enabled: true, updatedAt: at });
        await store.writeBrainSwitch(owner, false, at, signal);
        expect((await store.readBrainSwitch(owner, signal)).enabled).toBe(false);

        const day = new Date(Date.now() - 60_000);
        await store.recordMessage({ runId: randomUUID(), sessionId: '7', messageId: '9', textHash: 'b'.repeat(64) }, new Date(), signal);
        expect(await store.messagesSince(day, signal)).toEqual({ count: 1, textHashes: ['b'.repeat(64)] });
        expect(await store.messagesSince(new Date(Date.now() + 60_000), signal)).toEqual({ count: 0, textHashes: [] });
      } finally {
        await pool.request().batch(brainDown);
        await pool.request().batch(down);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.pi_message', N'U') AS id")).recordset).toEqual([{ id: null }]);
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.pi_turn', N'U') AS id")).recordset).toEqual([{ id: null }]);
    });
  });
  describe('inbox capture credentials', () => {
    it('stores hashes only, caps the count per owner, verifies per owner and revokes by id', async () => {
      const schema = await readFile(new URL('../../../../db/migrations/0082_inbox_capture_credentials.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0082_inbox_capture_credentials.sql', import.meta.url), 'utf8');
      const scopeSchema = await readFile(new URL('../../../../db/migrations/0083_inbox_credential_scope.sql', import.meta.url), 'utf8');
      const scopeDown = await readFile(new URL('../../../../db/migrations/down/0083_inbox_credential_scope.sql', import.meta.url), 'utf8');
      await pool.request().batch(schema);
      await pool.request().batch(scopeSchema);
      const store = createInboxCaptureCredentialStore(pool);
      const owner = randomUUID();
      const credentials = new InboxCaptureCredentials(store, owner);
      try {
        const shortcut = await credentials.issue('iPhone Shortcut');
        expect(await credentials.verify(shortcut.credential)).toEqual({ scope: 'write', label: 'iPhone Shortcut' });
        expect(await new InboxCaptureCredentials(store, randomUUID()).verify(shortcut.credential)).toBeNull();
        expect(await credentials.verify(`ji.${'A'.repeat(43)}`)).toBeNull();
        const stored = await pool.request().query<{ credential_hash: Buffer }>('SELECT credential_hash FROM dbo.inbox_capture_credentials');
        expect(stored.recordset[0]?.credential_hash).toEqual(createHash('sha256').update(shortcut.credential).digest());
        const [listed] = await credentials.list();
        expect(listed).toMatchObject({ id: shortcut.id, label: 'iPhone Shortcut' });
        expect(listed?.lastUsedAt).not.toBeNull();
        const results = await Promise.allSettled(Array.from({ length: 8 }, (_value, index) => credentials.issue(`device ${index}`)));
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
        expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof InboxCaptureCredentialLimit)).toHaveLength(4);
        expect(await credentials.list()).toHaveLength(5);
        expect(await credentials.revoke(shortcut.id)).toBe(true);
        expect(await credentials.revoke(shortcut.id)).toBe(false);
        expect(await credentials.verify(shortcut.credential)).toBeNull();
        expect(await credentials.list()).toHaveLength(4);
        const assistant = await credentials.issue('Claude', 'read_write');
        expect(await credentials.verify(assistant.credential)).toEqual({ scope: 'read_write', label: 'Claude' });
        expect((await credentials.list()).map((row) => row.scope).sort()).toEqual(['read_write', 'write', 'write', 'write', 'write']);
        await expect(pool.request().query("UPDATE dbo.inbox_capture_credentials SET scope = 'admin'")).rejects.toThrow();
      } finally {
        await pool.request().batch(scopeDown);
        await pool.request().batch(down);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.inbox_capture_credentials', N'U') AS id")).recordset).toEqual([{ id: null }]);
    });
  });
  it('rolls back schema, data and ledger together on a failed migration', async () => {
    const broken = migration('0002_broken.sql', `CREATE TABLE dbo.rollback_fixture (id int);
      UPDATE dbo.migration_fixture SET value=N'changed'; THROW 51000, 'fixture failure', 1;`);
    await expect(applyMigrations(pool, [first, broken])).rejects.toThrow();
    expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.rollback_fixture', N'U') AS id")).recordset).toEqual([{ id: null }]);
    expect((await pool.request().query('SELECT value FROM dbo.migration_fixture')).recordset).toEqual([{ value: 'original' }]);
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.schema_migrations')).recordset).toEqual([{ count: 1 }]);
    const second = migration('0002_recovered.sql', 'ALTER TABLE dbo.migration_fixture ADD recovered bit NULL;');
    expect(await applyMigrations(pool, [first, second])).toEqual([second.name]);
    expect(await applyMigrations(pool, [first, second])).toEqual([]);
  });
  it('rejects changed, removed or reordered applied history without changing stored data', async () => {
    await expect(applyMigrations(pool, [migration(first.name, 'DROP TABLE dbo.migration_fixture;')])).rejects.toThrow('committed migration history');
    await expect(applyMigrations(pool, [])).rejects.toThrow('committed migration history');
    expect((await pool.request().query('SELECT value FROM dbo.migration_fixture')).recordset).toEqual([{ value: 'original' }]);
  });
  it('cancels active SQL and rolls back before allowing another owner', async () => {
    const history = await pool.request().query<{ name: string; checksum: string }>('SELECT name, checksum FROM dbo.schema_migrations ORDER BY name');
    const applied = history.recordset.map((row) => ({ ...row, sql: '' }));
    const pending = migration('0003_cancelled.sql', "CREATE TABLE dbo.cancelled_fixture (id int); WAITFOR DELAY '00:00:30';");
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 500);
    try { await expect(applyMigrations(pool, [...applied, pending], 60_000, controller.signal)).rejects.toThrow(); }
    finally { clearTimeout(timer); }
    expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.cancelled_fixture', N'U') AS id")).recordset).toEqual([{ id: null }]);
    expect(await applyMigrations(pool, applied)).toEqual([]);
  });
  it('refuses a migration when another owner holds the lock and leaves no new state', async () => {
    const blocker = new sql.Transaction(pool);
    await blocker.begin();
    try {
      await new sql.Request(blocker).query(`EXEC sys.sp_getapplock @Resource=N'jarvis.schema-migrations', @LockMode='Exclusive', @LockOwner='Transaction';`);
      await expect(applyMigrations(pool, [], 25)).rejects.toThrow('lock was not acquired');
    } finally { await blocker.rollback(); }
    expect((await pool.request().query('SELECT COUNT(*) AS count FROM dbo.schema_migrations')).recordset).toEqual([{ count: 2 }]);
  });
});
