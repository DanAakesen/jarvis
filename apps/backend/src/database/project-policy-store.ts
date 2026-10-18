import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { withTaskPolicyLock } from './task-policy-lock.js';
import type { ProjectPolicyStore, PolicyPullRequest } from '../github/project-policy.js';

export function createProjectPolicyStore(pool: sql.ConnectionPool): ProjectPolicyStore {
  return {
    async getPullRequest(repository, number) {
      const { recordset } = await databaseReadRequest(pool)
        .input('repository', sql.NVarChar(140), repository)
        .input('number', sql.Int, number)
        .query<PolicyPullRequest>(`SELECT CONVERT(varchar(19), t.id) AS taskId, t.state AS taskState,
          p.repo AS repository, p.policy, pr.number, pr.state, pr.checks, pr.head_sha AS headSha,
          CONVERT(varchar(23), pr.opened_at, 126) + 'Z' AS openedAt
          FROM dbo.pull_requests AS pr
          INNER JOIN dbo.projects AS p ON p.id = pr.project_id
          INNER JOIN dbo.tasks AS t ON t.id = pr.task_id
          WHERE p.repo = @repository AND pr.number = @number;`);
      return recordset[0] ?? null;
    },
    async listOpenPullRequests(projectId) {
      const request = databaseReadRequest(pool);
      if (projectId !== undefined) request.input('projectId', sql.BigInt, BigInt(projectId));
      const projectFilter = projectId === undefined ? '' : ' AND p.id = @projectId';
      const { recordset } = await request.query<PolicyPullRequest>(`SELECT CONVERT(varchar(19), t.id) AS taskId,
        t.state AS taskState, p.repo AS repository, p.policy, pr.number, pr.state, pr.checks,
        pr.head_sha AS headSha, CONVERT(varchar(23), pr.opened_at, 126) + 'Z' AS openedAt
        FROM dbo.pull_requests AS pr
        INNER JOIN dbo.projects AS p ON p.id = pr.project_id
        INNER JOIN dbo.tasks AS t ON t.id = pr.task_id
        WHERE p.active = 1 AND p.policy = N'complete_without_deployment' AND pr.state = N'open'
          AND t.state IN (N'Running', N'NeedsAttention')${projectFilter}
        ORDER BY t.id, pr.number;`);
      return recordset;
    },
    async withActiveTask<T>(taskId: string, operation: () => Promise<T>, expectedHeadSha: string) {
      if (typeof expectedHeadSha !== 'string' || !/^[\da-f]{40}$/iu.test(expectedHeadSha)) {
        return { kind: 'awaiting_runner' as const };
      }
      return withTaskPolicyLock(pool, taskId, async (transaction) => {
        const { recordset } = await new sql.Request(transaction)
          .input('taskId', sql.BigInt, taskId)
          .input('headSha', sql.VarChar(40), expectedHeadSha.toLowerCase())
          .query<{ state: string; runnerCompleted: boolean }>(`SELECT task.state,
            CONVERT(bit, CASE WHEN task.lease_owner IS NULL AND EXISTS (
              SELECT 1 FROM dbo.task_events AS event
              WHERE event.task_id = task.id AND event.source = N'backend'
                AND event.type = N'runner_completion_verified'
                AND JSON_VALUE(event.payload, '$.workCommitSha') COLLATE Latin1_General_100_BIN2 = @headSha
                AND JSON_VALUE(event.payload, '$.executionGeneration') COLLATE Latin1_General_100_BIN2
                  = CONVERT(varchar(19), task.execution_generation)
                AND session.execution_generation = task.execution_generation
                AND JSON_VALUE(event.payload, '$.sandboxSessionId') COLLATE Latin1_General_100_BIN2
                  = CONVERT(varchar(19), session.id)
                AND JSON_VALUE(event.payload, '$.foundrySessionId') COLLATE Latin1_General_100_BIN2 = session.foundry_session_id
                AND JSON_VALUE(event.payload, '$.invocationId') COLLATE Latin1_General_100_BIN2 = turn.invocation_id
                AND turn.status = N'completed'
                AND (session.status = N'Active' OR (session.status = N'Ended'
                  AND session.end_reason IN (N'done', N'idle_expired')))
            ) THEN 1 ELSE 0 END) AS runnerCompleted
            FROM dbo.tasks AS task
            OUTER APPLY (
              SELECT TOP (1) candidate.id, candidate.foundry_session_id, candidate.status, candidate.end_reason,
                candidate.execution_generation
              FROM dbo.sandbox_sessions AS candidate WHERE candidate.task_id = task.id
              ORDER BY candidate.started_at DESC, candidate.id DESC
            ) AS session
            OUTER APPLY (
              SELECT TOP (1) invocation_id, status FROM dbo.sandbox_turns
              WHERE sandbox_session_id = session.id ORDER BY started_at DESC, id DESC
            ) AS turn
            WHERE task.id = @taskId;`);
        const state = recordset[0]?.state;
        if (state !== 'Running' && state !== 'NeedsAttention') {
          return { kind: 'inactive' as const };
        }
        if (recordset[0]?.runnerCompleted !== true) {
          return { kind: 'awaiting_runner' as const };
        }

        const value = await operation();
        return { kind: 'active' as const, value };
      });
    },
  };
}
