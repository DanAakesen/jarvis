import { createECDH, createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDatabaseConfig } from './config.js';
import { applyMigrations, readDownMigration, readMigrations, revertMigration, type Migration } from './migrations.js';
import { createTaskStore } from './task-store.js';
import { createCredentialStatusStore } from './credential-status-store.js';
import { createNowFeedStore } from './now-feed-store.js';
import { createSettingsStore } from './settings-store.js';
import { createWebhookDeliveryStore } from './webhook-delivery-store.js';
import { createProjectStore } from './project-store.js';
import { createSandboxHeartbeatStore } from './sandbox-heartbeat-store.js';
import { createAlertActivityStore } from './alert-store.js';
import { createAwayModeStore } from './away-mode-store.js';
import { createDispatcherStore } from './dispatcher-store.js';
import { createConversationStore } from './conversation-store.js';
import { createMemoryStore, createVaultIndexStore } from './memory-store.js';
import { createTaskStatusNotificationStore } from './task-status-notification-store.js';
import { createBackgroundJobStore } from './background-job-store.js';
import { createUsageStore } from './usage-store.js';
import { createToolCallStore } from './tool-call-store.js';
import { WorkspaceHtmlArtifactNotFound, WorkspaceHtmlArtifactStore, workspaceHtmlSizeLimit } from './workspace-html-artifact-store.js';
import { WorkspaceItemsStore } from './workspace-items-store.js';
import {
  createTaskEventArchive,
  type TaskEventArchiveBlobStore,
} from './task-event-archive.js';
import { ProjectConflictError } from '../factory/projects.js';
import { createEventHub } from '../core/event-hub.js';
import type { TaskEventMessage } from '../factory/task-store.js';
import { mapGithubWebhook } from '../github/webhook-mapping.js';
import { createPushStore } from './push-store.js';
import { createProactiveStore } from './proactive-store.js';
import { proactiveSettingsRevision, ProactiveSettingsConflictError } from '../proactive/preferences.js';
import { createProactiveAlertStore } from './proactive-alert-store.js';
import { createProactiveTodoReceiptStore } from './proactive-todo-store.js';
import { generateVapidKeyPair } from '../push/webpush.js';
import { defaultProactiveSettings } from '../proactive/store.js';
import { createProjectPolicyEvaluator } from '../github/project-policy.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import { createProjectPolicyStore } from './project-policy-store.js';
import { createPcBridgeStatusStore } from './pc-bridge-status-store.js';
import { createOwnerSessionStore } from './owner-session-store.js';
import { createOwnerReminderStore } from './owner-reminder-store.js';
import type { OwnerSessionRecord } from '../auth/session/store.js';
import { generateOwnerSessionCredential } from '../auth/session/token.js';

const configuration = loadDatabaseConfig();
if (!configuration || process.env.NODE_ENV !== 'test' || configuration.server !== '127.0.0.1') {
  throw new Error('Database integration tests require an isolated loopback SQL Server test configuration');
}
const rollbackConfiguration: sql.config = configuration;
const database = `jarvis_ci_${randomUUID().replaceAll('-', '')}`;
const administrator = new sql.ConnectionPool({ ...configuration, database: 'master' });
const pool = new sql.ConnectionPool({ ...configuration, database });
const core = '0001_core_tables.sql';
const tablesInSchema = [
  'activity', 'activitykit_registrations', 'approval_notification_registrations', 'artifacts', 'background_job_dismissals', 'background_job_steps', 'background_jobs', 'conversation_attachments',
  'conversation_summaries', 'credential_status', 'deployment_failure_receipts', 'deployments', 'factory_issue_origins', 'factory_task_submissions',
  'github_app_mint_status', 'jarvis_sessions',
  'memories', 'memory_deletions', 'memory_history', 'messages', 'owner_reminder_schedules', 'owner_sessions', 'phone_sessions',
  'proactive_alerts', 'proactive_items',
  'proactive_reminders', 'proactive_runs', 'proactive_settings', 'proactive_source_status', 'proactive_spend', 'proactive_todo_receipts', 'projects',
  'pull_requests', 'push_subscriptions', 'push_vapid_keys', 'releases',
  'sandbox_sessions', 'sandbox_turns', 'session_runtime_sources', 'session_runtime_tests', 'session_runtime_turns',
  'settings', 'task_event_archives', 'task_events', 'task_status_notifications',
  'tasks', 'teams_confirmations', 'teams_conversations', 'tool_calls', 'usage', 'vault_chunks', 'vault_links',
  'webhook_deliveries', 'workflow_runs', 'workspace_artifacts', 'workspace_html_artifact_versions',
  'workspace_html_artifacts', 'workspace_items', 'workspace_pins',
];

async function tables(databasePool = pool): Promise<string[]> {
  const { recordset } = await databasePool.request().query<{ name: string }>(
    "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name <> N'schema_migrations' ORDER BY name");
  return recordset.map((row) => row.name).sort();
}
async function ledger(databasePool = pool): Promise<string[]> {
  const { recordset } = await databasePool.request().query<{ name: string }>('SELECT name FROM dbo.schema_migrations ORDER BY name');
  return recordset.map((row) => row.name);
}
async function scalar(text: string, databasePool = pool): Promise<number> {
  const { recordset } = await databasePool.request().query<{ id: number }>(`${text}; SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`);
  return recordset[0]?.id ?? 0;
}

async function withRollbackDatabase(
  test: (rollbackPool: sql.ConnectionPool, committed: Migration[]) => Promise<void>,
): Promise<void> {
  const name = `jarvis_rollback_${randomUUID().replaceAll('-', '')}`;
  const rollbackPool = new sql.ConnectionPool({ ...rollbackConfiguration, database: name });
  await administrator.request().batch(`CREATE DATABASE [${name}];`);
  try {
    await rollbackPool.connect();
    const committed = await readMigrations();
    await applyMigrations(rollbackPool, committed);
    await test(rollbackPool, committed);
  } finally {
    await rollbackPool.close();
    await administrator.request().batch(`IF DB_ID(N'${name}') IS NOT NULL BEGIN
      ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${name}]; END;`);
  }
}

// Rollback is latest-only, so newer additive migrations are unwound first and returned oldest-first for re-applying.
async function revertNewerThan(rollbackPool: sql.ConnectionPool, committed: Migration[], name: string): Promise<Migration[]> {
  const newer = committed.filter((migration) => migration.name > name);
  for (const migration of [...newer].reverse()) {
    expect(await revertMigration(rollbackPool, committed, await readDownMigration(migration.name))).toBe(migration.name);
  }
  return newer;
}

function createMemoryArchiveBlobStore() {
  const stored = new Map<string, Buffer>();
  let failUpload = false;
  const blobs: TaskEventArchiveBlobStore = {
    async upload(name, body) {
      if (failUpload) throw new Error('Blob storage unavailable');
      stored.set(name, body);
    },
    async download(name) {
      const body = stored.get(name);
      if (!body) throw new Error('Archive blob not found');
      return body;
    },
  };
  return {
    blobs,
    failUploads(value: boolean) { failUpload = value; },
  };
}

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

describe('committed domain schema (groups 1-8)', () => {
  it('boots the committed migration manifest twice without duplicate ledger rows', async () => {
    const committed = await readMigrations();
    expect(await applyMigrations(pool, committed)).toEqual(committed.map((migration) => migration.name));
    expect(await applyMigrations(pool, committed)).toEqual([]);
    expect(await ledger()).toEqual(committed.map((migration) => migration.name));
    expect(await tables()).toEqual(tablesInSchema);
    const embeddings = await pool.request().query<{ vector_type: number | null; table_name: string; column_name: string }>(
      `SELECT TYPE_ID(N'vector') AS vector_type, tables.name AS table_name, columns.name AS column_name
        FROM sys.tables AS tables
        INNER JOIN sys.columns AS columns ON columns.object_id = tables.object_id
        WHERE tables.name IN (N'memories', N'vault_chunks')
          AND columns.name IN (N'embedding', N'embedding_json')
        ORDER BY tables.name, columns.name;`);
    if (embeddings.recordset[0]?.vector_type === null) {
      expect(embeddings.recordset.map(({ table_name, column_name }) => `${table_name}.${column_name}`)).toEqual([
        'memories.embedding_json', 'vault_chunks.embedding_json',
      ]);
    } else {
      expect(embeddings.recordset.map(({ table_name, column_name }) => `${table_name}.${column_name}`)).toEqual([
        'memories.embedding', 'vault_chunks.embedding',
      ]);
    }
    const credentials = await pool.request().query<{ name: string; status: string }>(
      `SELECT name, status FROM dbo.credential_status WHERE name IN (N'codex-login', N'copilot-token') ORDER BY name;`);
    expect(credentials.recordset).toEqual([
      { name: 'codex-login', status: 'unknown' },
      { name: 'copilot-token', status: 'unknown' },
    ]);
    const { recordset } = await pool.request().query<{ name: string }>(
      `SELECT name FROM sys.indexes WHERE name IN (
        N'IX_tasks_state_next_attempt_at', N'IX_task_events_task_id_at', N'IX_sandbox_sessions_task_id_status',
        N'IX_sandbox_turns_sandbox_session_id_started_at', N'IX_artifacts_task_id_at',
        N'IX_task_event_archives_task_first_at', N'IX_pull_requests_project_head_sha',
        N'IX_workflow_runs_project_head_sha', N'IX_releases_project_created_at',
        N'IX_deployments_release_id_at', N'IX_messages_at', N'IX_proactive_alerts_owner_day_status',
        N'IX_proactive_reminders_owner_day_state', N'IX_proactive_reminders_owner_state_fire_at',
        N'UX_activity_alert_key', N'UX_proactive_alerts_owner_alert_key', N'UX_proactive_reminders_owner_key',
        N'UX_tasks_issue_delivery') ORDER BY name`);
    expect(recordset.map((row) => row.name)).toEqual([
      'IX_artifacts_task_id_at', 'IX_deployments_release_id_at', 'IX_messages_at',
      'IX_proactive_alerts_owner_day_status', 'IX_proactive_reminders_owner_day_state',
      'IX_proactive_reminders_owner_state_fire_at', 'IX_pull_requests_project_head_sha',
      'IX_releases_project_created_at', 'IX_sandbox_sessions_task_id_status',
      'IX_sandbox_turns_sandbox_session_id_started_at', 'IX_task_event_archives_task_first_at',
      'IX_task_events_task_id_at', 'IX_tasks_state_next_attempt_at', 'IX_workflow_runs_project_head_sha',
      'UX_activity_alert_key', 'UX_proactive_alerts_owner_alert_key', 'UX_proactive_reminders_owner_key', 'UX_tasks_issue_delivery',
    ]);
  });

  it('renames Workspaces storage while synchronizing legacy SQL reads and writes', () =>
    withRollbackDatabase(async (rollbackPool, committed) => {
      await revertNewerThan(rollbackPool, committed, '0067_workspaces_identifiers.sql');
      const migration = committed.find(item => item.name === '0067_workspaces_identifiers.sql')!;
      expect(migration.name).toBe('0067_workspaces_identifiers.sql');
      const down = await readDownMigration(migration.name);
      await expect(revertMigration(rollbackPool, committed, down)).resolves.toBe(migration.name);

      const owner = randomUUID();
      const sourceId = randomUUID();
      const itemId = `research:${sourceId}`;
      const jobId = randomUUID();
      const priorResult = `research:${jobId}`;
      const legacyUpdate = `research:${randomUUID()}`;
      const canonicalUpdate = `research:${randomUUID()}`;
      await rollbackPool.request()
        .input('itemId', sql.NVarChar(80), itemId)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('source', sql.UniqueIdentifier, sourceId)
        .query(`INSERT dbo.folio_items
          (item_id, owner_object_id, kind, source_id, title, prompt_summary, created_at, pinned)
          VALUES (@itemId, @owner, N'research', @source, N'Existing report', N'Existing summary', SYSUTCDATETIME(), 0);`);
      await rollbackPool.request()
        .input('jobId', sql.NVarChar(36), jobId)
        .input('resultId', sql.NVarChar(80), priorResult)
        .query(`INSERT dbo.background_jobs
          (job_id, kind, title, status, step, steps, started_at, updated_at, result_folio_id, result_delivery_status)
          VALUES (@jobId, N'research', N'Existing research', N'done', 1, 1, SYSUTCDATETIME(), SYSUTCDATETIME(),
            @resultId, N'pending');`);

      await expect(applyMigrations(rollbackPool, committed)).resolves.toEqual(committed.filter(item => item.name >= migration.name).map(item => item.name));
      const synonym = await rollbackPool.request().query<{ name: string }>(
        `SELECT name FROM sys.synonyms WHERE schema_id = SCHEMA_ID(N'dbo') AND name = N'folio_items';`);
      expect(synonym.recordset).toEqual([{ name: 'folio_items' }]);

      const copied = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_workspace_item_id: string; result_folio_id: string }>(
          'SELECT result_workspace_item_id, result_folio_id FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(copied.recordset[0]).toEqual({
        result_workspace_item_id: priorResult, result_folio_id: priorResult,
      });

      await rollbackPool.request()
        .input('itemId', sql.NVarChar(80), itemId)
        .query(`UPDATE dbo.folio_items SET title = N'Legacy SQL update' WHERE item_id = @itemId;`);
      const legacyRead = await rollbackPool.request().input('itemId', sql.NVarChar(80), itemId)
        .query<{ title: string }>('SELECT title FROM dbo.workspace_items WHERE item_id = @itemId;');
      expect(legacyRead.recordset[0]?.title).toBe('Legacy SQL update');

      await rollbackPool.request()
        .input('jobId', sql.NVarChar(36), jobId)
        .input('resultId', sql.NVarChar(80), legacyUpdate)
        .query('UPDATE dbo.background_jobs SET result_folio_id = @resultId WHERE job_id = @jobId;');
      let synchronized = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_workspace_item_id: string | null; result_folio_id: string | null; result_delivery_status: string | null }>(
          'SELECT result_workspace_item_id, result_folio_id, result_delivery_status FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(synchronized.recordset[0]).toEqual({
        result_workspace_item_id: legacyUpdate, result_folio_id: legacyUpdate, result_delivery_status: 'pending',
      });
      await rollbackPool.request()
        .input('jobId', sql.NVarChar(36), jobId)
        .input('resultId', sql.NVarChar(80), canonicalUpdate)
        .query('UPDATE dbo.background_jobs SET result_workspace_item_id = @resultId WHERE job_id = @jobId;');
      synchronized = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_workspace_item_id: string | null; result_folio_id: string | null; result_delivery_status: string | null }>(
          'SELECT result_workspace_item_id, result_folio_id, result_delivery_status FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(synchronized.recordset[0]).toEqual({
        result_workspace_item_id: canonicalUpdate, result_folio_id: canonicalUpdate, result_delivery_status: 'pending',
      });

      await rollbackPool.request()
        .input('jobId', sql.NVarChar(36), jobId)
        .input('resultId', sql.NVarChar(80), canonicalUpdate)
        .query(`UPDATE dbo.background_jobs
          SET result_workspace_item_id = NULL, result_folio_id = @resultId
          WHERE job_id = @jobId;`);
      synchronized = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_workspace_item_id: string | null; result_folio_id: string | null; result_delivery_status: string | null }>(
          'SELECT result_workspace_item_id, result_folio_id, result_delivery_status FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(synchronized.recordset[0]).toEqual({
        result_workspace_item_id: canonicalUpdate, result_folio_id: canonicalUpdate, result_delivery_status: 'pending',
      });

      await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query(`UPDATE dbo.background_jobs
          SET result_folio_id = NULL, result_delivery_status = NULL
          WHERE job_id = @jobId;`);
      synchronized = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_workspace_item_id: string | null; result_folio_id: string | null; result_delivery_status: string | null }>(
          'SELECT result_workspace_item_id, result_folio_id, result_delivery_status FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(synchronized.recordset[0]).toEqual({
        result_workspace_item_id: null, result_folio_id: null, result_delivery_status: null,
      });

      await rollbackPool.request()
        .input('jobId', sql.NVarChar(36), jobId)
        .input('resultId', sql.NVarChar(80), legacyUpdate)
        .query(`UPDATE dbo.background_jobs
          SET result_folio_id = @resultId, result_delivery_status = N'pending'
          WHERE job_id = @jobId;`);
      await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query(`UPDATE dbo.background_jobs
          SET result_workspace_item_id = NULL, result_delivery_status = NULL
          WHERE job_id = @jobId;`);
      synchronized = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_workspace_item_id: string | null; result_folio_id: string | null; result_delivery_status: string | null }>(
          'SELECT result_workspace_item_id, result_folio_id, result_delivery_status FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(synchronized.recordset[0]).toEqual({
        result_workspace_item_id: null, result_folio_id: null, result_delivery_status: null,
      });

      await rollbackPool.request()
        .input('jobId', sql.NVarChar(36), jobId)
        .input('resultId', sql.NVarChar(80), canonicalUpdate)
        .query(`UPDATE dbo.background_jobs
          SET result_folio_id = @resultId, result_delivery_status = N'pending'
          WHERE job_id = @jobId;`);

      await revertNewerThan(rollbackPool, committed, migration.name);
      await expect(revertMigration(rollbackPool, committed, down)).resolves.toBe(migration.name);
      const restored = await rollbackPool.request().input('itemId', sql.NVarChar(80), itemId)
        .query<{ title: string }>('SELECT title FROM dbo.folio_items WHERE item_id = @itemId;');
      expect(restored.recordset[0]?.title).toBe('Legacy SQL update');
      const restoredJob = await rollbackPool.request().input('jobId', sql.NVarChar(36), jobId)
        .query<{ result_folio_id: string }>('SELECT result_folio_id FROM dbo.background_jobs WHERE job_id = @jobId;');
      expect(restoredJob.recordset[0]?.result_folio_id).toBe(canonicalUpdate);
    }));

  it('persists owner reminder schedules, filters explicit items by owner, and protects rollback (0065)', () =>
    withRollbackDatabase(async (rollbackPool, committed) => {
      const owner = randomUUID();
      const otherOwner = randomUUID();
      const store = createOwnerReminderStore(rollbackPool, owner);
      const fireAt = new Date('2026-10-23T08:00:00.000Z');
      const candidate = {
        idempotencyKey: 'a'.repeat(64),
        taskIdentity: 'b'.repeat(64),
        taskTitle: 'Synthetic task',
        fireAt,
        localTime: '10:00',
        anchorDate: '2026-10-23',
        cadence: 'daily' as const,
        untilTaskDone: true,
      };

      const first = await store.create(candidate, new Date('2026-10-23T07:00:00.000Z'));
      const duplicate = await store.create({ ...candidate, taskTitle: 'Changed duplicate' }, fireAt);
      expect(first.created).toBe(true);
      expect(duplicate).toMatchObject({
        created: false,
        schedule: { id: first.schedule.id, taskTitle: 'Synthetic task' },
      });
      expect(await createOwnerReminderStore(rollbackPool, otherOwner).get(first.schedule.id)).toBeNull();

      const [claim] = await store.claimDue(fireAt, 20, 60_000);
      expect(claim).toMatchObject({ state: 'sending', id: first.schedule.id });
      const nextFireAt = new Date('2026-10-24T08:00:00.000Z');
      expect(await store.finishClaim(first.schedule.id, claim!.claimToken!, {
        state: 'scheduled',
        fireAt: nextFireAt,
        lastFireAt: fireAt,
        lastDelivery: 'provider_accepted',
      })).toBe(true);
      const recovered = await createOwnerReminderStore(rollbackPool, owner).get(first.schedule.id);
      expect(recovered).toMatchObject({ state: 'scheduled', lastFireAt: fireAt, fireAt: nextFireAt });
      expect(await store.hasTaskReminderNear(candidate.taskIdentity, fireAt, 5 * 60_000)).toBe(true);

      const proactive = createProactiveStore(rollbackPool, owner);
      const ordinaryItem = await proactive.items.upsertFinding({
        dedupeKey: 'integration:ordinary-finding',
        title: 'Synthetic ordinary finding',
        body: 'Ordinary proactive finding.',
        category: 'todo',
        suggestionScope: 'personal',
        urgency: 'normal',
        dueAt: null,
        evidence: [],
        runId: null,
        language: 'en',
      });
      expect(ordinaryItem.ownerRequested).toBeUndefined();
      expect(ordinaryItem.dueAt).toBeNull();
      expect(await proactive.items.get(ordinaryItem.id)).toMatchObject({ id: ordinaryItem.id, dueAt: null });

      await proactive.settings.patch({ categories: { todo: false }, suggestionScope: 'work' });
      expect(await proactive.items.get(ordinaryItem.id)).toBeUndefined();
      const item = await proactive.items.upsertFinding({
        dedupeKey: 'integration:owner-reminder',
        title: 'Synthetic task',
        body: 'Owner-requested reminder.',
        category: 'todo',
        suggestionScope: 'personal',
        ownerRequested: true,
        urgency: 'normal',
        dueAt: fireAt.toISOString(),
        evidence: [],
        runId: null,
        language: 'en',
      });
      expect(await proactive.items.get(item.id)).toMatchObject({ ownerRequested: true });
      expect(await createProactiveStore(rollbackPool, otherOwner).items.get(item.id)).toBeUndefined();
      const updated = await proactive.items.upsertFinding({
        dedupeKey: 'integration:owner-reminder',
        title: 'Synthetic task',
        body: 'Updated owner-requested reminder.',
        category: 'todo',
        suggestionScope: 'personal',
        ownerRequested: true,
        urgency: 'normal',
        dueAt: null,
        evidence: [],
        runId: null,
        language: 'en',
      });
      expect(updated).toMatchObject({ id: item.id, ownerRequested: true, dueAt: null });
      expect(await proactive.items.get(updated.id)).toMatchObject({ id: item.id, ownerRequested: true, dueAt: null });

      const down = await readDownMigration('0065_owner_reminder_schedules.sql');
      const newer = await revertNewerThan(rollbackPool, committed, down.name);
      await expect(revertMigration(rollbackPool, committed, down))
        .rejects.toThrow('Owner reminder schedules must be retained');
      await rollbackPool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .query('DELETE FROM dbo.owner_reminder_schedules WHERE owner_object_id = @owner;');
      await expect(revertMigration(rollbackPool, committed, down))
        .rejects.toThrow('Owner-requested reminder items must be retained');
      await rollbackPool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .query('DELETE FROM dbo.proactive_items WHERE owner_object_id = @owner AND owner_requested = 1;');
      expect(await revertMigration(rollbackPool, committed, down)).toBe(down.name);
      expect(await applyMigrations(rollbackPool, committed)).toEqual([down.name, ...newer.map(({ name }) => name)]);
    }));

  it('stores owner-scoped push subscriptions idempotently, caps them, and opens durable items once', async () => {
    const store = createPushStore(pool);
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const makeSubscription = (endpoint: string) => {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      return {
        endpoint: `https://web.push.apple.com/device/${endpoint}`,
        p256dh: ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url'),
        auth: Buffer.alloc(16, 7).toString('base64url'),
      };
    };
    const first = makeSubscription('first');
    await store.upsertSubscription(owner, first);
    const firstRow = await store.listSubscriptions(owner);
    await store.upsertSubscription(owner, { ...first, p256dh: makeSubscription('replacement').p256dh });
    expect(await store.listSubscriptions(owner)).toMatchObject([{ id: firstRow[0]!.id, endpoint: first.endpoint }]);
    await Promise.all(['parallel-1', 'parallel-2'].map((endpoint) =>
      store.upsertSubscription(owner, makeSubscription(endpoint))));
    expect(await store.listSubscriptions(owner)).toHaveLength(3);
    await store.recordSubscriptionResult(firstRow[0]!.id, true);
    for (let index = 1; index <= 10; index++) {
      await store.upsertSubscription(owner, makeSubscription(`subscription-${index}`));
    }
    const capped = await store.listSubscriptions(owner);
    expect(capped).toHaveLength(10);
    expect(capped.map(({ endpoint }) => endpoint)).toContain(first.endpoint);
    expect(capped.map(({ endpoint }) => endpoint)).not.toContain(makeSubscription('subscription-1').endpoint);
    await store.upsertSubscription(otherOwner, first);
    expect(await store.listSubscriptions(otherOwner)).toHaveLength(1);
    await store.deleteSubscription(owner, first.endpoint);
    await store.deleteSubscription(owner, first.endpoint);
    expect((await store.listSubscriptions(owner)).some(({ endpoint }) => endpoint === first.endpoint)).toBe(false);

    const keys = [generateVapidKeyPair(), generateVapidKeyPair()];
    await Promise.allSettled(keys.map((candidate) => store.insertVapidKey(candidate)));
    const persistedKeys = await store.readVapidKey();
    expect(keys).toContainEqual(persistedKeys);
    expect((await pool.request().query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dbo.push_vapid_keys')).recordset[0]?.count).toBe(1);

    const item = await store.createTestItem(owner);
    await store.updateItemDelivery(item.id, 'accepted', 201);
    const delivery = await pool.request()
      .input('id', sql.UniqueIdentifier, item.id)
      .query<{ delivery_state: string; delivery_status_code: number | null; delivered_at: Date | null }>(
        'SELECT delivery_state, delivery_status_code, delivered_at FROM dbo.proactive_items WHERE id = @id;');
    expect(delivery.recordset[0]).toEqual({ delivery_state: 'accepted', delivery_status_code: 201, delivered_at: null });
    expect(await store.readItem(otherOwner, item.id)).toBeUndefined();
    const firstRead = await store.readItem(owner, item.id);
    const opened = await pool.request()
      .input('id', sql.UniqueIdentifier, item.id)
      .query<{ opened_at: Date }>('SELECT opened_at FROM dbo.proactive_items WHERE id = @id;');
    const firstOpenedAt = opened.recordset[0]?.opened_at;
    expect(firstRead).toMatchObject({ id: item.id, kind: 'test', title: 'Jarvis', body: 'New item' });
    expect(firstOpenedAt).toBeInstanceOf(Date);
    await store.readItem(owner, item.id);
    const openedAgain = await pool.request()
      .input('id', sql.UniqueIdentifier, item.id)
      .query<{ opened_at: Date }>('SELECT opened_at FROM dbo.proactive_items WHERE id = @id;');
    expect(openedAgain.recordset[0]?.opened_at).toEqual(firstOpenedAt);
  });

  it('recovers proactive background jobs with the fixed visible restart reason', () => withRollbackDatabase(async (rollbackPool) => {
    const store = createBackgroundJobStore(rollbackPool);
    const jobId = randomUUID();
    const at = new Date().toISOString();
    await store.create({
      jobId, kind: 'proactive', title: 'Proactive check (manual)', status: 'running',
      step: 0, steps: 1, startedAt: at, updatedAt: at,
    });
    expect(await store.reconcileInterrupted()).toContainEqual(expect.objectContaining({
      jobId, kind: 'proactive', status: 'failed', detail: 'Interrupted by a restart',
    }));
  }));

  it('serializes persisted proactive manual limits across stores and resets at Copenhagen midnight', () => withRollbackDatabase(async (rollbackPool) => {
    const owner = randomUUID();
    const first = createProactiveStore(rollbackPool, owner);
    const second = createProactiveStore(rollbackPool, owner);
    const start = Date.parse('2026-10-25T21:00:00Z');
    for (let index = 0; index < 6; index++) {
      const now = new Date(start + index * 5 * 60_000);
      const claims = await Promise.all([
        first.runs.claim({ trigger: 'manual', slot: null, now }),
        second.runs.claim({ trigger: 'manual', slot: null, now }),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const claimed = claims.find(Boolean)!;
      await first.runs.finish(claimed.run.id, claimed.generation, 'done', null, 0, now);
      expect(await second.runs.claim({
        trigger: 'manual', slot: null, now: new Date(now.getTime() + 5 * 60_000 - 1),
      })).toBeNull();
    }
    expect(await second.runs.claim({
      trigger: 'manual', slot: null, now: new Date(start + 30 * 60_000),
    })).toBeNull();
    expect(await second.runs.claim({
      trigger: 'manual', slot: null, now: new Date('2026-10-25T23:00:00Z'),
    })).not.toBeNull();
  }));

  it('fences guarded proactive findings by owner, generation, status and lease expiry', () => withRollbackDatabase(async (rollbackPool) => {
    const store = createProactiveStore(rollbackPool, randomUUID());
    const now = new Date('2026-10-20T05:00:00.000Z');
    const claimed = (await store.runs.claim({ trigger: 'scheduled', slot: null, now }))!;
    const guard = {
      runId: claimed.run.id, generation: claimed.generation,
      signal: new AbortController().signal, check: () => {}, now: () => now,
    };
    const finding = {
      dedupeKey: 'integration:guarded', title: 'Synthetic guarded finding',
      body: 'Synthetic evidence.', category: 'deadline' as const, urgency: 'normal' as const,
      dueAt: null, evidence: [], runId: claimed.run.id, language: 'en' as const,
    };
    const saved = await store.items.upsertFinding(finding, guard);
    const update = { ...finding, title: 'Must not persist' };
    await expect(store.items.upsertFinding(update, {
      ...guard, generation: guard.generation + 1,
    })).rejects.toThrow('lease_lost');
    await expect(store.items.upsertFinding(update, {
      ...guard, now: () => new Date(now.getTime() + 10 * 60_000),
    })).rejects.toThrow('lease_lost');
    const otherOwner = createProactiveStore(rollbackPool, randomUUID());
    await expect(otherOwner.items.upsertFinding(finding, guard)).rejects.toThrow('lease_lost');
    expect(await otherOwner.items.list('all', 20, now)).toEqual([]);
    await store.runs.finish(claimed.run.id, claimed.generation, 'done', null, 1, now);
    await expect(store.items.upsertFinding(update, guard)).rejects.toThrow('lease_lost');
    await expect(store.items.upsertFinding({ ...update, dedupeKey: 'integration:blocked' }, guard))
      .rejects.toThrow('lease_lost');
    expect(await store.items.list('all', 20, now)).toEqual([saved]);
  }));

  it('re-reads item state in owner scope without returning item text', () => withRollbackDatabase(async (rollbackPool) => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const store = createProactiveStore(rollbackPool, owner);
    const item = await store.items.upsertFinding({
      dedupeKey: 'integration:get-many-state',
      title: 'Synthetic private title',
      body: 'Synthetic private body.',
      category: 'deadline',
      urgency: 'time_critical',
      dueAt: null,
      evidence: [],
      runId: null,
      language: 'en',
    });
    await store.items.applyFeedback(item.id, 'seen');
    expect(await store.items.getMany([item.id, randomUUID()])).toEqual([{ id: item.id, state: 'seen' }]);
    expect(await createProactiveStore(rollbackPool, otherOwner).items.getMany([item.id])).toEqual([]);
  }));

  it('persists proactive settings, findings, feedback, leases, source status and estimated spend', () => withRollbackDatabase(async (rollbackPool) => {
    const owner = randomUUID();
    const store = createProactiveStore(rollbackPool, owner);
    const now = new Date('2026-10-20T05:00:00.000Z');
    expect(await store.settings.read()).toEqual(defaultProactiveSettings());
    expect(await store.settings.patch({
      paused: true,
      monthlyBudgetDkk: 275,
      sources: { calendar: false },
      newsFeeds: ['https://example.test/rss.xml'],
      guidance: 'Synthetic integration setting.',
    })).toMatchObject({
      paused: true, monthlyBudgetDkk: 275, sources: { calendar: false },
      newsFeeds: ['https://example.test/rss.xml'], guidance: 'Synthetic integration setting.',
    });

    const finding = {
      dedupeKey: 'integration:deadline-1',
      title: 'Synthetic calendar deadline',
      body: 'A synthetic deadline is approaching.',
      category: 'deadline' as const,
      urgency: 'normal' as const,
      dueAt: '2026-10-20T12:00:00.000Z',
      evidence: [{ source: 'calendar' as const, label: 'Calendar', observedAt: now.toISOString() }],
      runId: null,
      language: 'en' as const,
    };
    const first = await store.items.upsertFinding(finding);
    expect(first).toMatchObject({ kind: 'finding', state: 'new', dueAt: finding.dueAt, evidence: finding.evidence });
    expect(await store.items.getMany([first.id, randomUUID()])).toEqual([{ id: first.id, state: 'new' }]);
    expect((await store.items.applyFeedback(first.id, 'dismiss'))?.state).toBe('dismissed');
    expect((await store.items.upsertFinding({ ...finding, title: 'Updated synthetic title' })).state).toBe('dismissed');
    expect((await store.items.upsertFinding({ ...finding, urgency: 'fyi' })).state).toBe('dismissed');
    expect((await store.items.upsertFinding(finding)).state).toBe('dismissed');
    const changed = await store.items.upsertFinding({ ...finding, urgency: 'time_critical' });
    expect(changed).toMatchObject({ id: first.id, state: 'new', urgency: 'time_critical' });
    await store.items.applyFeedback(changed.id, 'snooze', '2026-10-20T06:00:00.000Z');
    expect(await store.items.list('open', 20, now)).toEqual([]);
    expect(await store.items.list('open', 20, new Date('2026-10-20T06:00:00.000Z'))).toHaveLength(1);
    expect(await store.items.get(changed.id, true)).toMatchObject({
      ...changed, state: 'snoozed', snoozedUntil: '2026-10-20T06:00:00.000Z',
    });

    const slot = '2026-10-20T07:00';
    const competing = await Promise.all([
      store.runs.claim({ trigger: 'scheduled', slot, now }),
      store.runs.claim({ trigger: 'scheduled', slot, now }),
    ]);
    expect(competing.filter(Boolean)).toHaveLength(1);
    const firstClaim = competing.find(Boolean)!;
    expect(await store.runs.running(now)).toEqual(firstClaim.run);
    expect(await store.runs.claim({ trigger: 'manual', slot: null, now })).toBeNull();
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(await store.runs.running(later)).toBeNull();
    const nextClaim = await store.runs.claim({ trigger: 'manual', slot: null, now: later });
    expect(nextClaim).not.toBeNull();
    expect(await store.runs.heartbeat(firstClaim.run.id, firstClaim.generation, later)).toBe(false);
    expect(await store.runs.finish(firstClaim.run.id, firstClaim.generation, 'done', null, 1, later)).toBe(false);
    expect(await store.runs.finish(nextClaim!.run.id, nextClaim!.generation, 'done', null, 1, later)).toBe(true);
    expect(await store.runs.running(later)).toBeNull();
    expect(await store.runs.countManualSince(now)).toBe(1);
    expect(await store.runs.claim({ trigger: 'manual', slot: null, now: new Date(later.getTime() + 1_000) })).toBeNull();
    const interrupted = await store.runs.claim({ trigger: 'manual', slot: null, now: new Date(later.getTime() + 5 * 60_000) });
    expect(await store.runs.markInterruptedOnStartup()).toBe(1);
    expect(await store.runs.finish(interrupted!.run.id, interrupted!.generation, 'done', null, 0, later)).toBe(false);
    expect(await store.runs.latest()).toMatchObject({ status: 'failed', reason: 'interrupted_by_restart' });
    expect(await store.runs.list(10)).toHaveLength(3);

    await store.sources.upsert({
      id: 'calendar', label: 'Calendar', enabled: true, state: 'unavailable',
      reason: 'not_connected', observedAt: now.toISOString(),
    });
    expect(await store.sources.list()).toMatchObject([
      { id: 'calendar', state: 'unavailable', reason: 'not_connected', observedAt: now.toISOString() },
    ]);
    await store.spend.record({
      runId: nextClaim!.run.id,
      month: '2026-10',
      inputTokens: 100,
      outputTokens: 25,
      estimatedDkk: 1.2345,
      createdAt: now,
    });
    expect(await store.spend.monthTotal('2026-10')).toBe(1.2345);
    expect(await store.spend.monthTotal('2026-11')).toBe(0);
  }));

  it('persists preference updates across store instances and reverses them without deleting findings', () => withRollbackDatabase(async (rollbackPool) => {
    const owner = randomUUID();
    const first = createProactiveStore(rollbackPool, owner);
    const now = new Date('2026-10-20T05:00:00.000Z');
    const finding = await first.items.upsertFinding({
      dedupeKey: 'integration:travel-preference',
      title: 'Synthetic trip detail',
      body: 'Synthetic travel evidence.',
      category: 'travel',
      suggestionScope: 'personal',
      urgency: 'normal',
      dueAt: null,
      evidence: [],
      runId: null,
      language: 'en',
    });
    await first.items.markTodoAdded([finding.id]);
    const concurrent = createProactiveStore(rollbackPool, owner);
    await Promise.all([
      first.settings.patch({ categories: { travel: false } }),
      concurrent.settings.patch({ suggestionScope: 'personal' }),
    ]);

    const restarted = createProactiveStore(rollbackPool, owner);
    expect(await restarted.settings.read()).toMatchObject({
      paused: false, monthlyBudgetDkk: 100, sources: { travel: true },
      categories: { travel: false }, suggestionScope: 'personal',
    });
    const revision = proactiveSettingsRevision(await restarted.settings.read());
    await restarted.settings.patch({ paused: true }, revision);
    await expect(concurrent.settings.patch({ sources: { todos: false } }, revision))
      .rejects.toBeInstanceOf(ProactiveSettingsConflictError);
    expect(await first.settings.read()).toMatchObject({
      paused: true, sources: { todos: true }, monthlyBudgetDkk: 100,
    });
    expect(await restarted.items.list('all', 20, now)).toEqual([]);
    expect(await restarted.items.get(finding.id)).toBeUndefined();
    expect(await restarted.items.applyFeedback(finding.id, 'dismiss')).toBeUndefined();

    await restarted.settings.patch({ categories: { travel: true }, suggestionScope: 'all' });
    expect(await first.items.get(finding.id)).toMatchObject({ id: finding.id, todoAdded: true });
  }));

  it('defaults pre-existing proactive settings rows to all categories and scope during migration', () => withRollbackDatabase(async (rollbackPool, committed) => {
    const preferenceMigration = committed.find(({ name }) =>
      name === '0063_proactive_suggestion_preferences.sql')!;
    const reverted = await revertNewerThan(rollbackPool, committed, '0061_daily_training_targets.sql');
    expect(reverted.map(({ name }) => name)).toContain(preferenceMigration.name);
    const owner = randomUUID();
    await rollbackPool.request()
      .input('owner', sql.UniqueIdentifier, owner)
      .query(`INSERT dbo.proactive_settings
        (owner_object_id, paused, monthly_budget_dkk, sources_json, news_feeds_json, guidance)
        VALUES (@owner, 1, 42, N'{"calendar":false}', N'[]', N'Existing synthetic settings');`);
    await applyMigrations(rollbackPool, committed);

    const settings = await createProactiveStore(rollbackPool, owner).settings.read();
    expect(settings).toMatchObject({
      paused: true,
      monthlyBudgetDkk: 42,
      sources: { calendar: false },
      categories: defaultProactiveSettings().categories,
      suggestionScope: 'all',
      newsFeeds: [],
      guidance: 'Existing synthetic settings',
    });
    await createProactiveStore(rollbackPool, owner).settings.patch({ categories: { travel: false } });
    await revertNewerThan(rollbackPool, committed, preferenceMigration.name);
    await expect(revertMigration(
      rollbackPool, committed, await readDownMigration(preferenceMigration.name),
    )).rejects.toThrow('retain them before rollback');
    expect((await createProactiveStore(rollbackPool, owner).settings.read()).categories.travel).toBe(false);
  }));

  it('persists add-only todo receipts, enforces the unique added key, and preserves todo-added findings', () => withRollbackDatabase(async (rollbackPool) => {
    const owner = randomUUID();
    const store = createProactiveStore(rollbackPool, owner);
    const receipts = createProactiveTodoReceiptStore(rollbackPool, owner);
    const finding = {
      dedupeKey: '0123456789abcdef0123456789abcdef',
      title: 'Synthetic suggested todo finding',
      body: 'Synthetic evidence.',
      category: 'suggestion' as const,
      urgency: 'normal' as const,
      dueAt: null,
      evidence: [],
      runId: null,
      language: 'en' as const,
    };
    const item = await store.items.upsertFinding(finding);
    await store.items.markTodoAdded([item.id]);
    expect(await store.items.get(item.id)).toMatchObject({ todoAdded: true });
    expect(await store.items.upsertFinding({ ...finding, title: 'Updated synthetic finding' }))
      .toMatchObject({ id: item.id, todoAdded: true });

    const receipt = {
      itemId: item.id,
      dedupeKey: finding.dedupeKey,
      dayKey: '2026-10-18',
      runId: randomUUID(),
      status: 'added' as const,
      reason: null,
      commitSha: 'a'.repeat(40),
    };
    const outcomes = await Promise.all([receipts.insert(receipt), receipts.insert(receipt)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await receipts.countAdded('2026-10-18')).toBe(1);
    expect(await receipts.list([finding.dedupeKey])).toEqual([{
      dedupeKey: finding.dedupeKey, added: true, skipped: false, failedAttempts: 0,
    }]);

    await receipts.insert({ ...receipt, dedupeKey: '1123456789abcdef0123456789abcdef', status: 'failed', reason: 'vault_write_failed', commitSha: null });
    await receipts.insert({ ...receipt, dedupeKey: '1123456789abcdef0123456789abcdef', status: 'failed', reason: 'vault_write_failed', commitSha: null });
    expect(await receipts.list(['1123456789abcdef0123456789abcdef'])).toMatchObject([
      { failedAttempts: 2, added: false, skipped: false },
    ]);
  }));

  it('persists owner-scoped alert ledger attempts and Copenhagen daily sent counts', () => withRollbackDatabase(async (rollbackPool) => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const item = await createProactiveStore(rollbackPool, owner).items.upsertFinding({
      dedupeKey: 'integration:alert-ledger',
      title: 'Synthetic alert finding',
      body: 'Synthetic alert body.',
      category: 'deadline',
      urgency: 'time_critical',
      dueAt: '2026-10-20T12:00:00.000Z',
      evidence: [],
      runId: null,
      language: 'en',
    });
    const ledger = createProactiveAlertStore(rollbackPool, owner);
    const base = {
      alertKey: '0123456789abcdef0123456789abcdef',
      class: 'deadline_24h' as const,
      itemId: item.id,
      runId: randomUUID(),
      dayKey: '2026-10-20',
      status: 'failed' as const,
      reason: 'provider_unavailable',
    };
    expect(await ledger.get(base.alertKey)).toBeUndefined();
    expect(await ledger.upsert(base)).toMatchObject({ attempts: 1, status: 'failed' });
    expect(await ledger.upsert(base)).toMatchObject({ attempts: 2, status: 'failed' });
    expect(await ledger.countSent(base.dayKey)).toBe(0);
    expect(await createProactiveAlertStore(rollbackPool, otherOwner).get(base.alertKey)).toBeUndefined();
    const sent = await ledger.upsert({ ...base, status: 'sent', reason: null });
    expect(sent).toMatchObject({ attempts: 3, status: 'sent', dayKey: base.dayKey });
    expect(await ledger.countSent(base.dayKey)).toBe(1);
    expect(await ledger.get(base.alertKey)).toEqual(sent);
  }));

  it('revises HTML artifacts atomically, retains every version and leaves Workspaces/pins intact', async () => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const store = new WorkspaceHtmlArtifactStore(pool);
    const workspaceItems = new WorkspaceItemsStore(pool);
    const signal = new AbortController().signal;
    const html = '<!doctype html><html><head></head><body>Original</body></html>';
    const sources = [{ title: 'Source', url: 'https://example.com' }];
    const artifact = await store.create(owner, 'Original report', html, sources, signal);
    const workspaceItemId = `html_app:${artifact.id}` as const;
    await workspaceItems.record(owner, {
      id: workspaceItemId, kind: 'html_app', sourceId: artifact.id, title: artifact.title,
      promptSummary: artifact.title, createdAt: artifact.createdAt,
    }, signal);
    await store.setPinned(artifact.id, owner, true, signal);
    await workspaceItems.update(owner, workspaceItemId, { pinned: true }, signal);
    const beforeWorkspaceItem = await workspaceItems.get(owner, workspaceItemId, signal);
    const beforeArtifact = await store.readVersion(artifact.id, owner, signal);

    const revisions = await Promise.all([
      store.update(artifact.id, owner, html.replace('Original', 'Monthly'), signal, 'Monthly report'),
      store.update(artifact.id, owner, html.replace('Original', 'Annual'), signal),
    ]);
    expect(revisions.map((revision) => revision.version).sort()).toEqual([2, 3]);
    for (const revision of revisions) {
      expect(revision).toMatchObject({ id: artifact.id, pinned: true, sources, createdAt: artifact.createdAt });
      expect(revision.id).toBe(revision.id.toLowerCase());
      expect(await store.readVersion(artifact.id, owner, signal, revision.version)).toEqual(revision);
    }
    const historical = await store.readVersion(artifact.id, owner, signal, 1);
    expect(historical).toMatchObject({ id: artifact.id, title: 'Original report', html, sources, version: 1, pinned: true });
    expect(await workspaceItems.get(owner, workspaceItemId, signal)).toEqual(beforeWorkspaceItem);

    const beforeRefusal = await store.readVersion(artifact.id, owner, signal);
    await expect(store.update(artifact.id, otherOwner, html, signal)).rejects.toBeInstanceOf(WorkspaceHtmlArtifactNotFound);
    await expect(store.update(randomUUID(), owner, html, signal)).rejects.toBeInstanceOf(WorkspaceHtmlArtifactNotFound);
    await expect(store.readVersion(artifact.id, otherOwner, signal, 1)).rejects.toBeInstanceOf(WorkspaceHtmlArtifactNotFound);
    await expect(store.update(artifact.id, owner, 'x'.repeat(workspaceHtmlSizeLimit + 1), signal))
      .rejects.toThrow('Invalid workspace HTML artifact');
    expect(await store.readVersion(artifact.id, owner, signal)).toEqual(beforeRefusal);

    const replaced = await store.update(artifact.id, owner, html, signal, undefined, []);
    expect(replaced).toMatchObject({ version: 4, sources: [], pinned: true, title: beforeRefusal.title });
    expect(beforeArtifact.version).toBe(1);
    const history = await pool.request().input('id', sql.UniqueIdentifier, artifact.id)
      .query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.workspace_html_artifact_versions WHERE artifact_id = @id');
    expect(history.recordset[0]?.count).toBe(3);
  });

  it('persists completed weather results with compatible identifiers and blocks destructive rollback', () =>
    withRollbackDatabase(async (rollbackPool, committed) => {
      const store = createBackgroundJobStore(rollbackPool);
      const jobId = randomUUID();
      const at = new Date().toISOString();
      const running = {
        jobId, kind: 'html_app' as const, title: 'Weather in Aarhus', status: 'running' as const,
        step: 0, steps: 3, startedAt: at, updatedAt: at,
      };
      await store.create(running);
      const resultId = `html_app:${randomUUID()}`;
      await expect(store.update({
        ...running, status: 'done', step: 3, viewId: `weather-${jobId.replaceAll('-', '')}`,
        resultId, resultDelivery: 'pending',
      })).resolves.toMatchObject({ status: 'done', resultId, resultDelivery: 'pending' });
      const persisted = await rollbackPool.request().input('id', sql.UniqueIdentifier, jobId)
        .query('SELECT result_workspace_item_id, result_folio_id FROM dbo.background_jobs WHERE job_id = @id;');
      expect(persisted.recordset[0]).toEqual({ result_workspace_item_id: resultId, result_folio_id: resultId });
      await expect(store.updateResultDelivery(jobId, 'delivered'))
        .resolves.toMatchObject({ status: 'done', resultId, resultDelivery: 'delivered' });
      await expect(rollbackPool.request().input('id', sql.UniqueIdentifier, jobId)
        .query("UPDATE dbo.background_jobs SET kind = N'research' WHERE job_id = @id;")).rejects.toThrow();
      const down = await readDownMigration('0072_weather_job_results.sql');
      const newer = await revertNewerThan(rollbackPool, committed, down.name);
      await expect(revertMigration(rollbackPool, committed, down)).rejects.toThrow('Weather job results must be preserved');
      await expect(store.get(jobId)).resolves.toMatchObject({ details: { job: { resultId } } });
      await expect(applyMigrations(rollbackPool, committed)).resolves.toEqual(newer.map(({ name }) => name));
    }));

  it('persists background-job steps, marks interrupted work failed, and prunes after 30 days', async () => {
    const store = createBackgroundJobStore(pool);
    const jobId = randomUUID();
    const startedAt = new Date();
    const running = {
      jobId,
      kind: 'research' as const,
      title: 'Research: SQL persistence',
      status: 'running' as const,
      step: 0,
      steps: 2,
      detail: 'Starting research',
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
    };
    await store.create(running, { topic: 'SQL persistence topic', depth: 'quick' });
    const progressed = {
      ...running,
      step: 1,
      detail: 'Searching: migration',
      updatedAt: new Date(startedAt.getTime() + 1_000).toISOString(),
    };
    await expect(store.update(progressed)).resolves.toMatchObject(progressed);
    expect(await store.list()).toContainEqual(progressed);
    await expect(store.get(jobId)).resolves.toMatchObject({
      details: {
        job: progressed,
        steps: [
          { status: 'running', step: 0, detail: 'Starting research' },
          { status: 'running', step: 1, detail: 'Searching: migration' },
        ],
        retryable: false,
      },
      retryInput: { topic: 'SQL persistence topic', depth: 'quick' },
    });

    const history = await pool.request().input('jobId', sql.NVarChar(36), jobId.toLowerCase())
      .query<{ status: string; step: number }>(`SELECT status, step FROM dbo.background_job_steps
        WHERE job_id = @jobId ORDER BY id;`);
    expect(history.recordset).toEqual([
      { status: 'running', step: 0 },
      { status: 'running', step: 1 },
    ]);

    const interrupted = await store.reconcileInterrupted();
    expect(interrupted).toContainEqual(expect.objectContaining({
      jobId, status: 'failed', detail: 'interrupted by restart',
    }));
    expect(await store.update({ ...progressed, status: 'done', step: 2, viewId: 'research-result' })).toBeNull();
    const failed = await store.get(jobId);
    expect(failed?.details).toMatchObject({
      error: 'interrupted by restart',
      retryable: true,
    });
    expect(failed?.details.steps.at(-1)).toMatchObject({
      status: 'failed', step: 1, detail: 'interrupted by restart',
    });
    const retryCandidates = [randomUUID(), randomUUID()].map((candidateId) => ({
      ...running,
      jobId: candidateId,
      status: 'running' as const,
      step: 0,
      detail: 'Starting research',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const retryResults = await Promise.all(retryCandidates.map((candidate) =>
      store.create(candidate, { topic: 'ignored changed topic', depth: 'deep' }, jobId)));
    expect(retryResults.filter(Boolean)).toHaveLength(1);
    const retriedJob = retryCandidates[retryResults.findIndex(Boolean)]!;
    await expect(store.get(retriedJob.jobId)).resolves.toMatchObject({
      retryInput: { topic: 'SQL persistence topic', depth: 'quick' },
    });
    await expect(store.get(jobId)).resolves.toMatchObject({ details: { retryable: false } });
    await pool.request().input('jobId', sql.NVarChar(36), jobId.toLowerCase()).query(`UPDATE dbo.background_jobs
      SET started_at = DATEADD(day, -31, SYSUTCDATETIME()) WHERE job_id = @jobId;`);
    expect(await store.list()).not.toContainEqual(expect.objectContaining({ jobId }));
    expect((await pool.request().input('jobId', sql.NVarChar(36), jobId.toLowerCase())
      .query('SELECT COUNT(1) AS count FROM dbo.background_job_steps WHERE job_id = @jobId')).recordset[0]?.count).toBe(0);
  });

  it('atomically persists notification messages and deduplication across failure, concurrency and store recreation', async () => {
    const project = await createProjectStore(pool).create({
      name: 'Notification fixture',
      repo: `DanAakesen/notification-${randomUUID()}`,
      default_branch: 'main',
      default_agent: 'copilot',
      policy: 'deliver_pr',
      merge_rules: null,
      sandbox_size: '1x2',
      tech: 'node',
    });
    const task = await createTaskStore(pool, createEventHub<TaskEventMessage>()).create({
      projectId: project.id,
      title: 'Notification fixture',
      request: 'Verify notification deduplication',
    });
    if (!task) throw new Error('Notification fixture task was not created');
    const firstStore = createTaskStatusNotificationStore(pool);
    const restartedStore = createTaskStatusNotificationStore(pool);

    const session = await createConversationStore(pool).createSession({ channel: 'chat', language: 'en' });
    const message = { sessionId: session.id, text: 'Synthetic completion', language: 'en' as const };
    await expect(firstStore.deliver(task.id, 'Done', { ...message, sessionId: '9223372036854775807' })).rejects.toThrow();
    const results = await Promise.all([firstStore.deliver(task.id, 'Done', message), restartedStore.deliver(task.id, 'Done', message)]);
    expect(results.sort()).toEqual([false, true]);
    const written = await pool.request().input('sessionId', sql.BigInt, BigInt(session.id))
      .query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.messages WHERE jarvis_session_id = @sessionId;');
    expect(written.recordset[0]?.count).toBe(1);
    await expect(restartedStore.deliver(task.id, 'Done', message)).resolves.toBe(false);
    await expect(restartedStore.deliver(task.id, 'pull_request_opened', message)).resolves.toBe(true);
    await expect(createTaskStore(pool, createEventHub<TaskEventMessage>())
      .transition(task.id, 'Cancelled')).resolves.toMatchObject({ kind: 'ok' });
  });
  it('retains issue origins and one task per webhook delivery even after completion and store recreation', async () => {
    const project = await createProjectStore(pool).create({ name: 'Issue delivery fixture', repo: `DanAakesen/delivery-${randomUUID()}`,
      default_branch: 'main', default_agent: 'codex', policy: 'deliver_pr', merge_rules: null, sandbox_size: '1x2', tech: 'node' });
    const conversation = createConversationStore(pool);
    const session = await conversation.createSession({ channel: 'chat', language: 'en' });
    const source = (await conversation.addMessage({ sessionId: session.id, role: 'dan', text: 'Synthetic coding request', model: null }))!;
    const first = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const restarted = createTaskStore(pool, createEventHub<TaskEventMessage>());
    await first.rememberIssueOrigin!(project.repo, 8, source.id);
    expect(await restarted.getIssueOrigin!(project.repo, 8)).toBe(source.id);
    const deliveryId = randomUUID();
    const input = { projectId: project.id, title: 'Synthetic issue task', request: 'Synthetic work', issueNumber: 8,
      issueDeliveryId: deliveryId, source: 'chat' as const, originMessageId: source.id };
    const created = await Promise.all([first.create(input), restarted.create(input)]);
    expect(created[0]?.id).toBe(created[1]?.id);
    await pool.request().input('taskId', sql.BigInt, BigInt(created[0]!.id)).query("UPDATE dbo.tasks SET state = N'Done' WHERE id = @taskId;");
    expect(await restarted.findByIssueDelivery!(deliveryId)).toMatchObject({ id: created[0]!.id, state: 'Done', originMessageId: source.id });
    expect(await restarted.create(input)).toMatchObject({ id: created[0]!.id, state: 'Done' });
  });

  it('persists presence modes across store recreation and publishes each transition once', async () => {
    const changedAt = new Date('2026-10-04T12:00:00.000Z');
    const firstStore = createAwayModeStore(pool);
    await firstStore.set('away', 'manual', changedAt);

    const onModeChanged = vi.fn();
    const restartedStore = createAwayModeStore(pool, onModeChanged);
    expect(await restartedStore.read()).toEqual({
      mode: 'away',
      source: 'manual',
      changedAt: changedAt.toISOString(),
    });

    await restartedStore.set('on_the_move', 'jarvis', new Date(changedAt.getTime() + 1));
    expect(await createAwayModeStore(pool).read()).toMatchObject({ mode: 'on_the_move', source: 'jarvis' });
    await restartedStore.set('present', 'manual', new Date(changedAt.getTime() + 2));
    expect(await createAwayModeStore(pool).read()).toMatchObject({ mode: 'present', source: 'manual' });
    expect((await pool.request().query<{ kind: string; title: string }>(
      `SELECT kind, title FROM dbo.activity WHERE area = N'core' ORDER BY id;`,
    )).recordset).toEqual([
      { kind: 'away_mode', title: 'Away mode is on' },
      { kind: 'away_mode', title: 'On the move mode is on' },
      { kind: 'away_mode', title: 'Present mode is on' },
    ]);
    expect(onModeChanged).toHaveBeenCalledTimes(2);
  });

  it('retains source-linked memory across sessions and store restarts, then forgets without deleting sources', async () => {
    const conversations = createConversationStore(pool);
    const firstSession = await conversations.createSession({ channel: 'chat', language: 'en' });
    const firstSource = await conversations.addMessage({
      sessionId: firstSession.id, role: 'dan', text: 'I prefer English for Jarvis.', model: null,
    });
    const secondSession = await conversations.createSession({ channel: 'voice', language: 'da' });
    const secondSource = await conversations.addMessage({
      sessionId: secondSession.id, role: 'dan', text: 'I prefer Danish for voice.', model: null,
    });

    const firstStore = createMemoryStore(pool);
    await firstStore.initialize();
    const vector = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
    const searchSetup = await pool.request().query<{
      fulltext_installed: boolean;
      fulltext_indexed: boolean;
    }>(`DECLARE @fullTextInstalled bit = 0;
      BEGIN TRY
        SET @fullTextInstalled = CASE
          WHEN FULLTEXTSERVICEPROPERTY(N'IsFullTextInstalled') = 1 THEN 1 ELSE 0 END;
      END TRY
      BEGIN CATCH
        SET @fullTextInstalled = 0;
      END CATCH;
      SELECT @fullTextInstalled AS fulltext_installed,
        CONVERT(bit, CASE WHEN EXISTS (
          SELECT 1 FROM sys.fulltext_indexes WHERE object_id = OBJECT_ID(N'dbo.memories')
        ) AND @fullTextInstalled = 1 THEN 1 ELSE 0 END) AS fulltext_indexed;`);
    if (searchSetup.recordset[0]?.fulltext_installed) {
      expect(searchSetup.recordset[0]?.fulltext_indexed).toBe(true);
    }
    const initial = await firstStore.save({
      category: 'preference',
      key: 'language',
      content: 'Dan prefers English for Jarvis.',
      sourceMessageId: firstSource.id,
      embedding: vector,
      embeddingModel: 'text-embedding-3-small',
    }, new AbortController().signal);
    if (firstStore.supportsVectorSearch()) {
      await expect(firstStore.searchByVector(vector, 'text-embedding-3-small', 5, new AbortController().signal))
        .resolves.toEqual([initial.memory]);
      const type = await pool.request().query<{ vector_type: number | null }>(
        `SELECT TYPE_ID(N'vector') AS vector_type;`);
      if (type.recordset[0]?.vector_type === null) {
        const storage = await pool.request().input('memoryId', sql.BigInt, BigInt(initial.memory.id))
          .query<{ embedding_json: string | null }>(
            `SELECT embedding_json FROM dbo.memories WHERE id = @memoryId;`);
        expect(JSON.parse(storage.recordset[0]!.embedding_json!)).toEqual(vector);
      }
    }
    const repeated = await firstStore.save({
      category: 'preference',
      key: 'language',
      content: 'Dan prefers English for Jarvis.',
      sourceMessageId: firstSource.id,
      embedding: null,
      embeddingModel: null,
    }, new AbortController().signal);
    const changed = await firstStore.save({
      category: 'preference',
      key: 'language',
      content: 'Dan prefers Danish for Jarvis voice.',
      sourceMessageId: secondSource.id,
      embedding: null,
      embeddingModel: null,
    }, new AbortController().signal);

    expect(initial).toMatchObject({ created: true, changed: true, memory: { revision: 1 } });
    expect(repeated).toMatchObject({ created: false, changed: false, memory: { revision: 1 } });
    expect(changed).toMatchObject({
      created: false,
      changed: true,
      memory: { id: initial.memory.id, revision: 2, sourceMessageId: secondSource.id },
    });

    const afterRestart = createMemoryStore(pool);
    await afterRestart.initialize();
    const recalled = await afterRestart.list(5, new AbortController().signal);
    expect(recalled.memories).toHaveLength(1);
    expect(recalled.memories[0]).toMatchObject({
      id: initial.memory.id,
      content: 'Dan prefers Danish for Jarvis voice.',
      sourceMessageId: secondSource.id,
      revision: 2,
    });
    const versions = await afterRestart.history(initial.memory.id, 10, new AbortController().signal);
    expect(versions.map(({ revision, sourceMessageId }) => ({ revision, sourceMessageId }))).toEqual([
      { revision: 2, sourceMessageId: secondSource.id },
      { revision: 1, sourceMessageId: firstSource.id },
    ]);

    const forgotten = await afterRestart.forget(
      initial.memory.id, secondSource.id, new AbortController().signal,
    );
    expect(forgotten).toEqual({ category: 'preference', key: 'language' });
    const afterForget = createMemoryStore(pool);
    await afterForget.initialize();
    expect((await afterForget.list(5, new AbortController().signal)).memories).toEqual([]);
    const retainedSources = await pool.request().input('firstId', sql.BigInt, BigInt(firstSource.id))
      .input('secondId', sql.BigInt, BigInt(secondSource.id))
      .query('SELECT COUNT(*) AS count FROM dbo.messages WHERE id IN (@firstId, @secondId) AND role = N\'dan\';');
    expect(retainedSources.recordset[0]?.count).toBe(2);
    const deletionLog = await pool.request().input('memoryId', sql.BigInt, BigInt(initial.memory.id))
      .query('SELECT COUNT(*) AS count FROM dbo.memory_deletions WHERE memory_id = @memoryId;');
    expect(deletionLog.recordset[0]?.count).toBe(1);
  });

  it('persists and ranks vault JSON embeddings on SQL Server without vector support', async () => {
    const store = createVaultIndexStore(pool);
    await store.initialize();
    const queryVector = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
    const otherVector = Array.from({ length: 1536 }, (_, index) => index === 1 ? 1 : 0);
    await store.replaceFile('People/Embedding ranking.md', 'a'.repeat(40), [
      {
        index: 0, heading: 'Orthogonal', content: 'Other vector',
        embedding: otherVector, embeddingModel: 'text-embedding-3-small',
      },
      {
        index: 1, heading: 'Nearest', content: 'Matching vector',
        embedding: queryVector, embeddingModel: 'text-embedding-3-small',
      },
    ], [], new AbortController().signal);

    if (store.supportsVectorSearch()) {
      await expect(store.searchByVector(queryVector, 'text-embedding-3-small', 1, new AbortController().signal)).resolves.toMatchObject([
        { path: 'People/Embedding ranking.md', heading: 'Nearest', content: 'Matching vector' },
      ]);
      const graph = await store.graphData(['People/Embedding ranking.md'], 'text-embedding-3-small', new AbortController().signal);
      const type = await pool.request().query<{ vector_type: number | null }>(
        `SELECT TYPE_ID(N'vector') AS vector_type;`);
      if (type.recordset[0]?.vector_type === null) expect(graph.embeddings).toHaveLength(2);
    }
  });

  it('ignores a concurrently repeated webhook delivery ID', async () => {
    const store = createWebhookDeliveryStore(pool);
    const deliveryId = randomUUID();
    const input = { deliveryId, event: 'push', outcome: 'ok' as const };
    const inserted = await Promise.all([store.record(input), store.record(input)]);
    expect(inserted.sort()).toEqual([false, true]);
    const { recordset } = await pool.request()
      .input('deliveryId', sql.NVarChar(100), deliveryId)
      .query(`SELECT delivery_id AS deliveryId, event, outcome FROM dbo.webhook_deliveries
        WHERE delivery_id = @deliveryId;`);
    expect(recordset).toEqual([{ deliveryId, event: 'push', outcome: 'ok' }]);
  });

  it('maps signed event fields into linked project records and ignores duplicate payload changes', async () => {
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Webhook fixture', N'DanAakesen/webhook-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const { record } = createWebhookDeliveryStore(pool);
    const repo = (await pool.request()
      .input('projectId', sql.Int, projectId)
      .query<{ repo: string }>('SELECT repo FROM dbo.projects WHERE id = @projectId')).recordset[0]!.repo;
    const now = new Date('2026-10-04T12:00:00Z');
    const headSha = 'a'.repeat(40);
    const releaseSha = 'b'.repeat(40);

    await record({
      deliveryId: randomUUID(), event: 'pull_request', outcome: 'ok',
      mapping: {
        kind: 'pull_request', repository: repo, number: 23, branch: 'feature/webhook',
        headSha, state: 'merged', openedAt: now.toISOString(), mergedAt: now.toISOString(),
      },
    });
    await record({
      deliveryId: randomUUID(), event: 'check_run', outcome: 'ok',
      mapping: {
        kind: 'check_run', repository: repo, headSha, pullRequestNumbers: [23],
        status: 'completed', conclusion: 'success',
      },
    });
    const pushDeliveryId = randomUUID();
    await record({
      deliveryId: pushDeliveryId, event: 'push', outcome: 'ok',
      mapping: { kind: 'push', repository: repo, ref: 'refs/heads/main', sha: releaseSha, at: now.toISOString() },
    });
    await record({
      deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok',
      mapping: {
        kind: 'workflow_run', repository: repo, id: 1_900_000_000_001, name: 'Release', event: 'push',
        branch: 'main', headSha: releaseSha, runNumber: 7, pullRequestNumbers: [23],
        status: 'completed', conclusion: 'success',
        startedAt: now.toISOString(), completedAt: now.toISOString(),
      },
    });
    await record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok',
      mapping: {
        kind: 'deployment_status', repository: repo, id: 1_900_000_000_002, sha: releaseSha,
        environment: 'production', status: 'success', at: now.toISOString(),
      },
    });
    await expect(record({
      deliveryId: pushDeliveryId, event: 'push', outcome: 'ok',
      mapping: { kind: 'push', repository: repo, ref: 'refs/heads/main', sha: headSha, at: now.toISOString() },
    })).resolves.toBe(false);

    const prs = await pool.request().input('projectId', sql.Int, projectId)
      .query(`SELECT number, branch, head_sha AS headSha, state, checks, opened_at AS openedAt, merged_at AS mergedAt
        FROM dbo.pull_requests WHERE project_id = @projectId;`);
    expect(prs.recordset).toEqual([{
      number: 23, branch: 'feature/webhook', headSha, state: 'merged', checks: 'passed', openedAt: now, mergedAt: now,
    }]);
    const runs = await pool.request().input('projectId', sql.Int, projectId)
      .query(`SELECT github_run_id AS runId, workflow, [trigger], status, conclusion, pull_request_id AS pullRequestId,
        release_id AS releaseId FROM dbo.workflow_runs WHERE project_id = @projectId;`);
    expect(runs.recordset).toEqual([{
      runId: '1900000000001', workflow: 'Release', trigger: 'push', status: 'completed', conclusion: 'success',
      pullRequestId: '1', releaseId: '1',
    }]);
    const releases = await pool.request().input('projectId', sql.Int, projectId)
      .query(`SELECT version, sha, status FROM dbo.releases WHERE project_id = @projectId;`);
    expect(releases.recordset).toEqual([{ version: '7', sha: releaseSha, status: 'released' }]);
    const deployments = await pool.request()
      .input('releaseId', sql.Int, releases.recordset.length ? runs.recordset[0]!.releaseId : null)
      .query(`SELECT github_deployment_id AS deploymentId, environment, status FROM dbo.deployments
        WHERE release_id = @releaseId;`);
    expect(deployments.recordset).toEqual([
      { deploymentId: '1900000000002', environment: 'production', status: 'success' },
    ]);
  });

  it('links a release workflow and deployment delivered before the main push', async () => {
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Out-of-order release fixture', N'DanAakesen/release-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const { record } = createWebhookDeliveryStore(pool);
    const repo = (await pool.request()
      .input('projectId', sql.Int, projectId)
      .query<{ repo: string }>('SELECT repo FROM dbo.projects WHERE id = @projectId')).recordset[0]!.repo;
    const sha = 'c'.repeat(40);
    const at = '2026-10-04T12:00:00.000Z';

    await record({
      deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok',
      mapping: {
        kind: 'workflow_run', repository: repo, id: 1_900_000_000_003, name: 'Release', event: 'push',
        branch: 'main', headSha: sha, runNumber: 8, pullRequestNumbers: [],
        status: 'completed', conclusion: 'success', startedAt: at, completedAt: at,
      },
    });
    await record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok',
      mapping: {
        kind: 'deployment_status', repository: repo, id: 1_900_000_000_004, sha,
        environment: 'production', status: 'success', at,
      },
    });
    await record({
      deliveryId: randomUUID(), event: 'push', outcome: 'ok',
      mapping: { kind: 'push', repository: repo, ref: 'refs/heads/main', sha, at },
    });

    const { recordset: releases } = await pool.request()
      .input('projectId', sql.Int, projectId)
      .input('sha', sql.Char(40), sha)
      .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.releases
        WHERE project_id = @projectId AND sha = @sha;`);
    expect(releases).toEqual([{ count: 1 }]);

    const { recordset } = await pool.request()
      .input('projectId', sql.Int, projectId)
      .input('sha', sql.Char(40), sha)
      .query(`SELECT r.version, r.status, CAST(r.id AS varchar(19)) AS releaseId,
          CAST(w.release_id AS varchar(19)) AS runReleaseId,
          CAST(d.release_id AS varchar(19)) AS deploymentReleaseId
        FROM dbo.releases AS r
        LEFT JOIN dbo.workflow_runs AS w ON w.project_id = r.project_id AND w.head_sha = r.sha
        LEFT JOIN dbo.deployments AS d ON d.release_id = r.id
        WHERE r.project_id = @projectId AND r.sha = @sha;`);
    expect(recordset).toHaveLength(1);
    expect(recordset[0]).toMatchObject({ version: '8', status: 'released' });
    expect(recordset[0]?.runReleaseId).toBe(recordset[0]?.releaseId);
    expect(recordset[0]?.deploymentReleaseId).toBe(recordset[0]?.releaseId);
  });

  it('orders task events by numeric id across a digit boundary', async () => {
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Ordering fixture', N'DanAakesen/order-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const store = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const task = (await store.create({ projectId: String(projectId), title: 'Ordering', request: 'Run' }))!;
    // Reseed just below the next power of ten so the new ids change digit count.
    const maxId = Number((await pool.request().query<{ maxId: string }>(`SELECT CAST(COALESCE(MAX(id), 0) AS varchar(19)) AS maxId FROM dbo.task_events;`)).recordset[0]!.maxId);
    const reseed = 10 ** String(Math.max(maxId, 10)).length - 3;
    await pool.request().query(`DBCC CHECKIDENT ('dbo.task_events', RESEED, ${String(reseed)}) WITH NO_INFOMSGS;`);
    const recorded: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      recorded.push((await store.recordEvent({ taskId: task.id, type: 'agent_turn', payload: { index }, source: 'runner' })).id);
    }
    expect(recorded.some((id) => id.length !== recorded[0]!.length)).toBe(true);
    await pool.request().query(`UPDATE dbo.task_events SET at = SYSUTCDATETIME() WHERE task_id = ${task.id};`);
    const sorted = [...recorded].sort((left, right) => Number(left) - Number(right));

    const after = await store.getEventsAfter(task.id, String(Number(sorted[0]) - 1), 6);
    expect(after.map((event) => event.id)).toEqual(sorted);
    const detail = await store.get(task.id, 50, 0);
    expect(detail!.events.map((event) => event.id).filter((id) => recorded.includes(id))).toEqual(sorted);
    expect((await store.transition(task.id, 'Cancelled')).kind).toBe('ok');
  });
  it('reads running tasks and categorized activity and persists dismissals', async () => {
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Now feed fixture', N'DanAakesen/now-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const tasks = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const running = await tasks.create({ projectId: String(projectId), title: 'Running feed task', request: 'Run' });
    const needsAttention = await tasks.create({
      projectId: String(projectId), title: 'Attention feed task', request: 'Run',
    });
    if (!running || !needsAttention) throw new Error('Now feed fixture tasks were not created');
    expect((await tasks.transition(running.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(needsAttention.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(needsAttention.id, 'NeedsAttention')).kind).toBe('ok');
    // Each task event has an activity row; a shared timestamp makes id the deterministic tie-breaker.
    await pool.request().query(`DECLARE @attentionAt datetime2(7) = DATEADD(day, 1, SYSUTCDATETIME());
      UPDATE dbo.activity SET at = @attentionAt
      WHERE area = N'factory' AND link = N'task:${needsAttention.id}';`);
    const attentionActivity = await pool.request().query<{ id: string }>(`SELECT TOP (1)
      CAST(a.id AS varchar(19)) AS id FROM dbo.activity AS a
      WHERE a.area = N'factory' AND a.link = N'task:${needsAttention.id}'
      ORDER BY a.at DESC, a.id DESC;`);
    const attentionActivityId = attentionActivity.recordset[0]?.id;
    if (!attentionActivityId) throw new Error('Now feed attention activity was not created');

    const releaseId = await scalar(`INSERT dbo.activity (area, kind, title, link)
      VALUES (N'github', N'release_published', N'Release feed fixture', N'release:7');
      UPDATE dbo.activity SET at = DATEADD(day, 1, SYSUTCDATETIME()) WHERE id = SCOPE_IDENTITY()`);
    const credentialId = await scalar(`INSERT dbo.activity (area, kind, title, link)
      VALUES (N'operations', N'credential_expiring', N'Credential feed fixture', NULL);
      UPDATE dbo.activity SET at = DATEADD(day, 1, SYSUTCDATETIME()) WHERE id = SCOPE_IDENTITY()`);
    const store = createNowFeedStore(pool);

    const initial = await store.read();
    expect((await tasks.transition(running.id, 'Cancelled')).kind).toBe('ok');
    expect((await tasks.transition(needsAttention.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(needsAttention.id, 'Cancelled')).kind).toBe('ok');
    expect(initial.items.length).toBeLessThanOrEqual(100);
    expect(initial.items.map((item) => item.category)).not.toContain('mode');
    expect(initial.items.map((item) => item.at)).toEqual(
      [...initial.items].map((item) => item.at).sort((left, right) => right.localeCompare(left)),
    );
    expect(initial.running).toContainEqual(expect.objectContaining({
      id: running.id,
      title: 'Running feed task',
      project: 'Now feed fixture',
      agent: 'copilot',
      startedAt: expect.any(String),
    }));
    expect(initial.items).toContainEqual(expect.objectContaining({
      id: attentionActivityId,
      category: 'attention',
      title: expect.any(String),
      link: `task:${needsAttention.id}`,
    }));
    expect(initial.items).toContainEqual(expect.objectContaining({
      id: String(releaseId), category: 'release', title: 'Release feed fixture', link: 'release:7',
    }));
    expect(initial.items).toContainEqual(expect.objectContaining({
      id: String(credentialId), category: 'credential', title: 'Credential feed fixture', link: null,
    }));

    expect(await store.dismiss(String(releaseId))).toBe(true);
    expect((await store.read()).items.some((item) => item.id === String(releaseId))).toBe(false);
    expect(await store.dismiss('9223372036854775807')).toBe(false);
  });

  it('keeps a dismissed policy reason dismissed across engine restarts and concurrent evaluations', async () => {
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Restart policy fixture', N'DanAakesen/restart-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'complete_without_deployment', N'1x2', N'node')`);
    const tasks = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const task = await tasks.create({ projectId: String(projectId), title: 'Restart policy task', request: 'Run' });
    if (!task) throw new Error('Restart policy task was not created');
    expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
    await pool.request().query(`INSERT dbo.pull_requests
      (task_id, project_id, number, branch, head_sha, state, checks, opened_at)
      VALUES (${task.id}, ${projectId}, 42, N'jarvis/task-${task.id}', N'${'a'.repeat(40)}',
        N'open', N'failed', SYSUTCDATETIME());`);
    const errors: unknown[] = [];
    const engine = () => createProjectPolicyEvaluator({
      store: createProjectPolicyStore(pool),
      tasks: createTaskStore(pool, createEventHub<TaskEventMessage>()),
      tokenIssuer: { issueForRepositoryRead: async () => 'fixture' } as unknown as GitHubAppTokenIssuer,
      fetch: vi.fn(async () => new Response('{}')),
      onError: (error) => errors.push(error),
    });
    const counts = async () => (await pool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.task_events WHERE task_id = ${task.id}) AS events,
      (SELECT COUNT(*) FROM dbo.activity WHERE link = N'task:${task.id}') AS activity;`)).recordset[0];
    const feed = createNowFeedStore(pool);
    const first = engine();
    await first.recheckProject(String(projectId));
    await first.stop();
    const latest = (await feed.read()).items.find((item) => item.link === `task:${task.id}`);
    expect(latest).toMatchObject({ title: 'Recorded GitHub checks are not green.' });
    if (!latest) throw new Error('Restart policy activity was not created');
    expect(await feed.dismiss(latest.id)).toBe(true);
    const originalCounts = await counts();
    const restarted = engine();
    const overlapping = engine();
    try {
      await Promise.all([
        restarted.recheckProject(String(projectId)),
        overlapping.recheckProject(String(projectId)),
      ]);
      expect(await counts()).toEqual(originalCounts);
      expect((await feed.read()).items.some((item) => item.link === `task:${task.id}`)).toBe(false);
      expect((await pool.request().query(`SELECT dismissed_at FROM dbo.activity
        WHERE id = ${latest.id};`)).recordset[0]?.dismissed_at).toBeInstanceOf(Date);

      await pool.request().query(`UPDATE dbo.pull_requests SET checks = N'pending' WHERE task_id = ${task.id};`);
      await Promise.all([
        restarted.recheckProject(String(projectId)),
        overlapping.recheckProject(String(projectId)),
      ]);
      expect(await counts()).toEqual({ events: originalCounts.events + 1, activity: originalCounts.activity + 1 });
      const changed = (await feed.read()).items.find((item) => item.link === `task:${task.id}`);
      expect(changed).toMatchObject({ title: 'GitHub pull request state could not be verified.' });
      if (!changed) throw new Error('Changed policy activity was not created');
      expect(await feed.dismiss(changed.id)).toBe(true);
      expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
      expect((await tasks.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
      const beforeRecheck = await counts();
      await Promise.all([
        restarted.recheckProject(String(projectId)),
        overlapping.recheckProject(String(projectId)),
      ]);
      expect(await counts()).toEqual({ events: beforeRecheck.events + 1, activity: beforeRecheck.activity + 1 });
      expect((await feed.read()).items).toContainEqual(expect.objectContaining({
        link: `task:${task.id}`, title: 'GitHub pull request state could not be verified.',
      }));
      expect(errors).toEqual([]);
    } finally {
      await restarted.stop();
      await overlapping.stop();
    }
  });

  it('preserves dismissed bridge status on identical concurrent writes and raises real changes', async () => {
    const changed = vi.fn();
    const first = createPcBridgeStatusStore(pool, changed);
    const restarted = createPcBridgeStatusStore(pool, changed);
    await first.setStatus(false);
    const status = async () => (await pool.request().query(`SELECT
      CONVERT(varchar(19), id) AS id, title, at, dismissed_at
      FROM dbo.activity WHERE alert_key = N'pc_bridge_status';`)).recordset[0];
    const initial = await status();
    const feed = createNowFeedStore(pool);
    expect(await feed.dismiss(initial.id)).toBe(true);
    const dismissed = await status();
    await Promise.all([first.setStatus(false), restarted.setStatus(false)]);
    expect(await status()).toEqual(dismissed);
    expect((await feed.read()).items.some((item) => item.id === initial.id)).toBe(false);
    await restarted.setStatus(true);
    expect(await status()).toMatchObject({
      id: initial.id, title: 'Local PC bridge is online — Jarvis control is active', dismissed_at: null,
    });
    expect((await feed.read()).items.some((item) => item.id === initial.id)).toBe(true);
    await feed.dismiss(initial.id);
    await first.setStatus(true, true);
    expect(await status()).toMatchObject({
      id: initial.id, title: 'Local PC bridge is online — Jarvis control is paused', dismissed_at: null,
    });
    await feed.dismiss(initial.id);
    await restarted.setStatus(false);
    expect(await status()).toMatchObject({
      id: initial.id, title: 'Local PC bridge is offline', dismissed_at: null,
    });
  });

  it('records each alert condition once and returns it in the Now feed', async () => {
    const alertNotifier = vi.fn();
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Alert fixture', N'DanAakesen/alert-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const repo = (await pool.request()
      .input('projectId', sql.Int, projectId)
      .query<{ repo: string }>('SELECT repo FROM dbo.projects WHERE id = @projectId')).recordset[0]!.repo;
    const sha = 'd'.repeat(40);
    const releaseId = await scalar(`INSERT dbo.releases (project_id, version, sha, status, created_at)
      VALUES (${projectId}, N'1', N'${sha}', N'deploying', SYSUTCDATETIME())`);
    const deploymentStore = createWebhookDeliveryStore(pool, alertNotifier);
    const failedDeployment = {
      kind: 'deployment_status' as const, repository: repo, id: 1_900_000_000_099, sha,
      environment: 'production', status: 'failure' as const, at: new Date().toISOString(),
    };
    await deploymentStore.record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok', mapping: failedDeployment,
    });
    await deploymentStore.record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok', mapping: failedDeployment,
    });
    expect(alertNotifier).toHaveBeenCalledExactlyOnceWith({
      type: 'deployment_failure',
      dedupeKey: `deployment:${projectId}:${createHash('sha256').update('environment:production').digest('hex')}:${failedDeployment.id}`,
      title: 'Deployment failed: production',
      link: `release:${releaseId}`,
    });

    const tasks = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const task = await tasks.create({ projectId: String(projectId), title: 'Crash fixture', request: 'Run' });
    if (!task) throw new Error('Alert fixture task was not created');
    expect((await tasks.transition(task.id, 'Running')).kind).toBe('ok');
    const sandboxId = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, size, image, status, agent_name)
      VALUES (${task.id}, N'alert-${randomUUID()}', N'1', N'1x2', N'node', N'Active', N'jarvis-runner-node-1x2')`);
    const heartbeatStore = createSandboxHeartbeatStore(
      pool,
      createEventHub<TaskEventMessage>(),
      alertNotifier,
    );
    await expect(heartbeatStore.markNeedsAttention(String(sandboxId))).resolves.toBe('crashed');
    await expect(heartbeatStore.markNeedsAttention(String(sandboxId))).resolves.toBe(false);
    expect(alertNotifier).toHaveBeenCalledTimes(2);

    const credentialStore = createCredentialStatusStore(pool, { alertNotifier });
    const expiry = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    await credentialStore.updateCopilotStatus('renew_soon', expiry, new Date().toISOString());
    await credentialStore.updateCopilotStatus('renew_soon', expiry, new Date().toISOString());
    expect(alertNotifier).toHaveBeenCalledTimes(3);

    const refreshed = vi.fn();
    const budgetAlerts = createAlertActivityStore(pool, refreshed);
    const octoberBudgetAlert = {
      type: 'budget_threshold' as const,
      dedupeKey: 'budget-80:2026-10',
      title: 'Monthly Azure budget reached 80%',
      link: null,
    };
    const novemberBudgetAlert = { ...octoberBudgetAlert, dedupeKey: 'budget-80:2026-11' };
    await expect(budgetAlerts.record(octoberBudgetAlert)).resolves.toBe(true);
    await expect(budgetAlerts.record(octoberBudgetAlert)).resolves.toBe(false);
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () => budgetAlerts.record(novemberBudgetAlert)),
    );
    expect(concurrentResults.filter(Boolean)).toHaveLength(1);
    const restartedBudgetAlerts = createAlertActivityStore(pool, refreshed);
    await expect(restartedBudgetAlerts.record(novemberBudgetAlert)).resolves.toBe(false);
    expect(refreshed).toHaveBeenCalledTimes(2);

    const octoberActivity = (await pool.request()
      .input('dedupeKey', sql.NVarChar(200), octoberBudgetAlert.dedupeKey)
      .query<{ id: string }>('SELECT CAST(id AS varchar(19)) AS id FROM dbo.activity WHERE alert_key = @dedupeKey'))
      .recordset[0];
    if (!octoberActivity) throw new Error('October budget alert was not persisted');
    await expect(createNowFeedStore(pool).dismiss(octoberActivity.id)).resolves.toBe(true);
    await expect(restartedBudgetAlerts.record(octoberBudgetAlert)).resolves.toBe(false);
    const budgetHistory = await pool.request().query<{ alerts: number; dismissed: number }>(`SELECT
      COUNT(*) AS alerts,
      SUM(CASE WHEN alert_key = N'budget-80:2026-10' AND dismissed_at IS NOT NULL THEN 1 ELSE 0 END) AS dismissed
      FROM dbo.activity WHERE alert_key IN (N'budget-80:2026-10', N'budget-80:2026-11');`);
    expect(budgetHistory.recordset[0]).toEqual({ alerts: 2, dismissed: 1 });

    const feed = await createNowFeedStore(pool).read();
    expect(feed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'alert', title: 'Deployment failed: production', link: `release:${releaseId}` }),
      expect.objectContaining({ category: 'alert', title: 'Sandbox crashed', link: `task:${task.id}` }),
      expect.objectContaining({ category: 'alert', title: `copilot-token expires ${expiry.slice(0, 10)}`, link: null }),
      expect.objectContaining({ category: 'alert', title: 'Monthly Azure budget reached 80%', link: null }),
    ]));
  });

  it('keeps board, plan and CI runs in history without deployment effects, and never fails cancelled deploys', async () => {
    const repo = `DanAakesen/workflow-${randomUUID().slice(0, 8)}`;
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Workflow fixture', N'${repo}', N'main', N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const sha = 'e'.repeat(40);
    const releaseId = await scalar(`INSERT dbo.releases (project_id, version, sha, status, created_at)
      VALUES (${projectId}, N'1', N'${sha}', N'deploying', SYSUTCDATETIME())`);
    const notifier = vi.fn();
    const store = createWebhookDeliveryStore(pool, notifier);
    let id = 1_900_000_001_000;
    for (const [file, result, initial, expected] of [
      ['project-board.yml', 'failure', 'deploying', 'deploying'],
      ['plan-status.yml', 'failure', 'deploying', 'deploying'],
      ['ci.yml', 'failure', 'deploying', 'deploying'],
      ['release.yml', 'failure', 'deploying', 'deploying'],
      ['deploy.yml', 'cancelled', 'deploying', 'deploying'],
      ['deploy.yml', 'cancelled', 'failed', 'failed'],
      ['deploy.yml', 'failure', 'deploying', 'failed'],
    ]) {
      await pool.request().input('status', sql.NVarChar(16), initial)
        .query(`UPDATE dbo.releases SET status = @status WHERE id = ${releaseId}`);
      const mapping = mapGithubWebhook('workflow_run', {
        repository: { full_name: repo },
        workflow_run: {
          id: ++id, name: file === 'release.yml' ? 'Release' : file,
          path: `.github/workflows/${file}`, event: 'push', head_branch: 'main',
          head_sha: sha, run_number: 1, status: 'completed', conclusion: result,
        },
      });
      if (!mapping) throw new Error('Workflow mapping fixture was not created');
      await store.record({ deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok', mapping });
      expect((await pool.request().query(`SELECT status FROM dbo.releases WHERE id = ${releaseId}`)).recordset)
        .toEqual([{ status: expected }]);
    }
    expect((await pool.request().query(`SELECT COUNT(*) AS count FROM dbo.workflow_runs
      WHERE project_id = ${projectId}`)).recordset).toEqual([{ count: 7 }]);
    expect(notifier).not.toHaveBeenCalled();
  });

  it('collapses failures for the same project workflow over a rolling hour, including dismissed alerts', async () => {
    const repo = `DanAakesen/collapse-${randomUUID().slice(0, 8)}`;
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Collapse fixture', N'${repo}', N'main', N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const sha = 'f'.repeat(40);
    const releaseId = await scalar(`INSERT dbo.releases (project_id, version, sha, status, created_at)
      VALUES (${projectId}, N'1', N'${sha}', N'deploying', SYSUTCDATETIME())`);
    const notifier = vi.fn();
    const store = createWebhookDeliveryStore(pool, notifier);
    const workflow = {
      kind: 'workflow_run' as const, repository: repo, id: 1_900_000_002_000, name: 'Deploy',
      deploymentWorkflow: true, event: 'push', branch: 'main', headSha: sha, runNumber: 1,
      pullRequestNumbers: [], status: 'completed' as const, conclusion: 'failure' as const,
      startedAt: null, completedAt: null,
    };
    const deployment = {
      kind: 'deployment_status' as const, repository: repo, id: 1_900_000_003_000, sha,
      environment: 'production', status: 'failure' as const, at: new Date().toISOString(),
      workflowRunId: workflow.id,
    };
    const recordDeployment = async (id: number, workflowRunId = workflow.id) => {
      await store.record({
        deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok',
        mapping: { ...deployment, id, workflowRunId, workflowId: workflowRunId === workflow.id + 1 ? 200 : 100 },
      });
    };
    await recordDeployment(deployment.id);
    await store.record({ deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok', mapping: workflow });
    await pool.request().query(`UPDATE dbo.activity SET at = DATEADD(minute, -59, SYSUTCDATETIME()),
      dismissed_at = SYSUTCDATETIME() WHERE link = N'release:${releaseId}'`);
    await store.record({
      deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok',
      mapping: { ...workflow, id: workflow.id + 10 },
    });
    await recordDeployment(deployment.id + 1, workflow.id + 10);
    expect(notifier).toHaveBeenCalledTimes(1);
    await pool.request().query(`UPDATE dbo.activity SET at = DATEADD(minute, -61, SYSUTCDATETIME())
      WHERE link = N'release:${releaseId}'`);
    await recordDeployment(deployment.id + 1, workflow.id + 10);
    expect(notifier).toHaveBeenCalledTimes(1);
    await Promise.all([recordDeployment(deployment.id + 2), recordDeployment(deployment.id + 3)]);
    expect(notifier).toHaveBeenCalledTimes(2);
    await store.record({
      deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok',
      mapping: { ...workflow, id: workflow.id + 1, name: 'Deploy staging' },
    });
    await recordDeployment(deployment.id + 4, workflow.id + 1);
    expect(notifier).toHaveBeenCalledTimes(3);
    await store.record({
      deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok',
      mapping: { ...workflow, id: workflow.id + 2, conclusion: 'cancelled' },
    });
    await pool.request().query(`UPDATE dbo.releases SET status = N'deploying' WHERE id = ${releaseId}`);
    await recordDeployment(deployment.id + 5, workflow.id + 2);
    expect(notifier).toHaveBeenCalledTimes(3);
    expect((await pool.request().query(`SELECT status FROM dbo.releases WHERE id = ${releaseId}`)).recordset)
      .toEqual([{ status: 'deploying' }]);
    expect((await pool.request().query(`SELECT COUNT(*) AS count FROM dbo.deployments
      WHERE release_id = ${releaseId}`)).recordset).toEqual([{ count: 5 }]);
    expect((await pool.request().query(`SELECT COUNT(*) AS count FROM dbo.activity
      WHERE link = N'release:${releaseId}'`)).recordset).toEqual([{ count: 3 }]);
    await pool.request().query(`INSERT dbo.activity (area, kind, title, link, alert_key)
      VALUES (N'operations', N'deployment_failure', N'Deployment failed: production',
        N'release:${releaseId}', N'deployment:${deployment.id + 6}')`);
    await recordDeployment(deployment.id + 6);
    expect(notifier).toHaveBeenCalledTimes(3);
    const otherRepo = `DanAakesen/other-${randomUUID().slice(0, 8)}`;
    await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Other deployment fixture', N'${otherRepo}', N'main', N'copilot', N'deliver_pr', N'1x2', N'node')`);
    await store.record({
      deliveryId: randomUUID(), event: 'workflow_run', outcome: 'ok',
      mapping: { ...workflow, repository: otherRepo, id: workflow.id + 20 },
    });
    await store.record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok',
      mapping: {
        ...deployment, repository: otherRepo, id: deployment.id + 20, workflowRunId: workflow.id + 20, workflowId: 100,
      },
    });
    expect(notifier).toHaveBeenCalledTimes(4);
    const suppressedWithoutRelease = {
      ...deployment, repository: otherRepo, id: deployment.id + 21, workflowRunId: workflow.id + 20, workflowId: 100,
    };
    await store.record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok', mapping: suppressedWithoutRelease,
    });
    await pool.request().query(`UPDATE dbo.activity SET at = DATEADD(minute, -61, SYSUTCDATETIME())
      WHERE link LIKE N'project:%' AND title = N'Deployment failed: production'`);
    await store.record({
      deliveryId: randomUUID(), event: 'deployment_status', outcome: 'ok', mapping: suppressedWithoutRelease,
    });
    expect(notifier).toHaveBeenCalledTimes(4);
  });

  it('dismisses only historical board deployment failures, preserving data and owner dismissals', async () => {
    const link = `cleanup:${randomUUID()}`;
    await pool.request().input('link', sql.NVarChar(100), link).query(`INSERT dbo.activity
      (area, kind, title, link, dismissed_at) VALUES
      (N'operations', N'deployment_failure', N'Deployment failed: project-board', @link, NULL),
      (N'operations', N'deployment_failure', N'Deployment failed: project-board', @link, '2026-10-01'),
      (N'operations', N'deployment_failure', N'Deployment failed: production', @link, NULL),
      (N'factory', N'task_event', N'Deployment failed: project-board', @link, NULL)`);
    const cleanup = (await readMigrations()).find((migration) =>
      migration.name === '0024_dismiss_board_deployment_failures.sql');
    if (!cleanup) throw new Error('Cleanup migration missing');
    const dismissal = cleanup.sql.slice(cleanup.sql.indexOf('UPDATE dbo.activity'));
    await pool.request().batch(dismissal);
    await pool.request().batch(dismissal);
    const { recordset } = await pool.request().input('link', sql.NVarChar(100), link)
      .query<{ dismissedAt: Date | null }>(`SELECT dismissed_at AS dismissedAt FROM dbo.activity
        WHERE link = @link ORDER BY id`);
    expect(recordset).toHaveLength(4);
    expect(recordset[0]?.dismissedAt).toBeInstanceOf(Date);
    expect(recordset[1]?.dismissedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(recordset[2]?.dismissedAt).toBeNull();
    expect(recordset[3]?.dismissedAt).toBeNull();
  });

  it('stores valid records across the committed schema', async () => {
    await pool.request().query(`INSERT dbo.settings (scope, [key], value) VALUES
      (N'global', N'jarvis.model', N'"gpt-5.6-luna"'), (N'project:1', N'voice.en.voice', N'{"name":"Ryan"}'),
      (N'project:12', N'agent.reasoning-effort', N'null')`);
    const session = await scalar("INSERT dbo.jarvis_sessions (channel, language) VALUES (N'chat', N'en')");
    const message = await scalar(`INSERT dbo.messages (jarvis_session_id, role, text, model, input_tokens, output_tokens)
      VALUES (${String(session)}, N'jarvis', N'On it.', N'gpt-5.6-luna', 10, 2)`);
    const project = await scalar(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Jarvis', N'DanAakesen/jarvis', N'main', N'codex', N'deliver_pr', N'1x2', N'node')`);
    await pool.request().query(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech, max_parallel_tasks, active)
      VALUES (N'Web', N'Dan-Aakesen/my-site.web_1', N'release/v1', N'copilot', N'complete_without_deployment', N'2x4', N'dotnet-8', 3, 0)`);
    const task = await scalar(`INSERT dbo.tasks (project_id, origin_message_id, title, request, source, agent)
      VALUES (${String(project)}, ${String(message)}, N'Fix it', N'Fix the bug', N'chat', N'codex')`);
    await pool.request().query(`INSERT dbo.tool_calls (message_id, tool, arguments, result, outcome, task_id)
      VALUES (${String(message)}, N'create_task', N'{"title":"Fix it"}', N'{"id":${String(task)}}', N'ok', ${String(task)}),
      (${String(message)}, N'list-tasks', N'{}', N'[]', N'error', NULL);
      INSERT dbo.task_events (task_id, type, summary, payload, source) VALUES (${String(task)}, N'created', N'Created', N'{}', N'backend');
      INSERT dbo.activity (area, kind, title, link) VALUES (N'factory', N'task_done', N'Fix it is done', N'task:${String(task)}');
      UPDATE dbo.tasks SET state = N'Running', lease_owner = N'dispatcher-1', lease_until = DATEADD(minute, 5, SYSUTCDATETIME()) WHERE id = ${String(task)};`);
    const sandboxSession = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status, started_at, cost_estimate_dkk)
      VALUES (${String(task)}, N'foundry-session-1', N'1', N'jarvis-runner-base-1x2', N'1x2', N'jarvis-runner:latest',
        N'Active', DATEADD(minute, -15, SYSUTCDATETIME()), 0)`);
    await pool.request().query(`INSERT dbo.sandbox_turns
      (sandbox_session_id, invocation_id, mode, acp_session_id, status)
      VALUES (${String(sandboxSession)}, N'invocation-1', N'task', N'acp-session-1', N'running');
      INSERT dbo.artifacts (task_id, kind, blob_path, size_bytes)
      VALUES (${String(task)}, N'log', N'tasks/1/log.txt', 12);
      INSERT dbo.webhook_deliveries (delivery_id, event)
      VALUES (N'delivery-1', N'push');
      UPDATE dbo.webhook_deliveries SET outcome = N'ok', processed_at = SYSUTCDATETIME()
      WHERE delivery_id = N'delivery-1';
      UPDATE dbo.credential_status SET expires_at = SYSUTCDATETIME(),
        last_renewed_at = SYSUTCDATETIME(), status = N'ok' WHERE name = N'codex-login';`);
    const taskStore = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const activeUsageDetail = await taskStore.get(String(task), 100, 0);
    expect(activeUsageDetail?.usage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'sandbox', metric: 'minutes', sandboxSessionId: String(sandboxSession), estimated: true,
      }),
    ]));
    const dispatcherStore = createDispatcherStore(pool, createEventHub<TaskEventMessage>());
    await dispatcherStore.endTaskSessions(String(task), 'Done');
    const sandboxUsage = await pool.request()
      .input('sessionId', sql.BigInt, BigInt(sandboxSession))
      .query<{ quantity: number; costDkk: number }>(`SELECT quantity, cost_dkk AS costDkk FROM dbo.usage
        WHERE sandbox_session_id = @sessionId AND source = N'sandbox' AND metric = N'minutes';`);
    expect(sandboxUsage.recordset).toHaveLength(1);
    expect(sandboxUsage.recordset[0]?.quantity).toBeGreaterThan(14.99);
    expect(sandboxUsage.recordset[0]?.quantity).toBeLessThan(15.1);
    expect(sandboxUsage.recordset[0]?.costDkk).toBeGreaterThan(0.22);
    expect(sandboxUsage.recordset[0]?.costDkk).toBeLessThan(0.23);

    const turn = {
      invocationId: 'usage-invocation', eventIndex: 1, data: { agent: 'codex' },
    };
    await taskStore.recordEvent({ taskId: String(task), type: 'agent_turn', payload: turn, source: 'runner' });
    await taskStore.recordEvent({ taskId: String(task), type: 'agent_turn', payload: turn, source: 'runner' });
    await taskStore.recordEvent({
      taskId: String(task),
      type: 'completed',
      source: 'runner',
      payload: {
        invocationId: 'usage-invocation',
        eventIndex: 8,
        data: { result: { response: { usage: { input_tokens: 123, output_tokens: 45, premium_requests: 1 } } } },
      },
    });
    await taskStore.recordEvent({
      taskId: String(task),
      type: 'acp_notification',
      source: 'runner',
      payload: {
        invocationId: 'usage-invocation',
        eventIndex: 9,
        data: { params: { usage: { inputTokens: 124 } } },
      },
    });
    const usageDetail = await taskStore.get(String(task), 100, 0);
    expect(usageDetail?.usage).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'sandbox', metric: 'minutes', sandboxSessionId: String(sandboxSession) }),
      expect.objectContaining({ source: 'codex', metric: 'turns', quantity: 1 }),
      expect.objectContaining({ source: 'codex', metric: 'input_tokens', quantity: 247 }),
      expect.objectContaining({ source: 'codex', metric: 'output_tokens', quantity: 45 }),
      expect.objectContaining({ source: 'codex', metric: 'premium_requests', quantity: 1 }),
    ]));
    const row = await pool.request().query<{ state: string; priority: number; attempt_count: number }>(
      `SELECT state, priority, attempt_count FROM dbo.tasks WHERE id = ${String(task)}`);
    expect(row.recordset).toEqual([{ state: 'Running', priority: 0, attempt_count: 0 }]);
    await pool.request().query(`UPDATE dbo.tasks SET state = N'Done', finished_at = SYSUTCDATETIME()
      WHERE id = ${String(task)};`);
  });

  it('recovers a scoped mint alert and re-alerts only for a new incident', async () => {
    const alertNotifier = vi.fn();
    const onAlert = vi.fn();
    const credentials = createCredentialStatusStore(pool, { alertNotifier, onAlert });
    const scopeKey = createHash('sha256').update(randomUUID()).digest('hex');
    await credentials.updateGitHubAppStatus('ok', '2040-01-01T00:00:00.000Z', scopeKey);
    await Promise.all([
      credentials.updateGitHubAppStatus('failed', '2040-01-01T01:00:00.000Z', scopeKey),
      credentials.updateGitHubAppStatus('failed', '2040-01-01T01:00:00.000Z', scopeKey),
    ]);
    await credentials.updateGitHubAppStatus('failed', '2040-01-01T02:00:00.000Z', scopeKey);
    expect((await credentials.list()).find((row) => row.name === 'github-app')).toEqual({
      name: 'github-app', status: 'failed', expiresAt: null,
      lastRenewedAt: '2040-01-01T00:00:00.000Z', lastCheckedAt: '2040-01-01T02:00:00.000Z',
    });
    expect(alertNotifier).toHaveBeenCalledOnce();
    expect(onAlert).toHaveBeenCalledOnce();
    const { recordset: firstIncident } = await pool.request()
      .input('scopeKey', sql.Char(64), scopeKey)
      .query<{ id: string; title: string; dismissedAt: Date | null; recoveredAt: Date | null }>(`SELECT
        CAST(id AS varchar(19)) AS id, title, dismissed_at AS dismissedAt, recovered_at AS recoveredAt
        FROM dbo.activity WHERE github_app_scope_key = @scopeKey;`);
    expect(firstIncident).toHaveLength(1);
    expect(firstIncident[0]?.title).toContain('GitHub App token mint failed');

    const restartedCredentials = createCredentialStatusStore(pool, { alertNotifier, onAlert });
    const feed = createNowFeedStore(pool);
    const incidentItem = (await feed.read()).items.find((item) => item.title.includes('GitHub App token mint failed'));
    expect(incidentItem).toBeDefined();
    expect(await feed.dismiss(incidentItem!.id)).toBe(true);
    await restartedCredentials.updateGitHubAppStatus('ok', '2040-01-01T03:00:00.000Z', scopeKey);
    await restartedCredentials.updateGitHubAppStatus('failed', '2040-01-01T04:00:00.000Z', scopeKey);
    await restartedCredentials.updateGitHubAppStatus('failed', '2040-01-01T03:30:00.000Z', scopeKey);
    expect((await credentials.list()).find((row) => row.name === 'github-app')?.status).toBe('failed');
    const { recordset: incidents } = await pool.request()
      .input('scopeKey', sql.Char(64), scopeKey)
      .query<{ dismissedAt: Date | null; recoveredAt: Date | null }>(`SELECT dismissed_at AS dismissedAt,
        recovered_at AS recoveredAt FROM dbo.activity WHERE github_app_scope_key = @scopeKey ORDER BY id;`);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({ dismissedAt: expect.any(Date), recoveredAt: expect.any(Date) });
    expect(incidents[1]).toMatchObject({ dismissedAt: null, recoveredAt: null });
    const activeItems = (await feed.read()).items.filter((item) =>
      item.title.includes('GitHub App token mint failed'));
    expect(activeItems).toHaveLength(1);
    await credentials.updateGitHubAppStatus('ok', '2040-01-01T05:00:00.000Z', scopeKey);
    expect(alertNotifier).toHaveBeenCalledTimes(2);
  });

  it('keeps aggregate health truthful across scopes and leaves legacy alerts unresolved', async () => {
    const credentials = createCredentialStatusStore(pool);
    const scopeA = createHash('sha256').update(randomUUID()).digest('hex');
    const scopeB = createHash('sha256').update(randomUUID()).digest('hex');
    const legacyKey = `credential:github-app:failed:legacy-test:${randomUUID()}`;
    try {
      await pool.request()
        .input('alertKey', sql.NVarChar(200), legacyKey)
        .query(`INSERT dbo.activity (area, kind, title, alert_key)
          VALUES (N'operations', N'credential_expiry', N'Legacy GitHub App mint failure', @alertKey);`);
      await Promise.all([
        credentials.updateGitHubAppStatus('failed', '2041-01-01T00:00:00.000Z', scopeA),
        credentials.updateGitHubAppStatus('failed', '2041-01-01T00:00:00.000Z', scopeB),
      ]);
      await credentials.updateGitHubAppStatus('ok', '2041-01-01T01:00:00.000Z', scopeA);
      expect((await credentials.list()).find((row) => row.name === 'github-app')?.status).toBe('failed');
      let visible = (await createNowFeedStore(pool).read()).items
        .filter((item) => item.title.includes('GitHub App token mint failed') || item.title.includes('Legacy GitHub App'));
      expect(visible).toHaveLength(2);

      await credentials.updateGitHubAppStatus('ok', '2041-01-01T02:00:00.000Z', scopeB);
      expect((await credentials.list()).find((row) => row.name === 'github-app')?.status).toBe('unknown');
      visible = (await createNowFeedStore(pool).read()).items
        .filter((item) => item.title.includes('GitHub App token mint failed') || item.title.includes('Legacy GitHub App'));
      expect(visible.map((item) => item.title)).toEqual(['Legacy GitHub App mint failure']);
      const legacy = await pool.request()
        .input('alertKey', sql.NVarChar(200), legacyKey)
        .query<{ scopeKey: string | null; recoveredAt: Date | null }>(`SELECT github_app_scope_key AS scopeKey,
          recovered_at AS recoveredAt FROM dbo.activity WHERE alert_key = @alertKey;`);
      expect(legacy.recordset).toEqual([{ scopeKey: null, recoveredAt: null }]);
      await credentials.updateGitHubAppStatus('ok', '2041-01-01T03:00:00.000Z', scopeA);
      expect((await credentials.list()).find((row) => row.name === 'github-app')?.status).toBe('unknown');
    } finally {
      await pool.request().input('alertKey', sql.NVarChar(200), legacyKey)
        .query('DELETE dbo.activity WHERE alert_key = @alertKey;');
      await pool.request()
        .input('scopeA', sql.Char(64), scopeA)
        .input('scopeB', sql.Char(64), scopeB)
        .query(`DELETE dbo.github_app_mint_status WHERE scope_key IN (@scopeA, @scopeB);
          UPDATE dbo.credential_status SET status = N'unknown', last_checked_at = NULL, last_renewed_at = NULL
          WHERE name = N'github-app';`);
    }
  });

  it('serializes Codex starts against renewal acquisition and recovers expired leases', async () => {
    const project = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/credentials-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Credential lease fixture', @repo, N'main', N'codex', N'deliver_pr', N'1x2', N'node');`);
    const projectId = project.recordset[0]?.id;
    if (!projectId) throw new Error('Credential lease project was not created');

    const tasks = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const credentials = createCredentialStatusStore(pool);
    const runningCodex = await tasks.create({ projectId, title: 'Codex active', request: 'Run', agent: 'codex' });
    if (!runningCodex) throw new Error('Codex task was not created');
    expect((await tasks.transition(runningCodex.id, 'Running')).kind).toBe('ok');

    const owner = randomUUID();
    expect(await credentials.acquireCodexRenewalLease(owner, 900)).toBe(false);
    expect((await tasks.transition(runningCodex.id, 'PauseRequested')).kind).toBe('ok');
    expect((await tasks.transition(runningCodex.id, 'Paused')).kind).toBe('ok');
    expect(await credentials.acquireCodexRenewalLease(owner, 900)).toBe(true);

    const blockedCodex = await tasks.create({ projectId, title: 'Codex blocked', request: 'Wait', agent: 'codex' });
    if (!blockedCodex) throw new Error('Blocked Codex task was not created');
    expect((await tasks.transition(blockedCodex.id, 'Running')).kind).toBe('renewal-active');
    const allowedCopilot = await tasks.create({ projectId, title: 'Copilot allowed', request: 'Run', agent: 'copilot' });
    if (!allowedCopilot) throw new Error('Copilot task was not created');
    expect((await tasks.transition(allowedCopilot.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(allowedCopilot.id, 'Cancelled')).kind).toBe('ok');

    await credentials.completeCodexRenewal(
      owner, 'ok', '2030-01-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z',
    );
    expect((await tasks.transition(blockedCodex.id, 'Running')).kind).toBe('ok');
    await credentials.updateCopilotStatus(
      'renew_soon', '2026-10-05T12:00:00.000Z', '2026-10-01T12:00:00.000Z',
    );
    expect(await credentials.list()).toEqual([
      {
        name: 'codex-login', status: 'ok',
        expiresAt: '2030-01-01T00:00:00.000Z', lastRenewedAt: '2026-10-03T00:00:00.000Z',
        lastCheckedAt: expect.any(String),
      },
      {
        name: 'copilot-token', status: 'renew_soon',
        expiresAt: '2026-10-05T12:00:00.000Z', lastRenewedAt: '2026-10-01T12:00:00.000Z',
        lastCheckedAt: expect.any(String),
      },
      { name: 'github-app', status: 'unknown', expiresAt: null, lastRenewedAt: null, lastCheckedAt: null },
    ]);
    expect((await tasks.transition(blockedCodex.id, 'PauseRequested')).kind).toBe('ok');
    expect((await tasks.transition(blockedCodex.id, 'Paused')).kind).toBe('ok');

    await pool.request()
      .input('owner', sql.UniqueIdentifier, owner)
      .query(`UPDATE dbo.credential_status SET renewal_lease_owner = @owner,
        renewal_lease_until = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE name = N'codex-login';`);
    const recoveredOwner = randomUUID();
    expect(await credentials.acquireCodexRenewalLease(recoveredOwner, 900)).toBe(true);
    await credentials.completeCodexRenewal(recoveredOwner, 'failed', null, null);
    const failedCredentialTask = await tasks.create({
      projectId, title: 'Blocked by failed credential', request: 'Wait', agent: 'codex',
    });
    if (!failedCredentialTask) throw new Error('Failed-credential task was not created');
    expect((await tasks.transition(failedCredentialTask.id, 'Running')).kind).toBe('credential-unavailable');

    const repairedOwner = randomUUID();
    expect(await credentials.acquireCodexRenewalLease(repairedOwner, 900)).toBe(true);
    await credentials.completeCodexRenewal(repairedOwner, 'ok', null, null);
    expect((await tasks.transition(failedCredentialTask.id, 'Running')).kind).toBe('ok');
    expect((await tasks.transition(failedCredentialTask.id, 'PauseRequested')).kind).toBe('ok');
    expect((await tasks.transition(failedCredentialTask.id, 'Paused')).kind).toBe('ok');
  });

  it('projects recorded PR, check and usage data without inventing missing values', async () => {
    const repository = `DanAakesen/summary-${randomUUID().slice(0, 8)}`;
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Summary fixture', N'${repository}', N'main', N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const store = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const task = (await store.create({ projectId: String(projectId), title: 'Recorded data', request: 'Run' }))!;
    const empty = (await store.create({ projectId: String(projectId), title: 'No data', request: 'Run' }))!;
    await store.recordEvent({
      taskId: task.id, type: 'pull_request_opened', source: 'backend',
      payload: { pullRequest: 2, url: `https://github.com/${repository}/pull/2` },
    });
    expect(await store.get(task.id, 1, 0)).toMatchObject({
      pullRequest: { number: 2, url: `https://github.com/${repository}/pull/2`, state: null },
      checks: null, checkConclusion: null, usageSummary: null,
    });
    const prId = await scalar(`INSERT dbo.pull_requests
      (task_id, project_id, number, branch, head_sha, state, checks, opened_at)
      VALUES (${task.id}, ${projectId}, 3, N'jarvis/task-${task.id}', N'${'a'.repeat(40)}',
        N'closed', N'failed', SYSUTCDATETIME())`);
    await pool.request().query(`INSERT dbo.workflow_runs
      (project_id, github_run_id, workflow, [trigger], head_sha, pull_request_id, status, conclusion, started_at, completed_at)
      VALUES (${projectId}, 99, N'CI', N'pull_request', N'${'a'.repeat(40)}', ${prId},
        N'completed', N'failure', DATEADD(minute, -2, SYSUTCDATETIME()), DATEADD(minute, -1, SYSUTCDATETIME())),
        (${projectId}, 100, N'CI', N'pull_request', N'${'a'.repeat(40)}', ${prId},
        N'completed', N'cancelled', SYSUTCDATETIME(), SYSUTCDATETIME());
      INSERT dbo.usage (task_id, project_id, source, metric, quantity, cost_dkk)
      VALUES (${task.id}, ${projectId}, N'codex', N'input_tokens', 100, NULL),
        (${task.id}, ${projectId}, N'codex', N'input_tokens', 23, NULL),
        (${task.id}, ${projectId}, N'codex', N'output_tokens', 45, NULL),
        (${task.id}, ${projectId}, N'jarvis_model', N'input_tokens', 10, 0.25);`);
    const expected = {
      pullRequest: { number: 3, url: `https://github.com/${repository}/pull/3`, state: 'closed' },
      checks: 'failed', checkConclusion: 'cancelled',
      usageSummary: { inputTokens: 133, outputTokens: 45, costDkk: 0.25 },
    };
    const listed = await store.list({ projectId: String(projectId), limit: 100, offset: 0 });
    expect(listed.find((item) => item.id === task.id)).toMatchObject(expected);
    expect(listed.find((item) => item.id === empty.id)).toMatchObject({
      pullRequest: null, checks: null, checkConclusion: null, usageSummary: null,
    });
    expect(await store.get(task.id, 1, 100)).toMatchObject(expected);
    await pool.request().query(`UPDATE dbo.usage SET cost_dkk = NULL WHERE task_id = ${task.id};`);
    expect(await store.get(task.id, 1, 0)).toMatchObject({ usageSummary: { costDkk: null } });
    const archived = createTaskStore(pool, createEventHub<TaskEventMessage>(),
      createTaskEventArchive(pool, createMemoryArchiveBlobStore().blobs));
    expect(await archived.get(task.id, 1, 0)).toMatchObject({ ...expected, usageSummary: { ...expected.usageSummary, costDkk: null } });
    await pool.request().query(`UPDATE dbo.tasks SET state = N'Cancelled' WHERE project_id = ${projectId};`);
  });

  it('retries failed starts atomically, resets dispatch attempts, and refuses sandbox history', async () => {
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Retry fixture', N'DanAakesen/retry-${randomUUID().slice(0, 8)}', N'main',
        N'copilot', N'deliver_pr', N'1x2', N'node')`);
    const hub = createEventHub<TaskEventMessage>();
    const published: TaskEventMessage[] = [];
    hub.subscribe((event) => published.push(event));
    const store = createTaskStore(pool, hub);
    const task = (await store.create({
      projectId: String(projectId), title: 'Retry start', request: 'Run', priority: 2_147_483_647,
    }))!;
    const dispatcher = createDispatcherStore(pool, hub);
    const claim = await dispatcher.claimNext('retry-fixture', 120, 3);
    if (claim.kind !== 'claimed' || claim.task.taskId !== task.id) {
      throw new Error('Retry fixture was not claimed');
    }
    await store.transition(task.id, 'Running');
    await dispatcher.failStart('retry-fixture', claim.task, null, 'foundry_start_rejected');
    await pool.request().query(`UPDATE dbo.tasks SET attempt_count = 3,
      next_attempt_at = DATEADD(hour, 1, SYSUTCDATETIME()) WHERE id = ${task.id};`);
    published.length = 0;
    const results = await Promise.all([store.retry(task.id), store.retry(task.id)]);
    expect(results.map((result) => result.kind).sort()).toEqual(['invalid-transition', 'ok']);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'state_changed', source: 'dan',
      payload: { from: 'NeedsAttention', to: 'Ready', reason: 'start_retry', previousAttemptCount: 3 },
    });
    const persisted = await store.get(task.id, 100, 0);
    expect(persisted).toMatchObject({
      state: 'Ready', attemptCount: 0, nextAttemptAt: null, startedAt: null,
      branch: claim.task.branch,
    });
    expect(persisted?.events.filter((event) => event.source === 'dan')).toHaveLength(1);
    expect((await store.retry('9223372036854775807')).kind).toBe('not-found');
    expect((await store.retry(task.id)).kind).toBe('invalid-transition');
    const claimedAgain = await dispatcher.claimNext('retry-again', 120, 3);
    expect(claimedAgain).toMatchObject({ kind: 'claimed', task: { taskId: task.id, attemptCount: 1 } });
    if (claimedAgain.kind !== 'claimed') throw new Error('Retry was not dispatchable');
    await dispatcher.failStart('retry-again', claimedAgain.task, null, 'credential_unavailable');
    const sessionId = await scalar(`DECLARE @sessionAt datetime2(7) = SYSUTCDATETIME();
      INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, size, image, status, started_at, ended_at, end_reason)
      VALUES (${task.id}, N'retry-${randomUUID()}', N'1', N'1x2', N'node', N'Ended',
        @sessionAt, @sessionAt, N'crashed')`);
    expect((await store.retry(task.id)).kind).toBe('invalid-transition');
    await pool.request().query(`DELETE dbo.sandbox_sessions WHERE id = ${sessionId};`);
    await pool.request().query(`UPDATE dbo.tasks SET attempt_count = 0 WHERE id = ${task.id};`);
    expect((await store.retry(task.id)).kind).toBe('invalid-transition');
    await pool.request().query(`UPDATE dbo.tasks SET attempt_count = 1 WHERE id = ${task.id};`);
    await pool.request().query(`UPDATE dbo.tasks SET lease_owner = N'retry-fixture',
      lease_until = DATEADD(hour, 1, SYSUTCDATETIME())
      WHERE id = ${task.id};`);
    expect((await store.retry(task.id)).kind).toBe('invalid-transition');
    await pool.request().query(`UPDATE dbo.tasks SET lease_owner = NULL, lease_until = NULL WHERE id = ${task.id};`);
    const uncertain = (await store.create({
      projectId: String(projectId), title: 'Unknown start outcome', request: 'Run',
    }))!;
    await pool.request().query(`UPDATE dbo.tasks SET state = N'NeedsAttention', attempt_count = 1
      WHERE id = ${uncertain.id};`);
    expect((await store.retry(uncertain.id)).kind).toBe('invalid-transition');
    for (const reason of ['foundry_start_failed', 'dispatch_lease_expired']) {
      await store.recordEvent({
        taskId: uncertain.id, type: 'state_changed', source: 'backend', payload: { reason },
      });
      expect((await store.retry(uncertain.id)).kind).toBe('invalid-transition');
    }
    await pool.request().query(`INSERT dbo.task_event_archives
      (task_id, first_at, first_event_id, blob_name, event_count)
      VALUES (${task.id}, SYSUTCDATETIME(), 1, N'retry-archived-fixture', 1);`);
    expect((await store.retry(task.id)).kind).toBe('invalid-transition');
    await pool.request().query(`DELETE dbo.task_event_archives WHERE task_id = ${task.id};`);
    await store.recordEvent({
      taskId: task.id, type: 'state_changed', source: 'backend',
      payload: { reason: 'session_persistence_failed' },
    });
    expect((await store.retry(task.id)).kind).toBe('invalid-transition');
  });

  it('creates, filters, reads and transitions tasks with transactional history', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/tasks-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Task API fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Task API fixture project was not created');
    const store = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const created = await store.create({ projectId, title: 'Task API contract', request: 'Exercise SQL task operations' });
    expect(created).toMatchObject({ projectId, agent: 'copilot', source: 'board', state: 'Ready' });
    if (!created) throw new Error('Task API fixture task was not created');
    const chatSessionId = await scalar("INSERT dbo.jarvis_sessions (channel, language) VALUES (N'chat', N'en')");
    const messageId = await scalar(`INSERT dbo.messages (jarvis_session_id, role, text, model)
      VALUES (${chatSessionId}, N'dan', N'Create a project', NULL)`);
    const chatTask = await store.create({
      projectId,
      title: 'Chat-created project scaffold',
      request: 'Scaffold from chat',
      source: 'chat',
      originMessageId: String(messageId),
    });
    expect(chatTask).toMatchObject({ source: 'chat', originMessageId: String(messageId) });
    if (!chatTask) throw new Error('Chat-created task fixture was not created');
    expect(await store.get(chatTask.id, 10, 0)).toMatchObject({
      events: [{ type: 'created', summary: 'Task created from chat' }],
    });
    expect((await store.transition(chatTask.id, 'Cancelled')).kind).toBe('ok');
    let idleOperationRan = false;
    expect(await store.withNoActiveTasks(async () => { idleOperationRan = true; }))
      .toEqual({ kind: 'active' });
    expect(idleOperationRan).toBe(false);

    expect(await store.list({
      projectId, agent: 'copilot', state: 'Ready', search: 'contract',
      limit: 10, offset: 0,
    })).toEqual([{ ...created, pullRequest: null, checks: null, checkConclusion: null, usageSummary: null }]);
    expect(await store.get(created.id, 10, 0)).toMatchObject({
      id: created.id,
      events: [{ type: 'created', payload: { state: 'Ready' }, source: 'backend' }],
    });
    await pool.request()
      .input('taskId', sql.BigInt, BigInt(created.id))
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ data: 'x'.repeat(3_000) }))
      .query('UPDATE dbo.task_events SET payload = @payload WHERE task_id = @taskId AND type = N\'created\';');
    expect(await store.get(created.id, 10, 0)).toMatchObject({
      events: [{ payload: null, payloadTruncated: true }],
    });

    const transition = async (id: string, state: 'Running' | 'PauseRequested' | 'Paused' | 'NeedsAttention' | 'Done' | 'Cancelled', verified = false) => {
      const result = await store.transition(id, state, verified);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error(`Unexpected transition result: ${result.kind}`);
      expect(result.task.state).toBe(state);
    };

    expect((await store.transition(created.id, 'Done')).kind).toBe('invalid-transition');
    await transition(created.id, 'Running');
    const foundrySessionId = 'session-active-task';
    await pool.request()
      .input('taskId', sql.BigInt, BigInt(created.id))
      .input('sessionId', sql.NVarChar(255), foundrySessionId)
      .query(`INSERT dbo.sandbox_sessions
        (task_id, foundry_session_id, agent_version, size, image, status)
        VALUES (@taskId, @sessionId, N'runner', N'1x2', N'runner', N'Active');`);
    expect(await store.getActiveRepository(created.id, foundrySessionId)).toBe(
      (await pool.request().input('id', sql.BigInt, BigInt(projectId))
        .query<{ repo: string }>('SELECT repo FROM dbo.projects WHERE id = @id;')).recordset[0]?.repo,
    );
    expect(await store.getActiveRepository(created.id, 'other-session')).toBeNull();
    await transition(created.id, 'PauseRequested');
    expect(await store.getActiveRepository(created.id, foundrySessionId)).not.toBeNull();
    await transition(created.id, 'Paused');
    expect(await store.getActiveRepository(created.id, foundrySessionId)).toBeNull();
    await transition(created.id, 'Running');
    await pool.request()
      .input('taskId', sql.BigInt, BigInt(created.id))
      .input('longSummary', sql.NVarChar(2_000), 'x'.repeat(450))
      .query(`INSERT dbo.task_events (task_id, type, summary, source) VALUES
        (@taskId, N'progress', N'First progress', N'runner'),
        (@taskId, N'progress', N'Second progress', N'runner'),
        (@taskId, N'progress', N'Third progress', N'runner'),
        (@taskId, N'progress', @longSummary, N'runner');`);
    const context = await store.getRunningContext();
    const runningTask = context.runningTasks.find(({ id }) => id === created.id);
    expect(context.truncated).toBe(false);
    expect(runningTask).toMatchObject({
      projectId,
      projectName: 'Task API fixture',
      title: 'Task API contract',
      state: 'Running',
      recentEvents: [
        { summary: 'x'.repeat(400), summaryTruncated: true },
        { summary: 'Third progress', summaryTruncated: false },
        { summary: 'Second progress', summaryTruncated: false },
      ],
    });
    await transition(created.id, 'NeedsAttention');
    await transition(created.id, 'Running');
    await transition(created.id, 'Done', true);
    expect((await store.transition(created.id, 'Running')).kind).toBe('invalid-transition');
    await expect(store.withNoActiveTasks(async () => 'scale updated'))
      .resolves.toEqual({ kind: 'idle', value: 'scale updated' });

    const readyCancel = await store.create({ projectId, title: 'Cancel ready', request: 'Cancel before start' });
    if (!readyCancel) throw new Error('Ready task fixture was not created');
    await transition(readyCancel.id, 'Cancelled');

    const runningCancel = await store.create({ projectId, title: 'Cancel running', request: 'Cancel while running' });
    if (!runningCancel) throw new Error('Running task fixture was not created');
    await transition(runningCancel.id, 'Running');
    await transition(runningCancel.id, 'Cancelled');

    const pausedCancel = await store.create({ projectId, title: 'Cancel paused', request: 'Cancel while paused' });
    if (!pausedCancel) throw new Error('Paused task fixture was not created');
    await transition(pausedCancel.id, 'Running');
    await transition(pausedCancel.id, 'PauseRequested');
    await transition(pausedCancel.id, 'Paused');
    await transition(pausedCancel.id, 'Cancelled');

    await pool.request().input('projectId', sql.BigInt, BigInt(projectId))
      .query('UPDATE dbo.projects SET active = 0 WHERE id = @projectId;');
    expect(await store.create({ projectId, title: 'Archived project', request: 'Must not be queued' })).toBeNull();
  });

  it('persists events and activity together, then publishes committed events within one second', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/events-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Event pipeline fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Event pipeline fixture project was not created');

    const hub = createEventHub<TaskEventMessage>();
    const delivered: TaskEventMessage[] = [];
    hub.subscribe((event) => delivered.push(event));
    const store = createTaskStore(pool, hub);
    const task = await store.create({ projectId, title: 'Event pipeline', request: 'Test persistence and publication' });
    if (!task) throw new Error('Event pipeline fixture task was not created');

    const startedAt = performance.now();
    const runnerEvent = await store.recordEvent({
      taskId: task.id,
      type: 'files_changed',
      summary: 'Changed source files',
      payload: { files: ['src/app.ts'] },
      source: 'runner',
    });
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(runnerEvent).toMatchObject({ taskId: task.id, type: 'files_changed', source: 'runner' });
    expect((await store.transition(task.id, 'Running')).kind).toBe('ok');
    expect(delivered.map(({ type }) => type)).toEqual(['created', 'files_changed', 'state_changed']);
    expect(delivered.map(({ taskId }) => taskId)).toEqual([task.id, task.id, task.id]);
    expect(await store.getEventsAfter(task.id, delivered[0]!.id, 1)).toEqual([runnerEvent]);
    expect(await store.getEventsAfter(task.id, runnerEvent.id, 1)).toMatchObject([
      { id: delivered[2]!.id, taskId: task.id, type: 'state_changed' },
    ]);
    expect(await store.getEventsAfter(task.id, delivered[2]!.id, 1)).toEqual([]);

    await expect(store.recordEvent({
      taskId: '9223372036854775807',
      type: 'files_changed',
      source: 'runner',
    })).rejects.toThrow('Task event persistence failed');
    await expect(store.recordEvent({
      taskId: task.id,
      type: 'files_changed\n',
      source: 'runner',
    })).rejects.toThrow('Invalid task event');
    await expect(store.recordEvent({
      taskId: task.id,
      type: 'files_changed',
      payload: 'x'.repeat(1024 * 1024 - 1),
      source: 'runner',
    })).rejects.toThrow('Invalid task event payload');
    expect(delivered).toHaveLength(3);

    const eventRows = await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
      .query<{ type: string }>('SELECT type FROM dbo.task_events WHERE task_id = @taskId ORDER BY id;');
    const activityRows = await pool.request().input('link', sql.NVarChar(100), `task:${task.id}`)
      .query<{ kind: string; title: string }>(
        'SELECT kind, title FROM dbo.activity WHERE link = @link ORDER BY id;');
    expect(eventRows.recordset.map(({ type }) => type)).toEqual(['created', 'files_changed', 'state_changed']);
    expect(activityRows.recordset).toEqual([
      { kind: 'created', title: 'Task created from the board' },
      { kind: 'files_changed', title: 'Changed source files' },
      { kind: 'state_changed', title: 'Task state changed' },
    ]);
  });

  it('includes the recorded pull request URL in later attention and completion events', async () => {
    const project = await createProjectStore(pool).create({
      name: 'Task status fixture',
      repo: `DanAakesen/task-status-${randomUUID()}`,
      default_branch: 'main',
      default_agent: 'copilot',
      policy: 'deliver_pr',
      merge_rules: null,
      sandbox_size: '1x2',
      tech: 'node',
    });
    const hub = createEventHub<TaskEventMessage>();
    const events: TaskEventMessage[] = [];
    hub.subscribe((event) => events.push(event));
    const store = createTaskStore(pool, hub);
    const task = await store.create({
      projectId: project.id,
      title: 'Task status fixture',
      request: 'Retain the pull request link',
    });
    if (!task) throw new Error('Task status fixture was not created');
    const url = 'https://github.com/DanAakesen/jarvis/pull/42';

    await store.recordEvent({
      taskId: task.id,
      type: 'pull_request_opened',
      payload: { url },
      source: 'backend',
    });
    await store.transition(task.id, 'Running');
    await store.recordEvent({ taskId: task.id, type: 'disk_low', source: 'runner' });
    await store.transition(task.id, 'Done', true);

    expect(events.filter((event) => event.type === 'state_changed').map((event) => event.payload))
      .toEqual([
        { from: 'Ready', to: 'Running' },
        { from: 'Running', to: 'NeedsAttention', reason: 'disk_low', pullRequestUrl: url },
        { from: 'NeedsAttention', to: 'Done', pullRequestUrl: url },
      ]);
  });

  it('moves a running task to NeedsAttention atomically when runner disk is low', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/disk-low-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Disk low fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Disk low fixture project was not created');

    const hub = createEventHub<TaskEventMessage>();
    const delivered: TaskEventMessage[] = [];
    hub.subscribe((event) => delivered.push(event));
    const store = createTaskStore(pool, hub);
    const task = await store.create({ projectId, title: 'Disk low fixture', request: 'Exercise low disk handling' });
    if (!task) throw new Error('Disk low fixture task was not created');
    expect((await store.transition(task.id, 'Running')).kind).toBe('ok');
    const eventsBeforeLowDisk = delivered.length;

    const lowDiskEvent = await store.recordEvent({
      taskId: task.id,
      type: 'disk_low',
      summary: 'Writable disk is below the configured threshold',
      payload: { disk_total_bytes: 6 * 1024 ** 3, disk_free_bytes: 512 * 1024 ** 2, threshold_bytes: 1024 ** 3 },
      source: 'runner',
    });

    expect(lowDiskEvent.type).toBe('disk_low');
    expect(delivered.slice(eventsBeforeLowDisk).map(({ type }) => type)).toEqual(['disk_low', 'state_changed']);
    const detail = await store.get(task.id, 20, 0);
    expect(detail?.state).toBe('NeedsAttention');
    expect(detail?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'state_changed',
        payload: { from: 'Running', to: 'NeedsAttention', reason: 'disk_low' },
      }),
    ]));

    await store.recordEvent({
      taskId: task.id,
      type: 'disk_low',
      summary: 'Writable disk remains below the configured threshold',
      payload: { disk_free_bytes: 512 * 1024 ** 2, threshold_bytes: 1024 ** 3 },
      source: 'runner',
    });
    expect(delivered.slice(eventsBeforeLowDisk).map(({ type }) => type)).toEqual([
      'disk_low', 'state_changed', 'disk_low',
    ]);
  });

  it('archives old events only after Blob upload and restores paged task history', async () => {
    const projectResult = await pool.request()
      .input('repo', sql.NVarChar(140), `DanAakesen/archive-${randomUUID().slice(0, 8)}`)
      .query<{ id: string }>(`INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
        OUTPUT CAST(inserted.id AS varchar(19)) AS id
        VALUES (N'Task event archive fixture', @repo, N'main', N'copilot', N'deliver_pr', N'1x2', N'node');`);
    const projectId = projectResult.recordset[0]?.id;
    if (!projectId) throw new Error('Task event archive project was not created');

    const blobStore = createMemoryArchiveBlobStore();
    const archive = createTaskEventArchive(pool, blobStore.blobs);
    const store = createTaskStore(pool, createEventHub<TaskEventMessage>(), archive);
    const task = await store.create({ projectId, title: 'Archive task events', request: 'Test archive and restore' });
    if (!task) throw new Error('Task event archive fixture was not created');

    await pool.request()
      .input('taskId', sql.BigInt, BigInt(task.id))
      .input('firstAt', sql.DateTime2(7), new Date('2020-01-01T00:00:00.000Z'))
      .input('secondAt', sql.DateTime2(7), new Date('2020-01-02T00:00:00.000Z'))
      .query(`INSERT dbo.task_events (task_id, type, summary, payload, source, at) VALUES
        (@taskId, N'archived_first', N'First archived event', N'{"archived":true}', N'backend', @firstAt),
        (@taskId, N'archived_second', N'Second archived event', N'{"archived":true}', N'runner', @secondAt);`);

    const cutoff = new Date('2021-01-01T00:00:00.000Z');
    blobStore.failUploads(true);
    await expect(archive.archiveExpiredEvents(cutoff)).rejects.toThrow('Blob storage unavailable');
    const retained = await pool.request()
      .input('taskId', sql.BigInt, BigInt(task.id))
      .input('cutoff', sql.DateTime2(7), cutoff)
      .query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.task_events WHERE task_id = @taskId AND at < @cutoff;');
    expect(retained.recordset[0]?.count).toBe(2);

    blobStore.failUploads(false);
    await expect(archive.archiveExpiredEvents(cutoff)).resolves.toBe(2);
    await expect(archive.archiveExpiredEvents(cutoff)).resolves.toBe(0);
    const remaining = await pool.request().input('taskId', sql.BigInt, BigInt(task.id))
      .query<{ type: string }>('SELECT type FROM dbo.task_events WHERE task_id = @taskId ORDER BY at, id;');
    expect(remaining.recordset.map(({ type }) => type)).toEqual(['created']);

    await expect(store.get(task.id, 2, 0)).resolves.toMatchObject({
      events: [
        { type: 'archived_first', payload: { archived: true }, source: 'backend' },
        { type: 'archived_second', payload: { archived: true }, source: 'runner' },
      ],
    });
    await expect(store.get(task.id, 2, 1)).resolves.toMatchObject({
      events: [
        { type: 'archived_second' },
        { type: 'created' },
      ],
    });
    await expect(store.get(task.id, 2, 2)).resolves.toMatchObject({
      events: [{ type: 'created' }],
    });
  });

  it('reads and transactionally writes only the recognized global settings', async () => {
    const store = createSettingsStore(pool);
    await store.write({
      appearance: { theme: 'dark', accent: '#a1b2c3', background: 'living-aurora' },
      jarvis: { model: 'gpt-5.6-luna', reasoning: 'low' },
      voice: { defaultLanguage: 'en', minimizeWindowsOnVoiceStart: true },
      global: { maxParallelTasks: 3 },
    });

    expect(await store.read()).toMatchObject({
      'appearance.theme': '"dark"',
      'appearance.accent': '"#a1b2c3"',
      'appearance.background': '"living-aurora"',
      'jarvis.model': '"gpt-5.6-luna"',
      'jarvis.reasoning_effort': '"low"',
      'voice.default_language': '"en"',
      'voice.minimize_windows_on_voice_start': 'true',
      'global.max_parallel_tasks': '3',
    });
  });

  it('heartbeats running sandboxes and atomically marks a confirmed crash', async () => {
    const project = await createProjectStore(pool).create({
      name: 'Heartbeat fixture', repo: `${database}/heartbeat`, default_branch: 'main',
      default_agent: 'copilot', policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    });

    const taskStore = createTaskStore(pool, createEventHub<TaskEventMessage>());

    const task = await taskStore.create({
      projectId: project.id, title: 'Heartbeat fixture', request: 'Exercise heartbeat persistence',
    });
    if (!task) throw new Error('Heartbeat task fixture was not created');
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const sandboxSessionId = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
      VALUES (${task.id}, N'heartbeat-session', N'1', N'jarvis-runner-base-1x2', N'1x2',
        N'jarvis-runner-base@sha256:fixture', N'Active')`);
    await pool.request().query(`INSERT dbo.sandbox_turns
      (sandbox_session_id, invocation_id, mode, acp_session_id, status)
      VALUES (${sandboxSessionId}, N'heartbeat-invocation', N'task', N'heartbeat-acp', N'running')`);

    const eventHub = createEventHub<TaskEventMessage>();
    const published: TaskEventMessage[] = [];
    eventHub.subscribe((event) => published.push(event));
    const store = createSandboxHeartbeatStore(pool, eventHub);
    // Earlier tests in this database leave their own running sessions; check only this fixture's.
    const running = (await store.listRunning()).filter((row) => row.sandboxSessionId === String(sandboxSessionId));
    expect(running).toEqual([{
      sandboxSessionId: String(sandboxSessionId), foundrySessionId: 'heartbeat-session',
      executionGeneration: '0',
      agentName: 'jarvis-runner-base-1x2', invocationId: 'heartbeat-invocation',
      invocationCompleted: false,
    }]);
    await store.recordHeartbeat(String(sandboxSessionId));
    const heartbeat = await pool.request().query<{ at: Date | null }>(
      `SELECT last_heartbeat_at AS at FROM dbo.sandbox_sessions WHERE id = ${sandboxSessionId}`);
    expect(heartbeat.recordset[0]?.at).toBeInstanceOf(Date);

    expect(await store.markNeedsAttention(String(sandboxSessionId))).toBe('crashed');
    expect(await store.markNeedsAttention(String(sandboxSessionId))).toBe(false);
    const result = await pool.request().query<{ taskState: string; sessionStatus: string; endReason: string; leaseOwner: string | null }>(
      `SELECT t.state AS taskState, s.status AS sessionStatus, s.end_reason AS endReason, t.lease_owner AS leaseOwner
        FROM dbo.tasks AS t JOIN dbo.sandbox_sessions AS s ON s.task_id = t.id WHERE s.id = ${sandboxSessionId}`);
    expect(result.recordset).toEqual([{
      taskState: 'NeedsAttention', sessionStatus: 'Crashed', endReason: 'crashed', leaseOwner: null,
    }]);
    const activity = await pool.request().query<{ kind: string; title: string; link: string }>(
      `SELECT kind, title, link FROM dbo.activity WHERE link = N'task:${task.id}' AND kind = N'state_changed'`);
    expect(activity.recordset).toContainEqual({
      kind: 'state_changed', title: 'Sandbox heartbeat detected a crash', link: `task:${task.id}`,
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      taskId: task.id,
      type: 'state_changed',
      summary: 'Sandbox heartbeat detected a crash',
      payload: { from: 'Running', to: 'NeedsAttention', reason: 'sandbox_crashed' },
      source: 'backend',
    });
  });

  it('stores the agent question when a sandbox needs Dan', async () => {
    const project = await createProjectStore(pool).create({
      name: 'Needs attention question fixture', repo: `${database}/attention-question`, default_branch: 'main',
      default_agent: 'copilot', policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    });
    const taskStore = createTaskStore(pool, createEventHub<TaskEventMessage>());
    const task = await taskStore.create({
      projectId: project.id, title: 'Scaffold question', request: 'Ask for missing information',
    });
    if (!task) throw new Error('Needs attention question task was not created');
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const sandboxSessionId = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
      VALUES (${task.id}, N'attention-question-session', N'1', N'jarvis-runner-base-1x2', N'1x2',
        N'jarvis-runner-base@sha256:fixture', N'Active')`);
    const eventHub = createEventHub<TaskEventMessage>();
    const published: TaskEventMessage[] = [];
    eventHub.subscribe((event) => published.push(event));
    const store = createSandboxHeartbeatStore(pool, eventHub);
    const question = 'Which license should this project use?';

    expect(await store.markNeedsAttention(String(sandboxSessionId), question)).toBe('needs_attention');
    const taskDetail = await taskStore.get(task.id, 10, 0);
    expect(taskDetail?.state).toBe('NeedsAttention');
    expect(taskDetail?.events).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'state_changed',
      summary: `Question for Dan: ${question}`,
      payload: { from: 'Running', to: 'NeedsAttention', reason: 'agent_question', question },
    })]));
    expect(published).toHaveLength(1);
    expect(published[0]?.summary).toBe(`Question for Dan: ${question}`);
    const sandbox = await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ status: string; endReason: string }>(`SELECT status, end_reason AS endReason
        FROM dbo.sandbox_sessions WHERE id = @sandboxSessionId;`);
    expect(sandbox.recordset).toEqual([{ status: 'Ended', endReason: 'done' }]);
  });

  it.each(['completed', 'session_question', 'completed_before_turn'])(
    'keeps a %s turn out of generic NeedsAttention crash cleanup and expires it without changing state',
    async (type) => {
    const eventHub = createEventHub<TaskEventMessage>();
    const taskStore = createTaskStore(pool, eventHub);
    const project = await createProjectStore(pool).create({
      name: 'Idle expiry fixture', repo: `${database}/idle-expiry-${type}`, default_branch: 'main',
      default_agent: 'copilot', policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    });
    const task = await taskStore.create({
      projectId: project.id, title: 'Continue after expiry', request: 'Continue the completed turn',
    });
    if (!task) throw new Error('Idle expiry task was not created');
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const sandboxSessionId = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
      VALUES (${task.id}, N'idle-expiry-session-${type}', N'1', N'jarvis-runner-base-1x2', N'1x2',
        N'jarvis-runner-base@sha256:fixture', N'Active')`);
    const invocationId = `idle-expiry-${randomUUID()}`;
    const recordCompletion = () => taskStore.recordEvent({
      taskId: task.id,
      type: type === 'completed_before_turn' ? 'completed' : type,
      summary: 'The agent needs a clarification.',
      source: 'runner',
      payload: { invocationId, eventIndex: 1, data: { question: 'Which license?' } },
    });
    if (type === 'completed_before_turn') await recordCompletion();
    await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('invocationId', sql.NVarChar(255), invocationId)
      .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
        VALUES (@sandboxSessionId, @invocationId, N'task', N'idle-expiry-acp', N'running');`);
    if (type !== 'completed_before_turn') await recordCompletion();
    if (type !== 'session_question') {
      expect((await taskStore.transition(task.id, 'NeedsAttention')).kind).toBe('ok');
    }
    const dispatcherStore = createDispatcherStore(pool, eventHub);
    expect(await dispatcherStore.endTaskSessions(task.id, 'NeedsAttention')).toEqual([]);
    const session = await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .query<{ status: string; endReason: string | null }>(
        'SELECT status, end_reason AS endReason FROM dbo.sandbox_sessions WHERE id = @sandboxSessionId;');
    expect(session.recordset).toEqual([{ status: 'Active', endReason: null }]);

    const heartbeatStore = createSandboxHeartbeatStore(pool, eventHub);
    expect(await heartbeatStore.listRunning()).toContainEqual({
      sandboxSessionId: String(sandboxSessionId), foundrySessionId: `idle-expiry-session-${type}`,
      executionGeneration: '0',
      agentName: 'jarvis-runner-base-1x2', invocationId, invocationCompleted: true,
    });
    expect(await heartbeatStore.markNeedsAttention(
      String(sandboxSessionId), undefined, 'old-invocation', true,
    )).toBe(false);
    const published: TaskEventMessage[] = [];
    eventHub.subscribe((event) => published.push(event));
    expect(await heartbeatStore.markNeedsAttention(
      String(sandboxSessionId), undefined, invocationId,
    )).toBe('idle_expired');

    const detail = await taskStore.get(task.id, 10, 0);
    expect(detail).toMatchObject({
      state: 'NeedsAttention',
      latestSessionEndReason: 'idle_expired',
      events: expect.arrayContaining([expect.objectContaining({
        type: 'sandbox_idle_expired',
        payload: { reason: 'idle_expired', invocationId },
      })]),
    });
    const turn = await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
      .input('invocationId', sql.NVarChar(255), invocationId)
      .query<{ status: string }>(`SELECT status FROM dbo.sandbox_turns
        WHERE sandbox_session_id = @sandboxSessionId AND invocation_id = @invocationId;`);
    expect(turn.recordset).toEqual([{ status: 'completed' }]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: 'sandbox_idle_expired', taskId: task.id });
    expect(await heartbeatStore.markNeedsAttention(
      String(sandboxSessionId), undefined, invocationId,
    )).toBe(false);
    expect((await taskStore.transition(task.id, 'Running')).kind).toBe('ok');
    const continuedSessionId = await scalar(`INSERT dbo.sandbox_sessions
      (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
      VALUES (${task.id}, N'continued-session-${type}', N'1', N'jarvis-runner-base-1x2', N'1x2',
        N'jarvis-runner-base@sha256:fixture', N'Active')`);
    expect(await dispatcherStore.endTaskSessions(task.id, 'NeedsAttention')).toEqual([]);
    expect(await dispatcherStore.endTaskSessions(task.id, 'NeedsAttention', true)).toEqual([]);
    const continued = await pool.request()
      .input('sandboxSessionId', sql.BigInt, BigInt(continuedSessionId))
      .query<{ status: string; endReason: string | null }>(
        'SELECT status, end_reason AS endReason FROM dbo.sandbox_sessions WHERE id = @sandboxSessionId;');
    expect(continued.recordset).toEqual([{ status: 'Active', endReason: null }]);
    expect((await taskStore.transition(task.id, 'Cancelled')).kind).toBe('ok');
    await dispatcherStore.endTaskSessions(task.id, 'Cancelled');
  });

  it('creates, updates, lists, and archives projects through the SQL store', async () => {
    const store = createProjectStore(pool);
    const repo = `${database}/project`;
    const project = await store.create({
      name: 'Project store', description: 'Project description', repo, default_branch: 'main', default_agent: 'copilot',
      policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    });
    expect(project).toMatchObject({ repo, description: 'Project description', max_parallel_tasks: 1, merge_rules: null, active: true });
    expect(await store.list()).toContainEqual(project);
    expect(await store.update(project.id, { description: null, max_parallel_tasks: 3 }))
      .toMatchObject({ description: null, max_parallel_tasks: 3 });
    expect(await store.archive(project.id)).toBe(true);
    expect(await store.list()).not.toContainEqual(expect.objectContaining({ id: project.id }));
    expect(await store.update(project.id, { name: 'Archived' })).toBeNull();
    expect(await store.archive(project.id)).toBe(false);
    await expect(store.create({
      name: 'Replacement', repo, default_branch: 'main', default_agent: 'copilot',
      policy: 'deliver_pr', sandbox_size: '1x2', tech: 'node',
    })).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it.each([
    ["INSERT dbo.settings (scope, [key], value) VALUES (N'global', N'jarvis.reasoning', N'not json')", 'CK_settings_value'],
    ["INSERT dbo.settings (scope, [key], value) VALUES (N'project:x', N'jarvis.model', N'{}')", 'CK_settings_scope'],
    ["INSERT dbo.tool_calls (message_id, tool, arguments, outcome) VALUES (1, N'create_task', N'[]', N'ok')", 'CK_tool_calls_arguments'],
    ["INSERT dbo.jarvis_sessions (channel, language) VALUES (N'email', N'en')", 'CK_jarvis_sessions_channel'],
    ["INSERT dbo.jarvis_sessions (channel, language) VALUES (N'VOICE', N'en')", 'CK_jarvis_sessions_channel'],
    ["INSERT dbo.messages (jarvis_session_id, role, text) VALUES (999999, N'dan', N'Hi')", 'FK_messages_jarvis_sessions'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech) VALUES (N'Dup', N'danaakesen/JARVIS', N'main', N'codex', N'deliver_pr', N'1x2', N'node')", 'UQ_projects_repo'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech) VALUES (N'Bad', N'not-a-repo', N'main', N'codex', N'deliver_pr', N'1x2', N'node')", 'CK_projects_repo'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech, max_parallel_tasks) VALUES (N'Zero', N'DanAakesen/zero', N'main', N'codex', N'deliver_pr', N'1x2', N'node', 0)", 'CK_projects_max_parallel_tasks'],
    ["INSERT dbo.projects (name, repo, default_branch, default_agent, policy, sandbox_size, tech) VALUES (N'Size', N'DanAakesen/size', N'main', N'codex', N'deliver_pr', N'4x8', N'node')", 'CK_projects_sandbox_size'],
    ["INSERT dbo.tasks (project_id, title, request, source, agent) VALUES (1, N'Voice', N'Do it', N'voice', N'codex')", 'CK_tasks_origin_message'],
    ["INSERT dbo.tasks (project_id, title, request, source, agent, state) VALUES (1, N'Lower', N'Do it', N'board', N'codex', N'ready')", 'CK_tasks_state'],
    ["INSERT dbo.tasks (project_id, title, request, source, agent, lease_owner) VALUES (1, N'Lease', N'Do it', N'board', N'codex', N'd1')", 'CK_tasks_lease'],
    ["INSERT dbo.tool_calls (message_id, tool, arguments, outcome) VALUES (1, N'create_task', N'{}', N'maybe')", 'CK_tool_calls_outcome'],
    ["INSERT dbo.task_events (task_id, type, source) VALUES (1, N'created', N'agent')", 'CK_task_events_source'],
    ["INSERT dbo.activity (area, kind, title) VALUES (N'Factory', N'task_done', N'Done')", 'CK_activity_area'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, size, image, status) VALUES (1, N'bad-size', N'1', N'4x8', N'image', N'Active')", 'CK_sandbox_sessions_size'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, size, image, status) VALUES (1, N'bad-status', N'1', N'1x2', N'image', N'active')", 'CK_sandbox_sessions_status'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, size, image, status) VALUES (1, N'', N'1', N'1x2', N'image', N'Active')", 'CK_sandbox_sessions_foundry_session_id'],
    ["INSERT dbo.sandbox_sessions (task_id, foundry_session_id, agent_version, agent_name, size, image, status) VALUES (1, N'bad-agent', N'1', N'', N'1x2', N'image', N'Active')", 'CK_sandbox_sessions_agent_name'],
    ["INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status) VALUES (1, N'i', N'other', N'a', N'running')", 'CK_sandbox_turns_mode'],
    ["INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status) VALUES (1, N'i', N'task', N'a', N'Running')", 'CK_sandbox_turns_status'],
    ["INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status) VALUES (1, N'', N'task', N'a', N'running')", 'CK_sandbox_turns_invocation_id'],
    ["INSERT dbo.artifacts (task_id, kind, blob_path, size_bytes) VALUES (1, N'other', N'path', 1)", 'CK_artifacts_kind'],
    ["INSERT dbo.artifacts (task_id, kind, blob_path, size_bytes) VALUES (1, N'log', N'path', -1)", 'CK_artifacts_size_bytes'],
    ["INSERT dbo.webhook_deliveries (delivery_id, event, received_at, processed_at, outcome) VALUES (N'delivery-bad', N'push', '2026-01-01', '2026-01-02', N'pending')", 'CK_webhook_deliveries_outcome'],
    ["INSERT dbo.credential_status (name, status) VALUES (N'unknown', N'ok')", 'CK_credential_status_name'],
    ["INSERT dbo.credential_status (name, status) VALUES (N'github-app-key', N'expired')", 'CK_credential_status_status'],
  ])('rejects invalid data %#', async (statement, constraint) => {
    await expect(pool.request().query(statement)).rejects.toThrow(constraint);
  });

  it('records refused tool calls (0018)', async () => {
    const session = await scalar("INSERT dbo.jarvis_sessions (channel, language) VALUES (N'chat', N'en')");
    const message = await scalar(`INSERT dbo.messages (jarvis_session_id, role, text)
      VALUES (${String(session)}, N'dan', N'Show my tasks in a window')`);
    const call = await scalar(`INSERT dbo.tool_calls (message_id, tool, arguments, result, outcome)
      VALUES (${String(message)}, N'workspace_command', N'{"redacted":true}', N'{"redacted":true}', N'refused')`);
    expect(call).toBeDefined();
    // Remove the row so the revert-all test below can run 0018's guarded down script.
    await pool.request().query(`DELETE dbo.tool_calls WHERE id = ${String(call)}`);
  });

  it('persists UUID-correlated connector audit without messages and refuses to erase that evidence on rollback', () => withRollbackDatabase(async (rollbackPool, committed) => {
    for (const migration of committed.filter(migration => migration.name > '0049_daily_connector_audit.sql').reverse()) {
      await revertMigration(rollbackPool, committed, await readDownMigration(migration.name));
    }
    const historical = committed.filter(migration => migration.name <= '0049_daily_connector_audit.sql');
    const down = await readDownMigration('0049_daily_connector_audit.sql');
    expect(await revertMigration(rollbackPool, historical, down)).toBe(down.name);
    expect((await rollbackPool.request().query<{ count: number }>(`SELECT COUNT(*) AS count FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.tool_calls') AND name = N'IX_tool_calls_message_id';`)).recordset[0]?.count).toBe(1);
    expect(await applyMigrations(rollbackPool, historical)).toEqual([down.name]);
    const record = createToolCallStore(rollbackPool).recordDailyMcp;
    if (!record) throw new Error('Connector audit method missing');
    const sessionId = await scalar("INSERT dbo.jarvis_sessions (channel, language) VALUES (N'chat', N'en')", rollbackPool);
    const messageId = await scalar(`INSERT dbo.messages (jarvis_session_id, role, text)
      VALUES (${String(sessionId)}, N'dan', N'Synthetic audit fixture')`, rollbackPool);
    await createToolCallStore(rollbackPool).record({
      messageId: String(messageId), tool: 'workspace_command', arguments: { redacted: true }, result: { redacted: true }, outcome: 'ok',
    });
    const requestId = randomUUID();
    await record({ requestId, tool: 'log_food', phase: 'awaiting_confirmation', outcome: 'ok' });
    const { recordset } = await rollbackPool.request().query<{ message_id: null; connector_request_id: string; tool: string; arguments: string; result: string; outcome: string }>(
      `SELECT message_id, connector_request_id, tool, arguments, result, outcome
      FROM dbo.tool_calls WHERE connector_request_id IS NOT NULL;`);
    expect(recordset).toHaveLength(1);
    expect(recordset[0]).toMatchObject({
      message_id: null, tool: 'daily_mcp_log_food', arguments: '{"redacted":true}',
      result: '{"redacted":true,"phase":"awaiting_confirmation"}', outcome: 'ok',
    });
    expect(String(recordset[0]?.connector_request_id).toLowerCase()).toBe(requestId.toLowerCase());
    await expect(rollbackPool.request().query(`INSERT dbo.tool_calls (connector_request_id, tool, arguments, outcome)
      VALUES (NEWID(), N'factory_create_task', N'{}', N'ok');`)).rejects.toThrow('CK_tool_calls_identity');
    await expect(rollbackPool.request().query(`INSERT dbo.tool_calls (tool, arguments, outcome)
      VALUES (N'daily_mcp_log_food', N'{}', N'ok');`)).rejects.toThrow('CK_tool_calls_identity');
    await expect(rollbackPool.request().input('messageId', sql.BigInt, messageId).query(
      `INSERT dbo.tool_calls (message_id, connector_request_id, tool, arguments, outcome)
      VALUES (@messageId, NEWID(), N'daily_mcp_log_food', N'{}', N'ok');`)).rejects.toThrow('CK_tool_calls_identity');
    await expect(rollbackPool.request().query(`INSERT dbo.tool_calls (message_id, tool, arguments, outcome)
      VALUES (-1, N'workspace_command', N'{}', N'ok');`)).rejects.toThrow('FOREIGN KEY');
    await expect(revertMigration(rollbackPool, historical, down)).rejects.toThrow('audit evidence must be retained');
    expect(await ledger(rollbackPool)).toEqual(historical.map(migration => migration.name));
    expect((await rollbackPool.request().query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.tool_calls')).recordset[0]?.count).toBe(2);
  }));

  it('reverts unused saved-food metadata but retains new constrained audit evidence', () => withRollbackDatabase(async (rollbackPool, committed) => {
    const down = await readDownMigration('0050_daily_saved_food.sql');
    const newer = await revertNewerThan(rollbackPool, committed, down.name);
    expect(await revertMigration(rollbackPool, committed, down)).toBe(down.name);
    expect(await applyMigrations(rollbackPool, committed)).toEqual([down.name, ...newer.map((migration) => migration.name)]);
    const record = createToolCallStore(rollbackPool).recordDailyMcp;
    if (!record) throw new Error('Connector audit method missing');
    for (const tool of ['read_food_preferences', 'manage_saved_food'] as const) {
      await record({ requestId: randomUUID(), tool, phase: 'ok', outcome: 'ok' });
    }
    await revertNewerThan(rollbackPool, committed, down.name);
    await expect(revertMigration(rollbackPool, committed, down)).rejects.toThrow('audit evidence must be retained');
    expect((await rollbackPool.request().query('SELECT COUNT(*) AS count FROM dbo.tool_calls')).recordset[0].count).toBe(2);
  }));
  it('refuses to erase cleared food-preference revision evidence on rollback', () => withRollbackDatabase(async (rollbackPool, committed) => {
    await rollbackPool.request().query(`INSERT daily.nutrition_recommendation_feedback(owner_object_id,meal_key,preference,revision,created_at,updated_at)
      VALUES('11111111-1111-4111-8111-111111111111',N'synthetic',NULL,2,N'2026-10-17',N'2026-10-17');`);
    await revertNewerThan(rollbackPool, committed, '0050_daily_saved_food.sql');
    await expect(revertMigration(rollbackPool, committed, await readDownMigration('0050_daily_saved_food.sql'))).rejects.toThrow('cannot discard revisions');
    expect((await rollbackPool.request().query('SELECT revision,preference FROM daily.nutrition_recommendation_feedback')).recordset)
      .toEqual([{ revision: '2', preference: null }]);
  }));

  it('keeps owner-scoped versioned conversation summaries within their constraints and reverts the table (0051)', () => withRollbackDatabase(async (rollbackPool, committed) => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const insertSummary = (ownerObjectId: string, version: number, fromId: number, throughId: number, messageCount: number, summary: string) =>
      rollbackPool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('version', sql.Int, version)
        .input('fromId', sql.BigInt, fromId)
        .input('throughId', sql.BigInt, throughId)
        .input('messageCount', sql.Int, messageCount)
        .input('summary', sql.NVarChar(sql.MAX), summary)
        .query(`INSERT dbo.conversation_summaries
          (owner_object_id, version, from_message_id, through_message_id, message_count, summary, open_items, model)
          VALUES (@owner, @version, @fromId, @throughId, @messageCount, @summary, N'', N'summary-model');`);
    await insertSummary(owner, 1, 1, 10, 10, 'First summary');
    await insertSummary(owner, 2, 1, 20, 20, 'Second summary');
    await insertSummary(otherOwner, 1, 1, 5, 5, 'Another owner reuses version 1');
    await expect(insertSummary(owner, 2, 1, 30, 30, 'Duplicate version')).rejects.toThrow('PK_conversation_summaries');
    await expect(insertSummary(owner, 0, 1, 2, 2, 'Version zero')).rejects.toThrow('CK_conversation_summaries_version');
    await expect(insertSummary(owner, 3, 0, 2, 2, 'First id zero')).rejects.toThrow('CK_conversation_summaries_range');
    await expect(insertSummary(owner, 3, 5, 4, 1, 'Reversed range')).rejects.toThrow('CK_conversation_summaries_range');
    await expect(insertSummary(owner, 3, 1, 30, 0, 'No messages')).rejects.toThrow('CK_conversation_summaries_message_count');
    await expect(insertSummary(owner, 3, 1, 30, 30, '')).rejects.toThrow('CK_conversation_summaries_summary');
    await expect(insertSummary(owner, 3, 1, 30, 30, 'x'.repeat(6001))).rejects.toThrow('CK_conversation_summaries_summary');
    await insertSummary(owner, 3, 1, 30, 30, 'x'.repeat(6000));
    const rows = await rollbackPool.request().input('owner', sql.UniqueIdentifier, owner)
      .query<{ version: number; from_id: string; through_id: string; open_items: string }>(
        `SELECT version, CONVERT(varchar(20), from_message_id) AS from_id,
          CONVERT(varchar(20), through_message_id) AS through_id, open_items
        FROM dbo.conversation_summaries WHERE owner_object_id = @owner ORDER BY version`);
    expect(rows.recordset).toEqual([
      { version: 1, from_id: '1', through_id: '10', open_items: '' },
      { version: 2, from_id: '1', through_id: '20', open_items: '' },
      { version: 3, from_id: '1', through_id: '30', open_items: '' },
    ]);
    const others = await rollbackPool.request().input('owner', sql.UniqueIdentifier, otherOwner)
      .query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.conversation_summaries WHERE owner_object_id = @owner');
    expect(others.recordset[0]?.count).toBe(1);
    const indexes = await rollbackPool.request().query<{ count: number }>(`SELECT COUNT(*) AS count FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.conversation_summaries') AND name = N'IX_conversation_summaries_owner_created';`);
    expect(indexes.recordset[0]?.count).toBe(1);

    const down = await readDownMigration('0051_conversation_summaries.sql');
    const newer = await revertNewerThan(rollbackPool, committed, down.name);
    expect(await revertMigration(rollbackPool, committed, down)).toBe(down.name);
    const dropped = await rollbackPool.request().query<{ id: number | null }>("SELECT OBJECT_ID(N'dbo.conversation_summaries', N'U') AS id");
    expect(dropped.recordset[0]?.id).toBeNull();
    expect(await applyMigrations(rollbackPool, committed)).toEqual([down.name, ...newer.map((migration) => migration.name)]);
    const restored = await rollbackPool.request().query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.conversation_summaries');
    expect(restored.recordset[0]?.count).toBe(0);
  }));

  it('stores owner sessions, enforces the active limit under concurrency, purges only dead rows of one owner, and reverts the table (0064)', () => withRollbackDatabase(async (rollbackPool, committed) => {
    const store = createOwnerSessionStore(rollbackPool);
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const racer = randomUUID();
    const purgeOwner = randomUUID();
    const bystander = randomUUID();
    const base = Date.parse('2026-10-22T12:00:00.000Z');
    const minute = 60_000;
    const day = 24 * 60 * minute;
    const at = (offset: number) => new Date(base + offset);
    const session = (overrides: Partial<OwnerSessionRecord> = {}): OwnerSessionRecord => {
      const credential = generateOwnerSessionCredential();
      return {
        sessionId: credential.sessionId, secretHash: credential.secretHash, ownerObjectId: owner, displayName: 'Test Owner',
        deviceLabel: null, createdAt: at(0), lastUsedAt: at(0), idleExpiresAt: at(10 * day), absoluteExpiresAt: at(30 * day),
        revokedAt: null, ...overrides,
      };
    };
    const create = (record: OwnerSessionRecord, maxActive = 10, purgeBefore = new Date(record.createdAt.getTime() - 30 * day)) =>
      store.create({ record, maxActive, purgeBefore });
    const unrevoked = async (ownerObjectId: string) => {
      const { recordset } = await rollbackPool.request().input('owner', sql.UniqueIdentifier, ownerObjectId)
        .query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.owner_sessions WHERE owner_object_id = @owner AND revoked_at IS NULL');
      return recordset[0]?.count;
    };
    const revokedAt = async (record: OwnerSessionRecord) => (await store.find(record.sessionId))?.revokedAt;
    const touch = (record: OwnerSessionRecord, now: number, staleBefore = now) =>
      store.touch({ sessionId: record.sessionId, now: at(now), idleExpiresAt: at(now + 10 * day), staleBefore: at(staleBefore) });

    // A row round-trips with its binary values, Unicode text and a lower-case owner id.
    const first = session({ deviceLabel: 'Café laptop' });
    await expect(create(first)).resolves.toEqual({ evicted: 0 });
    await expect(store.find(first.sessionId)).resolves.toEqual(first);
    await expect(store.find(session().sessionId)).resolves.toBeNull();

    await expect(create(session({ displayName: '' }))).rejects.toThrow('CK_owner_sessions_display_name');
    await expect(create(session({ deviceLabel: '' }))).rejects.toThrow('CK_owner_sessions_device_label');
    await expect(create(session({ idleExpiresAt: at(31 * day) }))).rejects.toThrow('CK_owner_sessions_lifetime');
    await expect(create(session({ idleExpiresAt: at(0), absoluteExpiresAt: at(0) }))).rejects.toThrow('CK_owner_sessions_lifetime');
    await expect(create(first)).rejects.toThrow('PK_owner_sessions');
    expect(await unrevoked(owner)).toBe(1);

    // A session past its idle expiry is never extended.
    const lapsed = session({ idleExpiresAt: at(10 * minute) });
    await create(lapsed);
    await expect(touch(lapsed, 11 * minute)).resolves.toBe(false);
    expect((await store.find(lapsed.sessionId))?.idleExpiresAt).toEqual(at(10 * minute));

    // The least recently used session is revoked once the limit is reached.
    const other = (minutes: number) => session({ ownerObjectId: otherOwner, createdAt: at(minutes * minute), lastUsedAt: at(minutes * minute) });
    const [b1, b2, b3, b4] = [other(1), other(2), other(3), other(5)];
    await expect(create(b1, 3)).resolves.toEqual({ evicted: 0 });
    await expect(create(b2, 3)).resolves.toEqual({ evicted: 0 });
    // A create that fails on insert must roll back the eviction that ran before it.
    await expect(create({ ...other(4), sessionId: b1.sessionId }, 2)).rejects.toThrow('PK_owner_sessions');
    expect(await revokedAt(b1)).toBeNull();
    await expect(create(b3, 3)).resolves.toEqual({ evicted: 0 });
    await expect(touch(b1, 4 * minute)).resolves.toBe(true);
    await expect(create(b4, 3)).resolves.toEqual({ evicted: 1 });
    expect(await revokedAt(b2)).toEqual(at(5 * minute));
    for (const kept of [b1, b3, b4]) expect(await revokedAt(kept)).toBeNull();
    expect(await revokedAt(first)).toBeNull();

    // A refresh is written once, and never revives a revoked session.
    await expect(touch(b3, 6 * minute, minute)).resolves.toBe(false);
    await expect(touch(b2, 6 * minute)).resolves.toBe(false);
    expect(await store.find(b2.sessionId)).toMatchObject({ revokedAt: at(5 * minute), lastUsedAt: at(2 * minute) });

    // Revocation is scoped to the owner, applies once, and revoke-all counts only active sessions.
    await expect(store.revoke(otherOwner, first.sessionId, at(7 * minute))).resolves.toBe(false);
    expect(await revokedAt(first)).toBeNull();
    await expect(store.revoke(otherOwner, b3.sessionId, at(7 * minute))).resolves.toBe(true);
    await expect(store.revoke(otherOwner, b3.sessionId, at(8 * minute))).resolves.toBe(false);
    await expect(store.revokeAll(otherOwner, at(9 * minute))).resolves.toBe(2);
    expect(await revokedAt(b2)).toEqual(at(5 * minute));
    expect(await revokedAt(b3)).toEqual(at(7 * minute));
    expect(await revokedAt(b1)).toEqual(at(9 * minute));
    await expect(store.revokeAll(otherOwner, at(10 * minute))).resolves.toBe(0);
    await expect(store.revokeAll(owner, at(11 * minute))).resolves.toBe(1);

    // Concurrent creates are serialised, so the active count never exceeds the limit.
    const results = await Promise.all(Array.from({ length: 6 }, () => create(session({ ownerObjectId: racer }), 3)));
    expect(results.reduce((sum, result) => sum + result.evicted, 0)).toBe(3);
    expect(await unrevoked(racer)).toBe(3);

    // A create purges only dead rows of its own owner.
    const gone = (overrides: Partial<OwnerSessionRecord>) => session({
      createdAt: at(-60 * day), lastUsedAt: at(-60 * day), idleExpiresAt: at(-50 * day), absoluteExpiresAt: at(-30 * day), ...overrides,
    });
    const dead = gone({ ownerObjectId: purgeOwner });
    const foreign = gone({ ownerObjectId: bystander });
    const revokedLongAgo = session({
      ownerObjectId: purgeOwner, createdAt: at(-40 * day), lastUsedAt: at(-40 * day), idleExpiresAt: at(5 * day), absoluteExpiresAt: at(20 * day),
    });
    const recentlyRevoked = session({ ownerObjectId: purgeOwner, createdAt: at(-5 * day), lastUsedAt: at(-5 * day) });
    for (const record of [dead, foreign, revokedLongAgo, recentlyRevoked]) await create(record, 10, at(-1000 * day));
    await expect(store.revoke(purgeOwner, revokedLongAgo.sessionId, at(-35 * day))).resolves.toBe(true);
    await expect(store.revoke(purgeOwner, recentlyRevoked.sessionId, at(-1 * day))).resolves.toBe(true);
    await create(session({ ownerObjectId: purgeOwner }));
    await expect(store.find(dead.sessionId)).resolves.toBeNull();
    await expect(store.find(revokedLongAgo.sessionId)).resolves.toBeNull();
    await expect(store.find(recentlyRevoked.sessionId)).resolves.not.toBeNull();
    await expect(store.find(foreign.sessionId)).resolves.not.toBeNull();

    const down = await readDownMigration('0064_owner_sessions.sql');
    const newer = await revertNewerThan(rollbackPool, committed, down.name);
    expect(await revertMigration(rollbackPool, committed, down)).toBe(down.name);
    const dropped = await rollbackPool.request().query<{ id: number | null }>("SELECT OBJECT_ID(N'dbo.owner_sessions', N'U') AS id");
    expect(dropped.recordset[0]?.id).toBeNull();
    expect(await applyMigrations(rollbackPool, committed)).toEqual([down.name, ...newer.map((migration) => migration.name)]);
    const restored = await rollbackPool.request().query<{ count: number }>('SELECT COUNT(*) AS count FROM dbo.owner_sessions');
    expect(restored.recordset[0]?.count).toBe(0);
  }));

  it('preserves used execution generations and only reverts unused migration 0048', () => withRollbackDatabase(async (rollbackPool, committed) => {
    for (const migration of committed.filter(migration => migration.name > '0048_factory_execution_generation.sql').reverse()) {
      await revertMigration(rollbackPool, committed, await readDownMigration(migration.name));
    }
    const applicable = committed.filter(migration => migration.name <= '0048_factory_execution_generation.sql');
    const projectId = await scalar(`INSERT dbo.projects
      (name, repo, default_branch, default_agent, policy, sandbox_size, tech)
      VALUES (N'Rollback', N'DanAakesen/rollback', N'main', N'copilot', N'deliver_pr', N'1x2', N'node')`, rollbackPool);
    const taskId = await scalar(`INSERT dbo.tasks (project_id, title, request, source, agent)
      VALUES (${String(projectId)}, N'Rollback proof', N'Preserve generation', N'board', N'copilot')`, rollbackPool);
    const down = await readDownMigration('0048_factory_execution_generation.sql');

    expect(await revertMigration(rollbackPool, committed, down)).toBe(down.name);
    expect(await applyMigrations(rollbackPool, applicable)).toEqual([down.name]);
    await rollbackPool.request().input('taskId', sql.BigInt, taskId)
      .query('UPDATE dbo.tasks SET execution_generation = execution_generation + 1 WHERE id = @taskId;');
    await expect(revertMigration(rollbackPool, committed, down))
      .rejects.toThrow('Factory execution generations must be retained');
    expect(await ledger(rollbackPool)).toEqual(applicable.map((migration) => migration.name));
    const retained = await rollbackPool.request().input('taskId', sql.BigInt, taskId)
      .query<{ generation: string }>(`SELECT CONVERT(varchar(19), execution_generation) AS generation
        FROM dbo.tasks WHERE id = @taskId;`);
    expect(retained.recordset).toEqual([{ generation: '1' }]);
    const columns = await rollbackPool.request().query<{ task_bytes: number; session_bytes: number }>(
      `SELECT COL_LENGTH(N'dbo.tasks', N'execution_generation') AS task_bytes,
        COL_LENGTH(N'dbo.sandbox_sessions', N'execution_generation') AS session_bytes;`);
    expect(columns.recordset).toEqual([{ task_bytes: 8, session_bytes: 8 }]);
  }));

  it('records smoke usage and preserves it when migration 0045 is reverted', () => withRollbackDatabase(async (rollbackPool, committed) => {
    const eventId = randomUUID();
    await createUsageStore(rollbackPool).recordFoundryUsage!({
      role: 'smoke',
      model: 'gpt-6-luna',
      inputTokens: 1,
      outputTokens: 1,
      eventId,
    });

    try {
      // Later additive migrations must be reversed first; do not weaken 0045's evidence guard.
      for (const migration of committed.filter(migration => migration.name > '0045_smoke_usage_role.sql').reverse()) {
        await revertMigration(rollbackPool, committed, await readDownMigration(migration.name));
      }
      const usage = await rollbackPool.request()
        .input('eventId', sql.NVarChar(300), eventId)
        .query<{ role: string }>('SELECT DISTINCT role FROM dbo.usage WHERE source_event_id = @eventId;');
      expect(usage.recordset).toEqual([{ role: 'smoke' }]);
      await expect(revertMigration(
        rollbackPool, committed, await readDownMigration('0045_smoke_usage_role.sql'),
      )).rejects.toThrow('Smoke usage rows must be retained');
      const retainedUsage = await rollbackPool.request()
        .input('eventId', sql.NVarChar(300), eventId)
        .query<{ role: string }>('SELECT DISTINCT role FROM dbo.usage WHERE source_event_id = @eventId;');
      expect(retainedUsage.recordset).toEqual([{ role: 'smoke' }]);
    } finally {
      await rollbackPool.request()
        .input('eventId', sql.NVarChar(300), eventId)
        .query('DELETE FROM dbo.usage WHERE source_event_id = @eventId;');
      await applyMigrations(rollbackPool, committed);
    }
  }));

  it('preserves steering metadata when reverting migration 0020', () => withRollbackDatabase(async (rollbackPool, committed) => {
    const session = await scalar("INSERT dbo.jarvis_sessions (channel, language) VALUES (N'chat', N'en')", rollbackPool);
    const message = await scalar(`INSERT dbo.messages
      (jarvis_session_id, role, text, language, interrupted)
      VALUES (${String(session)}, N'jarvis', N'Partial reply', N'en', 1)`, rollbackPool);
    const newer = committed.filter((migration) => migration.name > '0020_chat_message_steering.sql').reverse();
    for (const migration of newer) {
      const script = await readDownMigration(migration.name);
      expect(await revertMigration(rollbackPool, committed, script)).toBe(script.name);
    }
    const down = await readDownMigration('0020_chat_message_steering.sql');

    await expect(revertMigration(rollbackPool, committed, down))
      .rejects.toThrow('Message language and interruption data must be retained');
    expect((await rollbackPool.request().query(
      `SELECT language, interrupted FROM dbo.messages WHERE id = ${String(message)}`,
    )).recordset).toEqual([{ language: 'en', interrupted: true }]);

    await rollbackPool.request().query(
      `UPDATE dbo.messages SET language = NULL, interrupted = 0 WHERE id = ${String(message)}`,
    );
    expect(await revertMigration(rollbackPool, committed, down)).toBe(down.name);
    expect(await applyMigrations(rollbackPool, committed)).toEqual([down.name, ...[...newer].reverse().map((migration) => migration.name)]);
  }));

  it('refuses to revert a migration that is not the latest applied one and keeps state on failure', async () => {
    const committed = await readMigrations();
    const text = 'CREATE TABLE dbo.revert_fixture (id int);';
    const fixture: Migration = { name: '9999_revert_fixture.sql', sql: text, checksum: createHash('sha256').update(text).digest('hex') };
    expect(await applyMigrations(pool, [...committed, fixture])).toEqual([fixture.name]);
    await expect(revertMigration(pool, [...committed, fixture], await readDownMigration(core))).rejects.toThrow('latest applied');
    const failing = { name: fixture.name, sql: "DROP TABLE dbo.revert_fixture; THROW 51000, 'fixture failure', 1;" };
    await expect(revertMigration(pool, [...committed, fixture], failing)).rejects.toThrow();
    expect(await tables()).toEqual([...tablesInSchema, 'revert_fixture'].sort());
    expect(await revertMigration(pool, [...committed, fixture], { name: fixture.name, sql: 'DROP TABLE dbo.revert_fixture;' })).toBe(fixture.name);
    expect(await ledger()).toEqual(committed.map((migration) => migration.name));
  });

  it('reverts every committed migration with its down script, newest first, and applies them again', () => withRollbackDatabase(async (rollbackPool, committed) => {
    for (const migration of [...committed].reverse()) {
      expect(await revertMigration(rollbackPool, committed, await readDownMigration(migration.name))).toBe(migration.name);
    }
    expect(await tables(rollbackPool)).toEqual([]);
    expect(await ledger(rollbackPool)).toEqual([]);
    await expect(revertMigration(rollbackPool, committed, await readDownMigration(core))).rejects.toThrow('latest applied');
    expect(await applyMigrations(rollbackPool, committed)).toEqual(committed.map((migration) => migration.name));
    expect(await tables(rollbackPool)).toEqual(tablesInSchema);
  }));
});
