import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { AlertNotifier, ActivityAlert } from '../alerts.js';
import { notifyAlert } from '../alerts.js';
import { insertActivityAlert } from './alert-store.js';
import type { RunningSandbox, SandboxHeartbeatStore } from '../factory/heartbeat.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';

type RunningSandboxRow = RunningSandbox;
interface InsertedCrashEventRow extends Omit<TaskEventMessage, 'at' | 'payload'> {
  at: Date | string;
  payload: string | null;
}

export function createSandboxHeartbeatStore(
  pool: sql.ConnectionPool,
  eventHub: TaskEventHub,
  alertNotifier?: AlertNotifier,
): SandboxHeartbeatStore {
  return {
    async listRunning() {
      const { recordset } = await databaseReadRequest(pool).query<RunningSandboxRow>(`SELECT
        CAST(s.id AS varchar(19)) AS sandboxSessionId, s.foundry_session_id AS foundrySessionId,
        s.agent_name AS agentName, activeTurn.invocation_id AS invocationId,
        CAST(CASE WHEN activeTurn.status = N'completed' THEN 1 ELSE 0 END AS bit) AS invocationCompleted
        FROM dbo.sandbox_sessions AS s
        JOIN dbo.tasks AS t ON t.id = s.task_id
        CROSS APPLY (
          SELECT TOP (1) invocation_id,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.task_events AS event
              WHERE event.task_id = s.task_id AND event.source = N'runner'
                AND event.type IN (N'completed', N'session_question')
                AND JSON_VALUE(event.payload, '$.invocationId') = turn.invocation_id)
              THEN N'completed' ELSE turn.status END AS status
          FROM dbo.sandbox_turns AS turn
          WHERE sandbox_session_id = s.id
          ORDER BY started_at DESC, id DESC
        ) AS activeTurn
        WHERE s.status = N'Active' AND s.agent_name IS NOT NULL AND (
          (activeTurn.status = N'running' AND t.state IN (N'Running', N'PauseRequested'))
          OR (activeTurn.status = N'completed' AND t.state IN (N'Running', N'PauseRequested', N'NeedsAttention'))
        );`);
      return recordset;
    },

    async recordHeartbeat(sandboxSessionId, invocationId, invocationCompleted = false) {
      await pool.request()
        .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
        .input('invocationId', sql.NVarChar(255), invocationId ?? null)
        .input('invocationCompleted', sql.Bit, invocationCompleted)
        .query(`UPDATE dbo.sandbox_sessions SET last_heartbeat_at = SYSUTCDATETIME()
          WHERE id = @sandboxSessionId AND status = N'Active';
          IF @invocationCompleted = 1
            UPDATE dbo.sandbox_turns SET status = N'completed', ended_at = SYSUTCDATETIME()
            WHERE sandbox_session_id = @sandboxSessionId AND invocation_id = @invocationId
              AND status = N'running';`);
    },

    async resolvePause(sandboxSessionId, state) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const current = await new sql.Request(transaction)
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .query<{ taskId: string; state: string; requestedAt: Date | null }>(`SELECT
            CAST(session.task_id AS varchar(19)) AS taskId, task.state,
            (SELECT MAX(at) FROM dbo.task_events WHERE task_id = task.id AND type = N'state_changed') AS requestedAt
            FROM dbo.sandbox_sessions AS session WITH (UPDLOCK, ROWLOCK)
            INNER JOIN dbo.tasks AS task WITH (UPDLOCK, ROWLOCK) ON task.id = session.task_id
            WHERE session.id = @sandboxSessionId AND session.status = N'Active';`);
        const row = current.recordset[0];
        if (!row || row.state !== 'PauseRequested' ||
          (state === 'Running' && row.requestedAt && Date.now() - row.requestedAt.getTime() < 30_000)) {
          await transaction.rollback();
          return false;
        }
        const payload = { from: 'PauseRequested', to: state };
        const summary = state === 'Paused' ? 'Task paused after its turn stopped' : 'Pause did not stop the active turn';
        const inserted = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(row.taskId))
          .input('state', sql.NVarChar(32), state)
          .input('summary', sql.NVarChar(2000), summary)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .query<InsertedCrashEventRow>(`UPDATE dbo.tasks SET state = @state
            WHERE id = @taskId AND state = N'PauseRequested';
            INSERT dbo.task_events (task_id, type, summary, payload, source)
            OUTPUT CAST(inserted.id AS varchar(19)) AS id, inserted.type, inserted.summary,
              inserted.payload, CAST(0 AS bit) AS payloadTruncated, inserted.source,
              inserted.at, CAST(inserted.task_id AS varchar(19)) AS taskId
            VALUES (@taskId, N'state_changed', @summary, @payload, N'backend');
            INSERT dbo.activity (area, kind, title, link)
            VALUES (N'factory', N'state_changed', @summary, CONCAT(N'task:', @taskId));`);
        const event = inserted.recordset[0];
        if (!event) throw new Error('Pause resolution did not update the task');
        await transaction.commit();
        eventHub.publish({
          ...event,
          payload,
          at: event.at instanceof Date ? event.at.toISOString() : new Date(event.at).toISOString(),
        });
        return true;
      } catch (error) {
        try { await transaction.rollback(); }
        catch { /* The transaction may already have rolled back. */ }
        throw error;
      }
    },

    async markNeedsAttention(sandboxSessionId, question, invocationId, invocationCompleted = false) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const session = await new sql.Request(transaction)
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .query<{ taskId: string }>(`SELECT CAST(task_id AS varchar(19)) AS taskId
            FROM dbo.sandbox_sessions WITH (UPDLOCK, ROWLOCK)
            WHERE id = @sandboxSessionId AND status = N'Active';`);
        const taskId = session.recordset[0]?.taskId;
        if (!taskId) {
          await transaction.rollback();
          return false;
        }

        const turn = await new sql.Request(transaction)
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .input('taskId', sql.BigInt, BigInt(taskId))
          .query<{ status: string; invocationId: string }>(`SELECT TOP (1)
            CASE WHEN EXISTS (SELECT 1 FROM dbo.task_events AS event
              WHERE event.task_id = @taskId AND event.source = N'runner'
                AND event.type IN (N'completed', N'session_question')
                AND JSON_VALUE(event.payload, '$.invocationId') = turn.invocation_id)
              THEN N'completed' ELSE turn.status END AS status, turn.invocation_id AS invocationId
            FROM dbo.sandbox_turns AS turn WITH (UPDLOCK, ROWLOCK)
            WHERE sandbox_session_id = @sandboxSessionId ORDER BY started_at DESC, id DESC;`);
        const latestTurn = turn.recordset[0];
        if (invocationId && latestTurn?.invocationId !== invocationId) {
          await transaction.rollback();
          return false;
        }

        const attentionQuestion = typeof question === 'string' ? question.trim().slice(0, 500) : '';
        if (invocationCompleted || latestTurn?.status === 'completed') {
          const ended = await new sql.Request(transaction)
            .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
            .input('invocationId', sql.NVarChar(255), latestTurn?.invocationId ?? null)
            .query(`UPDATE dbo.sandbox_sessions SET status = N'Ended', ended_at = SYSUTCDATETIME(),
              end_reason = N'idle_expired' WHERE id = @sandboxSessionId AND status = N'Active';
              UPDATE dbo.sandbox_turns SET status = N'completed', ended_at = SYSUTCDATETIME()
              WHERE sandbox_session_id = @sandboxSessionId AND invocation_id = @invocationId
                AND status = N'running';`);
          if ((ended.rowsAffected[0] ?? 0) !== 1) {
            await transaction.rollback();
            return false;
          }

          const summary = 'Sandbox session expired after its invocation completed';
          const payload = { reason: 'idle_expired', ...(invocationId ? { invocationId } : {}) };
          const event = await new sql.Request(transaction)
            .input('taskId', sql.BigInt, BigInt(taskId))
            .input('eventType', sql.NVarChar(64), 'sandbox_idle_expired')
            .input('summary', sql.NVarChar(2000), summary)
            .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .query<InsertedCrashEventRow>(`INSERT dbo.task_events (task_id, type, summary, payload, source)
              OUTPUT CAST(inserted.id AS varchar(19)) AS id, inserted.type, inserted.summary,
                inserted.payload, CAST(0 AS bit) AS payloadTruncated, inserted.source,
                inserted.at, CAST(inserted.task_id AS varchar(19)) AS taskId
              VALUES (@taskId, @eventType, @summary, @payload, N'backend');
              INSERT dbo.activity (area, kind, title, link)
              VALUES (N'factory', @eventType, @summary, CONCAT(N'task:', @taskId));`);
          const row = event.recordset[0];
          if (!row) throw new Error('Sandbox expiry event insert returned no row');
          await transaction.commit();
          eventHub.publish({
            ...row,
            payload,
            at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
          });
          return 'idle_expired';
        }

        const task = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(taskId))
          .query<{ state: string }>('SELECT state FROM dbo.tasks WITH (UPDLOCK, ROWLOCK) WHERE id = @taskId;');
        const state = task.recordset[0]?.state;
        if (state !== 'Running' && state !== 'PauseRequested') {
          await transaction.rollback();
          return false;
        }

        await new sql.Request(transaction)
          .input('sandboxSessionId', sql.BigInt, BigInt(sandboxSessionId))
          .input('status', sql.NVarChar(16), attentionQuestion ? 'Ended' : 'Crashed')
          .input('endReason', sql.NVarChar(16), attentionQuestion ? 'done' : 'crashed')
          .query(`UPDATE dbo.sandbox_sessions SET status = @status, ended_at = SYSUTCDATETIME(),
            end_reason = @endReason WHERE id = @sandboxSessionId;`);
        const summary = attentionQuestion
          ? `Question for Dan: ${attentionQuestion}`
          : 'Sandbox heartbeat detected a crash';
        const payload = {
          from: state,
          to: 'NeedsAttention',
          reason: attentionQuestion ? 'agent_question' : 'sandbox_crashed',
          ...(attentionQuestion ? { question: attentionQuestion } : {}),
        };
        const event = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, BigInt(taskId))
          .input('eventType', sql.NVarChar(64), 'state_changed')
          .input('from', sql.NVarChar(32), state)
          .input('summary', sql.NVarChar(2000), summary)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .query<InsertedCrashEventRow>(`UPDATE dbo.tasks SET state = N'NeedsAttention', lease_owner = NULL, lease_until = NULL
            WHERE id = @taskId AND state = @from;
            INSERT dbo.task_events (task_id, type, summary, payload, source)
            OUTPUT CAST(inserted.id AS varchar(19)) AS id, inserted.type, inserted.summary,
              inserted.payload, CAST(0 AS bit) AS payloadTruncated, inserted.source,
              inserted.at, CAST(inserted.task_id AS varchar(19)) AS taskId
            VALUES (@taskId, @eventType, @summary, @payload, N'backend');
            INSERT dbo.activity (area, kind, title, link)
            VALUES (N'factory', @eventType, @summary, CONCAT(N'task:', @taskId));`);
        const row = event.recordset[0];
        if (!row) throw new Error('Sandbox crash event insert returned no row');
        const crashAlert: ActivityAlert | undefined = attentionQuestion ? undefined : {
          type: 'sandbox_crash',
          dedupeKey: `sandbox:${sandboxSessionId}`,
          title: 'Sandbox crashed',
          link: `task:${taskId}`,
        };
        const alertInserted = crashAlert ? await insertActivityAlert(transaction, crashAlert) : false;
        await transaction.commit();
        eventHub.publish({
          ...row,
          payload,
          at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
        });
        if (alertInserted && crashAlert) notifyAlert(alertNotifier, crashAlert);
        return attentionQuestion ? 'needs_attention' : 'crashed';
      } catch (error) {
        try { await transaction.rollback(); }
        catch { /* The transaction may already have rolled back. */ }
        throw error;
      }
    },
  };
}
