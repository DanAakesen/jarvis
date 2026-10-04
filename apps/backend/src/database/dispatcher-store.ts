import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { DispatcherStore, DispatchClaimResult, TaskControlTarget } from '../factory/dispatcher.js';
import type { RunningSandbox } from '../factory/heartbeat.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';

interface DispatchTaskRow {
  taskId: string;
  projectId: string;
  title: string;
  request: string;
  agent: 'codex' | 'copilot';
  modelOverride: string | null;
  reasoningOverride: string | null;
  attemptCount: number;
  nextAttemptAt: Date | string | null;
  sandboxSize: '1x2' | '2x4';
  tech: string;
}

interface EventRow extends Omit<TaskEventMessage, 'at' | 'payload'> {
  at: Date | string;
  payload: string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const deadlockAttempts = 3;

function sqlErrorNumber(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('number' in error)) return undefined;
  const number = (error as { number?: unknown }).number;
  return typeof number === 'number' ? number : undefined;
}

async function rollback(transaction: sql.Transaction): Promise<void> {
  try { await transaction.rollback(); }
  catch { /* The transaction may already have rolled back. */ }
}

async function acquireLock(transaction: sql.Transaction, resource: string, mode: 'Shared' | 'Exclusive'): Promise<void> {
  const { recordset } = await new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), resource)
    .input('mode', sql.NVarChar(16), mode)
    .query<{ result: number }>(`DECLARE @result int;
      EXEC @result = sys.sp_getapplock
        @Resource = @resource, @LockMode = @mode, @LockOwner = N'Transaction', @LockTimeout = 10000;
      SELECT @result AS result;`);
  if ((recordset[0]?.result ?? -1) < 0) throw new Error('Dispatcher coordination lock unavailable');
}

async function insertEvent(
  transaction: sql.Transaction,
  taskId: string,
  type: string,
  summary: string,
  payload: Record<string, unknown>,
  source: 'backend' | 'dan' = 'backend',
): Promise<TaskEventMessage> {
  let activityTitle = summary.slice(0, 400);
  if (activityTitle.length === 400 && activityTitle.charCodeAt(399) >= 0xd800 && activityTitle.charCodeAt(399) <= 0xdbff) {
    activityTitle = activityTitle.slice(0, -1);
  }
  const { recordset } = await new sql.Request(transaction)
    .input('taskId', sql.BigInt, BigInt(taskId))
    .input('type', sql.NVarChar(64), type)
    .input('summary', sql.NVarChar(2000), summary)
    .input('activityTitle', sql.NVarChar(400), activityTitle)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
    .input('source', sql.NVarChar(16), source)
    .query<EventRow>(`INSERT dbo.task_events (task_id, type, summary, payload, source)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id, CAST(inserted.task_id AS varchar(19)) AS taskId,
        inserted.type, inserted.summary, inserted.payload, CAST(0 AS bit) AS payloadTruncated,
        inserted.source, inserted.at
      VALUES (@taskId, @type, @summary, @payload, @source);
      INSERT dbo.activity (area, kind, title, link)
      VALUES (N'factory', @type, @activityTitle, CONCAT(N'task:', @taskId));`);
  const row = recordset[0];
  if (!row) throw new Error('Dispatcher event insert returned no row');
  return {
    ...row,
    at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
    payload: row.payload === null ? null : JSON.parse(row.payload) as unknown,
  };
}

export function createDispatcherStore(pool: sql.ConnectionPool, eventHub: TaskEventHub): DispatcherStore {
  return {
    async claimNext(owner, leaseSeconds, maxAttempts): Promise<DispatchClaimResult> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      const published: TaskEventMessage[] = [];
      try {
        await acquireLock(transaction, 'jarvis.backend-sleep-switch', 'Shared');
        await acquireLock(transaction, 'jarvis.task-dispatcher', 'Exclusive');

        const expired = await new sql.Request(transaction)
          .query<{ taskId: string }>(`SELECT CAST(id AS varchar(19)) AS taskId FROM dbo.tasks WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE state = N'Ready' AND lease_owner IS NOT NULL AND lease_until <= SYSUTCDATETIME();`);
        for (const { taskId } of expired.recordset) {
          const updated = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(taskId))
            .query<{ id: string }>(`UPDATE dbo.tasks SET state = N'NeedsAttention',
              lease_owner = NULL, lease_until = NULL, next_attempt_at = NULL
              OUTPUT CAST(inserted.id AS varchar(19)) AS id
              WHERE id = @taskId AND state = N'Ready' AND lease_until <= SYSUTCDATETIME();`);
          if (updated.recordset.length > 0) {
            published.push(await insertEvent(
              transaction, taskId, 'state_changed', 'Dispatcher lease expired before the sandbox was confirmed',
              { from: 'Ready', to: 'NeedsAttention', reason: 'dispatch_lease_expired' },
            ));
          }
        }

        const abandoned = await new sql.Request(transaction)
          .query<{ taskId: string }>(`SELECT CAST(t.id AS varchar(19)) AS taskId FROM dbo.tasks AS t
            WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE t.state = N'Running' AND t.lease_owner IS NOT NULL AND t.lease_until <= SYSUTCDATETIME()
              AND NOT EXISTS (SELECT 1 FROM dbo.sandbox_sessions AS s
                WHERE s.task_id = t.id AND s.status = N'Active');`);
        for (const { taskId } of abandoned.recordset) {
          const updated = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(taskId))
            .query<{ id: string }>(`UPDATE dbo.tasks SET state = N'NeedsAttention',
              lease_owner = NULL, lease_until = NULL, next_attempt_at = NULL
              OUTPUT CAST(inserted.id AS varchar(19)) AS id
              WHERE id = @taskId AND state = N'Running' AND lease_until <= SYSUTCDATETIME();`);
          if (updated.recordset.length > 0) {
            published.push(await insertEvent(
              transaction, taskId, 'state_changed', 'Dispatcher lease expired before the sandbox session was persisted',
              { from: 'Running', to: 'NeedsAttention', reason: 'dispatch_lease_expired' },
            ));
          }
        }

        const exhausted = await new sql.Request(transaction)
          .input('maxAttempts', sql.Int, maxAttempts)
          .query<{ taskId: string }>(`SELECT CAST(id AS varchar(19)) AS taskId
            FROM dbo.tasks WITH (UPDLOCK, READPAST, ROWLOCK)
            WHERE state = N'Ready' AND attempt_count >= @maxAttempts
              AND (next_attempt_at IS NULL OR next_attempt_at <= SYSUTCDATETIME())
              AND (lease_owner IS NULL OR lease_until <= SYSUTCDATETIME());`);
        for (const { taskId } of exhausted.recordset) {
          const updated = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(taskId))
            .input('maxAttempts', sql.Int, maxAttempts)
            .query<{ id: string }>(`UPDATE dbo.tasks SET state = N'NeedsAttention',
              lease_owner = NULL, lease_until = NULL, next_attempt_at = NULL
              OUTPUT CAST(inserted.id AS varchar(19)) AS id
              WHERE id = @taskId AND state = N'Ready' AND attempt_count >= @maxAttempts;`);
          if (updated.recordset.length > 0) {
            published.push(await insertEvent(
              transaction, taskId, 'state_changed', 'Dispatcher exhausted the available start attempts',
              { from: 'Ready', to: 'NeedsAttention', reason: 'dispatch_attempts_exhausted' },
            ));
          }
        }

        const claim = await new sql.Request(transaction)
          .input('owner', sql.NVarChar(100), owner)
          .input('leaseSeconds', sql.Int, leaseSeconds)
          .input('maxAttempts', sql.Int, maxAttempts)
          .query<DispatchTaskRow>(`DECLARE @now datetime2(7) = SYSUTCDATETIME();
            DECLARE @globalLimit int = COALESCE((
            SELECT TRY_CONVERT(int, value)
              FROM dbo.settings
              WHERE scope = N'global' AND [key] = N'global.max_parallel_tasks'
            ), 1);
            DECLARE @candidate TABLE (
              task_id bigint NOT NULL PRIMARY KEY, project_id bigint NOT NULL, title nvarchar(200) NOT NULL,
              request nvarchar(max) NOT NULL, agent nvarchar(16) NOT NULL, model_override nvarchar(100) NULL,
              reasoning_override nvarchar(32) NULL, attempt_count int NOT NULL,
              sandbox_size nvarchar(8) NOT NULL, tech nvarchar(32) NOT NULL
            );
            INSERT @candidate
            SELECT TOP (1) t.id, t.project_id, t.title, t.request, t.agent, t.model_override,
              t.reasoning_override, t.attempt_count, p.sandbox_size, p.tech
            FROM dbo.tasks AS t WITH (UPDLOCK, READPAST, ROWLOCK)
            INNER JOIN dbo.projects AS p ON p.id = t.project_id AND p.active = 1
            WHERE t.state = N'Ready'
              AND t.attempt_count < @maxAttempts
              AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= @now)
              AND (t.lease_owner IS NULL OR t.lease_until <= @now)
              AND (SELECT COUNT_BIG(*) FROM dbo.tasks AS active
                WHERE active.state IN (N'Running', N'PauseRequested')
                  OR (active.state = N'Ready' AND active.lease_until > @now)) < @globalLimit
              AND (SELECT COUNT_BIG(*) FROM dbo.tasks AS projectActive
                WHERE projectActive.project_id = t.project_id
                  AND (projectActive.state IN (N'Running', N'PauseRequested')
                    OR (projectActive.state = N'Ready' AND projectActive.lease_until > @now))) < p.max_parallel_tasks
            ORDER BY t.priority DESC, t.created_at, t.id;
            UPDATE t SET attempt_count = t.attempt_count + 1,
              lease_owner = @owner, lease_until = DATEADD(second, @leaseSeconds, @now)
            FROM dbo.tasks AS t INNER JOIN @candidate AS c ON c.task_id = t.id;
            SELECT CAST(c.task_id AS varchar(19)) AS taskId, CAST(c.project_id AS varchar(19)) AS projectId,
              c.title, c.request, c.agent, c.model_override AS modelOverride,
              c.reasoning_override AS reasoningOverride, c.attempt_count + 1 AS attemptCount,
              t.next_attempt_at AS nextAttemptAt, c.sandbox_size AS sandboxSize, c.tech
            FROM @candidate AS c INNER JOIN dbo.tasks AS t ON t.id = c.task_id;
            SELECT MIN(next_attempt_at) AS nextAttemptAt FROM dbo.tasks
            WHERE state = N'Ready' AND next_attempt_at > @now
              AND (lease_owner IS NULL OR lease_until <= @now);`);
        const task = claim.recordsets[0]?.[0] as DispatchTaskRow | undefined;
        const nextAttemptAt = claim.recordsets[1]?.[0]?.['nextAttemptAt'] as Date | string | null | undefined;
        await transaction.commit();
        for (const event of published) eventHub.publish(event);
        if (!task) return { kind: 'idle', nextAttemptAt: iso(nextAttemptAt ?? null) };
        return {
          kind: 'claimed',
          task: { ...task, nextAttemptAt: iso(task.nextAttemptAt) },
        };
      } catch {
        await rollback(transaction);
        throw new Error('Dispatcher could not claim a task');
      }
    },

    async deferClaim(owner, task, delayMs) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const { rowsAffected } = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(task.taskId))
          .input('owner', sql.NVarChar(100), owner)
          .input('attemptCount', sql.Int, task.attemptCount - 1)
          .input('delayMs', sql.Int, delayMs)
          .query(`UPDATE dbo.tasks SET attempt_count = @attemptCount,
            next_attempt_at = DATEADD(millisecond, @delayMs, SYSUTCDATETIME()),
            lease_owner = NULL, lease_until = NULL
            WHERE id = @taskId AND state = N'Ready' AND lease_owner = @owner;`);
        if ((rowsAffected[0] ?? 0) === 0) {
          await transaction.commit();
          return;
        }
        const event = await insertEvent(transaction, task.taskId, 'dispatch_retry', 'Dispatch deferred while a required resource is busy', {
          attemptCount: task.attemptCount - 1,
          nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
        });
        await transaction.commit();
        eventHub.publish(event);
      } catch {
        await rollback(transaction);
        throw new Error('Dispatcher could not defer a task');
      }
    },

    async failStart(owner, task, retryAt, reason) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const current = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(task.taskId))
          .input('owner', sql.NVarChar(100), owner)
          .query<{ state: string }>(`SELECT state FROM dbo.tasks WITH (UPDLOCK, ROWLOCK)
            WHERE id = @taskId AND lease_owner = @owner AND state IN (N'Ready', N'Running');`);
        const from = current.recordset[0]?.state;
        if (!from) throw new Error();
        const to = retryAt === null ? 'NeedsAttention' : 'Ready';
        const updated = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(task.taskId))
          .input('owner', sql.NVarChar(100), owner)
          .input('state', sql.NVarChar(32), to)
          .input('retryAt', sql.DateTime2(7), retryAt ? new Date(retryAt) : null)
          .query(`UPDATE dbo.tasks SET state = @state, next_attempt_at = @retryAt,
            lease_owner = NULL, lease_until = NULL
            WHERE id = @taskId AND lease_owner = @owner AND state IN (N'Ready', N'Running');`);
        if ((updated.rowsAffected[0] ?? 0) !== 1) throw new Error();
        const event = await insertEvent(
          transaction, task.taskId, 'state_changed',
          retryAt === null ? 'Dispatcher could not start the sandbox' : 'Dispatcher scheduled another start attempt',
          { from, to, reason, attemptCount: task.attemptCount, nextAttemptAt: retryAt },
        );
        await transaction.commit();
        eventHub.publish(event);
      } catch {
        await rollback(transaction);
        throw new Error('Dispatcher could not record a failed start');
      }
    },

    async recordStarted(owner, task, runnerName, accepted) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const owned = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(task.taskId))
          .input('owner', sql.NVarChar(100), owner)
          .query<{ id: string }>(`SELECT CAST(id AS varchar(19)) AS id FROM dbo.tasks WITH (UPDLOCK, ROWLOCK)
            WHERE id = @taskId AND state = N'Running' AND lease_owner = @owner
              AND lease_until > SYSUTCDATETIME();`);
        if (!owned.recordset[0]) throw new Error();
        const inserted = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(task.taskId))
          .input('sessionId', sql.NVarChar(255), accepted.sessionId)
          .input('runnerName', sql.NVarChar(255), runnerName)
          .input('size', sql.NVarChar(8), task.sandboxSize)
          .input('image', sql.NVarChar(255), runnerName)
          .query<{ sandboxSessionId: string }>(`INSERT dbo.sandbox_sessions
            (task_id, foundry_session_id, agent_version, agent_name, size, image, status)
            OUTPUT CAST(inserted.id AS varchar(19)) AS sandboxSessionId
            VALUES (@taskId, @sessionId, N'active', @runnerName, @size, @image, N'Active');`);
        const sandboxSessionId = inserted.recordset[0]?.sandboxSessionId;
        if (!sandboxSessionId) throw new Error();
        await new sql.Request(transaction)
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .input('sessionId', sql.NVarChar(255), accepted.sessionId)
          .input('invocationId', sql.NVarChar(255), accepted.invocationId)
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sandboxSessionId, @invocationId, N'task', @sessionId, N'running');`);
        const updated = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(task.taskId))
          .input('owner', sql.NVarChar(100), owner)
          .query(`UPDATE dbo.tasks SET lease_owner = NULL, lease_until = NULL, next_attempt_at = NULL
            WHERE id = @taskId AND state = N'Running' AND lease_owner = @owner;`);
        if ((updated.rowsAffected[0] ?? 0) !== 1) throw new Error();
        const event = await insertEvent(transaction, task.taskId, 'sandbox_started', 'Sandbox session started', {
          sandboxSessionId, foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId,
        });
        await transaction.commit();
        eventHub.publish(event);
        return sandboxSessionId;
      } catch {
        await rollback(transaction);
        throw new Error('Dispatcher could not persist the sandbox session');
      }
    },

    async getControlTarget(taskId): Promise<TaskControlTarget | null> {
      const { recordset } = await databaseReadRequest(pool)
        .input('taskId', sql.BigInt, BigInt(taskId))
        .query<TaskControlTarget>(`SELECT CAST(t.id AS varchar(19)) AS taskId,
          t.agent, t.request, t.model_override AS modelOverride, t.reasoning_override AS reasoningOverride,
          CAST(s.id AS varchar(19)) AS sandboxSessionId, s.foundry_session_id AS foundrySessionId,
          s.agent_name AS agentName, s.size AS sandboxSize, s.image, s.status AS sessionStatus,
          CASE WHEN s.status = N'Active' THEN activeTurn.invocation_id ELSE latestTurn.invocation_id END AS invocationId
          FROM dbo.tasks AS t
          OUTER APPLY (
            SELECT TOP (1) * FROM dbo.sandbox_sessions
            WHERE task_id = t.id AND status IN (N'Active', N'Idle')
            ORDER BY started_at DESC, id DESC
          ) AS s
          OUTER APPLY (
            SELECT TOP (1) invocation_id FROM dbo.sandbox_turns
            WHERE sandbox_session_id = s.id AND status = N'running'
            ORDER BY started_at DESC, id DESC
          ) AS activeTurn
          OUTER APPLY (
            SELECT TOP (1) invocation_id FROM dbo.sandbox_turns
            WHERE sandbox_session_id = s.id
            ORDER BY started_at DESC, id DESC
          ) AS latestTurn
          WHERE t.id = @taskId;`);
      const target = recordset[0];
      return target?.sandboxSessionId ? target : null;
    },

    async recordControlTurn(target, accepted, message) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const current = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(target.taskId))
          .input('sessionId', sql.BigInt, BigInt(target.sandboxSessionId))
          .input('invocationId', sql.NVarChar(255), target.invocationId)
          .query<{ invocationId: string }>(`SELECT turn.invocation_id AS invocationId
            FROM dbo.tasks AS task WITH (UPDLOCK, ROWLOCK)
            INNER JOIN dbo.sandbox_sessions AS session WITH (UPDLOCK, ROWLOCK)
              ON session.task_id = task.id AND session.id = @sessionId AND session.status = N'Active'
            INNER JOIN dbo.sandbox_turns AS turn WITH (UPDLOCK, ROWLOCK)
              ON turn.sandbox_session_id = session.id AND turn.status = N'running'
            WHERE task.id = @taskId AND task.state = N'Running' AND turn.invocation_id = @invocationId;`);
        if (!current.recordset[0]) {
          await transaction.rollback();
          return false;
        }
        await new sql.Request(transaction)
          .input('sessionId', sql.BigInt, BigInt(target.sandboxSessionId))
          .input('invocationId', sql.NVarChar(255), target.invocationId)
          .query(`UPDATE dbo.sandbox_turns SET status = N'cancelled', ended_at = SYSUTCDATETIME()
            WHERE sandbox_session_id = @sessionId AND invocation_id = @invocationId AND status = N'running';`);
        await new sql.Request(transaction)
          .input('sessionId', sql.BigInt, BigInt(target.sandboxSessionId))
          .input('invocationId', sql.NVarChar(255), accepted.invocationId)
          .input('acpSessionId', sql.NVarChar(255), accepted.sessionId)
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sessionId, @invocationId, N'steer', @acpSessionId, N'running');`);
        const messageCharacters = Array.from(message);
        const summary = messageCharacters.slice(0, 1_990).join('') + (messageCharacters.length > 1_990 ? '…' : '');
        const event = await insertEvent(transaction, target.taskId, 'steered', summary, { message }, 'dan');
        await transaction.commit();
        const payloadTruncated = event.payload !== null && Buffer.byteLength(JSON.stringify(event.payload)) > 4096;
        eventHub.publish({
          ...event,
          payload: payloadTruncated ? null : event.payload,
          payloadTruncated,
        });
        return true;
      } catch {
        await rollback(transaction);
        throw new Error('Dispatcher could not persist the steering turn');
      }
    },

    async recordResumedTurn(target, accepted): Promise<RunningSandbox> {
      if (accepted.sessionId !== target.foundrySessionId) {
        throw new Error('Foundry resumed a different session');
      }
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const current = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(target.taskId))
          .input('sessionId', sql.BigInt, BigInt(target.sandboxSessionId))
          .input('foundrySessionId', sql.NVarChar(255), target.foundrySessionId)
          .query<{ id: string }>(`SELECT CAST(session.id AS varchar(19)) AS id
            FROM dbo.tasks AS task WITH (UPDLOCK, ROWLOCK)
            INNER JOIN dbo.sandbox_sessions AS session WITH (UPDLOCK, ROWLOCK)
              ON session.task_id = task.id AND session.id = @sessionId
                AND session.foundry_session_id = @foundrySessionId AND session.status = N'Idle'
            WHERE task.id = @taskId AND task.state = N'Running';`);
        if (!current.recordset[0]) throw new Error();
        const reopened = await new sql.Request(transaction)
          .input('sessionId', sql.BigInt, BigInt(target.sandboxSessionId))
          .query(`UPDATE dbo.sandbox_sessions SET status = N'Active', started_at = SYSUTCDATETIME(),
            ended_at = NULL, end_reason = NULL WHERE id = @sessionId AND status = N'Idle';`);
        if ((reopened.rowsAffected[0] ?? 0) !== 1) throw new Error();
        const sandboxSessionId = target.sandboxSessionId;
        await new sql.Request(transaction)
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .input('invocationId', sql.NVarChar(255), accepted.invocationId)
          .input('acpSessionId', sql.NVarChar(255), accepted.sessionId)
          .query(`INSERT dbo.sandbox_turns (sandbox_session_id, invocation_id, mode, acp_session_id, status)
            VALUES (@sandboxSessionId, @invocationId, N'resume', @acpSessionId, N'running');`);
        const event = await insertEvent(transaction, target.taskId, 'sandbox_resumed', 'Sandbox session resumed', {
          sandboxSessionId, foundrySessionId: accepted.sessionId, invocationId: accepted.invocationId,
        });
        await transaction.commit();
        eventHub.publish(event);
        return {
          sandboxSessionId,
          foundrySessionId: accepted.sessionId,
          agentName: target.agentName,
          invocationId: accepted.invocationId,
        };
      } catch {
        await rollback(transaction);
        throw new Error('Dispatcher could not persist the resumed session');
      }
    },

    async endTaskSessions(taskId, state) {
      // Concurrent session ends can deadlock on the usage upsert's range locks (L61). Each attempt is
      // one transaction that rolls back completely, so retrying cannot double-count usage.
      for (let attempt = 1; ; attempt += 1) {
        let failure: number | undefined;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          const { recordset } = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(taskId))
            .input('state', sql.NVarChar(32), state)
            .query<{ sandboxSessionId: string }>(`DECLARE @ended TABLE (
                id bigint NOT NULL PRIMARY KEY, task_id bigint NOT NULL,
                started_at datetime2(7) NOT NULL, ended_at datetime2(7) NOT NULL, size nvarchar(8) NOT NULL
              );
              UPDATE dbo.sandbox_sessions SET
                status = CASE WHEN @state = N'Paused' THEN N'Idle' WHEN @state = N'NeedsAttention' THEN N'Crashed' ELSE N'Ended' END,
                end_reason = CASE WHEN @state = N'Paused' THEN N'idle' WHEN @state = N'NeedsAttention' THEN N'crashed'
                  WHEN @state = N'Done' THEN N'done' ELSE N'cancelled' END,
                ended_at = SYSUTCDATETIME()
              OUTPUT inserted.id, inserted.task_id, inserted.started_at, inserted.ended_at, inserted.size INTO @ended
              WHERE task_id = @taskId AND status = N'Active';
              IF @state = N'NeedsAttention'
                INSERT @ended (id, task_id, started_at, ended_at, size)
                SELECT s.id, s.task_id, s.started_at, s.ended_at, s.size
                FROM dbo.sandbox_sessions AS s WITH (UPDLOCK, ROWLOCK)
                WHERE s.task_id = @taskId AND s.status = N'Crashed'
                  AND NOT EXISTS (SELECT 1 FROM dbo.usage AS u WITH (UPDLOCK, HOLDLOCK)
                    WHERE u.sandbox_session_id = s.id AND u.source = N'sandbox'
                      AND u.metric = N'minutes' AND u.at = s.ended_at)
                  AND NOT EXISTS (SELECT 1 FROM @ended WHERE id = s.id);
              UPDATE s SET cost_estimate_dkk = CONVERT(decimal(12,4), ROUND(s.cost_estimate_dkk +
                DATEDIFF_BIG(millisecond, ended.started_at, ended.ended_at) / 3600000.0 *
                  CASE ended.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 4))
              FROM dbo.sandbox_sessions AS s
              INNER JOIN @ended AS ended ON ended.id = s.id;
              UPDATE u SET
                quantity = u.quantity + CONVERT(decimal(19,6),
                  DATEDIFF_BIG(millisecond, ended.started_at, ended.ended_at) / 60000.0),
                cost_dkk = session.cost_estimate_dkk, at = ended.ended_at
              FROM dbo.usage AS u
              INNER JOIN @ended AS ended ON u.sandbox_session_id = ended.id
                AND u.source = N'sandbox' AND u.metric = N'minutes'
              INNER JOIN dbo.sandbox_sessions AS session ON session.id = ended.id;
              INSERT dbo.usage
                (task_id, project_id, sandbox_session_id, source, metric, quantity, cost_dkk, at)
              SELECT ended.task_id, task.project_id, ended.id, N'sandbox', N'minutes',
                CONVERT(decimal(19,6), DATEDIFF_BIG(millisecond, ended.started_at, ended.ended_at) / 60000.0),
                session.cost_estimate_dkk, ended.ended_at
              FROM @ended AS ended
              INNER JOIN dbo.tasks AS task ON task.id = ended.task_id
              INNER JOIN dbo.sandbox_sessions AS session ON session.id = ended.id
              WHERE NOT EXISTS (SELECT 1 FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
                WHERE sandbox_session_id = ended.id AND source = N'sandbox' AND metric = N'minutes');
              UPDATE dbo.sandbox_sessions SET status = N'Ended',
                end_reason = CASE WHEN @state = N'Done' THEN N'done' ELSE N'cancelled' END
              WHERE task_id = @taskId AND status = N'Idle' AND @state NOT IN (N'Paused', N'NeedsAttention');
              UPDATE dbo.sandbox_turns SET
                status = CASE WHEN @state = N'Done' THEN N'completed'
                  WHEN @state = N'NeedsAttention' THEN N'failed' ELSE N'cancelled' END,
                ended_at = SYSUTCDATETIME()
              WHERE status = N'running' AND sandbox_session_id IN (SELECT id FROM @ended);
              SELECT CAST(id AS varchar(19)) AS sandboxSessionId FROM @ended;`);
          await transaction.commit();
          return recordset.map(({ sandboxSessionId }) => sandboxSessionId);
        } catch (error) {
          await rollback(transaction);
          failure = sqlErrorNumber(error);
        }
        if (failure === 1205 && attempt < deadlockAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 20)));
          continue;
        }
        // Only the SQL error number leaves this store; driver errors can contain SQL text.
        throw new Error(`Sandbox session usage persistence failed${failure === undefined ? '' : ` (SQL ${failure})`}`);
      }
    },
  };
}
