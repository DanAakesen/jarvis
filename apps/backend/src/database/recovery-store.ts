import sql from 'mssql';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';
import type { RecoveryClaimResult, TaskRecoveryStore } from '../factory/recovery-store.js';

interface RecoveryTaskRow {
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
  repository: string;
  defaultBranch: string;
  branch: string;
}

interface RecoveryEventRow extends Omit<TaskEventMessage, 'at' | 'payload'> {
  at: Date | string;
  payload: string | null;
}

async function acquireLock(transaction: sql.Transaction, resource: string, mode: 'Shared' | 'Exclusive'): Promise<void> {
  const { recordset } = await new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), resource)
    .input('mode', sql.NVarChar(16), mode)
    .query<{ result: number }>(`DECLARE @result int;
      EXEC @result = sys.sp_getapplock
        @Resource = @resource, @LockMode = @mode, @LockOwner = N'Transaction', @LockTimeout = 10000;
      SELECT @result AS result;`);
  if ((recordset[0]?.result ?? -1) < 0) throw new Error('Task recovery coordination lock unavailable');
}

async function insertRecoveryEvent(
  transaction: sql.Transaction,
  taskId: string,
): Promise<TaskEventMessage> {
  const { recordset } = await new sql.Request(transaction)
    .input('taskId', sql.BigInt, BigInt(taskId))
    .query<RecoveryEventRow>(`INSERT dbo.task_events (task_id, type, summary, payload, source)
      OUTPUT CAST(inserted.id AS varchar(19)) AS id, CAST(inserted.task_id AS varchar(19)) AS taskId,
        inserted.type, inserted.summary, inserted.payload, CAST(0 AS bit) AS payloadTruncated,
        inserted.source, inserted.at
      VALUES (@taskId, N'state_changed', N'Task recovery started', N'{"from":"NeedsAttention","to":"Running","reason":"recovery_requested"}', N'backend');
      INSERT dbo.activity (area, kind, title, link)
      VALUES (N'factory', N'state_changed', N'Task recovery started', CONCAT(N'task:', @taskId));`);
  const row = recordset[0];
  if (!row) throw new Error('Task recovery event was not recorded');
  return {
    ...row,
    at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
    payload: row.payload === null ? null : JSON.parse(row.payload) as unknown,
  };
}

async function rollback(transaction: sql.Transaction): Promise<void> {
  try { await transaction.rollback(); }
  catch { /* The transaction may already have rolled back. */ }
}

export function createTaskRecoveryStore(pool: sql.ConnectionPool, eventHub: TaskEventHub): TaskRecoveryStore {
  return {
    async getRunningTaskForSession(sandbox) {
      const { recordset } = await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(sandbox.sandboxSessionId))
        .input('foundrySessionId', sql.NVarChar(255), sandbox.foundrySessionId)
        .input('invocationId', sql.NVarChar(255), sandbox.invocationId)
        .query<{ taskId: string }>(`SELECT CAST(task.id AS varchar(19)) AS taskId
          FROM dbo.tasks AS task
          INNER JOIN dbo.sandbox_sessions AS session
            ON session.task_id = task.id AND session.id = @sandboxSessionId
              AND session.foundry_session_id = @foundrySessionId AND session.status = N'Active'
          INNER JOIN dbo.sandbox_turns AS turn
            ON turn.sandbox_session_id = session.id AND turn.invocation_id = @invocationId
              AND turn.status = N'running'
          WHERE task.state = N'Running';`);
      return recordset[0]?.taskId ?? null;
    },

    async claimRecovery(taskId, owner, leaseSeconds): Promise<RecoveryClaimResult> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        await acquireLock(transaction, 'jarvis.backend-sleep-switch', 'Shared');
        await acquireLock(transaction, 'jarvis.task-dispatcher', 'Exclusive');
        const { recordset } = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(taskId))
          .query<RecoveryTaskRow>(`SELECT CAST(t.id AS varchar(19)) AS taskId, CAST(t.project_id AS varchar(19)) AS projectId,
              t.title, t.request, t.agent, t.model_override AS modelOverride,
              t.reasoning_override AS reasoningOverride, t.attempt_count AS attemptCount,
            t.next_attempt_at AS nextAttemptAt, p.sandbox_size AS sandboxSize, p.tech,
            p.repo AS repository, p.default_branch AS defaultBranch, t.branch
            FROM dbo.tasks AS t WITH (UPDLOCK, ROWLOCK)
            INNER JOIN dbo.projects AS p ON p.id = t.project_id AND p.active = 1
            WHERE t.id = @taskId AND t.state = N'NeedsAttention' AND t.branch IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM dbo.sandbox_sessions AS s
                WHERE s.task_id = t.id AND s.status = N'Active');`);
        const task = recordset[0];
        if (!task) {
          await transaction.commit();
          return { kind: 'invalid-transition' };
        }

        const capacity = await new sql.Request(transaction)
          .input('projectId', sql.BigInt, BigInt(task.projectId))
          .query<{ available: boolean }>(`DECLARE @now datetime2(7) = SYSUTCDATETIME();
            DECLARE @globalLimit int = COALESCE((
              SELECT TRY_CONVERT(int, value) FROM dbo.settings
              WHERE scope = N'global' AND [key] = N'global.max_parallel_tasks'
            ), 1);
            DECLARE @projectLimit int = (SELECT max_parallel_tasks FROM dbo.projects WHERE id = @projectId);
            SELECT CAST(CASE WHEN
              (SELECT COUNT_BIG(*) FROM dbo.tasks AS active
                WHERE active.state IN (N'Running', N'PauseRequested')
                  OR (active.state = N'Ready' AND active.lease_until > @now)) < @globalLimit
              AND
              (SELECT COUNT_BIG(*) FROM dbo.tasks AS projectActive
                WHERE projectActive.project_id = @projectId
                  AND (projectActive.state IN (N'Running', N'PauseRequested')
                    OR (projectActive.state = N'Ready' AND projectActive.lease_until > @now))) < @projectLimit
              THEN 1 ELSE 0 END AS bit) AS available;`);
        if (!capacity.recordset[0]?.available) {
          await transaction.commit();
          return { kind: 'unavailable' };
        }

        const claimed = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(taskId))
          .input('owner', sql.NVarChar(100), owner)
          .input('leaseSeconds', sql.Int, leaseSeconds)
          .query(`UPDATE dbo.tasks SET state = N'Running', lease_owner = @owner,
              lease_until = DATEADD(second, @leaseSeconds, SYSUTCDATETIME()),
              next_attempt_at = NULL
            WHERE id = @taskId AND state = N'NeedsAttention' AND branch IS NOT NULL;`);
        if ((claimed.rowsAffected[0] ?? 0) !== 1) {
          await transaction.commit();
          return { kind: 'invalid-transition' };
        }
        const event = await insertRecoveryEvent(transaction, taskId);
        await transaction.commit();
        eventHub.publish(event);
        return {
          kind: 'claimed',
          task: {
            ...task,
            nextAttemptAt: task.nextAttemptAt instanceof Date
              ? task.nextAttemptAt.toISOString()
              : task.nextAttemptAt === null ? null : new Date(task.nextAttemptAt).toISOString(),
          },
        };
      } catch {
        await rollback(transaction);
        throw new Error('Task recovery could not claim the task');
      }
    },
  };
}
