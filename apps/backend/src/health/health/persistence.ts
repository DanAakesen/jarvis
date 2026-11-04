import sql from 'mssql';
import { healthSqlQuery } from '../health-upload/sql-transaction.js';
import { HealthPayloadError, type HealthObject } from './value.js';
import type { NormalizedHealth } from './normalize.js';

type Definition = { table: string; key: string[]; fields: Record<string, string> };
const measurement = { unit: 'nvarchar(256)', value: 'float', min_value: 'float', avg_value: 'float', max_value: 'float', sample_count: 'bigint', fields_json: 'nvarchar(max) AS JSON' };
export const healthDefinitions = {
  metrics: { table: 'health_daily_metrics', key: ['metric_name', 'metric_date'], fields: { metric_name: 'nvarchar(256)', metric_date: 'date', ...measurement, start_at: 'nvarchar(64)', end_at: 'nvarchar(64)' } },
  sleep: { table: 'health_sleep_daily', key: ['sleep_date'], fields: { sleep_date: 'date', sleep_start: 'nvarchar(64)', sleep_end: 'nvarchar(64)', total_sleep_hours: 'float', asleep_hours: 'float', core_hours: 'float', deep_hours: 'float', rem_hours: 'float', awake_hours: 'float', in_bed_hours: 'float', source_json: 'nvarchar(max) AS JSON', segment_count: 'bigint' } },
  workouts: { table: 'health_workouts', key: ['id'], fields: { id: 'nvarchar(256)', workout_type: 'nvarchar(256)', activity_identifier: 'nvarchar(256)', workout_date: 'date', start_at: 'nvarchar(64)', end_at: 'nvarchar(64)', duration_seconds: 'float', source_name: 'nvarchar(256)', is_indoor: 'bit', active_energy_value: 'float', active_energy_unit: 'nvarchar(256)', total_energy_value: 'float', total_energy_unit: 'nvarchar(256)', distance_value: 'float', distance_unit: 'nvarchar(256)', avg_heart_rate: 'float', max_heart_rate: 'float', detail_json: 'nvarchar(max) AS JSON' } },
  workoutMetrics: { table: 'health_workout_metrics', key: ['workout_id', 'metric_name'], fields: { workout_id: 'nvarchar(256)', metric_name: 'nvarchar(256)', ...measurement } },
  heartRateMinutes: { table: 'health_workout_heart_rate_minute', key: ['workout_id', 'sample_minute', 'metric_name'], fields: { workout_id: 'nvarchar(256)', sample_minute: 'nvarchar(64)', metric_name: 'nvarchar(256)', min_value: 'float', avg_value: 'float', max_value: 'float', unit: 'nvarchar(256)', source_json: 'nvarchar(max) AS JSON', sample_count: 'bigint' } },
} satisfies Record<string, Definition>;

export function validateNormalized(value: NormalizedHealth): void {
  for (const [kind, definition] of Object.entries(healthDefinitions)) {
    const identities = new Set<string>();
    for (const row of value[kind as keyof typeof healthDefinitions]) {
      const identity = JSON.stringify(definition.key.map(k => row[k]));
      if (identities.has(identity)) throw new HealthPayloadError('invalid_payload');
      identities.add(identity);
      for (const [field, type] of Object.entries(definition.fields)) {
        const item = row[field]; const maxLength = /^nvarchar\((\d+)\)$/u.exec(type)?.[1];
        if (maxLength && item !== null && item !== undefined && (typeof item !== 'string' || item.length > Number(maxLength))) throw new HealthPayloadError('invalid_identifier');
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new HealthPayloadError('payload_complexity');
}

/** Static identifiers only; JSON is parameterized. Caller holds the owner transaction lock. */
async function upsert(tx: sql.Transaction, owner: string, id: string, acceptedAt: Date, rows: HealthObject[], definition: Definition, signal: AbortSignal): Promise<void> {
  if (!rows.length) return;
  const columns = Object.keys(definition.fields);
  const schema = Object.entries(definition.fields).map(([field, type]) => `[${field}] ${type.replace(' AS JSON', '')} '$.${field}'${type.endsWith(' AS JSON') ? ' AS JSON' : ''}`).join(',');
  const join = definition.key.map(k => `t.[${k}]=s.[${k}]${definition.fields[k]!.startsWith('nvarchar') ? ' COLLATE Latin1_General_100_BIN2' : ''}`).join(' AND ');
  const assignments = columns.filter(k => !definition.key.includes(k)).map(k => `t.[${k}]=s.[${k}]`).join(',');
  const fields = columns.map(k => `[${k}]`).join(','); const select = columns.map(k => `s.[${k}]`).join(',');
  const children = definition.key.includes('workout_id') ? `DELETE s FROM #health_rows s WHERE NOT EXISTS(SELECT 1 FROM daily.health_workouts w WHERE w.owner_object_id=@owner AND w.id=s.workout_id COLLATE Latin1_General_100_BIN2 AND w.ingestion_id=@ingestion);` : '';
  await healthSqlQuery(new sql.Request(tx).input('owner', sql.UniqueIdentifier, owner).input('ingestion', sql.NVarChar(256), id)
    .input('accepted', sql.DateTimeOffset(3), acceptedAt).input('updated', sql.NVarChar(64), acceptedAt.toISOString()).input('rows', sql.NVarChar(sql.MAX), JSON.stringify(rows)),
  `SELECT * INTO #health_rows FROM OPENJSON(@rows) WITH(${schema});
   ${children}
   IF EXISTS(SELECT 1 FROM daily.[${definition.table}] t JOIN #health_rows s ON ${join} WHERE t.owner_object_id=@owner AND TRY_CONVERT(datetimeoffset,t.updated_at) IS NULL)
     THROW 51047,'Health target timestamp invalid',1;
   UPDATE t SET ${assignments}${assignments ? ',' : ''}t.ingestion_id=@ingestion,t.updated_at=@updated
     FROM daily.[${definition.table}] t JOIN #health_rows s ON ${join}
     WHERE t.owner_object_id=@owner AND TRY_CONVERT(datetimeoffset,t.updated_at)<=@accepted;
   INSERT daily.[${definition.table}](owner_object_id,${fields},ingestion_id,updated_at)
     SELECT @owner,${select},@ingestion,@updated FROM #health_rows s
     WHERE NOT EXISTS(SELECT 1 FROM daily.[${definition.table}] t WHERE t.owner_object_id=@owner AND ${join});
   DROP TABLE #health_rows;`, signal);
}

export async function writeNormalized(tx: sql.Transaction, owner: string, id: string, acceptedAt: Date, value: NormalizedHealth, signal: AbortSignal): Promise<void> {
  validateNormalized(value);
  for (const [kind, definition] of Object.entries(healthDefinitions)) {
    await upsert(tx, owner, id, acceptedAt, value[kind as keyof typeof healthDefinitions], definition, signal);
  }
  // No DELETE: empty exports and sparse workout details cannot erase prior history.
}
