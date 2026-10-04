import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { UsageEntry, UsageStore } from '../core/usage.js';

interface UsageRow extends Omit<UsageEntry, 'at'> {
  at: Date | string;
  totalEntries: string;
}

export function createUsageStore(pool: sql.ConnectionPool): UsageStore {
  return {
    async list(from, to) {
      const { recordset } = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, from)
        .input('to', sql.DateTime2, to)
        .query<UsageRow>(`WITH usage_rows AS (
          SELECT task_id AS taskId, project_id AS projectId, source, metric, quantity, cost_dkk AS costDkk, at,
            CONVERT(bit, CASE WHEN source IN (N'sandbox', N'voice') THEN 1 ELSE 0 END) AS estimated
          FROM dbo.usage
          WHERE at < @to AND (@from IS NULL OR at >= @from)
          UNION ALL
          SELECT s.task_id, t.project_id, N'sandbox', N'minutes',
            CONVERT(decimal(19,6), DATEDIFF_BIG(millisecond,
              CASE WHEN @from IS NOT NULL AND s.started_at < @from THEN @from ELSE s.started_at END, @to) / 60000.0),
            CONVERT(decimal(12,4), ROUND(DATEDIFF_BIG(millisecond,
              CASE WHEN @from IS NOT NULL AND s.started_at < @from THEN @from ELSE s.started_at END, @to) / 3600000.0 *
              CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 4)),
            @to, CONVERT(bit, 1)
          FROM dbo.sandbox_sessions s
          INNER JOIN dbo.tasks t ON t.id = s.task_id
          WHERE s.status = N'Active' AND s.ended_at IS NULL AND s.started_at < @to
        ),
        grouped AS (
          SELECT CAST(u.taskId AS varchar(19)) AS taskId, t.title AS taskTitle,
            CAST(COALESCE(u.projectId, t.project_id) AS varchar(19)) AS projectId, p.name AS projectName,
            COALESCE(t.agent, N'jarvis') AS agent, u.source, u.metric,
            SUM(u.quantity) AS quantity,
            SUM(CASE WHEN u.source IN (N'codex', N'copilot') THEN NULL ELSE u.costDkk END) AS costDkk,
            MAX(u.at) AS at,
            CONVERT(bit, MAX(CONVERT(tinyint, u.estimated))) AS estimated,
            CONVERT(varchar(19), COUNT_BIG(*) OVER ()) AS totalEntries
          FROM usage_rows u
          LEFT JOIN dbo.tasks t ON t.id = u.taskId
          LEFT JOIN dbo.projects p ON p.id = COALESCE(u.projectId, t.project_id)
          GROUP BY u.taskId, t.title, u.projectId, t.project_id, p.name, t.agent, u.source, u.metric
        )
        SELECT TOP (1000) taskId, taskTitle, projectId, projectName, agent, source, metric,
          quantity, costDkk, at, estimated, totalEntries
        FROM grouped
        ORDER BY at DESC, projectName, taskTitle, source, metric;`);
      const entries = recordset.map((row) => ({
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        projectId: row.projectId,
        projectName: row.projectName,
        agent: row.agent,
        source: row.source,
        metric: row.metric,
        quantity: row.quantity,
        costDkk: row.costDkk,
        at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
        estimated: row.estimated,
      }));
      return { entries, totalEntries: recordset[0]?.totalEntries ?? '0' };
    },
  };
}
