import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { copenhagenDayStart } from '../proactive/time.js';
import {
  defaultProactiveSettings,
  sourceLabels,
  type FeedbackAction,
  type FindingInput,
  type FindingWriteGuard,
  type ProactiveSettingsPatch,
  type ProactiveStore,
} from '../proactive/store.js';
import { type Item, type ProactiveSettings, type RunSummary, type SourceId, type SourceStatus } from '../proactive/types.js';

interface ItemRow {
  id: string;
  kind: Item['kind'];
  title: string;
  body: string;
  category: Item['category'];
  urgency: Item['urgency'];
  due_at: Date | string | null;
  evidence_json: string | null;
  state: Item['state'];
  snoozed_until: Date | string | null;
  feedback: Item['feedback'];
  run_id: string | null;
  todo_added: boolean;
  language: Item['language'];
  created_at: Date | string;
}

interface RunRow {
  id: string;
  trigger: RunSummary['trigger'];
  slot_key: string | null;
  status: RunSummary['status'];
  reason: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  finding_count: number;
  claim_generation: number;
  lease_until?: Date | string | null;
}

interface InternalEvidence {
  evidence: Item['evidence'];
  eventStartAt?: string | null;
  eventEndAt?: string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseEvidence(value: string | null): InternalEvidence {
  if (!value) return { evidence: [] };
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return { evidence: parsed as Item['evidence'] };
    if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as InternalEvidence).evidence)) {
      return parsed as InternalEvidence;
    }
  } catch { /* A malformed legacy value is exposed as empty evidence. */ }
  return { evidence: [] };
}

function mapItem(row: ItemRow): Item {
  return {
    id: row.id.toLowerCase(),
    kind: row.kind,
    title: row.title,
    body: row.body,
    category: row.category,
    urgency: row.urgency,
    dueAt: iso(row.due_at),
    evidence: parseEvidence(row.evidence_json).evidence,
    state: row.state,
    snoozedUntil: iso(row.snoozed_until),
    feedback: row.feedback,
    runId: row.run_id?.toLowerCase() ?? null,
    todoAdded: row.todo_added,
    language: row.language,
    createdAt: iso(row.created_at)!,
  };
}

function mapRun(row: RunRow): RunSummary {
  return {
    id: row.id.toLowerCase(),
    trigger: row.trigger,
    slot: row.slot_key,
    status: row.status,
    reason: row.reason,
    startedAt: iso(row.started_at)!,
    finishedAt: iso(row.finished_at),
    findingCount: row.finding_count,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

const itemColumns = [
  'id', 'kind', 'title', 'body', 'category', 'urgency', 'due_at', 'evidence_json', 'state',
  'snoozed_until', 'feedback', 'run_id', 'todo_added', 'language', 'created_at',
];
function itemSelect(prefix = ''): string {
  return itemColumns.map((column) => prefix ? `${prefix}.${column}` : column).join(', ');
}

export function createProactiveStore(pool: sql.ConnectionPool, ownerObjectId: string): ProactiveStore {
  const owner = ownerObjectId.toLowerCase();
  const defaults = defaultProactiveSettings();
  return {
    settings: {
      async read() {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{
            paused: boolean;
            monthly_budget_dkk: number;
            sources_json: string;
            news_feeds_json: string;
            guidance: string;
          }>(`SELECT paused, monthly_budget_dkk, sources_json, news_feeds_json, guidance
            FROM dbo.proactive_settings WHERE owner_object_id = @owner;`);
        const row = recordset[0];
        if (!row) return defaults;
        return {
          paused: row.paused,
          monthlyBudgetDkk: row.monthly_budget_dkk,
          sources: { ...defaults.sources, ...parseJson<Partial<ProactiveSettings['sources']>>(row.sources_json, {}) },
          newsFeeds: parseJson<string[]>(row.news_feeds_json, [...defaults.newsFeeds]),
          guidance: row.guidance,
        };
      },
      async patch(patch: ProactiveSettingsPatch) {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          const read = await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .query<{
              paused: boolean;
              monthly_budget_dkk: number;
              sources_json: string;
              news_feeds_json: string;
              guidance: string;
            }>(`SELECT paused, monthly_budget_dkk, sources_json, news_feeds_json, guidance
              FROM dbo.proactive_settings WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id = @owner;`);
          const row = read.recordset[0];
          const current: ProactiveSettings = row ? {
            paused: row.paused,
            monthlyBudgetDkk: row.monthly_budget_dkk,
            sources: { ...defaults.sources, ...parseJson<Partial<ProactiveSettings['sources']>>(row.sources_json, {}) },
            newsFeeds: parseJson<string[]>(row.news_feeds_json, [...defaults.newsFeeds]),
            guidance: row.guidance,
          } : defaults;
          const updated: ProactiveSettings = {
            ...current,
            ...patch,
            sources: { ...current.sources, ...patch.sources },
            newsFeeds: patch.newsFeeds === undefined ? current.newsFeeds : patch.newsFeeds,
          };
          await new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('paused', sql.Bit, updated.paused)
            .input('budget', sql.Int, updated.monthlyBudgetDkk)
            .input('sources', sql.NVarChar(sql.MAX), JSON.stringify(updated.sources))
            .input('feeds', sql.NVarChar(sql.MAX), JSON.stringify(updated.newsFeeds))
            .input('guidance', sql.NVarChar(1000), updated.guidance)
            .query(`MERGE dbo.proactive_settings WITH (HOLDLOCK) AS target
              USING (SELECT @owner AS owner_object_id) AS source
              ON target.owner_object_id = source.owner_object_id
              WHEN MATCHED THEN UPDATE SET paused = @paused, monthly_budget_dkk = @budget,
                sources_json = @sources, news_feeds_json = @feeds, guidance = @guidance,
                updated_at = SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT
                (owner_object_id, paused, monthly_budget_dkk, sources_json, news_feeds_json, guidance)
                VALUES (@owner, @paused, @budget, @sources, @feeds, @guidance);`);
          await transaction.commit();
          return updated;
        } catch (error) {
          try { await transaction.rollback(); } catch { /* Preserve the store failure. */ }
          throw error;
        }
      },
    },
    items: {
      async list(state, limit, now) {
        const request = databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('limit', sql.Int, limit)
          .input('now', sql.DateTime2, now);
        const where = state === 'all' ? '' :
          `AND (state IN (N'new', N'seen') OR (state = N'snoozed' AND snoozed_until <= @now))`;
        const { recordset } = await request.query<ItemRow>(`SELECT TOP (@limit) ${itemSelect()}
          FROM dbo.proactive_items WHERE owner_object_id = @owner ${where}
          ORDER BY created_at DESC, id DESC;`);
        return recordset.map(mapItem);
      },
      async get(id, markLoaded = false) {
        const request = (markLoaded ? pool.request() : databaseReadRequest(pool))
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id);
        const query = markLoaded
          ? `UPDATE dbo.proactive_items SET opened_at = COALESCE(opened_at, SYSUTCDATETIME())
              OUTPUT ${itemSelect('inserted')} WHERE owner_object_id = @owner AND id = @id;`
          : `SELECT ${itemSelect()} FROM dbo.proactive_items WHERE owner_object_id = @owner AND id = @id;`;
        const { recordset } = await request.query<ItemRow>(query);
        return recordset[0] ? mapItem(recordset[0]) : undefined;
      },
      async applyFeedback(id, action: FeedbackAction, snoozeUntil) {
        const { recordset } = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .input('action', sql.NVarChar(16), action)
          .input('snoozeUntil', sql.DateTime2, snoozeUntil ? new Date(snoozeUntil) : null)
          .query<ItemRow>(`UPDATE dbo.proactive_items
            SET state = CASE
                  WHEN @action = N'dismiss' THEN N'dismissed'
                  WHEN @action = N'seen' AND state = N'new' THEN N'seen'
                  WHEN @action = N'snooze' THEN N'snoozed'
                  ELSE state END,
                snoozed_until = CASE WHEN @action = N'snooze' THEN @snoozeUntil ELSE snoozed_until END,
                feedback = CASE WHEN @action IN (N'useful', N'wrong') THEN @action ELSE feedback END
            OUTPUT ${itemSelect('inserted')}
            WHERE id = @id AND owner_object_id = @owner;`);
        return recordset[0] ? mapItem(recordset[0]) : undefined;
      },
      async upsertFinding(input: FindingInput, guard?: FindingWriteGuard) {
        const transaction = new sql.Transaction(pool);
        let activeRequest: sql.Request | undefined;
        let leaseUntil: number | undefined;
        const cancel = () => { activeRequest?.cancel(); };
        const check = () => {
          guard?.check();
          guard?.signal.throwIfAborted();
          if (guard && leaseUntil !== undefined && leaseUntil <= guard.now().getTime()) {
            throw new Error('lease_lost');
          }
        };
        const query = async <T>(request: sql.Request, statement: string) => {
          check();
          activeRequest = request;
          try { return await request.query<T>(statement); }
          finally { activeRequest = undefined; }
        };
        guard?.signal.addEventListener('abort', cancel);
        try {
          check();
          await transaction.begin();
          if (guard) {
            const lease = await query<RunRow>(new sql.Request(transaction)
              .input('owner', sql.UniqueIdentifier, owner)
              .input('runId', sql.UniqueIdentifier, guard.runId),
            `SELECT status, claim_generation, lease_until
              FROM dbo.proactive_runs WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND id = @runId;`);
            const run = lease.recordset[0];
            if (input.runId !== guard.runId || !run || run.status !== 'running' ||
                Number(run.claim_generation) !== guard.generation || !run.lease_until ||
                new Date(run.lease_until).getTime() <= guard.now().getTime()) {
              throw new Error('lease_lost');
            }
            leaseUntil = new Date(run.lease_until).getTime();
          }
          const lockName = `jarvis.proactive.finding:${owner}:${input.dedupeKey}`;
          const lock = await query<{ result: number }>(new sql.Request(transaction)
            .input('resource', sql.NVarChar(255), lockName.slice(0, 255)),
            `DECLARE @result int;
              EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive',
                @LockOwner = 'Transaction', @LockTimeout = 10000;
              SELECT @result AS result;`);
          if ((lock.recordset[0]?.result ?? -1) < 0) throw new Error('Finding lock was not acquired');
          const existingResult = await query<ItemRow & { dedupe_key: string }>(new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('key', sql.NVarChar(64), input.dedupeKey),
            `SELECT TOP (1) ${itemSelect()}, dedupe_key
              FROM dbo.proactive_items WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND dedupe_key = @key;`);
          const existingRow = existingResult.recordset[0];
          const existing = existingRow ? mapItem(existingRow) : undefined;
          const priorEvidence = existingRow ? parseEvidence(existingRow.evidence_json) : undefined;
          const changed = existing !== undefined && (
            existing.dueAt !== input.dueAt ||
            (priorEvidence?.eventStartAt ?? null) !== (input.eventStartAt ?? null) ||
            (priorEvidence?.eventEndAt ?? null) !== (input.eventEndAt ?? null) ||
            (input.urgency === 'time_critical' && existing.urgency !== 'time_critical')
          );
          const evidence: InternalEvidence = {
            evidence: input.evidence,
            eventStartAt: input.eventStartAt ?? null,
            eventEndAt: input.eventEndAt ?? null,
          };
          const id = existing?.id ?? randomUUID();
          const state = existing
            ? existing.state === 'dismissed' && changed ? 'new' : existing.state
            : 'new';
          const request = new sql.Request(transaction)
            .input('id', sql.UniqueIdentifier, id)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('key', sql.NVarChar(64), input.dedupeKey)
            .input('title', sql.NVarChar(200), input.title)
            .input('body', sql.NVarChar(500), input.body)
            .input('category', sql.NVarChar(32), input.category)
            .input('urgency', sql.NVarChar(24), input.urgency)
            .input('dueAt', sql.DateTime2, input.dueAt ? new Date(input.dueAt) : null)
            .input('evidence', sql.NVarChar(sql.MAX), JSON.stringify(evidence))
            .input('state', sql.NVarChar(16), state)
            .input('runId', sql.UniqueIdentifier, input.runId)
            .input('language', sql.NVarChar(2), input.language);
          const saved = existing
            ? await query<ItemRow>(request, `UPDATE dbo.proactive_items SET
                title = @title, body = @body, category = @category, urgency = @urgency,
                due_at = @dueAt, evidence_json = @evidence, state = @state,
                run_id = @runId, language = @language, dedupe_key = @key
              OUTPUT ${itemSelect('inserted')}
              WHERE id = @id AND owner_object_id = @owner;`)
            : await query<ItemRow>(request, `INSERT dbo.proactive_items
                (id, owner_object_id, kind, title, body, delivery_state, category, urgency, due_at,
                 evidence_json, state, run_id, language, dedupe_key)
              OUTPUT inserted.${itemSelect().replaceAll(', ', ', inserted.').replaceAll('\n    ', '\n    inserted.')}
              VALUES (@id, @owner, N'finding', @title, @body, N'queued', @category, @urgency, @dueAt,
                @evidence, @state, @runId, @language, @key);`);
          const row = saved.recordset[0];
          if (!row) throw new Error('Finding could not be saved');
          check();
          await transaction.commit();
          return mapItem(row);
        } catch (error) {
          try { await transaction.rollback(); } catch { /* Preserve the store failure. */ }
          throw error;
        } finally {
          guard?.signal.removeEventListener('abort', cancel);
        }
      },
      async markTodoAdded(itemIds: readonly string[]) {
        if (itemIds.length === 0) return;
        await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('ids', sql.NVarChar(sql.MAX), JSON.stringify(itemIds))
          .query(`UPDATE item SET todo_added = 1
            FROM dbo.proactive_items AS item
            INNER JOIN OPENJSON(@ids) WITH (id uniqueidentifier '$') AS requested ON requested.id = item.id
            WHERE item.owner_object_id = @owner AND item.kind = N'finding';`);
      },
    },
    runs: {
      async claim({ trigger, slot, now }) {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          const request = new sql.Request(transaction)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('slot', sql.NVarChar(16), slot)
            .input('trigger', sql.NVarChar(16), trigger)
            .input('id', sql.UniqueIdentifier, randomUUID())
            .input('now', sql.DateTime2, now)
            .input('dayStart', sql.DateTime2, copenhagenDayStart(now))
            .input('lease', sql.DateTime2, new Date(now.getTime() + 10 * 60_000));
          const { recordset } = await request.query<RunRow>(`DECLARE @lockResult int;
            DECLARE @lockResource nvarchar(255) = CONCAT(N'jarvis.proactive.runs:', LOWER(CONVERT(nvarchar(36), @owner)));
            EXEC @lockResult = sys.sp_getapplock @Resource = @lockResource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 10000;
            IF @lockResult < 0 THROW 51001, 'Could not acquire proactive run claim lock', 1;
            UPDATE dbo.proactive_runs WITH (UPDLOCK, HOLDLOCK)
              SET status = N'failed', reason = N'lease_lost', finished_at = @now,
                claim_generation = claim_generation + 1
              WHERE owner_object_id = @owner AND status = N'running' AND lease_until <= @now;
            IF EXISTS (SELECT 1 FROM dbo.proactive_runs WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND status = N'running' AND lease_until > @now)
              SELECT CAST(NULL AS uniqueidentifier) AS id, CAST(NULL AS nvarchar(16)) AS [trigger],
                CAST(NULL AS nvarchar(16)) AS slot_key, CAST(NULL AS nvarchar(16)) AS status,
                CAST(NULL AS nvarchar(64)) AS reason, CAST(NULL AS datetime2) AS started_at,
                CAST(NULL AS datetime2) AS finished_at, CAST(NULL AS int) AS finding_count,
                CAST(NULL AS bigint) AS claim_generation;
            ELSE IF @slot IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.proactive_runs WITH (UPDLOCK, HOLDLOCK)
              WHERE owner_object_id = @owner AND slot_key = @slot)
              SELECT CAST(NULL AS uniqueidentifier) AS id, CAST(NULL AS nvarchar(16)) AS [trigger],
                CAST(NULL AS nvarchar(16)) AS slot_key, CAST(NULL AS nvarchar(16)) AS status,
                CAST(NULL AS nvarchar(64)) AS reason, CAST(NULL AS datetime2) AS started_at,
                CAST(NULL AS datetime2) AS finished_at, CAST(NULL AS int) AS finding_count,
                CAST(NULL AS bigint) AS claim_generation;
            ELSE IF @trigger = N'manual' AND (
              EXISTS (SELECT 1 FROM dbo.proactive_runs WHERE owner_object_id = @owner
                AND [trigger] = N'manual' AND started_at > DATEADD(minute, -5, @now))
              OR (SELECT COUNT(*) FROM dbo.proactive_runs WHERE owner_object_id = @owner
                AND [trigger] = N'manual' AND started_at >= @dayStart) >= 6)
              SELECT CAST(NULL AS uniqueidentifier) AS id, CAST(NULL AS nvarchar(16)) AS [trigger],
                CAST(NULL AS nvarchar(16)) AS slot_key, CAST(NULL AS nvarchar(16)) AS status,
                CAST(NULL AS nvarchar(64)) AS reason, CAST(NULL AS datetime2) AS started_at,
                CAST(NULL AS datetime2) AS finished_at, CAST(NULL AS int) AS finding_count,
                CAST(NULL AS bigint) AS claim_generation;
            ELSE
              INSERT dbo.proactive_runs
                (id, owner_object_id, [trigger], slot_key, status, started_at, finding_count, lease_until, claim_generation)
              OUTPUT inserted.id, inserted.[trigger], inserted.slot_key, inserted.status, inserted.reason,
                inserted.started_at, inserted.finished_at, inserted.finding_count, inserted.claim_generation
              VALUES (@id, @owner, @trigger, @slot, N'running', @now, 0, @lease, 1);`);
          await transaction.commit();
          const row = recordset[0];
          return row?.id ? { run: mapRun(row), generation: Number(row.claim_generation) } : null;
        } catch (error) {
          try { await transaction.rollback(); } catch { /* Preserve the store failure. */ }
          throw error;
        }
      },
      async heartbeat(id, generation, now) {
        const { rowsAffected } = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .input('generation', sql.BigInt, generation)
          .input('now', sql.DateTime2, now)
          .input('lease', sql.DateTime2, new Date(now.getTime() + 10 * 60_000))
          .query(`UPDATE dbo.proactive_runs SET lease_until = @lease
            WHERE owner_object_id = @owner AND id = @id AND status = N'running' AND claim_generation = @generation;`);
        return (rowsAffected[0] ?? 0) === 1;
      },
      async finish(id, generation, status, reason, findingCount, finishedAt) {
        const { rowsAffected } = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .input('generation', sql.BigInt, generation)
          .input('status', sql.NVarChar(16), status)
          .input('reason', sql.NVarChar(64), reason)
          .input('findingCount', sql.Int, findingCount)
          .input('finishedAt', sql.DateTime2, finishedAt)
          .query(`UPDATE dbo.proactive_runs SET status = @status, reason = @reason,
            finding_count = @findingCount, finished_at = @finishedAt
            WHERE owner_object_id = @owner AND id = @id AND status = N'running' AND claim_generation = @generation;`);
        return (rowsAffected[0] ?? 0) === 1;
      },
      async latest() {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<RunRow>(`SELECT TOP (1) id, [trigger], slot_key, status, reason, started_at,
            finished_at, finding_count, claim_generation
            FROM dbo.proactive_runs WHERE owner_object_id = @owner ORDER BY started_at DESC, id DESC;`);
        return recordset[0] ? mapRun(recordset[0]) : null;
      },
      async running(now) {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('now', sql.DateTime2, now)
          .query<RunRow>(`SELECT TOP (1) id, [trigger], slot_key, status, reason, started_at,
            finished_at, finding_count, claim_generation
            FROM dbo.proactive_runs WHERE owner_object_id = @owner AND status = N'running'
              AND lease_until > @now ORDER BY started_at DESC, id DESC;`);
        return recordset[0] ? mapRun(recordset[0]) : null;
      },
      async list(limit) {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('limit', sql.Int, limit)
          .query<RunRow>(`SELECT TOP (@limit) id, [trigger], slot_key, status, reason, started_at,
            finished_at, finding_count, claim_generation
            FROM dbo.proactive_runs WHERE owner_object_id = @owner ORDER BY started_at DESC, id DESC;`);
        return recordset.map(mapRun);
      },
      async countManualSince(since) {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('since', sql.DateTime2, since)
          .query<{ count: number }>(`SELECT COUNT(*) AS count FROM dbo.proactive_runs
            WHERE owner_object_id = @owner AND [trigger] = N'manual' AND started_at >= @since;`);
        return recordset[0]?.count ?? 0;
      },
      async markInterruptedOnStartup() {
        const { rowsAffected } = await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .query(`UPDATE dbo.proactive_runs SET status = N'failed', reason = N'interrupted_by_restart',
            finished_at = SYSUTCDATETIME(), claim_generation = claim_generation + 1
            WHERE owner_object_id = @owner AND status = N'running';`);
        return rowsAffected[0] ?? 0;
      },
    },
    sources: {
      async list() {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .query<{ source_id: SourceId; state: SourceStatus['state']; reason: string | null; observed_at: Date | string }>(
            `SELECT source_id, state, reason, observed_at FROM dbo.proactive_source_status WHERE owner_object_id = @owner;`);
        return recordset.map((row) => ({
          id: row.source_id,
          label: sourceLabels[row.source_id],
          enabled: true,
          state: row.state,
          reason: row.reason,
          observedAt: iso(row.observed_at),
        }));
      },
      async upsert(status) {
        await pool.request()
          .input('owner', sql.UniqueIdentifier, owner)
          .input('source', sql.NVarChar(16), status.id)
          .input('state', sql.NVarChar(16), status.state)
          .input('reason', sql.NVarChar(64), status.reason)
          .input('observedAt', sql.DateTime2, status.observedAt ? new Date(status.observedAt) : new Date())
          .query(`MERGE dbo.proactive_source_status WITH (HOLDLOCK) AS target
            USING (SELECT @owner AS owner_object_id, @source AS source_id) AS source
            ON target.owner_object_id = source.owner_object_id AND target.source_id = source.source_id
            WHEN MATCHED THEN UPDATE SET state = @state, reason = @reason, observed_at = @observedAt
            WHEN NOT MATCHED THEN INSERT (owner_object_id, source_id, state, reason, observed_at)
              VALUES (@owner, @source, @state, @reason, @observedAt);`);
      },
    },
    spend: {
      async record(input) {
        await pool.request()
          .input('id', sql.UniqueIdentifier, randomUUID())
          .input('owner', sql.UniqueIdentifier, owner)
          .input('run', sql.UniqueIdentifier, input.runId)
          .input('month', sql.Char(7), input.month)
          .input('inputTokens', sql.Int, input.inputTokens)
          .input('outputTokens', sql.Int, input.outputTokens)
          .input('estimated', sql.Decimal(9, 4), input.estimatedDkk)
          .input('createdAt', sql.DateTime2, input.createdAt)
          .query(`INSERT dbo.proactive_spend
            (id, owner_object_id, run_id, month_key, input_tokens, output_tokens, estimated_dkk, created_at)
            VALUES (@id, @owner, @run, @month, @inputTokens, @outputTokens, @estimated, @createdAt);`);
      },
      async monthTotal(month) {
        const { recordset } = await databaseReadRequest(pool)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('month', sql.Char(7), month)
          .query<{ total: number | null }>(`SELECT SUM(estimated_dkk) AS total FROM dbo.proactive_spend
            WHERE owner_object_id = @owner AND month_key = @month;`);
        return recordset[0]?.total ?? 0;
      },
    },
  };
}
