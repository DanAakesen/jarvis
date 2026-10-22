import type { FastifyRequest } from 'fastify';
import sql from 'mssql';
import { resolveDailyOwner } from '../owner.js';
import { ownerId } from '../health-upload/contracts.js';
import { healthInboxByteLimit, healthInboxRowLimit } from '../health-upload/sql-buffer.js';
import { healthSqlQuery, healthSqlTransaction } from '../health-upload/sql-transaction.js';
import { healthDefinitions } from './persistence.js';
import { dateOnly, instant, key } from './value.js';

type HistoryKind = 'metrics' | 'sleep' | 'workouts';
export interface HealthCursor { date: string; key: string }
const dimensions = { metrics: ['metric_date', 'metric_name'], sleep: ['sleep_date', 'sleep_date'], workouts: ['workout_date', 'id'] } as const;
const dateKey = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
const metricAlias = (value: string | undefined) => value?.includes(' ')
  ? `${value.charAt(0).toLowerCase()}${value.slice(1).replaceAll(' ', '_')}`
  : null;
function pageLimit(value: number): number { if (!Number.isInteger(value) || value < 1 || value > 500) throw new TypeError('Invalid health page limit'); return value; }
const sourceColumns = (column: string, path: string) => Array.from({ length: 6 }, (_, index) =>
  `JSON_VALUE(${column}, N'${path}[${index}]') AS read_source_${index + 1}`).join(',');
const metricFieldsSql = `JSON_VALUE(fields_json, N'$.aggregation') AS read_aggregation,
  ${sourceColumns('fields_json', '$.sources')},
  COALESCE(JSON_VALUE(fields_json, N'$.latest.date'), JSON_VALUE(fields_json, N'$.latest.endDate'),
    JSON_VALUE(fields_json, N'$.latest.sleepEnd'), JSON_VALUE(fields_json, N'$.latest.startDate')) AS read_latest_at,
  TRY_CONVERT(float, COALESCE(JSON_VALUE(fields_json, N'$.latest.qty'), JSON_VALUE(fields_json, N'$.latest.Avg'),
    JSON_VALUE(fields_json, N'$.latest.avg'), JSON_VALUE(fields_json, N'$.latest.average'),
    JSON_VALUE(fields_json, N'$.latest.value'))) AS read_latest_value,
  COALESCE(JSON_VALUE(fields_json, N'$.latest.units'), JSON_VALUE(fields_json, N'$.latest.unit')) AS read_latest_unit,
  COALESCE(JSON_VALUE(fields_json, N'$.latest.source'), JSON_VALUE(fields_json, N'$.latest.sourceName')) AS read_latest_source,
  JSON_VALUE(fields_json, N'$.latest.device') AS read_latest_device,
  TRY_CONVERT(float, JSON_VALUE(fields_json, N'$.latest_conversion_factor')) AS read_conversion_factor,
  CASE JSON_VALUE(fields_json, N'$.latest_value_is_source_units')
    WHEN N'true' THEN CAST(1 AS bit) WHEN N'false' THEN CAST(0 AS bit) ELSE NULL END AS read_value_is_source_units`;
function boundedText(value: unknown, maximum = 256): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}
function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) { dateOnly(value); return value; }
    instant(value);
    return value;
  } catch { return null; }
}
function sourceNames(row: Record<string, unknown>) {
  const sources = Array.from({ length: 5 }, (_, index) => boundedText(row[`read_source_${index + 1}`]))
    .filter((value): value is string => value !== null);
  return { sources: [...new Set(sources)], sourcesTruncated: boundedText(row.read_source_6) !== null };
}
function fields(row: Record<string, unknown>) {
  const aggregation = ['latest', 'sum', 'average'].includes(String(row.read_aggregation))
    ? row.read_aggregation as 'latest' | 'sum' | 'average' : null;
  return {
    aggregation,
    ...sourceNames(row),
    latestSample: {
      observedAt: safeTimestamp(row.read_latest_at),
      value: typeof row.read_latest_value === 'number' && Number.isFinite(row.read_latest_value) ? row.read_latest_value : null,
      sourceUnit: boundedText(row.read_latest_unit),
      source: boundedText(row.read_latest_source),
      device: boundedText(row.read_latest_device),
      conversionFactor: typeof row.read_conversion_factor === 'number' && Number.isFinite(row.read_conversion_factor) && row.read_conversion_factor > 0
        ? row.read_conversion_factor : null,
      valueIsSourceUnits: typeof row.read_value_is_source_units === 'boolean' ? row.read_value_is_source_units : null,
    },
  };
}
function withoutReadColumns(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith('read_')));
}

/** Read-only, unregistered boundary. Existing root auth resolves owner; no owner argument or raw-inbox reads. */
export class DailyHealthReadModel {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string) {}
  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest) { return new DailyHealthReadModel(pool, ownerId(resolveDailyOwner(request))); }

  async sync(signal: AbortSignal) {
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const request = () => new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner);
      const feeds = (await healthSqlQuery(request(), `SELECT feed_kind,last_success_at AS accepted_evidence_at,updated_at AS processed_committed_at,
        TRY_CONVERT(bigint,JSON_VALUE(last_counts_json,'$.metrics')) AS metric_rows,
        TRY_CONVERT(bigint,JSON_VALUE(last_counts_json,'$.sleepNights')) AS sleep_rows,
        TRY_CONVERT(bigint,JSON_VALUE(last_counts_json,'$.workouts')) AS workout_rows,
        TRY_CONVERT(bigint,JSON_VALUE(last_counts_json,'$.heartRateMinutes')) AS heart_rate_minutes
        FROM daily.health_sync_feeds WHERE owner_object_id=@owner AND feed_kind IN(N'metrics',N'workouts');`, bounded)).recordset;
      const heartbeat = (await healthSqlQuery(request(), 'SELECT last_received_at FROM daily.health_phone_sync_state WHERE owner_object_id=@owner AND id=1;', bounded)).recordset[0] ?? null;
      const inbox = (await healthSqlQuery(request(), `SELECT COUNT(*) AS retained,
        COALESCE(SUM(CONVERT(bigint,byte_count)),0) AS retained_bytes,
        COALESCE(SUM(CASE WHEN processing_status='pending' THEN 1 ELSE 0 END),0) AS accepted,
        COALESCE(SUM(CASE WHEN processing_status='pending' THEN 1 ELSE 0 END),0) AS pending,
        COALESCE(SUM(CASE WHEN processing_status='processing' THEN 1 ELSE 0 END),0) AS processing,
        COALESCE(SUM(CASE WHEN processing_status='processed' THEN 1 ELSE 0 END),0) AS succeeded,
        COALESCE(SUM(CASE WHEN processing_status='quarantined' THEN 1 ELSE 0 END),0) AS quarantined,
        MAX(accepted_at) AS last_accepted_at,MAX(CASE WHEN kind='upload' THEN processed_at END) AS last_processed_upload_at FROM daily.health_upload_inbox WHERE owner_object_id=@owner;`, bounded)).recordset[0];
      return { feeds, heartbeat, inbox: { ...inbox, retained_bytes: Number(inbox?.retained_bytes ?? 0),
        byte_limit: healthInboxByteLimit, row_limit: healthInboxRowLimit } }; // Heartbeat is distinct and cannot establish a processed feed timestamp.
    });
  }
  async metricCatalog(range: { startDate: string; endDate: string; limit?: number; after?: { key: string } }, signal: AbortSignal) {
    const start = dateOnly(range.startDate); const end = dateOnly(range.endDate); const limit = pageLimit(range.limit ?? 100);
    if (limit > 500 || end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new TypeError('Invalid health metric catalogue range');
    const after = range.after;
    if (after && key(after.key) !== after.key) throw new TypeError('Invalid health metric catalogue cursor');
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const rows = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner)
        .input('start', sql.Date, new Date(start)).input('end', sql.Date, new Date(end)).input('limit', sql.Int, limit)
        .input('afterName', sql.NVarChar(256), after?.key ?? null),
      `SELECT TOP(@limit + 1) metrics.metric_name,
          COALESCE((SELECT TOP(5) units.unit COLLATE Latin1_General_100_BIN2 AS unit FROM daily.health_daily_metrics AS units
            WHERE units.owner_object_id=@owner AND units.metric_name=metrics.metric_name
              AND units.metric_date BETWEEN @start AND @end AND units.unit IS NOT NULL
            GROUP BY units.unit COLLATE Latin1_General_100_BIN2
            ORDER BY units.unit COLLATE Latin1_General_100_BIN2 FOR JSON PATH),N'[]') AS units_json,
          MIN(metrics.metric_date) AS first_date,MAX(metrics.metric_date) AS last_date,
          COUNT(DISTINCT metrics.metric_date) AS day_count,MAX(metrics.updated_at) AS latest_updated_at
        FROM daily.health_daily_metrics AS metrics
        WHERE metrics.owner_object_id=@owner AND metrics.metric_date BETWEEN @start AND @end
          AND (@afterName IS NULL OR metrics.metric_name>@afterName)
        GROUP BY metrics.metric_name ORDER BY metrics.metric_name;`, bounded)).recordset;
      const truncated = rows.length > limit; const items = rows.slice(0, limit).map(row => ({
        metric_name: row.metric_name,
        units: (JSON.parse(String(row.units_json)) as { unit: string }[]).map(unit => unit.unit),
        first_date: row.first_date, last_date: row.last_date, day_count: row.day_count,
        latest_updated_at: row.latest_updated_at,
      }));
      const last = items.at(-1);
      return { items, next: truncated && last ? { key: String(last.metric_name) } : null };
    });
  }
  async history(kind: HistoryKind, range: { startDate: string; endDate: string; limit?: number; after?: HealthCursor; metric?: string }, signal: AbortSignal) {
    if (!Object.hasOwn(dimensions, kind)) throw new TypeError('Invalid health history kind');
    const start = dateOnly(range.startDate); const end = dateOnly(range.endDate); const limit = pageLimit(range.limit ?? 200);
    if (end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new TypeError('Invalid health history range');
    if (range.metric !== undefined && (kind !== 'metrics' || key(range.metric) !== range.metric)) throw new TypeError('Invalid health metric filter');
    const after = range.after;
    if (after) { dateOnly(after.date); key(after.key); if (after.date < start || after.date > end) throw new TypeError('Invalid health cursor'); }
    const definition = healthDefinitions[kind]; const [dateColumn, keyColumn] = dimensions[kind];
    const alias = metricAlias(range.metric);
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const request = new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('start', sql.Date, new Date(start)).input('end', sql.Date, new Date(end)).input('limit', sql.Int, limit + 1)
        .input('afterDate', sql.Date, after ? new Date(after.date) : null).input('afterKey', sql.NVarChar(256), after?.key ?? null)
        .input('metric', sql.NVarChar(256), range.metric ?? null)
        .input('metricAlias', sql.NVarChar(256), alias);
      // Lists omit unbounded JSON detail; exact workout detail has a separate bounded read below.
      const metadata = kind === 'metrics' ? `,${metricFieldsSql}`
        : kind === 'sleep' ? `,${sourceColumns('source_json', '$')}` : '';
      const rows = (await healthSqlQuery(request, `SELECT TOP(@limit) ${Object.keys(definition.fields).filter(k => !k.endsWith('_json')).map(k => `[${k}]`).join(',')},ingestion_id,updated_at${metadata} FROM daily.[${definition.table}]
        WHERE owner_object_id=@owner AND [${dateColumn}] BETWEEN @start AND @end
          AND ${kind === 'metrics' ? `(@metric IS NULL OR [metric_name] COLLATE Latin1_General_100_BIN2=@metric COLLATE Latin1_General_100_BIN2
            OR (@metricAlias IS NOT NULL AND [metric_name] COLLATE Latin1_General_100_BIN2=@metricAlias COLLATE Latin1_General_100_BIN2
              AND NOT EXISTS (SELECT 1 FROM daily.[${definition.table}] AS exact
                WHERE exact.owner_object_id=@owner AND exact.[${dateColumn}] BETWEEN @start AND @end
                  AND exact.metric_name COLLATE Latin1_General_100_BIN2=@metric COLLATE Latin1_General_100_BIN2)))` : '@metric IS NULL'}
          AND (@afterDate IS NULL OR [${dateColumn}]>@afterDate${kind === 'sleep' ? '' : ` OR ([${dateColumn}]=@afterDate AND [${keyColumn}]>@afterKey)`})
        ORDER BY [${dateColumn}]${kind === 'sleep' ? '' : `,[${keyColumn}]`};`, bounded)).recordset;
      const truncated = rows.length > limit;
      const items: Record<string, unknown>[] = rows.slice(0, limit).map(row => kind === 'metrics'
        ? { ...withoutReadColumns(row), fields: fields(row) }
        : kind === 'sleep'
          ? { ...withoutReadColumns(row), ...sourceNames(row) }
          : row);
      const last = items.at(-1);
      return { items, truncated, next: truncated && last ? { date: dateKey(last[dateColumn]), key: kind === 'sleep' ? dateKey(last[keyColumn]) : String(last[keyColumn]) } : null };
    });
  }
  async workoutMetrics(workoutId: string, signal: AbortSignal) {
    key(workoutId);
    const limit = 100;
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const rows = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner)
        .input('workout', sql.NVarChar(256), workoutId).input('limit', sql.Int, limit + 1),
      `SELECT TOP(@limit) workout_id,metric_name,unit,value,min_value,avg_value,max_value,sample_count,
          ingestion_id,updated_at,${metricFieldsSql}
        FROM daily.health_workout_metrics
        WHERE owner_object_id=@owner AND workout_id=@workout AND DATALENGTH(workout_id)=DATALENGTH(@workout)
        ORDER BY metric_name;`, bounded)).recordset;
      const truncated = rows.length > limit;
      const items: Record<string, unknown>[] = rows.slice(0, limit).map(row => ({ ...withoutReadColumns(row), fields: fields(row) }));
      return { items, truncated };
    });
  }
  async workoutDetail(workoutId: string, signal: AbortSignal) {
    key(workoutId);
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const row = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('workout', sql.NVarChar(256), workoutId),
        `SELECT id,CASE WHEN DATALENGTH(detail_json)<=16777216 THEN detail_json ELSE NULL END AS detail_json,
          CASE WHEN DATALENGTH(detail_json)>16777216 THEN 1 ELSE 0 END AS oversized FROM daily.health_workouts
          WHERE owner_object_id=@owner AND id=@workout AND DATALENGTH(id)=DATALENGTH(@workout);`, bounded)).recordset[0];
      if (!row) return null;
      if (row.oversized || typeof row.detail_json !== 'string' || Buffer.byteLength(row.detail_json) > 8 * 1024 * 1024) throw new TypeError('Health detail exceeds read limit');
      return { id: String(row.id), detail: JSON.parse(row.detail_json) as unknown };
    });
  }
  async heartRate(workoutId: string, options: { limit?: number; after?: { minute: string; metric: string }; metric?: string }, signal: AbortSignal) {
    key(workoutId); const limit = pageLimit(options.limit ?? 200);
    if (options.after) { instant(options.after.minute); key(options.after.metric); }
    if (options.metric !== undefined) key(options.metric);
    const alias = metricAlias(options.metric);
    return healthSqlTransaction(this.pool, this.owner, signal, async (tx, bounded) => {
      const rows = (await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('workout', sql.NVarChar(256), workoutId).input('limit', sql.Int, limit + 1)
        .input('minute', sql.NVarChar(64), options.after ? instant(options.after.minute) : null)
        .input('cursorMetric', sql.NVarChar(256), options.after?.metric ?? null)
        .input('metric', sql.NVarChar(256), options.metric ?? null).input('metricAlias', sql.NVarChar(256), alias),
      `SELECT TOP(@limit) sample_minute,metric_name,min_value,avg_value,max_value,unit,sample_count,${sourceColumns('source_json', '$')}
       FROM daily.health_workout_heart_rate_minute
       WHERE owner_object_id=@owner AND workout_id=@workout AND DATALENGTH(workout_id)=DATALENGTH(@workout)
         AND (@metric IS NULL OR metric_name COLLATE Latin1_General_100_BIN2=@metric COLLATE Latin1_General_100_BIN2
           OR (@metricAlias IS NOT NULL AND metric_name COLLATE Latin1_General_100_BIN2=@metricAlias COLLATE Latin1_General_100_BIN2
             AND NOT EXISTS (SELECT 1 FROM daily.health_workout_heart_rate_minute AS exact
               WHERE exact.owner_object_id=@owner AND exact.workout_id=@workout AND DATALENGTH(exact.workout_id)=DATALENGTH(@workout)
                 AND exact.metric_name COLLATE Latin1_General_100_BIN2=@metric COLLATE Latin1_General_100_BIN2)))
         AND (@minute IS NULL OR sample_minute>@minute OR (sample_minute=@minute AND metric_name>@cursorMetric))
       ORDER BY sample_minute,metric_name;`, bounded)).recordset;
      const truncated = rows.length > limit;
      const items: Record<string, unknown>[] = rows.slice(0, limit).map(row => ({ ...withoutReadColumns(row), ...sourceNames(row) }));
      const last = items.at(-1);
      return { items, truncated, next: truncated && last ? { minute: String(last.sample_minute), metric: String(last.metric_name) } : null };
    });
  }
}
