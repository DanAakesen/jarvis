import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, type Migration } from './migrations.js';
import { createWatchCredentialStore, WatchCredentials } from '../auth/watch-credential.js';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../core/memory-embeddings.js';
import { createInboxIndexStore } from './inbox-index-store.js';
import { createInboxOpsStore } from './inbox-ops-store.js';
import { createPiStore } from './pi-store.js';
import { createNotesFolderOrderStore } from './notes-folder-order-store.js';
import { createPiSituationStore } from './pi-situation-store.js';
import { parsePiSituationState } from '../pi/situation.js';
import { sourceIds } from '../proactive/types.js';
import { createInboxCaptureCredentialStore, InboxCaptureCredentialLimit, InboxCaptureCredentials } from '../auth/inbox-capture-credential.js';
import { createMemoryStore, createVaultIndexStore } from './memory-store.js';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { createPiActivationService } from '../pi/activation.js';
import { createPiSituationService, piSituationHash } from '../pi/situation.js';
import { createPiTurnRegistry } from '../pi/turns.js';
import { createProactiveEventStore } from './proactive-event-store.js';
import { createProactiveStore } from './proactive-store.js';
import { createPiBackgroundSlotService } from '../pi/activation-slots.js';
import { proactiveSettingsRevision } from '../proactive/preferences.js';

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

  it('migrates existing vault summaries and lists notes with no search chunks', async () => {
    const migrationFiles = ['0021_vault_memory_index.sql', '0027_vault_knowledge_graph.sql', '0103_vault_note_metadata.sql'];
    const [chunks, links, notes] = await Promise.all(migrationFiles.map((name) =>
      readFile(new URL(`../../../../db/migrations/${name}`, import.meta.url), 'utf8')));
    await pool.request().batch(chunks!);
    await pool.request().batch(links!);
    const legacyPath = 'Work/Events/old-name.md';
    const titleOnlyPath = 'Personal/Test 2.md';
    const sha = 'a'.repeat(40);
    const signal = AbortSignal.timeout(10_000);
    try {
      // Apply the vault columns from 0028 and 0031 without the unrelated memory and job tables.
      await pool.request().batch(`ALTER TABLE dbo.vault_chunks ADD embedding_model nvarchar(128) NULL;
        IF TYPE_ID(N'vector') IS NULL
          ALTER TABLE dbo.vault_chunks ADD embedding_json nvarchar(max) NULL;`);
      await pool.request()
        .input('hash', sql.Binary(32), createHash('sha256').update(legacyPath).digest())
        .input('path', sql.NVarChar(180), legacyPath)
        .input('sha', sql.Char(40), sha)
        .query(`INSERT INTO dbo.vault_chunks (path_hash, path, blob_sha, chunk_index, heading, content)
          VALUES (@hash, @path, @sha, 0, N'Wrong section', N'Original searchable content')`);
      await pool.request().batch(notes!);
      const store = createVaultIndexStore(pool);
      await store.initialize();
      const previous = (await store.graphFiles(signal))[0]!;
      expect(await store.files(null, signal)).toMatchObject([{
        path: legacyPath, titleMissing: true, blobSha: sha, updatedAt: previous.updatedAt,
      }]);
      expect(previous.blobSha).toBe(sha);
      await store.backfillFileTitle(legacyPath, 'b'.repeat(40), 'Wrong blob', signal);
      expect(await store.graphFiles(signal)).toEqual([previous]);
      await store.backfillFileTitle(legacyPath, sha, 'Edited > title', signal);
      expect(await store.graphFiles(signal, [legacyPath])).toEqual([{ ...previous, title: 'Edited > title' }]);
      expect(await store.files(null, signal)).toMatchObject([{ path: legacyPath, titleMissing: false }]);

      await store.replaceFile(titleOnlyPath, sha, 'Test 2', [], [], signal);
      expect(await store.graphFiles(signal, [titleOnlyPath, 'Missing.md'])).toMatchObject([{ path: titleOnlyPath, title: 'Test 2' }]);
      expect(await store.summary(null, signal)).toMatchObject({ notes: 2, chunks: 1 });
      expect(await store.searchByTerms(['Original'], 5, signal)).toMatchObject([{ path: legacyPath }]);
      await store.deleteFiles([titleOnlyPath], signal);
      await store.replaceFile(titleOnlyPath, sha, 'Removed note', [], [], signal, { onlyIfCurrent: true });
      expect(await store.graphFiles(signal, [titleOnlyPath])).toEqual([]);
      expect(await store.summary(null, signal)).toMatchObject({ notes: 1, chunks: 1 });

      const embeddingModel = 'fixture-model';
      const repaired = [{
        index: 0, heading: '', content: 'Repaired chunks',
        embedding: Array<number>(MEMORY_EMBEDDING_DIMENSIONS).fill(0.25), embeddingModel,
      }];
      expect(await store.files(embeddingModel, signal)).toMatchObject([{ path: legacyPath, embeddingMissing: true }]);
      await store.replaceFile(legacyPath, sha, 'Edited > title', repaired, [], signal, { onlyIfCurrent: true });
      expect(await store.graphFiles(signal, [legacyPath])).toEqual([{ ...previous, title: 'Edited > title' }]);
      expect(await store.files(embeddingModel, signal)).toMatchObject([{ path: legacyPath, embeddingMissing: false }]);
      expect(await store.searchByTerms(['Repaired'], 5, signal)).toMatchObject([{ path: legacyPath }]);
      const newSha = 'b'.repeat(40);
      const newer = [{ ...repaired[0]!, content: 'Newer version' }];
      await store.replaceFile(legacyPath, newSha, 'Newer title', newer, [], signal);
      await store.replaceFile(legacyPath, sha, 'Old title', repaired, [], signal, { onlyIfCurrent: true });
      expect(await store.graphFiles(signal, [legacyPath])).toMatchObject([{ path: legacyPath, title: 'Newer title', blobSha: newSha }]);
      expect(await store.searchByTerms(['Newer'], 5, signal)).toMatchObject([{ path: legacyPath }]);
    } finally {
      await pool.request().batch('DROP TABLE IF EXISTS dbo.vault_notes, dbo.vault_links, dbo.vault_chunks;');
    }
  });

  it('stores Settings corrections and deletion audits as Settings actions, never as the capture message', async () => {
    const core = await readFile(new URL('../../../../db/migrations/0001_core_tables.sql', import.meta.url), 'utf8');
    const memory = await readFile(new URL('../../../../db/migrations/0016_long_term_memory.sql', import.meta.url), 'utf8');
    const provenance = await readFile(new URL('../../../../db/migrations/0091_memory_action_provenance.sql', import.meta.url), 'utf8');
    const quarantine = await readFile(new URL('../../../../db/migrations/0092_memory_embedding_quarantine.sql', import.meta.url), 'utf8');
    const coreDown = await readFile(new URL('../../../../db/migrations/down/0001_core_tables.sql', import.meta.url), 'utf8');
    const memoryDown = await readFile(new URL('../../../../db/migrations/down/0016_long_term_memory.sql', import.meta.url), 'utf8');
    const provenanceDown = await readFile(new URL('../../../../db/migrations/down/0091_memory_action_provenance.sql', import.meta.url), 'utf8');
    const quarantineDown = await readFile(new URL('../../../../db/migrations/down/0092_memory_embedding_quarantine.sql', import.meta.url), 'utf8');
    await pool.request().batch(core);
    await pool.request().batch(memory);
    await pool.request().batch('ALTER TABLE dbo.memories ADD embedding_model nvarchar(128) NULL;');
    await pool.request().batch(provenance);
    await pool.request().batch(quarantine);
    let stage = 'schema verification';
    try {
      const columns = await pool.request().query<{
        quarantinedAt: number | null;
        quarantineReason: number | null;
      }>(`SELECT COL_LENGTH(N'dbo.memories', N'embedding_quarantined_at') AS quarantinedAt,
        COL_LENGTH(N'dbo.memories', N'embedding_quarantine_reason') AS quarantineReason;`);
      expect(columns.recordset[0]).toMatchObject({
        quarantinedAt: expect.any(Number),
        quarantineReason: expect.any(Number),
      });
      const session = await pool.request().query<{ id: string }>(
        "INSERT dbo.jarvis_sessions (channel, language) OUTPUT CONVERT(varchar(20), inserted.id) AS id VALUES (N'chat', N'en');",
      );
      const message = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(session.recordset[0]!.id))
        .query<{ id: string }>(`INSERT dbo.messages (jarvis_session_id, role, text)
          OUTPUT CONVERT(varchar(20), inserted.id) AS id
          VALUES (@sessionId, N'dan', N'Remember that I prefer afternoons.');`);
      const messageId = message.recordset[0]!.id;
      const store = createMemoryStore(pool);
      stage = 'initialization';
      await store.initialize();
      stage = 'save';
      const saved = await store.save({
        category: 'preference',
        key: 'appointments.time',
        content: 'Prefers afternoon appointments.',
        source: { kind: 'conversation', messageId },
        embedding: null,
        embeddingModel: null,
      }, AbortSignal.timeout(10_000));
      const settingsRequestId = randomUUID();
      const ownerObjectId = randomUUID();
      stage = 'correction';
      const corrected = await store.correct(saved.memory.id, {
        category: 'preference',
        key: 'appointments.time',
        content: 'Prefers morning appointments.',
        source: { kind: 'settings', requestId: settingsRequestId, ownerObjectId },
        embedding: null,
        embeddingModel: null,
      }, AbortSignal.timeout(10_000));
      expect(corrected.memory).toMatchObject({
        sourceMessageId: null,
        settingsAction: { requestId: settingsRequestId, ownerObjectId },
        sourceText: '',
      });
      const history = await store.history(saved.memory.id, 10, AbortSignal.timeout(10_000));
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ settingsAction: { requestId: settingsRequestId }, sourceMessageId: null });
      expect(history[1]).toMatchObject({ sourceMessageId: messageId, settingsAction: null });

      await expect(store.quarantineEmbedding(
        saved.memory.id,
        corrected.memory.revision,
        'credential',
        AbortSignal.timeout(10_000),
      )).resolves.toBe(true);
      await expect(pool.request().batch(quarantineDown)).rejects.toThrow(/durable policy evidence/u);
      const safeCorrection = await store.correct(saved.memory.id, {
        category: 'preference',
        key: 'appointments.time',
        content: 'Prefers an approved morning appointment.',
        source: { kind: 'settings', requestId: randomUUID(), ownerObjectId },
        embedding: null,
        embeddingModel: null,
      }, AbortSignal.timeout(10_000));
      const quarantineState = await pool.request()
        .input('memoryId', sql.BigInt, BigInt(safeCorrection.memory.id))
        .query<{
          embedding_quarantined_at: Date | null;
          embedding_quarantine_reason: string | null;
        }>(`SELECT embedding_quarantined_at, embedding_quarantine_reason
          FROM dbo.memories WHERE id = @memoryId;`);
      expect(quarantineState.recordset).toEqual([{
        embedding_quarantined_at: null,
        embedding_quarantine_reason: null,
      }]);

      const deleteRequestId = randomUUID();
      stage = 'forget';
      await expect(store.forget(saved.memory.id, {
        kind: 'settings',
        requestId: deleteRequestId,
        ownerObjectId,
      }, AbortSignal.timeout(10_000))).resolves.toMatchObject({ key: 'appointments.time' });
      const audit = await pool.request().query<{
        source_kind: string;
        request_message_id: string | null;
        action_request_id: string | null;
        action_owner_id: string | null;
      }>(`SELECT source_kind, CONVERT(varchar(20), request_message_id) AS request_message_id,
          LOWER(CONVERT(char(36), action_request_id)) AS action_request_id,
          LOWER(CONVERT(char(36), action_owner_id)) AS action_owner_id
        FROM dbo.memory_deletions;`);
      expect(audit.recordset).toEqual([{
        source_kind: 'settings',
        request_message_id: null,
        action_request_id: deleteRequestId,
        action_owner_id: ownerObjectId,
      }]);
      stage = 'down guard';
      await expect(pool.request().batch(provenanceDown)).rejects.toThrow(/durable audit evidence/u);
      stage = 'cleanup';
    } catch (error) {
      throw new Error(`Memory provenance SQL gate failed during ${stage}`, { cause: error });
    } finally {
      await pool.request().query(`IF OBJECT_ID(N'dbo.memory_deletions', N'U') IS NOT NULL
          DELETE FROM dbo.memory_deletions;
        IF OBJECT_ID(N'dbo.memories', N'U') IS NOT NULL
          DELETE FROM dbo.memories;`);
      await pool.request().batch(quarantineDown);
      await pool.request().batch(provenanceDown);
      await pool.request().batch(memoryDown);
      await pool.request().batch(coreDown);
    }
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
      const proactiveSchema = await readFile(new URL('../../../../db/migrations/0054_proactive_push.sql', import.meta.url), 'utf8');
      const proactiveDown = await readFile(new URL('../../../../db/migrations/down/0054_proactive_push.sql', import.meta.url), 'utf8');
      const foundationSchema = await readFile(new URL('../../../../db/migrations/0055_proactive_foundation.sql', import.meta.url), 'utf8');
      const foundationDown = await readFile(new URL('../../../../db/migrations/down/0055_proactive_foundation.sql', import.meta.url), 'utf8');
      const preferencesSchema = await readFile(new URL('../../../../db/migrations/0063_proactive_suggestion_preferences.sql', import.meta.url), 'utf8');
      const preferencesDown = await readFile(new URL('../../../../db/migrations/down/0063_proactive_suggestion_preferences.sql', import.meta.url), 'utf8');
      const eventsSchema = await readFile(new URL('../../../../db/migrations/0080_proactive_events.sql', import.meta.url), 'utf8');
      const eventsDown = await readFile(new URL('../../../../db/migrations/down/0080_proactive_events.sql', import.meta.url), 'utf8');
      const schema = await readFile(new URL('../../../../db/migrations/0086_pi_chat.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0086_pi_chat.sql', import.meta.url), 'utf8');
      const brainSchema = await readFile(new URL('../../../../db/migrations/0087_pi_brain.sql', import.meta.url), 'utf8');
      const brainDown = await readFile(new URL('../../../../db/migrations/down/0087_pi_brain.sql', import.meta.url), 'utf8');
      const watchSchema = await readFile(new URL('../../../../db/migrations/0088_pi_watch_look.sql', import.meta.url), 'utf8');
      const watchDown = await readFile(new URL('../../../../db/migrations/down/0088_pi_watch_look.sql', import.meta.url), 'utf8');
      const situationSchema = await readFile(new URL('../../../../db/migrations/0090_pi_situational_intelligence.sql', import.meta.url), 'utf8');
      const situationDown = await readFile(new URL('../../../../db/migrations/down/0090_pi_situational_intelligence.sql', import.meta.url), 'utf8');
      const integritySchema = await readFile(new URL('../../../../db/migrations/0097_pi_proactive_integrity.sql', import.meta.url), 'utf8');
      const integrityDown = await readFile(new URL('../../../../db/migrations/down/0097_pi_proactive_integrity.sql', import.meta.url), 'utf8');
      const outboxSchema = await readFile(new URL('../../../../db/migrations/0098_pi_situation_followup_outbox.sql', import.meta.url), 'utf8');
      const outboxDown = await readFile(new URL('../../../../db/migrations/down/0098_pi_situation_followup_outbox.sql', import.meta.url), 'utf8');
      const reviewSchema = await readFile(new URL('../../../../db/migrations/0099_pi_review_integrity.sql', import.meta.url), 'utf8');
      const reviewDown = await readFile(new URL('../../../../db/migrations/down/0099_pi_review_integrity.sql', import.meta.url), 'utf8');
      const generationSchema = await readFile(new URL('../../../../db/migrations/0100_pi_observation_generations.sql', import.meta.url), 'utf8');
      const generationDown = await readFile(new URL('../../../../db/migrations/down/0100_pi_observation_generations.sql', import.meta.url), 'utf8');
      const pendingAuthoritySchema = await readFile(new URL('../../../../db/migrations/0101_pi_pending_lookup_authority.sql', import.meta.url), 'utf8');
      const pendingAuthorityDown = await readFile(new URL('../../../../db/migrations/down/0101_pi_pending_lookup_authority.sql', import.meta.url), 'utf8');
      await pool.request().batch(proactiveSchema);
      await pool.request().batch(foundationSchema);
      await pool.request().batch(preferencesSchema);
      await pool.request().batch(eventsSchema);
      await pool.request().batch(schema);
      await pool.request().batch(brainSchema);
      await pool.request().batch(watchSchema);
      await pool.request().batch(situationSchema);
      await pool.request().batch(integritySchema);
      await pool.request().batch(outboxSchema);
      await pool.request().batch(reviewSchema);
      await pool.request().batch(generationSchema);
      await pool.request().batch(pendingAuthoritySchema);
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
        await store.recordMessage({
          ownerObjectId: owner,
          runId: randomUUID(),
          sessionId: '7',
          messageId: '9',
          textHash: 'b'.repeat(64),
          text: 'Would you like me to move the task?',
          evidence: [{
            source: 'calendar', ref: 'calendar-event:42', identity: 'calendar-event:42',
            label: 'Flight', observedAt: at.toISOString(), verifiedAt: at.toISOString(),
          }],
          followUpIds: ['follow:flight'],
        }, new Date(), signal);
        expect(await store.messagesSince(day, signal, owner)).toEqual({ count: 1, textHashes: ['b'.repeat(64)] });
        expect(await store.messagesSince(day, signal, randomUUID())).toEqual({ count: 0, textHashes: [] });
        expect(await store.messagesSince(new Date(Date.now() + 60_000), signal, owner)).toEqual({ count: 0, textHashes: [] });
        expect(await store.latestProactiveMessage(owner, day, signal)).toMatchObject({
          sessionId: '7',
          messageId: '9',
          text: 'Would you like me to move the task?',
          followUpIds: ['follow:flight'],
          evidence: [expect.objectContaining({ ref: 'calendar-event:42' })],
        });

        const proactive = createProactiveStore(pool, owner);
        await proactive.settings.patch({ backgroundTurnsPerDay: 1 });
        const queue = createProactiveEventStore(pool, owner);
        const slots = createPiBackgroundSlotService({
          queue,
          proactive,
          now: () => new Date('2026-11-15T10:00:00.000Z'),
        });
        const reservations = await Promise.all([
          slots.reserve({
            runId: randomUUID(), eventCount: 1, activationType: 'event', allowQuiet: true,
          }),
          slots.reserve({
            runId: randomUUID(), eventCount: 1, activationType: 'event', allowQuiet: true,
          }),
        ]);
        expect(reservations.filter(({ allowed }) => allowed)).toHaveLength(1);
        expect(reservations.find(({ allowed }) => !allowed)).toMatchObject({ reason: 'daily_cap' });
        const otherOwner = randomUUID();
        const otherSlots = createPiBackgroundSlotService({
          queue: createProactiveEventStore(pool, otherOwner),
          proactive: createProactiveStore(pool, otherOwner),
          now: () => new Date('2026-11-15T10:00:00.000Z'),
        });
        await expect(otherSlots.reserve({
          runId: randomUUID(), eventCount: 1, activationType: 'event', allowQuiet: true,
        })).resolves.toMatchObject({ allowed: true });

        const budgetOwner = randomUUID();
        const budgetStore = createProactiveStore(pool, budgetOwner);
        await budgetStore.settings.patch({ monthlyBudgetDkk: 1 });
        let budgetAt = new Date('2026-11-15T10:00:00.000Z');
        const budgetQueue = createProactiveEventStore(pool, budgetOwner);
        const budgetSlots = createPiBackgroundSlotService({
          queue: budgetQueue,
          proactive: budgetStore,
          now: () => budgetAt,
        });
        const budgetPolicy = proactiveSettingsRevision(await budgetStore.settings.read());
        const reserved = await Promise.all([
          budgetQueue.reserveBatch({
            batchId: randomUUID(),
            sampleTime: () => ({
              at: budgetAt,
              dayStart: new Date('2026-11-14T23:00:00.000Z'),
              quiet: false,
              satisfiedSlot: null,
            }),
            eventCount: 1,
            activationType: 'event',
            allowQuiet: true,
            minimumGapMs: 0,
            fallbackAllowed: 12,
            expectedPolicyRevision: budgetPolicy,
            worstCaseDkk: 0.6,
          }),
          budgetQueue.reserveBatch({
            batchId: randomUUID(),
            sampleTime: () => ({
              at: budgetAt,
              dayStart: new Date('2026-11-14T23:00:00.000Z'),
              quiet: false,
              satisfiedSlot: null,
            }),
            eventCount: 1,
            activationType: 'event',
            allowQuiet: true,
            minimumGapMs: 0,
            fallbackAllowed: 12,
            expectedPolicyRevision: budgetPolicy,
            worstCaseDkk: 0.6,
          }),
        ]);
        expect(reserved.filter(({ allowed }) => allowed)).toHaveLength(1);
        expect(reserved.find(({ allowed }) => !allowed))
          .toMatchObject({ reason: 'budget_exhausted' });
        const admittedBatch = await pool.request()
          .input('owner', sql.UniqueIdentifier, budgetOwner)
          .query<{ id: string; reserved_dkk: number; actual_dkk: number | null }>(`
            SELECT id, reserved_dkk, actual_dkk
            FROM dbo.proactive_event_batches
            WHERE owner_object_id = @owner;`);
        expect(admittedBatch.recordset).toMatchObject([{
          reserved_dkk: 0.6,
          actual_dkk: null,
        }]);
        await budgetStore.spend.record({
          runId: admittedBatch.recordset[0]!.id,
          month: '2026-11',
          inputTokens: 1,
          outputTokens: 1,
          estimatedDkk: 0.1,
          createdAt: budgetAt,
        });
        expect((await pool.request()
          .input('owner', sql.UniqueIdentifier, budgetOwner)
          .query<{ reserved_dkk: number; actual_dkk: number }>(`
            SELECT reserved_dkk, actual_dkk
            FROM dbo.proactive_event_batches
            WHERE owner_object_id = @owner;`)).recordset[0])
          .toEqual(expect.objectContaining({ reserved_dkk: 0.6, actual_dkk: 0.1 }));
        budgetAt = new Date(budgetAt.getTime() + 11 * 60_000);
        await expect(budgetSlots.reserve({
          runId: randomUUID(),
          eventCount: 1,
          activationType: 'event',
          allowQuiet: true,
          policyRevision: budgetPolicy,
          worstCaseDkk: 0.85,
        })).resolves.toMatchObject({ allowed: true });
        const stalePolicy = budgetPolicy;
        await budgetStore.settings.patch({ sources: { x: true } });
        budgetAt = new Date(budgetAt.getTime() + 11 * 60_000);
        await expect(budgetQueue.reserveBatch({
          batchId: randomUUID(),
          sampleTime: () => ({
            at: budgetAt,
            dayStart: new Date('2026-11-14T23:00:00.000Z'),
            quiet: false,
            satisfiedSlot: null,
          }),
          eventCount: 1,
          activationType: 'event',
          allowQuiet: true,
          minimumGapMs: 10 * 60_000,
          fallbackAllowed: 12,
          expectedPolicyRevision: stalePolicy,
          worstCaseDkk: 0.01,
        })).resolves.toMatchObject({ allowed: false, reason: 'policy_changed' });
        await budgetStore.settings.patch({ sources: { mail: false } });
        await budgetStore.settings.patch({ sources: { mail: true } });
        const disabled = (await budgetStore.sources.list()).find(({ id }) => id === 'mail')!;
        expect(disabled).toMatchObject({
          state: 'stale',
          reason: 'source_disabled',
        });
        const invalidatedAt = new Date(disabled.invalidatedAt!);
        await budgetStore.sources.upsert({
          id: 'mail',
          label: 'Mail',
          enabled: true,
          state: 'ok',
          reason: null,
          observedAt: new Date(invalidatedAt.getTime() - 1).toISOString(),
          verifiedAt: invalidatedAt.toISOString(),
        });
        expect((await budgetStore.sources.list()).find(({ id }) => id === 'mail'))
          .toMatchObject({ state: 'stale' });
        await budgetStore.sources.upsert({
          id: 'mail',
          label: 'Mail',
          enabled: true,
          state: 'ok',
          reason: null,
          observedAt: new Date(invalidatedAt.getTime() - 1).toISOString(),
          verifiedAt: new Date(invalidatedAt.getTime() + 1).toISOString(),
        });
        expect((await budgetStore.sources.list()).find(({ id }) => id === 'mail'))
          .toMatchObject({
            state: 'ok',
            observedAt: new Date(invalidatedAt.getTime() - 1).toISOString(),
            verifiedAt: new Date(invalidatedAt.getTime() + 1).toISOString(),
          });

        // Standing-watch looks: counted per watch and day, with the wake's cost shared out afterwards.
        const dayStart = new Date(Date.now() - 3_600_000);
        const wake = randomUUID();
        await store.recordLook('Deploy of main', wake, new Date(), signal);
        await store.recordLook('Price', wake, new Date(Date.now() - 1000), signal);
        await store.recordLook('Price', randomUUID(), new Date(Date.now() - 2000), signal);
        await store.allocateRunCost(wake, 0.05, signal);
        const activity = await store.watchActivity(dayStart, signal);
        expect(activity.map(({ watch, looks, costDkk }) => ({ watch, looks, costDkk })).sort((a, b) => a.watch.localeCompare(b.watch)))
          .toEqual([{ watch: 'Deploy of main', looks: 1, costDkk: 0.05 }, { watch: 'Price', looks: 2, costDkk: 0.05 }]);
        expect(await store.watchActivity(new Date(Date.now() + 60_000), signal)).toEqual([]);

        const situations = createPiSituationStore(pool);
        const situation = parsePiSituationState({
          version: 1, asOf: at.toISOString(), summary: '', summaryRefIds: [],
          sources: sourceIds.map((id) => ({
            id, state: 'missing', observedAt: null, expiresAt: null, reason: 'not_observed', refIds: [],
          })),
          refs: [], facts: [], followUps: [],
        });
        const activation = {
          id: randomUUID(), type: 'event' as const, source: 'timer', at,
        };
        const policyRevision = proactiveSettingsRevision(await proactive.settings.read());
        const initialized = await Promise.all([
          situations.initialize(owner, situation, at, signal),
          situations.initialize(owner, situation, at, signal),
        ]);
        expect(initialized.map(({ revision }) => revision)).toEqual([1, 1]);
        const stored = await situations.commit({
          owner,
          expectedRevision: initialized[0].revision,
          expectedHash: initialized[0].hash,
          state: situation,
          activation,
          policyRevision,
          followUpActions: [],
          authoritativeRefs: [],
          observations: [],
        }, signal);
        expect(await situations.read(owner, signal)).toMatchObject({
          revision: 2, hash: stored.hash, lastActivation: { id: activation.id, type: 'event' },
        });

        const legacyOwner = randomUUID();
        await situations.initialize(legacyOwner, situation, at, signal);
        const legacy = structuredClone(situation);
        legacy.summary = 'Legacy bearerToken=fixture-secret';
        legacy.summaryRefIds = ['memory:fact-ref'];
        legacy.sources.find(({ id }) => id === 'memory')!.state = 'fresh';
        legacy.sources.find(({ id }) => id === 'memory')!.observedAt = at.toISOString();
        legacy.sources.find(({ id }) => id === 'memory')!.reason = 'provider api_token=fixture-secret';
        legacy.sources.find(({ id }) => id === 'memory')!.refIds = [
          'memory:unsafe-ref',
          'memory:fact-ref',
          'memory:follow-ref',
        ];
        legacy.refs.push({
          id: 'memory:unsafe-ref',
          source: 'memory',
          identity: 'memory:unsafe-ref',
          label: 'githubApiTokenValue',
          observedAt: at.toISOString(),
          expiresAt: null,
        }, {
          id: 'memory:fact-ref',
          source: 'memory',
          identity: 'memory:fact-ref',
          label: 'Appointment preference',
          observedAt: at.toISOString(),
          expiresAt: null,
        }, {
          id: 'memory:follow-ref',
          source: 'memory',
          identity: 'memory:follow-ref',
          label: 'Appointment follow-up',
          observedAt: at.toISOString(),
          expiresAt: null,
        });
        legacy.facts.push({
          id: 'fact:legacy-memory',
          source: 'memory',
          refIds: ['memory:fact-ref'],
          text: 'auth_token=fixture-secret',
          observedAt: at.toISOString(),
          expiresAt: null,
          stale: false,
        });
        legacy.followUps.push({
          id: 'follow:legacy-memory',
          text: 'Remember the api_token=fixture-secret.',
          dueAt: null,
          refIds: ['memory:follow-ref'],
        });
        const legacyHash = piSituationHash(legacy);
        await pool.request()
          .input('owner', sql.UniqueIdentifier, legacyOwner)
          .input('state', sql.NVarChar(sql.MAX), JSON.stringify(legacy))
          .input('hash', sql.Char(64), legacyHash)
          .query(`UPDATE dbo.pi_situational_state
            SET state_json=@state, content_hash=@hash
            WHERE owner_object_id=@owner;`);

        const memoryProactive = createMemoryProactiveStore(legacyOwner);
        const situationService = createPiSituationService({
          owner: legacyOwner,
          store: situations,
          proactive: memoryProactive,
          sources: [],
          now: () => at,
        });
        const registry = createPiTurnRegistry();
        const activations = createPiActivationService({ registry, situation: situationService });
        for (const [type, source] of [
          ['chat', 'chat'],
          ['voice', 'voice'],
          ['scheduled', 'timer'],
        ] as const) {
          const started = await activations.begin({
            type,
            source,
            ownerObjectId: legacyOwner,
            sessionId: `session-${type}`,
            messageId: type === 'scheduled' ? '' : `message-${type}`,
            signal,
          });
          expect(started.context).not.toContain('api_token');
          expect(started.context).not.toContain('auth_token');
          expect(started.context).not.toContain('bearerToken');
          expect(started.context).not.toContain('githubApiTokenValue');
          registry.close(started.grant.turn);
        }
        const migratedRow = await pool.request()
          .input('owner', sql.UniqueIdentifier, legacyOwner)
          .query<{ revision: string; state_json: string; content_hash: string }>(
            `SELECT revision, state_json, content_hash
              FROM dbo.pi_situational_state WHERE owner_object_id=@owner;`,
          );
        const migratedState = JSON.parse(migratedRow.recordset[0]!.state_json) as ReturnType<typeof parsePiSituationState>;
        expect(Number(migratedRow.recordset[0]!.revision)).toBe(2);
        expect(migratedRow.recordset[0]!.content_hash.trim()).toBe(piSituationHash(migratedState));
        expect(migratedState.summary).toBe('');
        expect(migratedState.sources.find(({ id }) => id === 'memory')?.reason).toBeNull();
        expect(migratedState.refs.map(({ id }) => id)).not.toContain('memory:unsafe-ref');
        expect(migratedState.refs.filter(({ source }) => source === 'memory')).toHaveLength(2);
        expect(migratedState.facts.some(({ source }) => source === 'memory')).toBe(false);
        expect(migratedState.followUps.some(({ id }) => id === 'follow:legacy-memory')).toBe(false);
        await expect(situations.commit({
          owner, expectedRevision: 1, expectedHash: initialized[0].hash, state: situation,
          activation: { ...activation, id: randomUUID() },
          policyRevision,
          followUpActions: [],
          authoritativeRefs: [],
          observations: [],
        }, signal)).rejects.toMatchObject({ code: 'conflict' });
        await proactive.settings.patch({ brainInstructions: 'Check upcoming deadlines.' });
        await proactive.settings.patch({ guidance: 'changed after the situation was read' });
        expect((await proactive.settings.read()).brainInstructions).toBe('Check upcoming deadlines.');
        await expect(situations.commit({
          owner,
          expectedRevision: stored.revision,
          expectedHash: stored.hash,
          state: situation,
          activation: { ...activation, id: randomUUID() },
          policyRevision,
          followUpActions: [],
          authoritativeRefs: [],
          observations: [],
        }, signal)).rejects.toMatchObject({ code: 'conflict' });
        const currentPolicy = proactiveSettingsRevision(await proactive.settings.read());
        const dueAt = new Date(at.getTime() + 60_000);
        const followUpState = parsePiSituationState({
          ...situation,
          sources: situation.sources.map((entry) => entry.id === 'calendar' ? {
            ...entry,
            state: 'fresh',
            observedAt: at.toISOString(),
            reason: null,
            refIds: ['calendar-event:flight'],
          } : entry),
          refs: [{
            id: 'calendar-event:flight',
            source: 'calendar',
            identity: 'calendar-event:flight',
            label: 'Flight',
            observedAt: at.toISOString(),
            expiresAt: null,
            materialHash: 'f'.repeat(64),
            verifiedAt: at.toISOString(),
          }],
          followUps: [{
            id: 'follow:flight',
            text: 'Check in.',
            dueAt: dueAt.toISOString(),
            refIds: ['calendar-event:flight'],
          }],
        });
        const followUpAuthority = followUpState.refs.map((ref) => ({
          ...ref,
          verifiedAt: ref.verifiedAt!,
          activatedAt: ref.verifiedAt!,
          invalidatedAt: null,
          staleReason: null,
        }));
        await expect(situations.commit({
          owner,
          expectedRevision: stored.revision,
          expectedHash: stored.hash,
          state: followUpState,
          activation: { ...activation, id: randomUUID() },
          policyRevision: currentPolicy,
          followUpActions: [],
          authoritativeRefs: [],
          observations: [],
        }, signal)).rejects.toMatchObject({ code: 'invalid' });
        expect((await situations.read(owner, signal))?.revision).toBe(stored.revision);
        await expect(situations.commit({
          owner,
          expectedRevision: stored.revision,
          expectedHash: stored.hash,
          state: followUpState,
          activation: { ...activation, id: randomUUID() },
          policyRevision: currentPolicy,
          followUpActions: [{
            operation: 'upsert',
            followUpId: 'follow:flight',
            event: {
              source: 'followup',
              kind: 'commitment.due',
              identity: 'pi-followup:follow:flight',
              material: { blob: 'x'.repeat(40_000) },
              dedupeKey: 'pi-followup:follow:flight:rollback',
              summary: 'Rollback probe.',
              detail: {},
              occurredAt: dueAt.toISOString(),
              notBeforeAt: dueAt.toISOString(),
            },
          }],
          authoritativeRefs: followUpAuthority,
          observations: [{
            source: 'calendar',
            state: 'ok',
            reason: null,
            observedAt: at.toISOString(),
            verifiedAt: at.toISOString(),
          }],
        }, signal)).rejects.toThrow();
        const atomic = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{
            revision: number;
            authority: number;
            statuses: number;
            outbox: number;
          }>(`SELECT
            (SELECT CONVERT(int, revision) FROM dbo.pi_situational_state
              WHERE owner_object_id = @owner) AS revision,
            (SELECT COUNT(*) FROM dbo.pi_situation_ref_authority WHERE owner_object_id = @owner) AS authority,
            (SELECT COUNT(*) FROM dbo.proactive_source_status WHERE owner_object_id = @owner) AS statuses,
            (SELECT COUNT(*) FROM dbo.pi_situation_outbox WHERE owner_object_id = @owner) AS outbox;`);
        expect(atomic.recordset[0]).toEqual({
          revision: stored.revision,
          authority: 0,
          statuses: 0,
          outbox: 1,
        });
        await situations.recordLookupAuthority(
          owner,
          followUpAuthority[0]!,
          currentPolicy,
          signal,
        );
        const pending = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ active: number; pending: number; statuses: number }>(`
            SELECT
              SUM(CASE WHEN activated_at IS NULL THEN 0 ELSE 1 END) AS active,
              SUM(CASE WHEN activated_at IS NULL AND invalidated_at IS NULL THEN 1 ELSE 0 END) AS pending,
              (SELECT COUNT(*) FROM dbo.proactive_source_status
                WHERE owner_object_id = @owner) AS statuses
            FROM dbo.pi_situation_ref_authority
            WHERE owner_object_id = @owner;`);
        expect(pending.recordset[0]).toEqual({ active: 0, pending: 1, statuses: 0 });
        const pendingRead = await situations.read(owner, signal);
        expect(pendingRead?.authoritativeRefs).toEqual([
          expect.objectContaining({
            id: 'calendar-event:flight',
            source: 'calendar',
            verifiedAt: at.toISOString(),
            materialHash: expect.any(String),
            activatedAt: null,
            invalidatedAt: null,
          }),
        ]);
        const patchService = createPiSituationService({
          owner,
          store: situations,
          proactive,
          sources: [],
          now: () => at,
        });
        patchService.attachEvents(queue);
        const queuedPatch = await patchService.patch({
          expectedRevision: stored.revision,
          expectedHash: stored.hash,
          policyRevision: currentPolicy,
          patch: {
            upsertRefs: [followUpState.refs[0]],
            upsertFollowUps: followUpState.followUps,
          },
          activation: { ...activation, id: randomUUID() },
        }, signal);
        const queued = queuedPatch.record;
        const activated = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ active: number; pending: number }>(`SELECT
            SUM(CASE WHEN activated_at IS NULL THEN 0 ELSE 1 END) AS active,
            SUM(CASE WHEN activated_at IS NULL THEN 1 ELSE 0 END) AS pending
          FROM dbo.pi_situation_ref_authority
          WHERE owner_object_id = @owner AND invalidated_at IS NULL;`);
        expect(activated.recordset[0]).toEqual({ active: 1, pending: 0 });
        await expect(situations.commit({
          owner,
          expectedRevision: queued.revision,
          expectedHash: queued.hash,
          state: situation,
          activation: { ...activation, id: randomUUID() },
          policyRevision: currentPolicy,
          followUpActions: [],
          authoritativeRefs: [],
          observations: [{
            source: 'calendar',
            state: 'unavailable',
            reason: 'stale_provider_result',
            observedAt: null,
            verifiedAt: new Date(at.getTime() - 1).toISOString(),
          }],
        }, signal)).rejects.toMatchObject({ code: 'conflict' });
        expect((await situations.read(owner, signal))?.revision).toBe(queued.revision);
        const reconciled = await Promise.all([
          queue.reconcileSituationOutbox(at, signal),
          queue.reconcileSituationOutbox(at, signal),
        ]);
        expect(reconciled.filter(({ changed }) => changed)).toHaveLength(1);
        expect(reconciled.every(({ pending }) => !pending)).toBe(true);
        expect(await queue.nextDueAt()).toEqual(dueAt);
        const cancelled = await situations.commit({
          owner,
          expectedRevision: queued.revision,
          expectedHash: queued.hash,
          state: situation,
          activation: { ...activation, id: randomUUID() },
          policyRevision: currentPolicy,
          followUpActions: [{
            operation: 'cancel',
            followUpId: 'follow:flight',
            identity: 'pi-followup:follow:flight',
          }],
          authoritativeRefs: [],
          observations: [],
        }, signal);
        await expect(queue.reconcileSituationOutbox(
          new Date(at.getTime() + 1),
          signal,
        )).resolves.toMatchObject({ changed: true, pending: false });
        expect(await queue.nextDueAt()).toBeNull();
        expect(cancelled.revision).toBe(4);
        const reactivated = await situations.commit({
          owner,
          expectedRevision: cancelled.revision,
          expectedHash: cancelled.hash,
          state: followUpState,
          activation: { ...activation, id: randomUUID() },
          policyRevision: currentPolicy,
          followUpActions: [{
            operation: 'upsert',
            followUpId: 'follow:flight',
            event: {
              source: 'followup',
              kind: 'commitment.due',
              identity: 'pi-followup:follow:flight',
              material: { text: 'Check in.', dueAt: dueAt.toISOString() },
              dedupeKey: 'pi-followup:follow:flight:v1',
              summary: 'Check in.',
              detail: { followUpId: 'follow:flight', evidenceSources: ['calendar'] },
              occurredAt: dueAt.toISOString(),
              notBeforeAt: dueAt.toISOString(),
            },
          }],
          authoritativeRefs: followUpAuthority,
          observations: [],
        }, signal);
        await expect(queue.reconcileSituationOutbox(
          new Date(at.getTime() + 2),
          signal,
        )).resolves.toMatchObject({ changed: true, pending: false });
        expect(await queue.nextDueAt()).toEqual(dueAt);
        expect(reactivated.revision).toBe(5);
        const oldGeneration = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ id: string }>(`SELECT id FROM dbo.proactive_events
            WHERE owner_object_id = @owner AND source = N'followup'
              AND processed_at IS NULL;`);
        await proactive.settings.patch({ sources: { calendar: false } });
        await queue.reconcileSituationOutbox(new Date(), signal);
        expect(await queue.nextDueAt()).toBeNull();
        const invalidatedAuthority = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ invalidated_at: Date | null; stale_reason: string | null }>(`
            SELECT invalidated_at, stale_reason
            FROM dbo.pi_situation_ref_authority
            WHERE owner_object_id = @owner AND source_id = N'calendar';`);
        expect(invalidatedAuthority.recordset[0]).toMatchObject({
          invalidated_at: expect.any(Date),
          stale_reason: 'source_disabled',
        });
        await proactive.settings.patch({ sources: { calendar: true } });
        const calendarStatus = (await proactive.sources.list())
          .find(({ id }) => id === 'calendar')!;
        const reverifiedAt = new Date(Date.parse(calendarStatus.invalidatedAt!) + 1);
        const reverifiedState = parsePiSituationState({
          ...followUpState,
          refs: followUpState.refs.map((ref) => ({
            ...ref,
            verifiedAt: reverifiedAt.toISOString(),
          })),
        });
        const reverifiedAuthority = reverifiedState.refs.map((ref) => ({
          ...ref,
          verifiedAt: ref.verifiedAt!,
          activatedAt: ref.verifiedAt!,
          invalidatedAt: null,
          staleReason: null,
        }));
        const reenabledPolicy = proactiveSettingsRevision(await proactive.settings.read());
        const reenabled = await situations.commit({
          owner,
          expectedRevision: reactivated.revision,
          expectedHash: reactivated.hash,
          state: reverifiedState,
          activation: { ...activation, id: randomUUID() },
          policyRevision: reenabledPolicy,
          followUpActions: [{
            operation: 'upsert',
            followUpId: 'follow:flight',
            event: {
              source: 'followup',
              kind: 'commitment.due',
              identity: 'pi-followup:follow:flight',
              material: { text: 'Check in.', dueAt: dueAt.toISOString() },
              dedupeKey: 'pi-followup:follow:flight:v1',
              summary: 'Check in.',
              detail: { followUpId: 'follow:flight', evidenceSources: ['calendar'] },
              occurredAt: dueAt.toISOString(),
              notBeforeAt: dueAt.toISOString(),
            },
          }],
          authoritativeRefs: reverifiedAuthority,
          observations: [{
            source: 'calendar',
            state: 'ok',
            reason: null,
            observedAt: at.toISOString(),
            verifiedAt: reverifiedAt.toISOString(),
          }],
        }, signal);
        await expect(queue.reconcileSituationOutbox(reverifiedAt, signal))
          .resolves.toMatchObject({ pending: false });
        const newGeneration = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ id: string }>(`SELECT id FROM dbo.proactive_events
            WHERE owner_object_id = @owner AND source = N'followup'
              AND processed_at IS NULL;`);
        expect(newGeneration.recordset[0]?.id).not.toBe(oldGeneration.recordset[0]?.id);
        expect(reenabled.state.refs[0]).toMatchObject({
          observedAt: at.toISOString(),
          verifiedAt: reverifiedAt.toISOString(),
        });
        expect((await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ receipts: number; stale: number }>(`SELECT
            COUNT(*) AS receipts,
            SUM(CASE WHEN invalidated_at IS NULL THEN 0 ELSE 1 END) AS stale
          FROM dbo.pi_situation_ref_authority
          WHERE owner_object_id = @owner AND source_id = N'calendar';`))
          .recordset[0]).toEqual({ receipts: 2, stale: 1 });
        expect((await pool.request()
          .query<{ pending: number }>(`SELECT COUNT(*) AS pending
            FROM dbo.pi_situation_outbox
            WHERE applied_at IS NULL;`))
          .recordset[0]?.pending).toBe(0);
        const lookupOwner = randomUUID();
        const lookupProactive = createProactiveStore(pool, lookupOwner);
        const lookupQueue = createProactiveEventStore(pool, lookupOwner);
        const lookupService = createPiSituationService({
          owner: lookupOwner,
          store: situations,
          proactive: lookupProactive,
          sources: [],
          now: () => at,
        });
        lookupService.attachEvents(lookupQueue);
        const lookupInitial = await situations.initialize(lookupOwner, situation, at, signal);
        const lookupPolicy = proactiveSettingsRevision(await lookupProactive.settings.read());
        const firstLookup = {
          id: 'calendar:ambiguous',
          source: 'calendar' as const,
          identity: 'calendar-event:ambiguous',
          label: 'First',
          observedAt: at.toISOString(),
          expiresAt: null,
          materialHash: 'a'.repeat(64),
          verifiedAt: at.toISOString(),
          activatedAt: null,
          invalidatedAt: null,
          staleReason: null,
        };
        await situations.recordLookupAuthority(
          lookupOwner,
          firstLookup,
          lookupPolicy,
          signal,
        );
        const beforeFirstPatch = await situations.read(lookupOwner, signal);
        expect(beforeFirstPatch?.authoritativeRefs).toEqual([
          expect.objectContaining({
            id: firstLookup.id,
            materialHash: firstLookup.materialHash,
            activatedAt: null,
          }),
        ]);
        const firstRef = {
          id: firstLookup.id,
          source: firstLookup.source,
          identity: firstLookup.identity,
          label: firstLookup.label,
          observedAt: firstLookup.observedAt,
          expiresAt: firstLookup.expiresAt,
          materialHash: firstLookup.materialHash,
          verifiedAt: firstLookup.verifiedAt,
        };
        const firstPatch = await lookupService.patch({
          expectedRevision: lookupInitial.revision,
          expectedHash: lookupInitial.hash,
          policyRevision: lookupPolicy,
          patch: { upsertRefs: [firstRef] },
          activation: { ...activation, id: randomUUID() },
        }, signal);
        await lookupService.synchronizeFollowUps(signal);
        const secondVerifiedAt = new Date(at.getTime() + 1).toISOString();
        const secondLookup = {
          ...firstLookup,
          label: 'Second',
          materialHash: 'b'.repeat(64),
          verifiedAt: secondVerifiedAt,
        };
        const thirdLookup = {
          ...firstLookup,
          label: 'Third',
          materialHash: 'c'.repeat(64),
          verifiedAt: secondVerifiedAt,
        };
        await situations.recordLookupAuthority(
          lookupOwner,
          secondLookup,
          lookupPolicy,
          signal,
        );
        await situations.recordLookupAuthority(
          lookupOwner,
          thirdLookup,
          lookupPolicy,
          signal,
        );
        const beforeExactPatch = await situations.read(lookupOwner, signal);
        expect(beforeExactPatch?.authoritativeRefs).toHaveLength(3);
        expect(beforeExactPatch?.authoritativeRefs.filter(({ activatedAt }) =>
          activatedAt === null)).toHaveLength(2);
        const secondRef = {
          id: secondLookup.id,
          source: secondLookup.source,
          identity: secondLookup.identity,
          label: secondLookup.label,
          observedAt: secondLookup.observedAt,
          expiresAt: secondLookup.expiresAt,
          materialHash: secondLookup.materialHash,
          verifiedAt: secondLookup.verifiedAt,
        };
        const exactPatch = await lookupService.patch({
          expectedRevision: firstPatch.record.revision,
          expectedHash: firstPatch.record.hash,
          policyRevision: lookupPolicy,
          patch: { upsertRefs: [secondRef] },
          activation: { ...activation, id: randomUUID() },
        }, signal);
        await lookupService.synchronizeFollowUps(signal);
        expect(exactPatch.record.state.refs[0]).toMatchObject({
          id: secondLookup.id,
          materialHash: secondLookup.materialHash,
          verifiedAt: secondLookup.verifiedAt,
          label: 'Second',
        });
        const exactRead = await situations.read(lookupOwner, signal);
        expect(exactRead?.authoritativeRefs.find(({ materialHash }) =>
          materialHash === secondLookup.materialHash)).toMatchObject({
          activatedAt: expect.any(String),
          invalidatedAt: null,
        });
        expect(exactRead?.authoritativeRefs.find(({ materialHash }) =>
          materialHash === firstLookup.materialHash)).toMatchObject({
          activatedAt: expect.any(String),
          invalidatedAt: expect.any(String),
        });
        expect(exactRead?.authoritativeRefs.find(({ materialHash }) =>
          materialHash === thirdLookup.materialHash)).toMatchObject({
          activatedAt: null,
          invalidatedAt: null,
        });
        expect((await pool.request()
          .input('owner', sql.UniqueIdentifier, lookupOwner)
          .query<{ pending: number }>(`SELECT COUNT(*) AS pending
            FROM dbo.pi_situation_outbox
            WHERE owner_object_id = @owner AND applied_at IS NULL;`))
          .recordset[0]?.pending).toBe(0);
      } finally {
        await pool.request().batch('DELETE FROM dbo.pi_situation_outbox;');
        await pool.request().batch('DELETE FROM dbo.pi_situational_state;');
        await pool.request().batch(
          'DELETE FROM dbo.proactive_events; DELETE FROM dbo.proactive_event_batches; ' +
          'DELETE FROM dbo.pi_message; DELETE FROM dbo.proactive_spend; ' +
          'DELETE FROM dbo.proactive_source_status; DELETE FROM dbo.proactive_settings;',
        );
        const rollback = async (name: string, script: string) => {
          try { await pool.request().batch(script); }
          catch (error) { throw new Error(`Database rollback ${name} failed`, { cause: error }); }
        };
        await pool.request().batch('DELETE FROM dbo.pi_situation_ref_authority;');
        await rollback('0101', pendingAuthorityDown);
        await rollback('0100', generationDown);
        await rollback('0099', reviewDown);
        await rollback('0098', outboxDown);
        await rollback('0097', integrityDown);
        await rollback('0090', situationDown);
        await rollback('watch', watchDown);
        await rollback('brain', brainDown);
        await rollback('core PI', down);
        await rollback('events', eventsDown);
        await rollback('preferences', preferencesDown);
        await rollback('foundation', foundationDown);
        await rollback('proactive', proactiveDown);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.pi_watch_look', N'U') AS id")).recordset).toEqual([{ id: null }]);
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.pi_message', N'U') AS id")).recordset).toEqual([{ id: null }]);
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.pi_turn', N'U') AS id")).recordset).toEqual([{ id: null }]);
    });
  });
  describe('manual folder order', () => {
    it('keeps one ordered list per owner and parent, replaces it whole and rejects broken rows', async () => {
      const schema = await readFile(new URL('../../../../db/migrations/0089_notes_folder_order.sql', import.meta.url), 'utf8');
      const down = await readFile(new URL('../../../../db/migrations/down/0089_notes_folder_order.sql', import.meta.url), 'utf8');
      await pool.request().batch(schema);
      const store = createNotesFolderOrderStore(pool);
      const owner = randomUUID();
      const other = randomUUID();
      const signal = new AbortController().signal;
      try {
        await store.replace(owner, '', ['Work', 'Personal', 'Økonomi'], signal);
        await store.replace(owner, 'Work', ['Work/Projects', 'Work/Archive'], signal);
        await store.replace(other, '', ['Other'], signal);
        expect(await store.read(owner, signal)).toEqual([
          { parent: '', folders: ['Work', 'Personal', 'Økonomi'] },
          { parent: 'Work', folders: ['Work/Projects', 'Work/Archive'] },
        ]);
        await store.replace(owner, '', ['Personal', 'Work'], signal);
        expect((await store.read(owner, signal))[0]).toEqual({ parent: '', folders: ['Personal', 'Work'] });
        expect(await store.read(other, signal)).toEqual([{ parent: '', folders: ['Other'] }]);
        await Promise.all([
          store.replace(owner, 'Work', ['Work/A', 'Work/B'], signal),
          store.replace(owner, 'Work', ['Work/B', 'Work/A'], signal),
        ]);
        const work = (await store.read(owner, signal)).find((row) => row.parent === 'Work');
        expect([['Work/A', 'Work/B'], ['Work/B', 'Work/A']]).toContainEqual(work?.folders);
        await store.replace(owner, 'Work', [], signal);
        expect((await store.read(owner, signal)).map((row) => row.parent)).toEqual(['']);
        await expect(pool.request().query(`INSERT dbo.notes_folder_order VALUES ('${owner}', N'', N'Work', -1)`)).rejects.toThrow();
        await expect(store.replace(owner, '', ['Same', 'Same'], signal)).rejects.toThrow();
        expect((await store.read(owner, signal))[0]).toEqual({ parent: '', folders: ['Personal', 'Work'] });
      } finally {
        await pool.request().batch(down);
      }
      expect((await pool.request().query("SELECT OBJECT_ID(N'dbo.notes_folder_order', N'U') AS id")).recordset).toEqual([{ id: null }]);
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
