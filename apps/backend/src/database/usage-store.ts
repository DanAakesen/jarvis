import sql from 'mssql';
import { foundryTokenCosts, DKK_PER_USD } from '../core/usage-pricing.js';
import type { FoundryModelUsage } from '../core/usage.js';
import { databaseReadRequest } from './wake-retry.js';
import type { DailyToolCount, UsageEntry, UsageStore } from '../core/usage.js';

interface UsageRow extends Omit<UsageEntry, 'at'> {
  at: Date | string;
  totalEntries: string;
}

interface CostTotalRow {
  period: 'daily' | 'monthly';
  bucket: string;
  usd: number;
  dkk: number;
  estimatedEntries: number;
  unverifiedEntries: number;
}

export function createUsageStore(pool: sql.ConnectionPool): UsageStore {
  return {
    async list(from, to) {
      const dailyFrom = from ?? new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
      const utcDayStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
      const utcMonthStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
      const { recordset } = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, from)
        .input('to', sql.DateTime2, to)
        .query<UsageRow>(`WITH usage_rows AS (
          SELECT task_id AS taskId, project_id AS projectId, source, metric, quantity,
            cost_dkk AS costDkk, cost_usd AS costUsd, cost_status AS costStatus, role, model, at,
            CONVERT(bit, CASE
              WHEN source IN (N'sandbox', N'voice') OR
                (source = N'jarvis_model' AND metric = N'screen_frames') THEN 1 ELSE 0 END) AS estimated
          FROM dbo.usage
          WHERE at < @to AND (@from IS NULL OR at >= @from)
          UNION ALL
          SELECT s.task_id, t.project_id, N'sandbox', N'minutes',
            CONVERT(decimal(19,6), DATEDIFF_BIG(millisecond,
              CASE WHEN @from IS NOT NULL AND s.started_at < @from THEN @from ELSE s.started_at END, @to) / 60000.0),
            CONVERT(decimal(19,8), ROUND(DATEDIFF_BIG(millisecond,
              CASE WHEN @from IS NOT NULL AND s.started_at < @from THEN @from ELSE s.started_at END, @to) / 3600000.0 *
              CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 8)),
            CONVERT(decimal(19,8), ROUND(ROUND(DATEDIFF_BIG(millisecond,
              CASE WHEN @from IS NOT NULL AND s.started_at < @from THEN @from ELSE s.started_at END, @to) / 3600000.0 *
              CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 8) / ${DKK_PER_USD}, 8)),
            N'estimated', NULL, NULL, @to, CONVERT(bit, 1)
          FROM dbo.sandbox_sessions s
          INNER JOIN dbo.tasks t ON t.id = s.task_id
          WHERE s.status = N'Active' AND s.ended_at IS NULL AND s.started_at < @to
        ),
        grouped AS (
          SELECT CAST(u.taskId AS varchar(19)) AS taskId, t.title AS taskTitle,
            CAST(COALESCE(u.projectId, t.project_id) AS varchar(19)) AS projectId, p.name AS projectName,
            COALESCE(t.agent, N'jarvis') AS agent, u.source, u.metric, u.role, u.model,
            SUM(u.quantity) AS quantity,
            SUM(CASE WHEN u.source IN (N'codex', N'copilot') THEN NULL ELSE u.costDkk END) AS costDkk,
            SUM(CASE WHEN u.source IN (N'codex', N'copilot') THEN NULL ELSE u.costUsd END) AS costUsd,
            u.costStatus,
            MAX(u.at) AS at,
            CONVERT(bit, MAX(CONVERT(tinyint, u.estimated))) AS estimated,
            CONVERT(varchar(19), COUNT_BIG(*) OVER ()) AS totalEntries
          FROM usage_rows u
          LEFT JOIN dbo.tasks t ON t.id = u.taskId
          LEFT JOIN dbo.projects p ON p.id = COALESCE(u.projectId, t.project_id)
          GROUP BY u.taskId, t.title, u.projectId, t.project_id, p.name, t.agent,
            u.source, u.metric, u.role, u.model, u.costStatus
        )
        SELECT TOP (1000) taskId, taskTitle, projectId, projectName, agent, source, metric, role, model,
          quantity, costUsd, costDkk, costStatus, at, estimated, totalEntries
        FROM grouped
        ORDER BY at DESC, projectName, taskTitle, source, metric, role, model;`);
      const toolCalls = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, utcDayStart)
        .input('to', sql.DateTime2, to)
        .query<DailyToolCount>(`SELECT tool, CONVERT(varchar(19), COUNT_BIG(*)) AS count
        FROM dbo.tool_calls
        WHERE at >= @from AND at < @to
        GROUP BY tool
        ORDER BY tool;`);
      const costTotals = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, from)
        .input('to', sql.DateTime2, to)
        .input('dailyFrom', sql.DateTime2, dailyFrom)
        .input('dayStart', sql.DateTime2, utcDayStart)
        .input('monthStart', sql.DateTime2, utcMonthStart)
        .query<CostTotalRow>(`WITH daily_cost_rows AS (
            SELECT at, cost_usd, cost_dkk, cost_status
            FROM dbo.usage WHERE at >= @dailyFrom AND at < @to
            UNION ALL
            SELECT @to,
              CONVERT(decimal(19,8), ROUND(ROUND(DATEDIFF_BIG(millisecond,
                CASE WHEN s.started_at > (CASE WHEN @from IS NOT NULL AND @from > @dayStart THEN @from ELSE @dayStart END)
                  THEN s.started_at ELSE (CASE WHEN @from IS NOT NULL AND @from > @dayStart THEN @from ELSE @dayStart END) END,
                @to) / 3600000.0 *
                CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 8) / ${DKK_PER_USD}, 8)),
              CONVERT(decimal(19,8), ROUND(DATEDIFF_BIG(millisecond,
                CASE WHEN s.started_at > (CASE WHEN @from IS NOT NULL AND @from > @dayStart THEN @from ELSE @dayStart END)
                  THEN s.started_at ELSE (CASE WHEN @from IS NOT NULL AND @from > @dayStart THEN @from ELSE @dayStart END) END,
                @to) / 3600000.0 *
                CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 8)),
              N'estimated'
            FROM dbo.sandbox_sessions s
            WHERE s.status = N'Active' AND s.ended_at IS NULL AND s.started_at < @to AND @to > @dayStart
          ),
          monthly_cost_rows AS (
            SELECT at, cost_usd, cost_dkk, cost_status
            FROM dbo.usage WHERE (@from IS NULL OR at >= @from) AND at < @to
            UNION ALL
            SELECT @to,
              CONVERT(decimal(19,8), ROUND(ROUND(DATEDIFF_BIG(millisecond,
                CASE WHEN s.started_at > (CASE WHEN @from IS NOT NULL AND @from > @monthStart THEN @from ELSE @monthStart END)
                  THEN s.started_at ELSE (CASE WHEN @from IS NOT NULL AND @from > @monthStart THEN @from ELSE @monthStart END) END,
                @to) / 3600000.0 *
                CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 8) / ${DKK_PER_USD}, 8)),
              CONVERT(decimal(19,8), ROUND(DATEDIFF_BIG(millisecond,
                CASE WHEN s.started_at > (CASE WHEN @from IS NOT NULL AND @from > @monthStart THEN @from ELSE @monthStart END)
                  THEN s.started_at ELSE (CASE WHEN @from IS NOT NULL AND @from > @monthStart THEN @from ELSE @monthStart END) END,
                @to) / 3600000.0 *
                CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END, 8)),
              N'estimated'
            FROM dbo.sandbox_sessions s
            WHERE s.status = N'Active' AND s.ended_at IS NULL AND s.started_at < @to AND @to > @monthStart
          )
          SELECT N'daily' AS period, CONVERT(char(10), CONVERT(date, at), 23) AS bucket,
            COALESCE(SUM(cost_usd), 0) AS usd, COALESCE(SUM(cost_dkk), 0) AS dkk,
            COUNT_BIG(CASE WHEN cost_status = N'estimated' AND (cost_usd IS NOT NULL OR cost_dkk IS NOT NULL) THEN 1 END) AS estimatedEntries,
            COUNT_BIG(CASE WHEN cost_status = N'unverified' THEN 1 END) AS unverifiedEntries
          FROM daily_cost_rows GROUP BY CONVERT(date, at)
          UNION ALL
          SELECT N'monthly', CONVERT(char(7), DATEFROMPARTS(YEAR(at), MONTH(at), 1), 120),
            COALESCE(SUM(cost_usd), 0), COALESCE(SUM(cost_dkk), 0),
            COUNT_BIG(CASE WHEN cost_status = N'estimated' AND (cost_usd IS NOT NULL OR cost_dkk IS NOT NULL) THEN 1 END),
            COUNT_BIG(CASE WHEN cost_status = N'unverified' THEN 1 END)
          FROM monthly_cost_rows
          GROUP BY YEAR(at), MONTH(at);`);
      const meteredTools = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, from)
        .input('to', sql.DateTime2, to)
        .query<{ tool: 'research' | 'web_research' | 'image_generation'; count: string }>(`SELECT tool,
            CONVERT(varchar(20), COUNT_BIG(*)) AS count
          FROM dbo.tool_calls
          WHERE tool IN (N'research', N'web_research', N'image_generation')
            AND at < @to AND (@from IS NULL OR at >= @from)
          GROUP BY tool
          ORDER BY tool;`);
      const entries = recordset.map((row) => ({
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        projectId: row.projectId,
        projectName: row.projectName,
        agent: row.agent,
        source: row.source,
        metric: row.metric,
        role: row.role,
        model: row.model,
        quantity: row.quantity,
        costDkk: row.costDkk,
        costUsd: row.costUsd,
        costStatus: row.costStatus,
        at: row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString(),
        estimated: row.estimated,
      }));
      const totals = costTotals.recordset.map(({ bucket, usd, dkk, estimatedEntries, unverifiedEntries }) => ({
        period: bucket,
        usd: Number(usd),
        dkk: Number(dkk),
        estimatedEntries: Number(estimatedEntries),
        unverifiedEntries: Number(unverifiedEntries),
      }));
      return {
        entries,
        totalEntries: recordset[0]?.totalEntries ?? '0',
        dailyToolCounts: toolCalls.recordset,
        dailyCostTotals: totals.filter((_, index) => costTotals.recordset[index]?.period === 'daily'),
        monthlyCostTotals: totals.filter((_, index) => costTotals.recordset[index]?.period === 'monthly'),
        toolCalls: meteredTools.recordset.map(({ tool, count }) => ({ tool, count, costStatus: 'unverified' as const })),
      };
    },
    async recordFoundryUsage({ role, model, inputTokens, outputTokens, eventId }: FoundryModelUsage) {
      const costs = foundryTokenCosts(model, inputTokens, outputTokens);
      const status = costs ? 'estimated' : 'unverified';
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        await transaction.request()
          .input('role', sql.NVarChar(24), role)
          .input('model', sql.NVarChar(128), model)
          .input('inputTokens', sql.Decimal(19, 6), inputTokens)
          .input('outputTokens', sql.Decimal(19, 6), outputTokens)
          .input('inputDkk', sql.Decimal(19, 8), costs?.inputDkk ?? null)
          .input('outputDkk', sql.Decimal(19, 8), costs?.outputDkk ?? null)
          .input('inputUsd', sql.Decimal(19, 8), costs?.inputUsd ?? null)
          .input('outputUsd', sql.Decimal(19, 8), costs?.outputUsd ?? null)
          .input('costStatus', sql.NVarChar(16), status)
          .input('eventId', sql.NVarChar(300), eventId)
          .query(`INSERT INTO dbo.usage
            (source, metric, quantity, cost_dkk, cost_usd, cost_status, role, model, source_event_id, at)
            SELECT N'jarvis_model', metrics.metric, metrics.quantity, metrics.cost_dkk, metrics.cost_usd,
              @costStatus, @role, @model, @eventId, SYSUTCDATETIME()
            FROM (VALUES
              (N'input_tokens', @inputTokens, @inputDkk, @inputUsd),
              (N'output_tokens', @outputTokens, @outputDkk, @outputUsd)
            ) AS metrics(metric, quantity, cost_dkk, cost_usd)
            WHERE NOT EXISTS (
              SELECT 1 FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
              WHERE task_id IS NULL AND source = N'jarvis_model' AND metric = metrics.metric
                AND source_event_id = @eventId
            );`);
        await transaction.commit();
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the stable persistence error. */ }
        throw new Error('Foundry usage could not be recorded');
      }
    },
  };
}
