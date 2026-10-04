import sql from 'mssql';
import type { DispatcherStore, DispatchClaimResult } from '../factory/dispatcher.js';
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
): Promise<TaskEventMessage> {
  const { recordset } = await new sql.Request(transaction)
    .input('taskId', sql.BigInt, BigInt(taskId))
    .input('type', sql.NVarChar(64), type)
    .input('summary', sql.NVarChar(2000), summary)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
    .query<EventRow>(`INSERT dbo.task_events (task_id, type, summary, payload, source)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id, CAST(inserted.task_id AS varchar(19)) AS taskId,
        inserted.type, inserted.summary, inserted.payload, CAST(0 AS bit) AS payloadTruncated,
        inserted.source, inserted.at
      VALUES (@taskId, @type, @summary, @payload, N'backend');
      INSERT dbo.activity (area, kind, title, link)
      VALUES (N'factory', @type, @summary, CONCAT(N'task:', @taskId));`);
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
              SELECT TRY_CONVERT(int, JSON_VALUE(value, '$'))
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
                WHERE active.state = N'Running'
                  OR (active.state = N'Ready' AND active.lease_until > @now)) < @globalLimit
              AND (SELECT COUNT_BIG(*) FROM dbo.tasks AS projectActive
                WHERE projectActive.project_id = t.project_id
                  AND (projectActive.state = N'Running'
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

    async endTaskSessions(taskId, state) {
      const { recordset } = await pool.request()
        .input('taskId', sql.BigInt, BigInt(taskId))
        .input('state', sql.NVarChar(32), state)
        .query<{ sandboxSessionId: string }>(`DECLARE @ended TABLE (id bigint NOT NULL);
          UPDATE dbo.sandbox_sessions SET
            status = CASE WHEN @state = N'Paused' THEN N'Idle' WHEN @state = N'NeedsAttention' THEN N'Crashed' ELSE N'Ended' END,
            end_reason = CASE WHEN @state = N'Paused' THEN N'idle' WHEN @state = N'NeedsAttention' THEN N'crashed'
              WHEN @state = N'Done' THEN N'done' ELSE N'cancelled' END,
            ended_at = SYSUTCDATETIME()
          OUTPUT inserted.id INTO @ended
          WHERE task_id = @taskId AND status = N'Active';
          UPDATE dbo.sandbox_turns SET status = N'cancelled', ended_at = SYSUTCDATETIME()
          WHERE status = N'running' AND sandbox_session_id IN (SELECT id FROM @ended);
          SELECT CAST(id AS varchar(19)) AS sandboxSessionId FROM @ended;`);
      return recordset.map(({ sandboxSessionId }) => sandboxSessionId);
    },
  };
}
