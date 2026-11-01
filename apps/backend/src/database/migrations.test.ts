import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMigrationsDirectory, readDownMigration, readMigrations } from './migrations.js';

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'jarvis-migration-'));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))); });

describe('committed SQL manifest', () => {
  it('allows completed weather results without deleting evidence or changing compatibility identifiers', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0072_weather_job_results.sql');
    expect(migration?.sql).toContain("kind IN (N'research', N'html_app') AND status = N'done'");
    expect(migration?.sql).toContain("THEN N'research:' ELSE N'html_app:'");
    expect(migration?.sql).toContain('TRY_CONVERT(uniqueidentifier');
    expect(migration?.sql).toContain('result_folio_id = LOWER(result_folio_id)');
    expect(migration?.sql).not.toMatch(/\b(?:UPDATE|DELETE|TRIGGER)\b/u);
    const down = await readDownMigration('0072_weather_job_results.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('Weather job results must be preserved');
    expect(down.sql).toContain("kind = N'research' AND status = N'done'");
    expect(down.sql).not.toMatch(/\b(?:UPDATE|DELETE)\b/u);
  });
  it('stores owner-bound background job dismissals separately from raw jobs with reversible visibility state', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0053_background_job_dismissals.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.background_job_dismissals');
    expect(migration?.sql).toContain('owner_object_id uniqueidentifier NOT NULL');
    expect(migration?.sql).toContain('PRIMARY KEY (owner_object_id, job_id)');
    expect(migration?.sql).toContain('REFERENCES dbo.background_jobs (job_id) ON DELETE CASCADE');
    expect(migration?.sql).toContain('DEFAULT SYSUTCDATETIME()');
    expect(migration?.sql).toContain('IX_background_job_dismissals_job_id');
    expect(migration?.sql).not.toMatch(/\b(?:UPDATE|DELETE)\b(?! CASCADE)/u);
    const down = await readDownMigration('0053_background_job_dismissals.sql');
    expect(down.sql).toContain('IF EXISTS (SELECT 1 FROM dbo.background_job_dismissals WITH (TABLOCKX,HOLDLOCK))');
    expect(down.sql).toContain('THROW 51000');
    expect(down.sql).toContain('dismissal preferences must be retained');
    expect(down.sql).toContain('DROP TABLE dbo.background_job_dismissals;');
  });

  it('adds durable owner-scoped push delivery tables and protects rollback evidence', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0054_proactive_push.sql');
    expect(migration?.sql).toContain('CHECK (id = 1)');
    expect(migration?.sql).toContain('UX_push_subscriptions_owner_endpoint_hash');
    expect(migration?.sql).toContain("CHECK (kind = N'test')");
    expect((await readDownMigration('0054_proactive_push.sql')).sql).toContain('cannot roll back while rows exist');
  });
  it('stores owner-set Daily training targets without defaults and protects them on rollback', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0061_daily_training_targets.sql');
    expect(migration?.sql).toContain('CREATE TABLE daily.training_targets');
    expect(migration?.sql).toContain('owner_object_id uniqueidentifier NOT NULL');
    expect(migration?.sql).toContain('gym_sessions_per_week int NULL');
    expect(migration?.sql).toContain('run_sessions_per_week int NULL');
    expect(migration?.sql).toContain('daily_steps int NULL');
    expect(migration?.sql).toContain('CHECK (daily_steps IS NULL OR daily_steps BETWEEN 0 AND 100000)');
    expect(migration?.sql).not.toMatch(/\bDEFAULT\b/iu);
    const down = await readDownMigration('0061_daily_training_targets.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('must be retained');
  });
  it('stores owner lift entries with bounded kg, idempotency and a guarded reverse batch', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0070_daily_lift_entries.sql');
    expect(migration?.sql).toContain('CREATE TABLE daily.lift_entries');
    expect(migration?.sql).toContain('owner_object_id uniqueidentifier NOT NULL');
    expect(migration?.sql).toContain('exercise_key nvarchar(80) NOT NULL');
    expect(migration?.sql).toContain('weight_kg decimal(6,2)');
    expect(migration?.sql).toContain('performed_at datetime2(3)');
    expect(migration?.sql).toContain('revision bigint NOT NULL');
    expect(migration?.sql).toContain('UNIQUE (owner_object_id, idempotency_key)');
    expect(migration?.sql).toContain('IX_daily_lift_entries_owner_exercise_performed');
    const down = await readDownMigration('0070_daily_lift_entries.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('Workout lift history must be retained');
    expect(down.sql).toContain('DROP TABLE daily.lift_entries;');
  });
  it('tracks scoped GitHub App mint recovery while retaining unresolved legacy alerts', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0062_github_app_mint_recovery.sql');
    expect(migration?.sql).toContain('github_app_scope_key char(64)');
    expect(migration?.sql).toContain('recovered_at datetime2(7)');
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE dbo.activity ADD");
    expect(migration?.sql).toContain("alert_key LIKE N''credential:github-app:failed:%''");
    expect(migration?.sql).toContain('CREATE TABLE dbo.github_app_mint_status');
    expect(migration?.sql).toContain("status = N'failed'");
    expect(migration?.sql).toContain('legacy-unscoped');
    const down = await readDownMigration('0062_github_app_mint_recovery.sql');
    expect(down.sql).toContain('SET github_app_scope_key = NULL, recovered_at = NULL');
    expect(down.sql).not.toMatch(/\bDELETE\b/iu);
  });
  it('stores owner sessions as hashed credentials with bounded text and consistent lifetimes', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0064_owner_sessions.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.owner_sessions');
    expect(migration?.sql).toContain('session_id binary(16) NOT NULL');
    expect(migration?.sql).toContain('CONSTRAINT PK_owner_sessions PRIMARY KEY');
    expect(migration?.sql).toContain('secret_hash binary(32) NOT NULL');
    expect(migration?.sql).toContain('owner_object_id uniqueidentifier NOT NULL');
    expect(migration?.sql).toContain('revoked_at datetime2(3) NULL');
    expect(migration?.sql).toContain('CK_owner_sessions_display_name CHECK (LEN(display_name) BETWEEN 1 AND 200)');
    expect(migration?.sql).toContain('CK_owner_sessions_device_label CHECK (device_label IS NULL OR LEN(device_label) BETWEEN 1 AND 40)');
    expect(migration?.sql).toContain('idle_expires_at <= absolute_expires_at');
    expect(migration?.sql).toContain('IX_owner_sessions_owner_last_used');
    expect(migration?.sql).not.toMatch(/\bsecret\b/iu);
    expect(migration?.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
    const down = await readDownMigration('0064_owner_sessions.sql');
    expect(down.sql.trim()).toBe('DROP TABLE dbo.owner_sessions;');
  });
  it('adds no-default owner reminder schedules with task identity and delivery leases', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0065_owner_reminder_schedules.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.owner_reminder_schedules');
    expect(migration?.sql).toContain('owner_object_id uniqueidentifier NOT NULL');
    expect(migration?.sql).toContain('idempotency_key char(64)');
    expect(migration?.sql).toContain('task_identity char(64)');
    expect(migration?.sql).toContain('claim_token uniqueidentifier NULL');
    expect(migration?.sql).toContain('lease_until datetime2(7) NULL');
    expect(migration?.sql).toContain('last_fire_at datetime2(7) NULL');
    expect(migration?.sql).toContain('owner_requested bit NOT NULL');
    expect(migration?.sql).toContain('DEFAULT 0');
    expect(migration?.sql).not.toMatch(/\bINSERT\b|\bUPDATE\b/u);
    const down = await readDownMigration('0065_owner_reminder_schedules.sql');
    expect(down.sql).toContain('Owner reminder schedules must be retained');
    expect(down.sql).toContain('Owner-requested reminder items must be retained');
    expect(down.sql).toContain('DROP TABLE dbo.owner_reminder_schedules;');
  });
  it('adds the proactive operational schema and a reversible proactive job kind', async () => {
    const foundation = (await readMigrations()).find(({ name }) => name === '0055_proactive_foundation.sql');
    expect(foundation?.sql).toContain("CHECK (kind IN (N'test', N'finding'))");
    expect(foundation?.sql).toContain('UX_proactive_items_owner_dedupe_key');
    expect(foundation?.sql).toContain('CREATE TABLE dbo.proactive_settings');
    expect(foundation?.sql).toContain('CREATE TABLE dbo.proactive_runs');
    expect(foundation?.sql).toContain('CREATE TABLE dbo.proactive_source_status');
    expect(foundation?.sql).toContain('CREATE TABLE dbo.proactive_spend');
    expect(foundation?.sql).toContain('UX_proactive_runs_owner_slot');
    expect((await readDownMigration('0055_proactive_foundation.sql')).sql)
      .toContain('Proactive records are durable evidence');

    const jobs = (await readMigrations()).find(({ name }) => name === '0056_background_job_kind_proactive.sql');
    expect(jobs?.sql).toContain("N'proactive'");
    const down = await readDownMigration('0056_background_job_kind_proactive.sql');
    expect(down.sql).toContain("WHERE kind = N'proactive'");
    expect(down.sql).toContain('THROW 51000');
  });
  it('adds durable category and personal/work preferences with safe defaults and guarded rollback', async () => {
    const migration = (await readMigrations()).find(({ name }) =>
      name === '0063_proactive_suggestion_preferences.sql');
    expect(migration?.sql).toContain('"deadline":true');
    expect(migration?.sql).toContain('"travel":true');
    expect(migration?.sql).toContain("DEFAULT N'all'");
    expect(migration?.sql).toContain("DEFAULT N'unknown'");
    const down = await readDownMigration('0063_proactive_suggestion_preferences.sql');
    expect(down.sql).toContain('OPENJSON(CASE WHEN ISJSON(categories_json) = 1 THEN categories_json ELSE N\'{}\' END)');
    expect(down.sql).toContain('suggestion_scope <> N\'all\'');
    expect(down.sql).toContain("suggestion_scope <> N'unknown'");
    expect(down.sql).toContain('THROW 51000');
  });
  it('adds durable suggested-todo receipts with add-once and daily-cap indexes', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0058_proactive_todo_receipts.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.proactive_todo_receipts');
    expect(migration?.sql).toContain('item_id uniqueidentifier NULL');
    expect(migration?.sql).toContain('dedupe_key char(32) NOT NULL');
    expect(migration?.sql).toContain('WHERE status = N\'added\'');
    expect(migration?.sql).toContain('IX_proactive_todo_receipts_owner_day_status');
    const down = await readDownMigration('0058_proactive_todo_receipts.sql');
    expect(down.sql).toContain('Proactive todo receipts are durable evidence');
    expect(down.sql).toContain('DROP TABLE dbo.proactive_todo_receipts');
  });
  it('stores hash-only alert attempts with owner/key idempotency and retains rollback evidence', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0057_proactive_alerts.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.proactive_alerts');
    expect(migration?.sql).toContain('alert_key char(32) COLLATE Latin1_General_100_BIN2 NOT NULL');
    expect(migration?.sql).toContain('UNIQUE INDEX UX_proactive_alerts_owner_alert_key');
    expect(migration?.sql).toContain('IX_proactive_alerts_owner_day_status');
    expect(migration?.sql).toContain("N'travel_disruption'");
    expect(migration?.sql).toContain('CK_proactive_alerts_reason');
    const down = await readDownMigration('0057_proactive_alerts.sql');
    expect(down.sql).toContain('cannot roll back while rows exist');
    expect(down.sql).toContain('DROP TABLE dbo.proactive_alerts;');
  });
  it('creates the owner-scoped proactive reminder store with its pending and sent indexes', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0059_proactive_reminders.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.proactive_reminders');
    expect(migration?.sql).toContain('title nvarchar(80) NOT NULL');
    expect(migration?.sql).toContain("N'pending', N'sent', N'cancelled', N'expired', N'failed', N'suppressed'");
    expect(migration?.sql).toContain('UX_proactive_reminders_owner_key');
    expect(migration?.sql).toContain('IX_proactive_reminders_owner_state_fire_at');
    expect(migration?.sql).toContain('IX_proactive_reminders_owner_day_state');
    expect((await readDownMigration('0059_proactive_reminders.sql')).sql)
      .toContain('DROP TABLE dbo.proactive_reminders;');
  });

  it('retains durable task submission claims and refuses to erase retry protection on rollback', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0052_factory_task_submissions.sql');
    expect(migration?.sql).toContain('submission_id uniqueidentifier NOT NULL PRIMARY KEY');
    expect(migration?.sql).toContain('fingerprint varchar(64) NOT NULL');
    expect(migration?.sql).toContain('response nvarchar(max) NULL');
    expect((await readDownMigration('0052_factory_task_submissions.sql')).sql).toContain('THROW 51000');
  });
  it('stores versioned owner-scoped conversation summaries with bounded text and a reversible table', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0051_conversation_summaries.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.conversation_summaries');
    expect(migration?.sql).toContain('summary nvarchar(max) NOT NULL');
    expect(migration?.sql).toContain('open_items nvarchar(3000) NOT NULL');
    expect(migration?.sql).toContain('CK_conversation_summaries_summary CHECK (LEN(summary) >= 1 AND LEN(summary) <= 6000)');
    expect(migration?.sql).toContain('PK_conversation_summaries PRIMARY KEY (owner_object_id, version)');
    expect(migration?.sql).toContain('CK_conversation_summaries_range CHECK (from_message_id >= 1 AND through_message_id >= from_message_id)');
    expect(migration?.sql).toContain('IX_conversation_summaries_owner_created');
    expect(migration?.sql).not.toContain('REFERENCES');
    await expect(readDownMigration('0051_conversation_summaries.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP TABLE dbo.conversation_summaries'),
    });
  });
  it('adds saved-food concurrency metadata without rewriting deployed 0049 and protects rollback evidence', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0050_daily_saved_food.sql');
    expect(migration?.sql).toContain('nutrition_favorites ADD revision bigint NOT NULL');
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE daily.nutrition_favorites");
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE daily.nutrition_recommendation_feedback");
    expect(migration?.sql).toContain('nutrition_recommendation_feedback ALTER COLUMN preference nvarchar(256) NULL');
    expect(migration?.sql).toContain("N'daily_mcp_manage_saved_food'");
    const down = await readDownMigration('0050_daily_saved_food.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('cannot discard revisions or cleared preferences');
  });
  it('keeps ordinary audit message identity and adds constrained connector UUID correlation without erasing rollback evidence', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0049_daily_connector_audit.sql');
    expect(migration?.sql).toContain('connector_request_id uniqueidentifier NULL');
    expect(migration?.sql).toContain('message_id IS NOT NULL AND connector_request_id IS NULL');
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE dbo.tool_calls");
    const down = await readDownMigration('0049_daily_connector_audit.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('audit evidence must be retained');
    expect(down.sql).toContain('DROP INDEX IX_tool_calls_message_id ON dbo.tool_calls');
    expect(down.sql).toContain('CREATE INDEX IX_tool_calls_message_id ON dbo.tool_calls (message_id)');
  });
  it('adds durable Factory generations without backfilling completion proof and protects rollback', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0048_factory_execution_generation.sql');
    expect(migration?.sql).toContain('ALTER TABLE dbo.tasks ADD execution_generation bigint NOT NULL');
    expect(migration?.sql).toContain('ALTER TABLE dbo.sandbox_sessions ADD execution_generation bigint NOT NULL');
    expect(migration?.sql).not.toContain('UPDATE dbo.task_events');
    const down = await readDownMigration('0048_factory_execution_generation.sql');
    expect(down.sql).toContain('WHERE execution_generation <> 0');
    expect(down.sql).toContain('THROW 51000');
  });
  it('bounds inactive health attempts and protects processing evidence on rollback', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0047_daily_health_processing.sql');
    expect(migration?.sql).toContain('processing_attempts BETWEEN 0 AND 3');
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE daily.health_upload_inbox");
    const down = await readDownMigration('0047_daily_health_processing.sql');
    expect(down.sql).toContain('TABLOCKX,HOLDLOCK');
    expect(down.sql).toContain('no processing evidence');
  });
  it('adds reversible bounded message metadata with same-batch references compiled dynamically', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0040_message_visual_context.sql');
    expect(migration?.sql).toContain('ALTER TABLE dbo.messages ADD metadata nvarchar(max) NULL');
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE dbo.messages");
    expect(migration?.sql).toContain('DATALENGTH(metadata) <= 64000');
    await expect(readDownMigration('0040_message_visual_context.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP COLUMN metadata'),
    });
  });
  it('finds committed migrations at the repository root without a directory override', async () => {
    expect(defaultMigrationsDirectory).toMatch(/\/db\/migrations\/$/);
    await expect(readMigrations()).resolves.toBeInstanceOf(Array);
  });
  it('orders numbered migrations and computes immutable checksums from bytes', async () => {
    const path = await directory();
    await writeFile(join(path, '0002_second.sql'), 'SELECT 2;');
    await writeFile(join(path, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(path, 'README.md'), 'Not SQL');
    const migrations = await readMigrations(path);
    expect(migrations.map((migration) => migration.name)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(path, '0001_first.sql'), 'SELECT 3;');
    expect((await readMigrations(path))[0]?.checksum).not.toBe(migrations[0]?.checksum);
  });
  it('accepts the reserved 0062 allocation alongside proactive migration 0063', async () => {
    const path = await directory();
    await writeFile(join(path, '0062_github_app_mint_recovery.sql'), 'SELECT 1;');
    await writeFile(join(path, '0063_proactive_suggestion_preferences.sql'), 'SELECT 2;');

    expect((await readMigrations(path)).map(({ name }) => name)).toEqual([
      '0062_github_app_mint_recovery.sql',
      '0063_proactive_suggestion_preferences.sql',
    ]);
  });
  it.each(['SELECT 1;\nGO\nSELECT 2;', '', 'GO 2 -- repeat'])('rejects unsupported empty or GO batches %#', async (contents) => {
    const path = await directory();
    await writeFile(join(path, '0001_first.sql'), contents);
    await expect(readMigrations(path)).rejects.toThrow('nonempty SQL batch');
  });
  it('rejects duplicate sequence numbers', async () => {
    const path = await directory();
    await writeFile(join(path, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(path, '0001_second.sql'), 'SELECT 2;');
    await expect(readMigrations(path)).rejects.toThrow('duplicate');
  });
  it('ships a reviewed down script for every committed migration', async () => {
    const migrations = await readMigrations();
    const names = migrations.map((migration) => migration.name);
    expect(names).toEqual([
      '0001_core_tables.sql', '0002_sandbox_operations.sql', '0003_sandbox_agent_name.sql',
      '0004_credential_renewal.sql', '0005_task_event_archives.sql', '0007_usage.sql',
      '0008_activity_dismissals.sql', '0009_github_release_records.sql',
      '0010_idle_expired_sessions.sql', '0011_alert_deduplication.sql', '0014_teams_notifications.sql',
      '0015_screen_frame_usage.sql', '0016_long_term_memory.sql', '0017_phone_call_sessions.sql',
      '0018_tool_call_refused_outcome.sql', '0019_workspace_artifacts.sql',
      '0020_chat_message_steering.sql', '0021_vault_memory_index.sql',
      '0022_task_notification_deduplication.sql',
      '0023_github_app_credential_health.sql',
      '0024_dismiss_board_deployment_failures.sql',
      '0025_workspace_html_artifacts.sql',
      '0026_workspace_html_artifact_history.sql',
      '0027_vault_knowledge_graph.sql',
      '0028_json_embeddings_without_vector.sql',
      '0029_background_jobs.sql',
      '0030_foundry_usage_cost_coverage.sql',
      '0031_embedding_model_identity.sql',
      '0032_conversation_search.sql',
      '0033_project_description.sql',
      '0034_research_job_retry.sql',
      '0035_folio.sql',
      '0036_folio_lowercase_ids.sql',
      '0037_task_github_issues.sql',
      '0038_workspace_pins.sql',
      '0039_conversation_attachments.sql',
      '0040_message_visual_context.sql',
      '0041_daily_owner_schema.sql',
      '0042_daily_plan_unknown_nutrients.sql',
      '0043_daily_favorite_definitions.sql',
      '0044_daily_nutrition_export.sql',
      '0045_smoke_usage_role.sql',
      '0046_daily_health_upload_inbox.sql',
      '0047_daily_health_processing.sql',
      '0048_factory_execution_generation.sql',
      '0049_daily_connector_audit.sql',
      '0050_daily_saved_food.sql',
      '0051_conversation_summaries.sql',
      '0052_factory_task_submissions.sql',
      '0053_background_job_dismissals.sql',
      '0054_proactive_push.sql',
      '0055_proactive_foundation.sql',
      '0056_background_job_kind_proactive.sql',
      '0057_proactive_alerts.sql',
      '0058_proactive_todo_receipts.sql',
      '0059_proactive_reminders.sql',
      '0060_daily_health_processing_state.sql',
      '0061_daily_training_targets.sql',
      '0062_github_app_mint_recovery.sql',
      '0063_proactive_suggestion_preferences.sql',
      '0064_owner_sessions.sql',
      '0065_owner_reminder_schedules.sql',
      '0066_research_result_recovery.sql',
      '0067_workspaces_identifiers.sql',
      '0068_issue_delivery_origin.sql',
      '0069_runtime_test_sessions.sql',
      '0070_daily_lift_entries.sql',
      '0071_activitykit_registrations.sql',
      '0072_weather_job_results.sql',
    ]);
    for (const migration of migrations) await expect(readDownMigration(migration.name)).resolves.toMatchObject({ name: migration.name });
  });
  it('allows smoke usage and refuses rollback while its usage rows exist', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0045_smoke_usage_role.sql');
    expect(migration?.sql).toContain("N'smoke'");
    const down = await readDownMigration('0045_smoke_usage_role.sql');
    expect(down.sql).toContain("WHERE role = N'smoke'");
    expect(down.sql).toContain('THROW 51000');
  });
  it('adds a nullable task issue link with an active-issue uniqueness constraint', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0037_task_github_issues.sql');
    expect(migration?.sql).toContain('ALTER TABLE dbo.tasks ADD issue_number int NULL');
    expect(migration?.sql).toContain('EXEC(N\'CREATE UNIQUE INDEX UX_tasks_active_project_issue');
    expect(migration?.sql).toContain('state <> N\'\'Done\'\' AND state <> N\'\'Cancelled\'\'');
    await expect(readDownMigration('0037_task_github_issues.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP COLUMN issue_number'),
    });
  });
  it('stores owner-scoped workspace pins with a reversible table', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0038_workspace_pins.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.workspace_pins');
    expect(migration?.sql).toContain('view_id nvarchar(64) COLLATE Latin1_General_100_BIN2');
    expect(migration?.sql).toContain('pinned_at datetime2(7)');
    expect(migration?.sql).toContain('ISJSON(view_json) = 1');
    expect(migration?.sql).toContain('IX_workspace_pins_owner_pinned_at');
    await expect(readDownMigration('0038_workspace_pins.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP TABLE dbo.workspace_pins'),
    });
  });
  it('stores private owner-scoped conversation attachments with bounded text and reversible cleanup', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0039_conversation_attachments.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.conversation_attachments');
    expect(migration?.sql).toContain('message_id bigint NULL');
    expect(migration?.sql).toContain("id = LOWER(id)");
    expect(migration?.sql).toContain("blob_name LIKE N'attachments/%'");
    expect(migration?.sql).toContain("status IN (N'uploaded', N'ready', N'failed')");
    expect(migration?.sql).toContain('expires_at datetime2(7) NOT NULL');
    expect(migration?.sql).toContain('LEN(extracted_text) <= 100000');
    await expect(readDownMigration('0039_conversation_attachments.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP TABLE dbo.conversation_attachments'),
    });
  });
  it('stores JSON embeddings only when SQL vector support is unavailable', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0028_json_embeddings_without_vector.sql');
    expect(migration?.sql).toContain("IF TYPE_ID(N'vector') IS NULL");
    expect(migration?.sql).toContain("ALTER TABLE dbo.memories ADD embedding_json nvarchar(max) NULL");
    expect(migration?.sql).toContain("ALTER TABLE dbo.vault_chunks ADD embedding_json nvarchar(max) NULL");
    await expect(readDownMigration('0028_json_embeddings_without_vector.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP COLUMN embedding_json'),
    });
  });
  it('stores background jobs and their step history with cascading retention', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0029_background_jobs.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.background_jobs');
    expect(migration?.sql).toContain('CREATE TABLE dbo.background_job_steps');
    expect(migration?.sql).toContain('job_id nvarchar(36) COLLATE Latin1_General_100_BIN2');
    expect(migration?.sql).toContain('job_id = LOWER(job_id)');
    expect(migration?.sql).toContain('ON DELETE CASCADE');
    await expect(readDownMigration('0029_background_jobs.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP TABLE dbo.background_job_steps'),
    });
  });
  it('adds a nullable project description with a reversible migration', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0033_project_description.sql');
    expect(migration?.sql).toContain('ALTER TABLE dbo.projects ADD description nvarchar(2000) NULL');
    await expect(readDownMigration('0033_project_description.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('ALTER TABLE dbo.projects DROP COLUMN description'),
    });
  });
  it('stores the embedding model identity and permits embedding background jobs', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0031_embedding_model_identity.sql');
    expect(migration?.sql).toContain('ALTER TABLE dbo.memories ADD embedding_model nvarchar(128) NULL');
    expect(migration?.sql).toContain('ALTER TABLE dbo.vault_chunks ADD embedding_model nvarchar(128) NULL');
    expect(migration?.sql).toContain("N'embedding'");
    await expect(readDownMigration('0031_embedding_model_identity.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP COLUMN embedding_model'),
    });
  });
  it('indexes workspace HTML artifacts and images in Workspaces with reversible storage', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0035_folio.sql');
    expect(migration?.sql).toContain('CREATE TABLE dbo.folio_items');
    expect(migration?.sql).toContain("N'html_app'");
    expect(migration?.sql).toContain('FROM dbo.workspace_html_artifacts AS artifact');
    expect(migration?.sql).toContain('FROM dbo.workspace_artifacts AS artifact');
    await expect(readDownMigration('0035_folio.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP TABLE dbo.folio_items'),
    });
  });
  it('renames Workspaces storage without dropping data and keeps legacy SQL aliases synchronized', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0067_workspaces_identifiers.sql');
    expect(migration?.sql).toContain("sp_rename N'dbo.folio_items', N'workspace_items'");
    expect(migration?.sql).toContain('CREATE SYNONYM dbo.folio_items FOR dbo.workspace_items');
    expect(migration?.sql).toContain('result_workspace_item_id');
    expect(migration?.sql).toContain('TR_background_jobs_workspace_result_compat');
    expect(migration?.sql).toContain('SET result_workspace_item_id = result_folio_id');
    expect(migration?.sql).toContain("EXEC(N'UPDATE dbo.background_jobs");
    expect(migration?.sql).toContain("EXEC(N'ALTER TABLE dbo.background_jobs");
    expect(migration?.sql).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/iu);
    const down = await readDownMigration('0067_workspaces_identifiers.sql');
    expect(down.sql).toContain('DROP SYNONYM dbo.folio_items');
    expect(down.sql).toContain("sp_rename N'dbo.workspace_items', N'folio_items'");
    expect(down.sql).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/iu);
  });
  it('stores retry inputs and one retry claim per research job', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0034_research_job_retry.sql');
    expect(migration?.sql).toContain('retry_input nvarchar(max) NULL');
    expect(migration?.sql).toContain('retry_job_id nvarchar(36)');
    await expect(readDownMigration('0034_research_job_retry.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP COLUMN retry_input, retry_job_id'),
    });
  });
  it('indexes conversation message dates for bounded search', async () => {
    const migration = (await readMigrations()).find(({ name }) => name === '0032_conversation_search.sql');
    expect(migration?.sql).toContain('CREATE INDEX IX_messages_at ON dbo.messages (at DESC, id DESC)');
    await expect(readDownMigration('0032_conversation_search.sql')).resolves.toMatchObject({
      sql: expect.stringContaining('DROP INDEX IX_messages_at ON dbo.messages'),
    });
  });
  it('reads down scripts from down/ without treating them as forward migrations', async () => {
    const path = await directory();
    await mkdir(join(path, 'down'));
    await writeFile(join(path, '0001_first.sql'), 'CREATE TABLE dbo.t (id int);');
    await writeFile(join(path, 'down', '0001_first.sql'), 'DROP TABLE dbo.t;');
    expect((await readMigrations(path)).map((migration) => migration.name)).toEqual(['0001_first.sql']);
    expect(await readDownMigration('0001_first.sql', path)).toEqual({ name: '0001_first.sql', sql: 'DROP TABLE dbo.t;' });
    await writeFile(join(path, 'down', '0001_first.sql'), 'DROP TABLE dbo.t;\nGO');
    await expect(readDownMigration('0001_first.sql', path)).rejects.toThrow('nonempty SQL batch');
    await expect(readDownMigration('../0001_first.sql', path)).rejects.toThrow('Invalid database migration name');
    await expect(readDownMigration('0002_missing.sql', path)).rejects.toThrow();
  });
});
