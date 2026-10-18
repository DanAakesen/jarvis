import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm, readdir, symlink, lstat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dailyTables } from '../store/schema.js';
import { columnTypes, decisions, EXCLUDED_TABLES, IMPORT_ORDER, MIXED_TABLES, SOURCE_CHECKS, TARGET_ONLY_COLUMNS } from './decisions.js';
import { generateBundle, SYNTHETIC_SENTINEL, VARIANTS } from './generate.js';
import { BundleReader, DiskIndex, sha256 } from './io.js';
import { CLI_FLAGS, main } from './cli.js';
import { parseManifest, parseObjectEntry, type Manifest } from './manifest.js';
import { validateBundle, validDate, validInteger, type ValidationReport } from './validate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const workspace = join(root, '.daily-synthetic-tests-' + randomUUID());
const now = '2026-10-18T00:00:00Z';
let serial = 0;
beforeAll(async () => { await mkdir(workspace, { mode: 0o700 }); });
afterAll(async () => { await rm(workspace, { recursive: true, force: true }); });
const paths = () => {
  const name = String(serial++);
  return { bundle: join(workspace, name), reportDir: join(workspace, `${name}-report`), now };
};
async function fixture(variant = 'valid', rows = 1): Promise<{ options: ReturnType<typeof paths>; report: ValidationReport; manifest: Manifest }> {
  const options = paths();
  const manifest = await generateBundle({ bundle: options.bundle, seed: 22, variant, rows });
  const report = await validateBundle(options);
  return { options, report, manifest };
}
async function rewriteManifest(bundle: string, change: (manifest: Manifest) => void): Promise<void> {
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as Manifest;
  change(manifest);
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));
}
async function rewriteTable(bundle: string, table: string, text: string): Promise<void> {
  await writeFile(join(bundle, `${table}.ndjson`), text);
  await rewriteManifest(bundle, m => {
    m.tables[table]!.sha256 = sha256(text);
    m.tables[table]!.rowCount = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  });
}
const codes = (report: ValidationReport): string[] => [
  ...Object.keys(report.errors), ...Object.keys(report.objects.errors),
  ...Object.values(report.tables).flatMap(t => Object.keys(t.errors)),
];

describe('source decisions and SQL metadata', () => {
  it('cross-checks all 31 mapping rows, exact source keys, registry targets/columns and parent order', async () => {
    const mapping = await readFile(join(root, 'docs/daily-schema-mapping.md'), 'utf8');
    const rows = [...mapping.matchAll(/^\| (\w+) \| ([^|]+) \| ([^|]+) \|$/gm)];
    expect(rows).toHaveLength(31);
    expect(Object.keys(decisions).sort()).toEqual(rows.map(r => r[1]).sort());
    expect(Object.values(decisions).flatMap(d => d.target ? [d.target] : []).sort()).toEqual(Object.keys(dailyTables).sort());
    for (const [, name, target, source] of rows) {
      const decision = decisions[name!]!;
      if (decision.target) {
        expect(target).toContain(`daily.${decision.target}`);
        expect(decision.sourceKey).toEqual(name === 'coach_profiles' ? ['owner_email'] : source!.trim().split(', '));
        const registry = dailyTables[decision.target];
        expect(name === 'coach_profiles' ? [] : decision.sourceKey).toEqual(registry.keys);
        expect(decision.excludedColumns).toContain('owner_email');
        for (const parent of decision.parents) {
          expect(IMPORT_ORDER.indexOf(parent.table)).toBeLessThan(IMPORT_ORDER.indexOf(decision.target));
          expect(registry.columns).toContain(parent.column);
          expect(dailyTables[parent.table].columns).toContain(parent.key);
        }
      } else {
        expect(source!.trim()).toBe('No active migration');
        expect(decision.decision).toBe('exclude');
      }
    }
    expect(decisions.nutrition_queue!.excludedColumns).toContain('claim_token');
    expect(EXCLUDED_TABLES).toHaveLength(4);
    expect(MIXED_TABLES).toHaveLength(5);
  });
  it('pins every source bigint, all four SQL FKs, discriminator negative CHECKs, and additive columns', async () => {
    const sql = await readFile(join(root, 'db/migrations/0041_daily_owner_schema.sql'), 'utf8');
    for (const [, table, body] of sql.matchAll(/CREATE TABLE daily\.\[(\w+)\] \(([\s\S]*?)\n\);/g)) {
      const columns = [...body!.matchAll(/^\s+\[(\w+)\] (\w+)/gm)];
      const integerColumns = columns.filter(c => c[2] === 'bigint').map(c => c[1]).sort();
      expect([...decisions[table!]!.integerColumns].sort()).toEqual(integerColumns);
      const registry = dailyTables[table! as keyof typeof dailyTables];
      for (const [, column, type] of columns) expect(columnTypes[table! as keyof typeof dailyTables][column!]).toBe(type);
      const additive = table === 'nutrition_favorites' ? ['nutrient_provenance_json'] : [];
      expect([...registry.columns].sort()).toEqual([...columns.map(c => c[1]), ...additive].sort());
    }
    const fks = [...sql.matchAll(/ALTER TABLE daily\.\[(\w+)\].*?FOREIGN KEY \(\[owner_object_id\], \[(\w+)\]\) REFERENCES daily\.\[(\w+)\] \(\[owner_object_id\], \[(\w+)\]\)/g)];
    expect(fks).toHaveLength(4);
    for (const [, table, column, parent, key] of fks) expect(decisions[table!]!.parents).toEqual([{ table: parent, column, key }]);
    expect(Object.values(decisions).reduce((n, d) => n + d.parents.length, 0)).toBe(4);
    for (const [table, metadata] of Object.entries(SOURCE_CHECKS)) {
      expect(sql).toContain(`CK_daily_${table}_source CHECK (LOWER(source) NOT LIKE N'%ticktick%')`);
      expect(metadata.allowedValues).toBeNull();
    }
    const files = (await readdir(join(root, 'db/migrations'))).filter(f => /^00(?:4[2-9]|50)_.*\.sql$/.test(f));
    expect(files).toHaveLength(9);
    const additiveSql = (await Promise.all(files.map(f => readFile(join(root, 'db/migrations', f), 'utf8')))).join('\n');
    for (const [table, columns] of Object.entries(TARGET_ONLY_COLUMNS)) {
      for (const column of columns) {
        expect(additiveSql).toContain(column);
        expect(dailyTables[table as keyof typeof dailyTables].columns).not.toContain(column);
      }
    }
    expect(additiveSql).toContain('ALTER COLUMN preference nvarchar(256) NULL');
    expect(additiveSql).toContain('ALTER COLUMN protein_grams float NULL');
  });
});

describe('strict manifest runtime boundary', () => {
  it('accepts v1 and rejects each malformed envelope without echoed values', async () => {
    const { manifest } = await fixture();
    expect(parseManifest(manifest)).toEqual(manifest);
    const invalid: unknown[] = [null, [], {}, { ...manifest, formatVersion: 2 }, { ...manifest, extra: SYNTHETIC_SENTINEL },
      { ...manifest, createdAt: SYNTHETIC_SENTINEL }, { ...manifest, exporter: { name: 'SYNTHETIC', version: '1', extra: true } },
      { ...manifest, tables: { a: { file: 'a.ndjson', rowCount: -1, sha256: 'bad', complete: true, columns: [] } } },
      { ...manifest, rulings: { a: { decision: 'import', rule: SYNTHETIC_SENTINEL } } },
      { ...manifest, objects: { index: '../bad', count: 0, totalBytes: 0, sha256: '0'.repeat(64) } }];
    for (const value of invalid) expect(() => parseManifest(value)).toThrow('manifest-invalid');
  });
  it.each(['rowCount', 'sha256', 'complete', 'columns'])('rejects invalid %s metadata', async field => {
    const { manifest } = await fixture();
    const values: Record<string, unknown> = { rowCount: 1.5, sha256: 'G'.repeat(64), complete: false, columns: ['id', 'id'] };
    (manifest.tables.health_workouts as unknown as Record<string, unknown>)[field] = values[field];
    expect(() => parseManifest(manifest)).toThrow('manifest-invalid');
  });
  it('strictly validates object entries and refuses traversal/extra fields', () => {
    const object = { file: 'objects/SYNTHETIC.bin', ingestionId: 'SYNTHETIC', bytes: 1, sha256: '0'.repeat(64), expiresAt: now };
    expect(parseObjectEntry(object)).toEqual(object);
    for (const value of [{ ...object, file: '../SYNTHETIC' }, { ...object, bytes: -1 }, { ...object, extra: true },
      { ...object, expiresAt: 'bad' }, { ...object, expiresAt: '2026-02-30T00:00:00Z' }, { ...object, expiresAt: '2026-10-18T24:00:00Z' }]) {
      expect(() => parseObjectEntry(value)).toThrow('object-entry-invalid');
    }
  });
});

describe('streaming validation and negative fixtures', () => {
  it('validates all source decisions, original bytes and excluded non-JSON credentials', async () => {
    const { report, options } = await fixture();
    expect(report.valid).toBe(true);
    expect(report.objects).toMatchObject({ count: 1, verified: 1, expired: 0, errors: {} });
    expect(report.totals.sourceRows).toBe(31);
    for (const table of EXCLUDED_TABLES) expect(report.tables[table]).toMatchObject({ sourceRows: 1, excludedRows: 1, errors: {} });
    expect((await readdir(options.reportDir)).sort()).toEqual(['validation-report.json', 'validation-summary.md']);
    expect((await lstat(join(options.reportDir, 'validation-report.json'))).mode & 0o777).toBe(0o600);
  });
  const failures: Record<string, string> = {
    truncated: 'row-count-mismatch', 'wrong-checksum': 'checksum-mismatch', 'overlength-key': 'key-invalid',
    'integer-overflow': 'integer-invalid', 'unsafe-integer': 'integer-invalid', unclassified: 'unclassified-discriminator',
    'unsupported-payload': 'unsupported-sanitisation', 'unknown-column': 'unknown-column', 'extra-table': 'unknown-table',
    'different-owner': 'duplicate-key', 'duplicate-key': 'duplicate-key', 'missing-key': 'missing-key',
    'missing-key-column': 'missing-key-column', 'invalid-date': 'key-invalid', 'not-object': 'row-not-object',
    'invalid-json': 'invalid-json', 'invalid-utf8': 'invalid-utf8', 'missing-table': 'missing-table', incomplete: 'manifest-invalid',
    'missing-ruling': 'blocked-needs-ruling', 'wrong-row-count': 'row-count-mismatch', 'missing-object': 'bundle-io',
    'wrong-object-size': 'object-size-mismatch', 'wrong-object-hash': 'object-checksum-mismatch',
    'missing-ingestion': 'object-ingestion-missing', 'object-ledger-mismatch': 'object-ledger-mismatch',
    'object-index-hash': 'objects-checksum-mismatch', 'object-index-count': 'objects-count-mismatch',
    'object-index-bytes': 'objects-bytes-mismatch', 'duplicate-object': 'object-duplicate', 'missing-parent': 'missing-parent',
    'path-traversal': 'unsafe-table-file', symlink: 'unsafe-path', sentinel: 'key-invalid',
    'manifest-version': 'manifest-invalid', 'blank-line': 'invalid-json',
  };
  it.each(Object.entries(failures))('fails closed: %s -> %s', async (variant, code) => {
    const { report } = await fixture(variant);
    expect(report.valid).toBe(false);
    expect(codes(report)).toContain(code);
  });
  it.each(['valid', 'padded-key', 'integer-boundaries', 'ticktick', 'claim-token', 'expired-object', 'tombstoned-meal', 'null-nutrients', 'missing-optional'])('accepts intended edge case %s', async variant => {
    const { report } = await fixture(variant);
    expect(report.valid).toBe(true);
    if (variant === 'ticktick') expect(report.tables.attention_items!.ticktickRows).toBe(1);
    if (variant === 'expired-object') expect(report.objects).toMatchObject({ expired: 1, verified: 0 });
    if (variant === 'missing-optional') expect(report.totals.warnings).toBeGreaterThan(0);
  });
  it('covers every exported generator variant', () => {
    expect([...Object.keys(failures), 'valid', 'padded-key', 'integer-boundaries', 'ticktick', 'claim-token', 'expired-object', 'tombstoned-meal', 'null-nutrients', 'missing-optional'].sort()).toEqual([...VARIANTS].sort());
  });
  it('preserves padded and case-distinct keys rather than trimming or folding them', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await rewriteTable(options.bundle, 'health_workouts', ['Synthetic', 'Synthetic ', 'synthetic', ''].map(id => JSON.stringify({ id })).join('\n') + '\n');
    expect((await validateBundle(options)).tables.health_workouts!.errors).toEqual({});
  });
  it('detects numeric/string representations of the same integer key as duplicates', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await rewriteTable(options.bundle, 'health_sync_state', '{"id":1}\n{"id":"1"}\n');
    expect((await validateBundle(options)).tables.health_sync_state!.errors['duplicate-key']).toBe(1);
  });
  it('does not bless mixed payloads with arbitrary free-text owner rules or TickTick hidden in JSON', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await rewriteManifest(options.bundle, m => { m.rulings!.attention_runs!.rule = SYNTHETIC_SENTINEL; });
    const report = await validateBundle(options);
    expect(report.tables.attention_runs!.errors).toHaveProperty('unsupported-sanitisation');
    for (const payload of ['{"ticktick":[]}', '["SYNTHETIC"]', '"SYNTHETIC"', '1', 'null']) {
      await rewriteTable(options.bundle, 'attention_runs', JSON.stringify({ id: 'SYNTHETIC', source_status_json: payload }) + '\n');
      expect((await validateBundle(options)).valid).toBe(false);
    }
  });
  it('requires a ruling even for an empty mixed table', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await rewriteTable(options.bundle, 'attention_runs', '');
    await rewriteManifest(options.bundle, m => { delete m.rulings!.attention_runs; });
    expect((await validateBundle(options)).tables.attention_runs!.blocked).toBe(true);
  });
  it('checks object coverage, index absence, ingestion metadata and strict entry shape', async () => {
    for (const kind of ['coverage', 'no-index', 'ingestion', 'shape']) {
      const options = paths();
      await generateBundle({ bundle: options.bundle, seed: 22 });
      if (kind === 'coverage') {
        await writeFile(join(options.bundle, 'objects.ndjson'), '');
        await rewriteManifest(options.bundle, m => { m.objects = { index: 'objects.ndjson', count: 0, totalBytes: 0, sha256: sha256('') }; });
      } else if (kind === 'no-index') {
        await rewriteManifest(options.bundle, m => { delete m.objects; });
      } else if (kind === 'ingestion') {
        await rewriteTable(options.bundle, 'health_ingestions', JSON.stringify({ id: 'SYNTHETIC_22_0', checksum: '0'.repeat(64), content_bytes: 1 }) + '\n');
      } else {
        await writeFile(join(options.bundle, 'objects.ndjson'), '{"file":"../SYNTHETIC"}\n');
      }
      const report = await validateBundle(options);
      expect(codes(report)).toContain(({ coverage: 'object-coverage-missing', 'no-index': 'objects-index-missing', ingestion: 'object-ingestion-mismatch', shape: 'object-entry-invalid' })[kind]);
    }
  });
  it('bounds manifest and line sizes, and rejects invalid time/budget', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    const manifest = await readFile(join(options.bundle, 'manifest.json'));
    await writeFile(join(options.bundle, 'manifest.json'), Buffer.alloc(40000, 32));
    expect((await validateBundle({ ...options, memoryBudgetBytes: 65536 })).errors).toHaveProperty('manifest-too-large');
    await writeFile(join(options.bundle, 'manifest.json'), manifest);
    await rewriteTable(options.bundle, 'health_workouts', JSON.stringify({ id: 'SYNTHETIC', detail_json: 'X'.repeat(9000) }) + '\n');
    expect(codes(await validateBundle({ ...options, memoryBudgetBytes: 65536 }))).toContain('line-too-large');
    expect((await validateBundle({ ...options, memoryBudgetBytes: 1 })).errors).toHaveProperty('memory-budget-invalid');
    expect((await validateBundle({ ...options, now: SYNTHETIC_SENTINEL })).errors).toHaveProperty('validation-time-invalid');
  });
  it('enforces non-key column types without narrowing valid source numbers', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await rewriteTable(options.bundle, 'health_workouts', JSON.stringify({
      id: 'SYNTHETIC', workout_type: {}, duration_seconds: '1', is_indoor: 2, workout_date: '2026-02-30',
    }) + '\n');
    expect((await validateBundle(options)).tables.health_workouts!.errors['column-type-invalid']).toBe(4);
    await rewriteTable(options.bundle, 'nutrition_meals', '{"id":"SYNTHETIC","energy_kcal":1e309}\n');
    expect((await validateBundle(options)).tables.nutrition_meals!.errors['column-type-invalid']).toBe(1);
  });
  it('keeps source offsets, tombstones and NULL versus zero unchanged', async () => {
    const { options } = await fixture('tombstoned-meal');
    const path = join(options.bundle, 'nutrition_meals.ndjson');
    const row = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    row.occurred_at = '2026-10-18T03:04:05.123+02:00';
    const text = JSON.stringify(row) + '\n';
    await rewriteTable(options.bundle, 'nutrition_meals', text);
    const report = await validateBundle(options);
    expect(report.valid).toBe(true);
    expect(row.protein_grams).toBeNull();
    expect(row.carbohydrates_grams).toBe(0);
    expect(row.deleted_at).toBe(now);
    expect(await readFile(path, 'utf8')).toBe(text);
  });
  it('accepts missing expired bytes at the exact retention boundary but still checks references', async () => {
    const { options } = await fixture();
    await rm(join(options.bundle, 'objects/SYNTHETIC_OBJECT.bin'));
    const expired = await validateBundle({ ...options, now: '2099-01-01T00:00:00Z' });
    expect(expired.valid).toBe(true);
    expect(expired.objects.expired).toBe(1);
    await rewriteTable(options.bundle, 'health_ingestions', '');
    expect((await validateBundle({ ...options, now: '2099-01-01T00:00:00Z' })).objects.errors).toHaveProperty('object-ingestion-missing');
  });
  it('bounds and validates excluded bytes without attempting JSON decoding', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await rewriteTable(options.bundle, 'mcp_oauth_codes', SYNTHETIC_SENTINEL + '\n');
    expect((await validateBundle(options)).tables.mcp_oauth_codes!.errors).toEqual({});
    await writeFile(join(options.bundle, 'mcp_oauth_codes.ndjson'), Buffer.from([0xff, 10]));
    expect((await validateBundle(options)).tables.mcp_oauth_codes!.errors).toHaveProperty('invalid-utf8');
    await writeFile(join(options.bundle, 'mcp_oauth_codes.ndjson'), 'X'.repeat(9000) + '\n');
    expect((await validateBundle({ ...options, memoryBudgetBytes: 65536 })).tables.mcp_oauth_codes!.errors).toHaveProperty('line-too-large');
  });
  it('refuses unexpected files, undeclared columns, unknown rulings and malformed retention', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    await writeFile(join(options.bundle, 'SYNTHETIC_UNEXPECTED'), SYNTHETIC_SENTINEL);
    await rewriteTable(options.bundle, 'health_workouts', '{"id":"SYNTHETIC","SYNTHETIC_UNDECLARED":1}\n');
    await rewriteTable(options.bundle, 'health_raw_objects', '{"ingestion_id":"SYNTHETIC_22_0","expires_at":"SYNTHETIC_INVALID","checksum":"SYNTHETIC_INVALID"}\n');
    await rewriteManifest(options.bundle, m => { m.rulings![SYNTHETIC_SENTINEL] = { decision: 'exclude', rule: SYNTHETIC_SENTINEL }; delete m.rulings!.briefing_runs; });
    const report = await validateBundle(options);
    expect(codes(report)).toEqual(expect.arrayContaining(['unexpected-files', 'unknown-ruling', 'unknown-column', 'undeclared-column', 'retention-invalid', 'object-ledger-invalid']));
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_SENTINEL);
  });
  it('rejects root/ancestor symlinks, object symlinks and output-file symlinks', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    const alias = join(workspace, `alias-${serial++}`);
    await symlink(options.bundle, alias);
    expect((await validateBundle({ ...options, bundle: alias })).errors).toHaveProperty('unsafe-path');
    await rm(join(options.bundle, 'objects/SYNTHETIC_OBJECT.bin'));
    await symlink('../manifest.json', join(options.bundle, 'objects/SYNTHETIC_OBJECT.bin'));
    expect((await validateBundle(options)).objects.errors).toHaveProperty('bundle-io');
    await rm(join(options.reportDir, 'validation-report.json'));
    await symlink(join(options.bundle, 'manifest.json'), join(options.reportDir, 'validation-report.json'));
    const manifestBefore = await readFile(join(options.bundle, 'manifest.json'));
    await expect(validateBundle(options)).rejects.toThrow();
    expect(await readFile(join(options.bundle, 'manifest.json'))).toEqual(manifestBefore);
  });
  it('decodes UTF-8 across chunk boundaries and final lines without LF', async () => {
    const options = paths();
    await generateBundle({ bundle: options.bundle, seed: 22 });
    const text = `${' '.repeat(16383)}é\nSYNTHETIC`;
    await writeFile(join(options.bundle, 'SYNTHETIC.ndjson'), text);
    const reader = await BundleReader.create(options.bundle, 65536);
    const lines: string[] = [];
    try {
      const actual = await reader.lines('SYNTHETIC.ndjson', async line => { lines.push(line); });
      expect(lines).toEqual([`${' '.repeat(16383)}é`, 'SYNTHETIC']);
      expect(actual).toMatchObject({ rows: 2, sha256: sha256(text) });
      await expect(reader.hash('../manifest.json')).rejects.toThrow('unsafe-path');
    } finally { await reader.close(); }
  });
});

describe('integer/date values and privacy', () => {
  it.each([-9007199254740991, 9007199254740991, 0, '9223372036854775807', '-9223372036854775808'])('accepts exact integer %s', value => expect(validInteger(value)).toBe(true));
  it.each([9007199254740992, -9007199254740992, 1.2, '9223372036854775808', '-9223372036854775809', '01', '1.0', null, {}, '1e3'])('rejects invalid integer %s', value => expect(validInteger(value)).toBe(false));
  it.each(['2024-02-29', '2026-10-18'])('accepts exact calendar key %s', value => expect(validDate(value)).toBe(true));
  it.each(['2026-02-29', '2026-02-30', '2026-1-01', '2026-01-01T00:00:00Z', '0000-01-01'])('rejects invalid calendar key %s', value => expect(validDate(value)).toBe(false));
  it('leaks no sentinel from keys, values, columns, unknown tables, metadata, rules or CLI arguments', async () => {
    const { options } = await fixture('sentinel');
    await rewriteManifest(options.bundle, m => {
      m.exporter = { name: SYNTHETIC_SENTINEL, version: SYNTHETIC_SENTINEL };
      m.sourceSchemaRef = SYNTHETIC_SENTINEL;
      m.rulings!.attention_runs!.rule = SYNTHETIC_SENTINEL;
      m.tables[SYNTHETIC_SENTINEL] = { file: `${SYNTHETIC_SENTINEL}.ndjson`, rowCount: 0, sha256: sha256(''), complete: true, columns: [] };
    });
    const report = await validateBundle(options);
    const json = await readFile(join(options.reportDir, 'validation-report.json'), 'utf8');
    const summary = await readFile(join(options.reportDir, 'validation-summary.md'), 'utf8');
    const log: string[] = [];
    expect(await main(['validate', '--bundle', `${SYNTHETIC_SENTINEL}/missing`, '--report-dir', paths().reportDir], t => log.push(t))).toBe(1);
    expect(await main([SYNTHETIC_SENTINEL], t => log.push(t))).toBe(2);
    expect(await main(['generate', '--bundle', options.bundle, '--seed', '22'], t => log.push(t))).toBe(2);
    for (const text of [JSON.stringify(report), json, summary, log.join('')]) {
      expect(text).not.toContain(SYNTHETIC_SENTINEL);
      expect(text).not.toContain(options.bundle);
      expect(text).not.toContain('SYNTHETIC_OWNER.invalid');
    }
    expect(report.unknownTables).toMatchObject({ count: 1 });
    expect(report.unknownTables.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('never exposes a populated excluded claim token or raw filesystem errors', async () => {
    const { options, report } = await fixture('claim-token');
    expect(JSON.stringify(report)).not.toContain(SYNTHETIC_SENTINEL);
    expect(await readFile(join(options.reportDir, 'validation-report.json'), 'utf8')).not.toContain(SYNTHETIC_SENTINEL);
    const blocked = join(workspace, `SYNTHETIC_BLOCK_${serial++}`);
    await writeFile(blocked, SYNTHETIC_SENTINEL);
    let message = '';
    try { await validateBundle({ ...options, reportDir: join(blocked, SYNTHETIC_SENTINEL) }); }
    catch (e) { message = (e as Error).message; }
    expect(message).toBe('report-io');
    expect(message).not.toContain(SYNTHETIC_SENTINEL);
  });
});

describe('CLI, packaging, determinism and bounded-memory proof', () => {
  it('keeps generator deterministic for a seed and refuses overwrite', async () => {
    const a = paths(), b = paths();
    await generateBundle({ bundle: a.bundle, seed: 22 });
    await generateBundle({ bundle: b.bundle, seed: 22 });
    expect(await readFile(join(a.bundle, 'manifest.json'))).toEqual(await readFile(join(b.bundle, 'manifest.json')));
    await expect(generateBundle({ bundle: a.bundle, seed: 22 })).rejects.toThrow();
    await expect(generateBundle({ bundle: paths().bundle, seed: 1, variant: 'bad' })).rejects.toThrow('generator-options-invalid');
  });
  it('supports help/generate/validate and rejects unsupported or duplicated flags without echo', async () => {
    const options = paths(), log: string[] = [];
    const output = (text: string) => { log.push(text); };
    expect(await main(['--help'], output)).toBe(0);
    expect(await main(['generate', '--bundle', options.bundle, '--seed', '22'], output)).toBe(0);
    expect(await main(['validate', '--bundle', options.bundle, '--report-dir', options.reportDir, '--now', now, '--memory-budget-bytes', '65536'], output)).toBe(0);
    for (const args of [[], ['generate'], ['generate', '--seed', '22'], ['validate', '--bundle', 'x'], ['generate', '--bundle', 'x', '--seed', '1', '--seed', '2'], ['generate', '--bundle', 'x', '--seed', 'NaN'], ['validate', '--SYNTHETIC', SYNTHETIC_SENTINEL]]) {
      expect(await main(args, output)).toBe(2);
    }
    expect(log.join('')).not.toContain(SYNTHETIC_SENTINEL);
    expect(await main(['generate', '--help'], output)).toBe(0);
  });
  it('every flag in the owner runbook exists in the exported CLI contract', async () => {
    const runbook = await readFile(join(root, 'docs/daily-migration-runbook.md'), 'utf8');
    // npm's preparation flags are not flags accepted by this separate CLI.
    const flags = [...new Set(runbook.replace(/^.*npm run .*$/gm, '').match(/--[a-z][a-z-]*/g) ?? [])];
    expect(flags.length).toBeGreaterThan(3);
    for (const flag of flags) expect(CLI_FLAGS).toContain(flag);
    for (const flag of CLI_FLAGS) expect(runbook).toContain(flag);
  });
  it('lists every removable source file in the TEMPORARY P12-19 README inventory', async () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const readme = await readFile(join(directory, 'README.md'), 'utf8');
    expect(readme).toContain('TEMPORARY');
    expect(readme).toContain('P12-19');
    for (const file of await readdir(directory)) expect(readme).toContain(`\`${file}\``);
  });
  it('is unreachable through the production entry import dependency graph', async () => {
    const seen = new Set<string>();
    async function visit(file: string): Promise<void> {
      if (seen.has(file)) return;
      seen.add(file);
      expect(file).not.toContain('/daily/migration/');
      const content = await readFile(file, 'utf8');
      for (const match of content.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        const relative = match[1]!;
        const target = resolve(dirname(file), relative.replace(/\.js$/, '.ts'));
        await visit(target);
      }
    }
    await visit(join(root, 'apps/backend/src/index.ts'));
    expect(seen.size).toBeGreaterThan(30);
  });
  it('keeps full duplicate membership on disk, not in a row-growing Set', async () => {
    const path = join(workspace, `index-${serial++}`);
    await mkdir(path);
    const index = await DiskIndex.create(path);
    try {
      for (let i = 0; i < 200; i++) expect(await index.add('SYNTHETIC', String(i))).toBe(true);
      expect(await index.add('SYNTHETIC', '0')).toBe(false);
      expect(await index.get('SYNTHETIC', '199')).toBe('');
      expect(await index.get('SYNTHETIC', 'not-found')).toBeNull();
      expect((await readdir(index.path)).length).toBeGreaterThan(20);
    } finally { await index.close(); }
    expect(await readdir(path)).toEqual([]);
  });
  it('validates a bundle many times the buffer budget under a capped child heap', async () => {
    const options = paths();
    const manifest = await generateBundle({ bundle: options.bundle, seed: 22, rows: 2500 });
    const bytes = (await lstat(join(options.bundle, 'health_workouts.ndjson'))).size;
    expect(bytes).toBeGreaterThan(65536 * 20);
    expect(manifest.tables.health_workouts!.rowCount).toBe(2500);
    const cli = join(root, 'apps/backend/dist/daily/migration/cli.js');
    // Build is an explicit validation step before this suite; no extra test runner.
    const child = spawnSync(process.execPath, ['--max-old-space-size=48', cli, 'validate', '--bundle', options.bundle,
      '--report-dir', options.reportDir, '--now', now, '--memory-budget-bytes', '65536'], { encoding: 'utf8', timeout: 90000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('validation-passed\n');
    const report = JSON.parse(await readFile(join(options.reportDir, 'validation-report.json'), 'utf8')) as ValidationReport;
    expect(report.valid).toBe(true);
    expect(report.tables.health_workouts!.sourceRows).toBe(2500);
    expect(await readdir(options.reportDir)).not.toContainEqual(expect.stringContaining('.daily-index-'));
  }, 120000);
});
