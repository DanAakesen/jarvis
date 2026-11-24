import sql from 'mssql';
import { foundryTokenCosts, DKK_PER_USD } from '../core/usage-pricing.js';
import type { FoundryModelUsage } from '../core/usage.js';
import { databaseReadRequest } from './wake-retry.js';
import type { HealthToolCount, UsageEntry, UsageStore } from '../core/usage.js';
import { imageUsageEventId } from '../vision/screen.js';
import { createScreenFrameUsageStore } from './screen-usage-store.js';

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

// Split running sessions at UTC midnight. The same rows feed the detail table and the cost chart.
const usageRows = `WITH open_sessions AS (
  SELECT task_id, size,
    CASE WHEN started_at < @from THEN @from ELSE started_at END AS rangeStart
  FROM dbo.sandbox_sessions
  WHERE status = N'Active' AND ended_at IS NULL AND started_at < @to
    AND (@from IS NULL OR @from < @to)
),
usage_rows AS (
  SELECT task_id AS taskId, project_id AS projectId, source, metric, quantity,
    CASE WHEN source NOT IN (N'codex', N'copilot') THEN cost_dkk END AS costDkk,
    CASE WHEN source NOT IN (N'codex', N'copilot') THEN cost_usd END AS costUsd,
    cost_status AS costStatus, role, model, at,
    CONVERT(bit, CASE WHEN cost_status = N'estimated' OR source IN (N'sandbox', N'voice') OR
      (source = N'jarvis_model' AND metric = N'screen_frames') THEN 1 ELSE 0 END) AS estimated
  FROM dbo.usage
  WHERE at < @to AND (@from IS NULL OR at >= @from)
  UNION ALL
  SELECT s.task_id, t.project_id, N'sandbox', N'minutes',
    CONVERT(decimal(19,6), elapsed.ms / 60000.0), cost.dkk,
    CONVERT(decimal(19,8), cost.dkk / ${DKK_PER_USD}), N'estimated', NULL, NULL,
    CASE WHEN @to < boundary.midnight THEN @to ELSE DATEADD(millisecond, -1, boundary.midnight) END,
    CONVERT(bit, 1)
  FROM open_sessions s
  INNER JOIN dbo.tasks t ON t.id = s.task_id
  CROSS APPLY GENERATE_SERIES(0, DATEDIFF(day, s.rangeStart, @to), 1) days
  CROSS APPLY (VALUES (DATEADD(day, days.value, CONVERT(date, s.rangeStart)))) d(dayStart)
  CROSS APPLY (VALUES (CONVERT(datetime2, DATEADD(day, 1, d.dayStart)))) boundary(midnight)
  CROSS APPLY (VALUES (DATEDIFF_BIG(millisecond, GREATEST(s.rangeStart, d.dayStart),
    LEAST(@to, boundary.midnight)))) elapsed(ms)
  CROSS APPLY (VALUES (CONVERT(decimal(19,8), elapsed.ms / 3600000.0 *
    CASE s.size WHEN N'1x2' THEN 0.8901 ELSE 1.7802 END))) cost(dkk)
  WHERE d.dayStart < @to
)`;

export function createUsageStore(pool: sql.ConnectionPool): UsageStore {
  return {
    async list(from, to, detailBy) {
      const healthFrom = from ?? new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
      const utcDayStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
      const detailBucket = detailBy === 'day' ? ', CONVERT(date, u.at)'
        : detailBy === 'month' ? ', YEAR(u.at), MONTH(u.at)' : '';
      const { recordset } = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, from)
        .input('to', sql.DateTime2, to)
        .query<UsageRow>(`${usageRows},
        grouped AS (
          SELECT CAST(u.taskId AS varchar(19)) AS taskId, t.title AS taskTitle,
            CAST(COALESCE(u.projectId, t.project_id) AS varchar(19)) AS projectId, p.name AS projectName,
            COALESCE(t.agent, N'jarvis') AS agent, u.source, u.metric, u.role, u.model,
            SUM(u.quantity) AS quantity,
            SUM(u.costDkk) AS costDkk, SUM(u.costUsd) AS costUsd,
            u.costStatus,
            MAX(u.at) AS at,
            CONVERT(bit, MAX(CONVERT(tinyint, u.estimated))) AS estimated,
            CONVERT(varchar(19), COUNT_BIG(*) OVER ()) AS totalEntries
          FROM usage_rows u
          LEFT JOIN dbo.tasks t ON t.id = u.taskId
          LEFT JOIN dbo.projects p ON p.id = COALESCE(u.projectId, t.project_id)
          GROUP BY u.taskId, t.title, u.projectId, t.project_id, p.name, t.agent,
            u.source, u.metric, u.role, u.model, u.costStatus${detailBucket}
        )
        SELECT TOP (1000) taskId, taskTitle, projectId, projectName, agent, source, metric, role, model,
          quantity, costUsd, costDkk, costStatus, at, estimated, totalEntries
        FROM grouped
        ORDER BY at DESC, projectName, taskTitle, source, metric, role, model, costStatus, projectId, taskId;`);
      const toolCalls = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, utcDayStart)
        .input('to', sql.DateTime2, to)
        .query<HealthToolCount>(`SELECT tool, CONVERT(varchar(19), COUNT_BIG(*)) AS count
        FROM dbo.tool_calls
        WHERE at >= @from AND at < @to
        GROUP BY tool
        ORDER BY tool;`);
      const costTotals = await databaseReadRequest(pool)
        .input('from', sql.DateTime2, from)
        .input('to', sql.DateTime2, to)
        .input('healthFrom', sql.DateTime2, healthFrom)
        .query<CostTotalRow>(`${usageRows},
          buckets AS (
            SELECT b.period, b.bucket, u.costUsd, u.costDkk, u.costStatus
            FROM usage_rows u
            CROSS APPLY (VALUES
              (N'daily', CONVERT(char(10), u.at, 23)),
              (N'monthly', CONVERT(varchar(7), u.at, 120))
            ) b(period, bucket)
            WHERE b.period = N'monthly' OR u.at >= @healthFrom
          )
          SELECT period, RTRIM(bucket) AS bucket, COALESCE(SUM(costUsd), 0) AS usd, COALESCE(SUM(costDkk), 0) AS dkk,
            COUNT_BIG(CASE WHEN costStatus = N'estimated' AND (costUsd IS NOT NULL OR costDkk IS NOT NULL) THEN 1 END) AS estimatedEntries,
            COUNT_BIG(CASE WHEN costStatus = N'unverified' THEN 1 END) AS unverifiedEntries
          FROM buckets GROUP BY period, bucket;`);
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
        healthToolCounts: toolCalls.recordset,
        healthCostTotals: totals.filter((_, index) => costTotals.recordset[index]?.period === 'daily'),
        monthlyCostTotals: totals.filter((_, index) => costTotals.recordset[index]?.period === 'monthly'),
        toolCalls: meteredTools.recordset.map(({ tool, count }) => ({ tool, count, costStatus: 'unverified' as const })),
      };
    },
    async recordFoundryUsage({ role, model, inputTokens, outputTokens, eventId, imageReservation }: FoundryModelUsage) {
      if (imageReservation) {
        if (role !== 'chat') throw new Error('Invalid image usage role');
        await createScreenFrameUsageStore(pool).recordImageTokens!({
          sessionId: imageReservation.sessionId,
          eventId: imageUsageEventId(imageReservation.sessionId, imageReservation.itemId),
          model, inputTokens, outputTokens, role,
        });
        return;
      }
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
