import { mkdir, open, writeFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { dailyTables, type DailyTable } from '../store/schema.js';
import { decisions, MIXED_TABLES } from './decisions.js';
import { safeDirectory, sha256 } from './io.js';
import { fail, type Manifest } from './manifest.js';

export const VARIANTS = [
  'valid', 'truncated', 'wrong-checksum', 'overlength-key', 'padded-key', 'integer-boundaries', 'integer-overflow',
  'unsafe-integer', 'ticktick', 'unclassified', 'unsupported-payload', 'unknown-column', 'extra-table', 'claim-token',
  'expired-object', 'tombstoned-meal', 'null-nutrients', 'different-owner', 'duplicate-key', 'missing-key',
  'missing-key-column', 'invalid-date', 'not-object', 'invalid-json', 'invalid-utf8', 'missing-table', 'incomplete',
  'missing-optional', 'missing-ruling', 'wrong-row-count', 'missing-object', 'wrong-object-size', 'wrong-object-hash',
  'missing-ingestion', 'object-ledger-mismatch', 'object-index-hash', 'object-index-count', 'object-index-bytes',
  'duplicate-object', 'missing-parent', 'path-traversal', 'symlink', 'sentinel', 'manifest-version', 'blank-line',
] as const;
export type Variant = typeof VARIANTS[number];
export interface GenerateOptions { bundle: string; seed: number; variant?: string | undefined; rows?: number | undefined }
export const SYNTHETIC_SENTINEL = 'SYNTHETIC_PRIVATE_SENTINEL_NOT_FOR_REPORTS';
const CREATED = '2026-10-18T00:00:00Z';
const OBJECT_BYTES = Buffer.from('SYNTHETIC ORIGINAL OBJECT\n');

function syntheticRow(table: DailyTable, sequence: number, seed: number): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const definition = dailyTables[table];
  for (const column of definition.columns) {
    if (column.endsWith('_json')) row[column] = '{}';
    else row[column] = null;
  }
  for (const key of definition.keys as readonly string[]) {
    const type = (definition.keyTypes as Record<string, { type: string }>)[key]?.type;
    row[key] = type === 'bigint' ? sequence + 1 : type === 'date' ? `2026-10-${String(sequence % 28 + 1).padStart(2, '0')}` : `SYNTHETIC_${seed}_${sequence}`;
  }
  for (const column of decisions[table]!.integerColumns) if (row[column] === null) row[column] = 0;
  row.owner_email = 'SYNTHETIC_OWNER.invalid';
  if (table === 'nutrition_meals') {
    row.meal_name = `Synthetic meal ${String(sequence).padStart(3, '0')}`;
    row.energy_kcal = 0; row.protein_grams = null; row.carbohydrates_grams = 0;
    row.fat_grams = null; row.fiber_grams = 0; row.revision = 1;
  }
  if (table === 'health_workouts') row.detail_json = JSON.stringify({ synthetic: true, padding: 'X'.repeat(512) });
  if (table === 'health_ingestions') { row.checksum = sha256(OBJECT_BYTES); row.content_bytes = OBJECT_BYTES.length; }
  if (table === 'health_raw_objects') {
    row.ingestion_id = `SYNTHETIC_${seed}_0`; row.object_key = 'SYNTHETIC_OBJECT';
    row.checksum = sha256(OBJECT_BYTES); row.content_bytes = OBJECT_BYTES.length; row.expires_at = '2099-01-01T00:00:00Z';
  }
  for (const parent of decisions[table]!.parents) row[parent.column] = `SYNTHETIC_${seed}_0`;
  return row;
}

/** Writes only conspicuously synthetic data; refuses an existing bundle directory. */
export async function generateBundle(options: GenerateOptions): Promise<Manifest> {
  try { return await generate(options); }
  catch (e) {
    if (e instanceof Error && e.message === 'generator-options-invalid') throw e;
    return fail('generator-io');
  }
}

async function generate(options: GenerateOptions): Promise<Manifest> {
  const variant = options.variant ?? 'valid';
  if (!(VARIANTS as readonly string[]).includes(variant) || !Number.isSafeInteger(options.seed)
    || !Number.isSafeInteger(options.rows ?? 1) || (options.rows ?? 1) < 1) return fail('generator-options-invalid');
  const destination = resolve(options.bundle);
  await safeDirectory(dirname(destination));
  // No destructive overwrite, including when the requested path is a symlink.
  await mkdir(destination, { mode: 0o700 });
  const manifest: Manifest = {
    formatVersion: 1, createdAt: CREATED, exporter: { name: 'SYNTHETIC_ONLY', version: '1' },
    sourceSchemaRef: 'SYNTHETIC_NOT_SOURCE_EVIDENCE', tables: {}, rulings: {},
  };
  for (const table of MIXED_TABLES) manifest.rulings![table] = {
    decision: ['attention_source_snapshots', 'attention_items', 'attention_rule_config'].includes(table) ? 'exclude' : 'import-sanitised',
    rule: 'empty-payload-v1',
  };
  for (const name of Object.keys(decisions)) {
    const decision = decisions[name]!;
    const table = decision.target;
    const columns = table ? [...dailyTables[table].columns, 'owner_email'] : ['SYNTHETIC_EXCLUDED'];
    if (name === 'nutrition_queue' && variant === 'claim-token') columns.push('claim_token');
    if (name === 'nutrition_meals' && ['unknown-column', 'sentinel'].includes(variant)) columns.push(SYNTHETIC_SENTINEL);
    if (name === 'health_workouts' && variant === 'missing-key-column') columns.splice(columns.indexOf('id'), 1);
    if (name === 'nutrition_meals' && variant === 'missing-optional') columns.splice(columns.indexOf('protein_grams'), 1);
    const handle = await open(join(destination, `${name}.ndjson`), 'wx', 0o600);
    const hash = createHash('sha256');
    const n = name === 'health_workouts' ? options.rows ?? 1 : 1;
    let actualRows = 0;
    try {
      for (let i = 0; i < n; i++) {
        const row = table ? syntheticRow(table, i, options.seed) : {};
        if (name === 'health_workouts') {
          if (variant === 'overlength-key') row.id = 'SYNTHETIC_'.repeat(40);
          if (variant === 'padded-key') row.id = `${row.id} `;
          if (variant === 'missing-key') delete row.id;
          if (variant === 'sentinel') { row.id = SYNTHETIC_SENTINEL.repeat(20); row.detail_json = SYNTHETIC_SENTINEL; }
        }
        if (name === 'health_daily_metrics' && variant === 'invalid-date') row.metric_date = '2026-02-30';
        if (name === 'health_workout_metrics' && variant === 'missing-parent') row.workout_id = 'SYNTHETIC_NO_PARENT';
        if (['health_workout_metrics', 'health_workout_heart_rate_minute'].includes(name) && variant === 'padded-key') row.workout_id = `${row.workout_id} `;
        if (name === 'health_sleep_daily') {
          if (variant === 'integer-boundaries') row.segment_count = '-9223372036854775808';
          if (variant === 'integer-overflow') row.segment_count = '9223372036854775808';
          if (variant === 'unsafe-integer') row.segment_count = 9007199254740992;
        }
        if (name === 'health_daily_metrics' && variant === 'integer-boundaries') row.sample_count = '9223372036854775807';
        if (name === 'nutrition_queue' && variant === 'claim-token') row.claim_token = SYNTHETIC_SENTINEL;
        if (name === 'nutrition_meals') {
          if (['unknown-column', 'sentinel'].includes(variant)) row[SYNTHETIC_SENTINEL] = SYNTHETIC_SENTINEL;
          if (variant === 'tombstoned-meal') row.deleted_at = CREATED;
          if (variant === 'missing-optional') delete row.protein_grams;
        }
        if (name === 'coach_profiles' && variant === 'different-owner') row.owner_email = 'SYNTHETIC_DIFFERENT_OWNER.invalid';
        if (name === 'attention_items' && ['ticktick', 'unclassified'].includes(variant)) {
          row.source = variant === 'ticktick' ? 'SYNTHETIC_TiCkTiCk_EXCLUDED' : 'SYNTHETIC_UNKNOWN_SOURCE';
          manifest.rulings![name] = { decision: 'import-sanitised', rule: 'empty-payload-v1' };
        }
        if (name === 'attention_runs' && variant === 'unsupported-payload') row.source_status_json = JSON.stringify({ arbitrary: SYNTHETIC_SENTINEL });
        if (name === 'health_raw_objects' && variant === 'expired-object') row.expires_at = '2000-01-01T00:00:00Z';
        const line = !table ? 'SYNTHETIC_EXCLUDED_NOT_JSON\n'
          : name === 'nutrition_meals' && variant === 'not-object' ? '[]\n'
            : name === 'nutrition_meals' && variant === 'invalid-json' ? `${SYNTHETIC_SENTINEL}\n`
              : name === 'nutrition_meals' && variant === 'blank-line' ? '\n'
                : `${JSON.stringify(row)}\n`;
        const bytes = name === 'nutrition_meals' && variant === 'invalid-utf8' ? Buffer.from([0xff, 10]) : Buffer.from(line);
        await handle.write(bytes); hash.update(bytes); actualRows++;
        if ((name === 'health_workouts' && variant === 'duplicate-key') || (name === 'coach_profiles' && variant === 'different-owner')) {
          const duplicate = name === 'coach_profiles' ? Buffer.from(`${JSON.stringify({ ...row, owner_email: 'SYNTHETIC_OTHER_OWNER.invalid' })}\n`) : bytes;
          await handle.write(duplicate); hash.update(duplicate); actualRows++;
        }
      }
    } finally { await handle.close(); }
    manifest.tables[name] = { file: `${name}.ndjson`, rowCount: actualRows, sha256: hash.digest('hex'), complete: true, columns };
  }
  await mkdir(join(destination, 'objects'), { mode: 0o700 });
  const object = {
    file: 'objects/SYNTHETIC_OBJECT.bin', ingestionId: `SYNTHETIC_${options.seed}_0`,
    bytes: OBJECT_BYTES.length, sha256: sha256(OBJECT_BYTES),
    expiresAt: variant === 'expired-object' ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
  };
  if (variant === 'missing-ingestion') object.ingestionId = 'SYNTHETIC_MISSING_INGESTION';
  if (variant === 'object-ledger-mismatch') object.expiresAt = '2098-01-01T00:00:00Z';
  const objectIndex = `${JSON.stringify(object)}\n`.repeat(variant === 'duplicate-object' ? 2 : 1);
  await writeFile(join(destination, 'objects.ndjson'), objectIndex, { mode: 0o600 });
  if (!['missing-object', 'expired-object'].includes(variant)) await writeFile(join(destination, object.file),
    variant === 'wrong-object-size' ? Buffer.from('SYNTHETIC_SHORT') : variant === 'wrong-object-hash' ? Buffer.alloc(OBJECT_BYTES.length, 88) : OBJECT_BYTES, { mode: 0o600 });
  manifest.objects = { index: 'objects.ndjson', count: variant === 'duplicate-object' ? 2 : 1,
    totalBytes: OBJECT_BYTES.length * (variant === 'duplicate-object' ? 2 : 1), sha256: sha256(objectIndex) };
  if (variant === 'object-index-hash') manifest.objects.sha256 = '0'.repeat(64);
  if (variant === 'object-index-count') manifest.objects.count++;
  if (variant === 'object-index-bytes') manifest.objects.totalBytes++;
  if (variant === 'truncated') await writeFile(join(destination, 'nutrition_meals.ndjson'), '', { mode: 0o600 });
  if (variant === 'wrong-checksum') manifest.tables.nutrition_meals!.sha256 = '0'.repeat(64);
  if (variant === 'wrong-row-count') manifest.tables.nutrition_meals!.rowCount++;
  if (variant === 'missing-table') { delete manifest.tables.nutrition_meals; await rm(join(destination, 'nutrition_meals.ndjson')); }
  if (variant === 'missing-ruling') delete manifest.rulings!.attention_runs;
  if (variant === 'extra-table') {
    manifest.tables[SYNTHETIC_SENTINEL] = { file: `${SYNTHETIC_SENTINEL}.ndjson`, rowCount: 0, sha256: sha256(''), complete: true, columns: [] };
    await writeFile(join(destination, `${SYNTHETIC_SENTINEL}.ndjson`), '', { mode: 0o600 });
  }
  if (variant === 'path-traversal') manifest.tables.nutrition_meals!.file = '../SYNTHETIC_PRIVATE';
  if (variant === 'symlink') {
    await rm(join(destination, 'nutrition_meals.ndjson'));
    await symlink('manifest.json', join(destination, 'nutrition_meals.ndjson'));
  }
  const serialized = JSON.stringify(manifest, null, 2);
  await writeFile(join(destination, 'manifest.json'),
    variant === 'incomplete' ? serialized.replace('"complete": true', '"complete": false')
      : variant === 'manifest-version' ? serialized.replace('"formatVersion": 1', '"formatVersion": 2') : serialized, { mode: 0o600 });
  return manifest;
}
