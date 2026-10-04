import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  CreateTaskInput,
  RecordTaskEventInput,
  RunningTaskContext,
  TaskDetail,
  TaskEventHub,
  TaskEventMessage,
  TaskEventRecord,
  TaskListFilters,
  TaskRecord,
  TaskStore,
  TaskTransitionResult,
  TaskUsageRecord,
} from '../factory/task-store.js';
import { canTransitionTask, type TaskState } from '../factory/task-lifecycle.js';
import {
  acquireTaskEventArchiveLock,
  type TaskEventArchive,
} from './task-event-archive.js';

interface TaskRow extends Omit<TaskRecord, 'createdAt' | 'startedAt' | 'finishedAt' | 'nextAttemptAt'> {
  createdAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  nextAttemptAt: Date | string | null;
}

interface EventRow extends Omit<TaskEventRecord, 'at' | 'payload'> {
  at: Date | string;
  payload: string | null;
}

interface RunningContextRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  agent: TaskRecord['agent'];
  state: TaskRecord['state'];
  activity: string | null;
  startedAt: Date | string | null;
  eventId: string | null;
  eventType: string | null;
  eventSummary: string | null;
  eventSource: TaskEventRecord['source'] | null;
  eventAt: Date | string | null;
}

const runningContextTaskLimit = 20;
const runningContextEventLimit = 3;
const runningContextSummaryLimit = 400;

interface InsertedEventRow extends Omit<TaskEventRecord, 'at' | 'payload' | 'payloadTruncated'> {
  at: Date | string;
  payload: string | null;
}

interface UsageRow extends Omit<TaskUsageRecord, 'at'> {
  at: Date | string;
}

interface UsageTaskRow {
  projectId: string;
  agent: 'codex' | 'copilot';
}

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxPayloadBytes = 1024 * 1024;
const maxPublishedPayloadBytes = 4096;

const taskColumns = `CAST(id AS varchar(19)) AS id, CAST(project_id AS varchar(19)) AS projectId,
  CAST(origin_message_id AS varchar(19)) AS originMessageId, title, request, source, agent,
  model_override AS modelOverride, reasoning_override AS reasoningOverride, state, activity,
  priority, attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt, branch,
  created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt`;

const insertedTaskColumns = `CAST(inserted.id AS varchar(19)) AS id,
  CAST(inserted.project_id AS varchar(19)) AS projectId,
  CAST(inserted.origin_message_id AS varchar(19)) AS originMessageId, inserted.title, inserted.request,
  inserted.source, inserted.agent, inserted.model_override AS modelOverride,
  inserted.reasoning_override AS reasoningOverride, inserted.state, inserted.activity,
  inserted.priority, inserted.attempt_count AS attemptCount, inserted.next_attempt_at AS nextAttemptAt,
  inserted.branch, inserted.created_at AS createdAt, inserted.started_at AS startedAt,
  inserted.finished_at AS finishedAt`;
const sleepSwitchLock = 'jarvis.backend-sleep-switch';

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTask(row: TaskRow): TaskRecord {
  return {
    ...row,
    createdAt: iso(row.createdAt) as string,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    nextAttemptAt: iso(row.nextAttemptAt),
  };
}

function parsePayload(payload: string | null): unknown {
  if (payload === null) return null;
  try { return JSON.parse(payload) as unknown; }
  catch { return null; }
}

function serializePayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined || Buffer.byteLength(serialized) > maxPayloadBytes) {
      throw new Error();
    }
    return serialized;
  } catch {
    throw new Error('Invalid task event payload');
  }
}

function validateEvent(event: RecordTaskEventInput): string | null {
  if (typeof event.taskId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(event.taskId) ||
    event.taskId !== event.taskId.trim() || BigInt(event.taskId) > maxSqlBigInt ||
    typeof event.type !== 'string' || !/^[a-z][a-z_]{0,63}$/.test(event.type) ||
    event.type !== event.type.trim() ||
    !['runner', 'backend', 'github', 'dan'].includes(event.source) ||
    (event.summary !== undefined && event.summary !== null &&
      (typeof event.summary !== 'string' || event.summary.length > 2000))) {
    throw new Error('Invalid task event');
  }
  return serializePayload(event.payload);
}

function toTaskEvent(row: InsertedEventRow, taskId: string): TaskEventMessage {
  const payloadTruncated = row.payload !== null && Buffer.byteLength(row.payload) > maxPublishedPayloadBytes;
  return {
    ...row,
    taskId,
    payload: payloadTruncated ? null : parsePayload(row.payload),
    payloadTruncated,
    at: iso(row.at) as string,
  };
}

async function insertTaskEvent(
  transaction: sql.Transaction,
  event: RecordTaskEventInput,
  payload: string | null,
): Promise<TaskEventMessage> {
  const inserted = await new sql.Request(transaction)
    .input('taskId', sql.BigInt, BigInt(event.taskId))
    .input('type', sql.NVarChar(64), event.type)
    .input('summary', sql.NVarChar(2000), event.summary ?? null)
    .input('payload', sql.NVarChar(sql.MAX), payload)
    .input('source', sql.NVarChar(16), event.source)
    .query<InsertedEventRow>(`INSERT INTO dbo.task_events (task_id, type, summary, payload, source)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id, inserted.type, inserted.summary, inserted.payload,
        inserted.source, inserted.at
      VALUES (@taskId, @type, @summary, @payload, @source);`);
  const row = inserted.recordset[0];
  if (!row) throw new Error('Task event insert returned no row');

  let title = (event.summary?.trim() || event.type).slice(0, 400);
  if (title.length === 400 && title.charCodeAt(399) >= 0xd800 && title.charCodeAt(399) <= 0xdbff) {
    title = title.slice(0, -1);
  }
  await new sql.Request(transaction)
    .input('kind', sql.NVarChar(64), event.type)
    .input('title', sql.NVarChar(400), title)
    .input('link', sql.NVarChar(100), `task:${event.taskId}`)
    .query(`INSERT INTO dbo.activity (area, kind, title, link)
      VALUES (N'factory', @kind, @title, @link);`);
  return toTaskEvent(row, event.taskId);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reportedMetrics(event: RecordTaskEventInput, payload: unknown): {
  sourceEventId: string;
  metrics: { metric: 'input_tokens' | 'output_tokens' | 'premium_requests'; quantity: number }[];
} | null {
  if (event.source !== 'runner') return null;
  const envelope = record(payload);
  const invocationId = envelope?.invocationId;
  const eventIndex = envelope?.eventIndex;
  if (typeof invocationId !== 'string' || invocationId.length === 0 || invocationId.length > 255 ||
    !Number.isSafeInteger(eventIndex) || (eventIndex as number) < 0) return null;
  const data = record(envelope?.data);
  const result = record(data?.result);
  const response = record(result?.response);
  const params = record(data?.params);
  const update = record(params?.update);
  const usage = record(response?.usage) ?? record(result?.usage) ?? record(params?.usage) ?? record(update?.usage);
  if (!usage) return null;

  const metrics: { metric: 'input_tokens' | 'output_tokens' | 'premium_requests'; quantity: number }[] = [];
  for (const [metric, keys] of [
    ['input_tokens', ['input_tokens', 'inputTokens']],
    ['output_tokens', ['output_tokens', 'outputTokens']],
    ['premium_requests', ['premium_requests', 'premiumRequests']],
  ] as const) {
    const quantity = keys.map((key) => usage[key]).find(Number.isSafeInteger);
    if (typeof quantity === 'number' && quantity >= 0) metrics.push({ metric, quantity });
  }
  return { sourceEventId: `${invocationId}:${eventIndex}`, metrics };
}

async function insertUsage(
  transaction: sql.Transaction,
  taskId: string,
  projectId: string,
  source: TaskUsageRecord['source'],
  metric: TaskUsageRecord['metric'],
  quantity: number,
  sourceEventId: string,
): Promise<void> {
  await new sql.Request(transaction)
    .input('taskId', sql.BigInt, BigInt(taskId))
    .input('projectId', sql.BigInt, BigInt(projectId))
    .input('source', sql.NVarChar(16), source)
    .input('metric', sql.NVarChar(32), metric)
    .input('quantity', sql.Decimal(19, 6), quantity)
    .input('sourceEventId', sql.NVarChar(300), sourceEventId)
    .query(`IF NOT EXISTS (SELECT 1 FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
        WHERE task_id = @taskId AND source = @source AND metric = @metric AND source_event_id = @sourceEventId)
      INSERT dbo.usage (task_id, project_id, source, metric, quantity, source_event_id)
      VALUES (@taskId, @projectId, @source, @metric, @quantity, @sourceEventId);`);
}

async function recordRunnerUsage(
  transaction: sql.Transaction,
  event: RecordTaskEventInput,
  payload: unknown,
): Promise<void> {
  if (event.source !== 'runner') return;
  const envelope = record(payload);
  const invocationId = envelope?.invocationId;
  const eventIndex = envelope?.eventIndex;
  if (typeof invocationId !== 'string' || invocationId.length === 0 || invocationId.length > 255 ||
    !Number.isSafeInteger(eventIndex) || (eventIndex as number) < 0) return;
  const data = record(envelope?.data);
  if (!data) return;
  const isAgentTurn = event.type === 'agent_turn';
  const reported = reportedMetrics(event, payload);
  if (!isAgentTurn && (!reported || reported.metrics.length === 0)) return;
  const taskResult = await new sql.Request(transaction)
    .input('taskId', sql.BigInt, BigInt(event.taskId))
    .query<UsageTaskRow>(`SELECT CAST(project_id AS varchar(19)) AS projectId, agent
      FROM dbo.tasks WHERE id = @taskId;`);
  const task = taskResult.recordset[0];
  if (!task) return;
  if (isAgentTurn && data.agent === task.agent) {
    await insertUsage(
      transaction, event.taskId, task.projectId, task.agent, 'turns', 1, `${invocationId}:turn`,
    );
  }
  if (!reported) return;
  for (const { metric, quantity } of reported.metrics) {
    await insertUsage(
      transaction, event.taskId, task.projectId, task.agent, metric, quantity, reported.sourceEventId,
    );
  }
}

async function taskUsage(executor: sql.ConnectionPool | sql.Transaction, taskId: string): Promise<TaskUsageRecord[]> {
  const request = executor instanceof sql.Transaction ? new sql.Request(executor) : databaseReadRequest(executor);
  const { recordset } = await request
    .input('taskId', sql.BigInt, BigInt(taskId))
    .query<UsageRow>(`SELECT CAST(NULL AS varchar(19)) AS id, source, metric, SUM(quantity) AS quantity,
        SUM(cost_dkk) AS costDkk, CAST(NULL AS varchar(19)) AS sandboxSessionId, MAX(at) AS at,
        CAST(0 AS bit) AS estimated
      FROM dbo.usage WHERE task_id = @taskId AND source <> N'sandbox'
      GROUP BY source, metric
      UNION ALL
      SELECT CAST(id AS varchar(19)) AS id, source, metric, quantity, cost_dkk AS costDkk,
        CAST(sandbox_session_id AS varchar(19)) AS sandboxSessionId, at,
        CAST(CASE WHEN source = N'sandbox' THEN 1 ELSE 0 END AS bit) AS estimated
      FROM dbo.usage WHERE task_id = @taskId AND source = N'sandbox'
      UNION ALL
      SELECT CAST(NULL AS varchar(19)) AS id, N'sandbox' AS source, N'minutes' AS metric,
        CONVERT(decimal(19,6), DATEDIFF_BIG(millisecond, started_at, SYSUTCDATETIME()) / 60000.0) AS quantity,
        CONVERT(decimal(12,4), ROUND(DATEDIFF_BIG(millisecond, started_at, SYSUTCDATETIME()) / 3600000.0 *
          CASE size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 4)) AS costDkk,
        CAST(id AS varchar(19)) AS sandboxSessionId, SYSUTCDATETIME() AS at,
        CAST(1 AS bit) AS estimated
      FROM dbo.sandbox_sessions
      WHERE task_id = @taskId AND status = N'Active' AND ended_at IS NULL
      ORDER BY at, source, metric;`);
  return recordset.map((row) => ({ ...row, at: iso(row.at) as string }));
}

async function rollback(transaction: sql.Transaction): Promise<void> {
  try { await transaction.rollback(); }
  catch { /* The transaction may already have rolled back. */ }
}

async function acquireSleepSwitchLock(transaction: sql.Transaction, mode: 'Shared' | 'Exclusive'): Promise<void> {
  const { recordset } = await new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), sleepSwitchLock)
    .input('mode', sql.NVarChar(16), mode)
    .query<{ result: number }>(`DECLARE @result int;
      EXEC @result = sys.sp_getapplock
        @Resource = @resource, @LockMode = @mode, @LockOwner = N'Transaction', @LockTimeout = 10000;
      SELECT @result AS result;`);
  if ((recordset[0]?.result ?? -1) < 0) throw new Error('Task coordination lock unavailable');
}

export function createTaskStore(
  pool: sql.ConnectionPool,
  eventHub: TaskEventHub,
  eventArchive?: TaskEventArchive,
): TaskStore {
  return {
    async create(input: CreateTaskInput) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await acquireSleepSwitchLock(transaction, 'Shared');
        const project = await new sql.Request(transaction)
          .input('projectId', sql.BigInt, BigInt(input.projectId))
          .query<{ defaultAgent: 'codex' | 'copilot' }>(
            'SELECT default_agent AS defaultAgent FROM dbo.projects WITH (UPDLOCK, HOLDLOCK) WHERE id = @projectId AND active = 1');
        const defaultAgent = project.recordset[0]?.defaultAgent;
        if (!defaultAgent) {
          await transaction.rollback();
          return null;
        }
        const inserted = await new sql.Request(transaction)
          .input('projectId', sql.BigInt, BigInt(input.projectId))
          .input('title', sql.NVarChar(200), input.title)
          .input('request', sql.NVarChar(sql.MAX), input.request)
          .input('agent', sql.NVarChar(16), input.agent ?? defaultAgent)
          .input('modelOverride', sql.NVarChar(100), input.modelOverride ?? null)
          .input('reasoningOverride', sql.NVarChar(32), input.reasoningOverride ?? null)
          .input('priority', sql.Int, input.priority ?? 0)
          .query<TaskRow>(`INSERT INTO dbo.tasks
            (project_id, title, request, source, agent, model_override, reasoning_override, priority)
            OUTPUT ${insertedTaskColumns}
            VALUES (@projectId, @title, @request, N'board', @agent, @modelOverride, @reasoningOverride, @priority);`);
        const task = inserted.recordset[0];
        if (!task) throw new Error('Task insert returned no row');
        const event: RecordTaskEventInput = {
          taskId: task.id,
          type: 'created',
          summary: 'Task created from the board',
          payload: { state: 'Ready' },
          source: 'backend',
        };
        const serializedPayload = validateEvent(event);
        const publishedEvent = await insertTaskEvent(transaction, event, serializedPayload);
        await transaction.commit();
        eventHub.publish(publishedEvent);
        return toTask(task);
      } catch {
        await rollback(transaction);
        throw new Error('Task persistence failed');
      }
    },

    async withNoActiveTasks<T>(operation: () => Promise<T>) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await acquireSleepSwitchLock(transaction, 'Exclusive');
        const active = await new sql.Request(transaction)
          .query<{ hasActiveTask: boolean }>(`SELECT CONVERT(bit, CASE WHEN EXISTS (
            SELECT 1 FROM dbo.tasks WHERE state IN (N'Ready', N'Running', N'PauseRequested')
          ) THEN 1 ELSE 0 END) AS hasActiveTask;`);
        if (active.recordset[0]?.hasActiveTask) {
          await transaction.rollback();
          return { kind: 'active' as const };
        }
        const value = await operation();
        await transaction.commit();
        return { kind: 'idle' as const, value };
      } catch {
        await rollback(transaction);
        throw new Error('Task persistence failed');
      }
    },

    async list(filters: TaskListFilters) {
      const request = databaseReadRequest(pool)
        .input('limit', sql.Int, filters.limit)
        .input('offset', sql.Int, filters.offset);
      const clauses: string[] = [];
      if (filters.projectId !== undefined) {
        request.input('projectId', sql.BigInt, BigInt(filters.projectId));
        clauses.push('project_id = @projectId');
      }
      if (filters.agent !== undefined) {
        request.input('agent', sql.NVarChar(16), filters.agent);
        clauses.push('agent = @agent');
      }
      if (filters.state !== undefined) {
        request.input('state', sql.NVarChar(32), filters.state);
        clauses.push('state = @state');
      }
      if (filters.createdAfter !== undefined) {
        request.input('createdAfter', sql.DateTime2(7), new Date(filters.createdAfter));
        clauses.push('created_at >= @createdAfter');
      }
      if (filters.createdBefore !== undefined) {
        request.input('createdBefore', sql.DateTime2(7), new Date(filters.createdBefore));
        clauses.push('created_at < @createdBefore');
      }
      if (filters.search !== undefined) {
        request.input('search', sql.NVarChar(100), filters.search);
        clauses.push('(CHARINDEX(@search, title) > 0 OR CHARINDEX(@search, request) > 0)');
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const { recordset } = await request.query<TaskRow>(`SELECT ${taskColumns} FROM dbo.tasks ${where}
        ORDER BY created_at DESC, id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);
      return recordset.map(toTask);
    },

    async get(id: string, eventLimit: number, eventOffset: number): Promise<TaskDetail | null> {
      if (!eventArchive) {
        const taskResult = await databaseReadRequest(pool)
          .input('taskId', sql.BigInt, BigInt(id))
          .query<TaskRow>(`SELECT ${taskColumns} FROM dbo.tasks WHERE id = @taskId;`);
        const row = taskResult.recordset[0];
        if (!row) return null;
        const eventsResult = await databaseReadRequest(pool)
          .input('taskId', sql.BigInt, BigInt(id))
          .input('eventLimit', sql.Int, eventLimit)
          .input('eventOffset', sql.Int, eventOffset)
          .query<EventRow>(`SELECT CAST(id AS varchar(19)) AS id, type, summary,
            CASE WHEN DATALENGTH(payload) > 4096 THEN NULL ELSE payload END AS payload,
            CAST(CASE WHEN DATALENGTH(payload) > 4096 THEN 1 ELSE 0 END AS bit) AS payloadTruncated,
            source, at
            FROM dbo.task_events WHERE task_id = @taskId
            ORDER BY at ASC, id ASC OFFSET @eventOffset ROWS FETCH NEXT @eventLimit ROWS ONLY;`);
        return {
          ...toTask(row),
          usage: await taskUsage(pool, id),
          events: eventsResult.recordset.map((event) => ({
            ...event,
            payload: parsePayload(event.payload),
            at: iso(event.at) as string,
          })),
        };
      }

      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await acquireTaskEventArchiveLock(transaction, 'Shared');
        const taskResult = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(id))
          .query<TaskRow>(`SELECT ${taskColumns} FROM dbo.tasks WHERE id = @taskId;`);
        const row = taskResult.recordset[0];
        if (!row) {
          await transaction.rollback();
          return null;
        }

        const archivedPage = await eventArchive.prepareArchivedEvents(transaction, id, eventOffset, eventLimit);
        const usage = await taskUsage(transaction, id);
        const remainingLimit = eventLimit - archivedPage.eventCount;
        let activeEvents: TaskEventRecord[] = [];
        if (remainingLimit > 0) {
          const activeOffset = archivedPage.complete ? Math.max(eventOffset - archivedPage.total, 0) : 0;
          const eventsResult = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(id))
            .input('eventLimit', sql.Int, remainingLimit)
            .input('eventOffset', sql.Int, activeOffset)
            .query<EventRow>(`SELECT CAST(id AS varchar(19)) AS id, type, summary,
              CASE WHEN DATALENGTH(payload) > 4096 THEN NULL ELSE payload END AS payload,
              CAST(CASE WHEN DATALENGTH(payload) > 4096 THEN 1 ELSE 0 END AS bit) AS payloadTruncated,
              source, at
              FROM dbo.task_events WHERE task_id = @taskId
              ORDER BY at ASC, id ASC OFFSET @eventOffset ROWS FETCH NEXT @eventLimit ROWS ONLY;`);
          activeEvents = eventsResult.recordset.map((event) => ({
            ...event,
            payload: parsePayload(event.payload),
            at: iso(event.at) as string,
          }));
        }
        await transaction.commit();
        const archivedEvents = await eventArchive.restoreArchivedEvents(archivedPage);
        return { ...toTask(row), events: [...archivedEvents, ...activeEvents], usage };
      } catch {
        await rollback(transaction);
        throw new Error('Task detail persistence failed');
      }
    },

    async getActiveRepository(id: string, foundrySessionId: string): Promise<string | null> {
      const result = await pool.request()
        .input('taskId', sql.BigInt, BigInt(id))
        .input('foundrySessionId', sql.NVarChar(255), foundrySessionId)
        .query<{ repo: string }>(`SELECT p.repo
          FROM dbo.tasks AS t
          INNER JOIN dbo.projects AS p ON p.id = t.project_id
          INNER JOIN dbo.sandbox_sessions AS s ON s.task_id = t.id
          WHERE t.id = @taskId AND t.state IN (N'Running', N'PauseRequested')
            AND s.foundry_session_id = @foundrySessionId AND s.status IN (N'Starting', N'Active', N'Idle')
            AND s.ended_at IS NULL;`);
      return result.recordset[0]?.repo ?? null;
    },

    async getEventsAfter(taskId: string, eventId: string, limit: number): Promise<TaskEventMessage[]> {
      const result = await databaseReadRequest(pool)
        .input('taskId', sql.BigInt, BigInt(taskId))
        .input('eventId', sql.BigInt, BigInt(eventId))
        .input('limit', sql.Int, limit)
        .query<EventRow>(`SELECT TOP (@limit) CAST(id AS varchar(19)) AS id, type, summary,
          CASE WHEN DATALENGTH(payload) > 4096 THEN NULL ELSE payload END AS payload,
          CAST(CASE WHEN DATALENGTH(payload) > 4096 THEN 1 ELSE 0 END AS bit) AS payloadTruncated,
          source, at
          FROM dbo.task_events WHERE task_id = @taskId AND id > @eventId
          ORDER BY id ASC;`);
      return result.recordset.map((event) => ({
        ...event,
        taskId,
        payload: parsePayload(event.payload),
        at: iso(event.at) as string,
      }));
    },

    async getRunningContext() {
      const result = await databaseReadRequest(pool)
        .input('taskLimit', sql.Int, runningContextTaskLimit + 1)
        .input('eventLimit', sql.Int, runningContextEventLimit)
        .query<RunningContextRow>(`WITH running_tasks AS (
            SELECT TOP (@taskLimit) t.id AS task_id, t.project_id, p.name AS project_name,
              t.title, t.agent, t.state, t.activity, t.started_at,
              ROW_NUMBER() OVER (ORDER BY t.started_at DESC, t.id DESC) AS task_order
            FROM dbo.tasks AS t
            INNER JOIN dbo.projects AS p ON p.id = t.project_id
            WHERE t.state = N'Running'
            ORDER BY t.started_at DESC, t.id DESC
          )
          SELECT CONVERT(varchar(19), t.task_id) AS id,
            CONVERT(varchar(19), t.project_id) AS projectId, t.project_name AS projectName,
            t.title, t.agent, t.state, t.activity, t.started_at AS startedAt,
            CONVERT(varchar(19), e.id) AS eventId, e.type AS eventType,
            e.summary AS eventSummary, e.source AS eventSource, e.at AS eventAt
          FROM running_tasks AS t
          OUTER APPLY (
            SELECT TOP (@eventLimit) e.id, e.type, e.summary, e.source, e.at
            FROM dbo.task_events AS e
            WHERE e.task_id = t.task_id
            ORDER BY e.at DESC, e.id DESC
          ) AS e
          ORDER BY t.task_order, e.at DESC, e.id DESC;`);
      const tasks = new Map<string, RunningTaskContext>();
      for (const row of result.recordset) {
        let task = tasks.get(row.id);
        if (!task) {
          task = {
            id: row.id,
            projectId: row.projectId,
            projectName: row.projectName,
            title: row.title,
            agent: row.agent,
            state: row.state,
            activity: row.activity,
            startedAt: iso(row.startedAt),
            recentEvents: [],
          };
          tasks.set(row.id, task);
        }
        if (row.eventId !== null && row.eventType !== null && row.eventSource !== null && row.eventAt !== null) {
          const summary = row.eventSummary?.slice(0, runningContextSummaryLimit) ?? null;
          task.recentEvents.push({
            type: row.eventType,
            summary,
            summaryTruncated: row.eventSummary !== null && row.eventSummary.length > runningContextSummaryLimit,
            source: row.eventSource,
            at: iso(row.eventAt) as string,
          });
        }
      }
      const runningTasks = Array.from(tasks.values());
      const truncated = runningTasks.length > runningContextTaskLimit;
      return {
        runningTasks: runningTasks.slice(0, runningContextTaskLimit),
        truncated,
      };
    },

    async transition(id: string, state: TaskState, completionVerified = false): Promise<TaskTransitionResult> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await acquireSleepSwitchLock(transaction, 'Shared');
        if (state === 'Running') {
          const agentResult = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(id))
            .query<{ agent: 'codex' | 'copilot' }>('SELECT agent FROM dbo.tasks WHERE id = @taskId;');
          if (agentResult.recordset[0]?.agent === 'codex') {
            const credential = await new sql.Request(transaction)
              .query<{ status: string; renewalActive: boolean }>(`SELECT status,
                CAST(CASE WHEN renewal_lease_until > SYSUTCDATETIME() THEN 1 ELSE 0 END AS bit) AS renewalActive
                FROM dbo.credential_status WITH (UPDLOCK, HOLDLOCK) WHERE name = N'codex-login';`);
            if (credential.recordset[0]?.status === 'failed') {
              await transaction.rollback();
              return { kind: 'credential-unavailable' };
            }
            if (credential.recordset[0]?.renewalActive !== false) {
              await transaction.rollback();
              return { kind: 'renewal-active' };
            }
          }
        }
        const currentResult = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(id))
          .query<{ state: TaskState }>('SELECT state FROM dbo.tasks WITH (UPDLOCK, ROWLOCK) WHERE id = @taskId;');
        const current = currentResult.recordset[0]?.state;
        if (!current) {
          await transaction.rollback();
          return { kind: 'not-found' };
        }
        if (!canTransitionTask(current, state, completionVerified)) {
          await transaction.rollback();
          return { kind: 'invalid-transition' };
        }
        const releasesLease = ['Paused', 'NeedsAttention', 'Done', 'Cancelled'].includes(state);
        const updated = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(id))
          .input('state', sql.NVarChar(32), state)
          .input('releasesLease', sql.Bit, releasesLease)
          .query<TaskRow>(`UPDATE dbo.tasks SET state = @state,
            started_at = CASE WHEN @state = N'Running' THEN COALESCE(started_at, SYSUTCDATETIME()) ELSE started_at END,
            finished_at = CASE WHEN @state IN (N'Done', N'Cancelled') THEN SYSUTCDATETIME() ELSE finished_at END,
            lease_owner = CASE WHEN @releasesLease = 1 THEN NULL ELSE lease_owner END,
            lease_until = CASE WHEN @releasesLease = 1 THEN NULL ELSE lease_until END
            OUTPUT ${insertedTaskColumns}
            WHERE id = @taskId;`);
        const task = updated.recordset[0];
        if (!task) throw new Error('Task update returned no row');
        const event: RecordTaskEventInput = {
          taskId: id,
          type: 'state_changed',
          summary: 'Task state changed',
          payload: { from: current, to: state },
          source: 'backend',
        };
        const serializedPayload = validateEvent(event);
        const publishedEvent = await insertTaskEvent(transaction, event, serializedPayload);
        await transaction.commit();
        eventHub.publish(publishedEvent);
        return { kind: 'ok', task: toTask(task) };
      } catch {
        await rollback(transaction);
        throw new Error('Task persistence failed');
      }
    },

    async recordEvent(event: RecordTaskEventInput): Promise<TaskEventMessage> {
      const payload = validateEvent(event);
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        let currentState: TaskState | undefined;
        if (event.type === 'disk_low') {
          const task = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(event.taskId))
            .query<{ state: TaskState }>(
              'SELECT state FROM dbo.tasks WITH (UPDLOCK, ROWLOCK) WHERE id = @taskId;');
          currentState = task.recordset[0]?.state;
        }
        const publishedEvent = await insertTaskEvent(transaction, event, payload);
        await recordRunnerUsage(transaction, event, event.payload);
        let stateChangedEvent: TaskEventMessage | undefined;
        if (currentState === 'Running') {
          await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(event.taskId))
            .query(`UPDATE dbo.tasks SET state = N'NeedsAttention', lease_owner = NULL, lease_until = NULL
              WHERE id = @taskId AND state = N'Running';`);
          const stateChanged: RecordTaskEventInput = {
            taskId: event.taskId,
            type: 'state_changed',
            summary: 'Low sandbox disk; task needs attention',
            payload: { from: 'Running', to: 'NeedsAttention', reason: 'disk_low' },
            source: 'backend',
          };
          stateChangedEvent = await insertTaskEvent(
            transaction,
            stateChanged,
            validateEvent(stateChanged),
          );
        }
        await transaction.commit();
        eventHub.publish(publishedEvent);
        if (stateChangedEvent) eventHub.publish(stateChangedEvent);
        return publishedEvent;
      } catch {
        await rollback(transaction);
        throw new Error('Task event persistence failed');
      }
    },
  };
}
