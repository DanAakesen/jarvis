import { constants } from 'node:fs';
import { open, lstat, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { dailyTables, type DailyTable } from '../store/schema.js';
import { columnTypes, decisions, IMPORT_ORDER, MIXED_TABLES, SOURCE_CHECKS, type TableDecision } from './decisions.js';
import { BundleReader, DiskIndex, safeDirectory, sha256 } from './io.js';
import { fail, parseManifest, parseObjectEntry, record, timestamp, ValidationFailure, type Manifest, type Ruling } from './manifest.js';

type Counts = Record<string, number>;
export interface TableReport {
  decision: string;
  sourceRows: number;
  manifestRows: number;
  sha256: string | null;
  checksumMatch: boolean;
  warnings: Counts;
  errors: Counts;
  blocked: boolean;
  ticktickRows: number;
  unclassifiedRows: number;
  excludedRows: number;
  evidenceDigest: string | null;
}
export interface ValidationReport {
  formatVersion: 1;
  valid: boolean;
  errors: Counts;
  tables: Record<string, TableReport>;
  unknownTables: { count: number; digest: string | null };
  objects: { count: number; bytes: number; expired: number; verified: number; errors: Counts; sha256: string | null };
  totals: { sourceRows: number; errors: number; warnings: number; blockedTables: number };
}
export interface ValidateOptions { bundle: string; reportDir: string; now?: string | undefined; memoryBudgetBytes?: number | undefined }
const bump = (counts: Counts, code: string): void => { counts[code] = (counts[code] ?? 0) + 1; };
const sum = (counts: Counts): number => Object.values(counts).reduce((a, b) => a + b, 0);
const ownDecision = (name: string): TableDecision | undefined => Object.hasOwn(decisions, name) ? decisions[name] : undefined;
const evidence = (report: TableReport, value: string): void => { report.evidenceDigest = sha256(`${report.evidenceDigest ?? ''}\0${value}`).slice(0, 24); };
const failureCode = (e: unknown): string => e instanceof ValidationFailure ? e.code
  : e instanceof SyntaxError ? 'invalid-json'
    : e instanceof TypeError ? 'invalid-utf8' : 'bundle-io';

export function validInteger(value: unknown): boolean {
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return false;
  const canonical = value.replace(/^(-?)0+(?=\d)/, '$1');
  if (canonical.length > 20) return false;
  const integer = BigInt(canonical);
  return integer >= -9223372036854775808n && integer <= 9223372036854775807n;
}
export function validDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && value.slice(0, 4) !== '0000'
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const emptyJson = (value: unknown): boolean => {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? Object.keys(parsed).length === 0 : Array.isArray(parsed) && parsed.length === 0; }
  catch { return false; }
};

export function isImportableRow(table: string, row: Record<string, unknown>, ruling: Ruling | undefined): boolean {
  if (!(MIXED_TABLES as readonly string[]).includes(table)) return true;
  const check = Object.hasOwn(SOURCE_CHECKS, table) ? SOURCE_CHECKS[table as keyof typeof SOURCE_CHECKS] : undefined;
  const discriminator = check ? row[check.column] : undefined;
  if (check && typeof discriminator === 'string' && discriminator.toLowerCase().includes(check.excludesCaseInsensitiveSubstring)) return false;
  if (ruling?.decision === 'exclude' || !ruling) return false;
  // 0041 has a negative CHECK, not a positive source allowlist. Nothing else is guessed.
  if (check || ruling.rule !== 'empty-payload-v1'
    || Object.entries(row).some(([key, value]) => key.endsWith('_json') && !emptyJson(value))
    || (table === 'briefing_runs' && row.preview_text !== null && row.preview_text !== undefined && row.preview_text !== '')) {
    return false;
  }
  return true;
}

function classify(table: string, row: Record<string, unknown>, ruling: Ruling | undefined, report: TableReport): boolean {
  const importable = isImportableRow(table, row, ruling);
  if (importable || !(MIXED_TABLES as readonly string[]).includes(table)) return importable;
  const check = Object.hasOwn(SOURCE_CHECKS, table) ? SOURCE_CHECKS[table as keyof typeof SOURCE_CHECKS] : undefined;
  const discriminator = check ? row[check.column] : undefined;
  if (check && typeof discriminator === 'string' && discriminator.toLowerCase().includes(check.excludesCaseInsensitiveSubstring)) {
    report.ticktickRows++; report.excludedRows++;
    return false;
  }
  if (ruling?.decision === 'exclude') {
    if (check) report.unclassifiedRows++;
    report.excludedRows++;
    return false;
  }
  if (!ruling) { report.blocked = true; report.unclassifiedRows++; bump(report.errors, 'blocked-needs-ruling'); return false; }
  report.unclassifiedRows++;
  bump(report.errors, check ? 'unclassified-discriminator' : 'unsupported-sanitisation');
  return false;
}

async function inspectRow(table: DailyTable, line: string, decision: TableDecision, ruling: Ruling | undefined,
  report: TableReport, index: DiskIndex, declared: readonly string[]): Promise<void> {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { bump(report.errors, 'invalid-json'); return; }
  if (!record(parsed)) { bump(report.errors, 'row-not-object'); return; }
  const row = parsed;
  const definition = dailyTables[table];
  const allowed: readonly string[] = definition.columns;
  for (const column of Object.keys(row)) {
    if (decision.excludedColumns.includes(column)) continue;
    if (!allowed.includes(column)) { bump(report.errors, 'unknown-column'); evidence(report, column); }
    if (!declared.includes(column)) { bump(report.errors, 'undeclared-column'); evidence(report, column); }
  }
  for (const column of decision.integerColumns) {
    if (row[column] !== undefined && row[column] !== null && !validInteger(row[column])) bump(report.errors, 'integer-invalid');
  }
  for (const column of allowed) {
    const value = row[column];
    const type = columnTypes[table][column];
    if (value !== null && value !== undefined) {
      if (type === 'nvarchar' && typeof value !== 'string') bump(report.errors, 'column-type-invalid');
      if (type === 'float' && (typeof value !== 'number' || !Number.isFinite(value))) bump(report.errors, 'column-type-invalid');
      if (type === 'date' && !validDate(value)) bump(report.errors, 'column-type-invalid');
      if (type === 'bit' && typeof value !== 'boolean' && value !== 0 && value !== 1) bump(report.errors, 'column-type-invalid');
    }
    if (!Object.hasOwn(row, column) && !(definition.keys as readonly string[]).includes(column)) bump(report.warnings, 'missing-optional-value');
    if (column.endsWith('_json') && row[column] !== null && row[column] !== undefined) {
      if (typeof row[column] !== 'string') bump(report.errors, 'json-column-invalid');
      else { try { JSON.parse(row[column] as string); } catch { bump(report.errors, 'json-column-invalid'); } }
    }
  }
  let keysValid = true;
  for (const column of definition.keys as readonly string[]) {
    const value = row[column];
    const keyType = (definition.keyTypes as Record<string, { type: string; maxLength?: number }>)[column];
    if (value === undefined || value === null) { bump(report.errors, 'missing-key'); keysValid = false; }
    else if (keyType?.type === 'bigint' ? !validInteger(value)
      : keyType?.type === 'date' ? !validDate(value)
        : typeof value !== 'string' || value.length > (keyType?.maxLength ?? 256)) {
      bump(report.errors, 'key-invalid'); keysValid = false; evidence(report, JSON.stringify(value));
    }
  }
  // The source email is never an identity selector: every profile maps to one owner.
  if (table === 'coach_profiles' && !Object.hasOwn(row, 'owner_email')) { bump(report.errors, 'missing-key'); keysValid = false; }
  if (keysValid) {
    const key = JSON.stringify((definition.keys as readonly string[]).map(k => {
      const value = row[k];
      return decision.integerColumns.includes(k) ? String(BigInt(value as string | number)) : value;
    }));
    if (!await index.add(`keys:${table}`, key)) { bump(report.errors, 'duplicate-key'); evidence(report, key); }
  }
  const importable = classify(table, row, ruling, report);
  if (importable) {
    for (const parent of decision.parents) {
      if (typeof row[parent.column] !== 'string'
        || await index.get(`keys:${parent.table}`, JSON.stringify([row[parent.column]])) === null) bump(report.errors, 'missing-parent');
    }
  }
  if (table === 'health_ingestions' && keysValid) {
    await index.add('ingestions', String(row.id));
  }
  if (table === 'health_raw_objects' && keysValid) {
    if (row.sanitized_checksum !== undefined && row.sanitized_checksum !== null
      && (typeof row.sanitized_checksum !== 'string' || !/^[a-fA-F0-9]{64}$/.test(row.sanitized_checksum))) bump(report.errors, 'sanitized-checksum-invalid');
    await index.add('ledger', String(row.ingestion_id), JSON.stringify({
      checksum: row.checksum, bytes: row.content_bytes, expiresAt: row.expires_at,
    }));
  }
}

async function inspectObjects(manifest: Manifest, reader: BundleReader, index: DiskIndex, now: number, report: ValidationReport): Promise<void> {
  const objects = report.objects;
  const metadata = manifest.objects;
  // A historical ledger does not establish that retained bytes still exist.
  if (!metadata) return;
  try {
    const actual = await reader.lines(metadata.index, async line => {
      objects.count++;
      let entry;
      try { entry = parseObjectEntry(JSON.parse(line)); }
      catch (e) { bump(objects.errors, failureCode(e)); return; }
      objects.bytes += entry.bytes;
      if (!Number.isSafeInteger(objects.bytes)) fail('object-size-invalid');
      if (!await index.add('object-files', entry.file) || !await index.add('object-ingestions', entry.ingestionId)) bump(objects.errors, 'object-duplicate');
      const ingestion = await index.get('ingestions', entry.ingestionId);
      if (ingestion === null) bump(objects.errors, 'object-ingestion-missing');
      const ledger = await index.get('ledger', entry.ingestionId);
      if (ledger !== null) {
        const expected = JSON.parse(ledger) as { checksum?: unknown; bytes?: unknown; expiresAt?: unknown };
        const known = (value: unknown): boolean => value !== null && value !== undefined;
        if ((known(expected.checksum) && (typeof expected.checksum !== 'string' || expected.checksum.toLowerCase() !== entry.sha256))
          || (known(expected.bytes) && (!validInteger(expected.bytes) || BigInt(expected.bytes as string | number) !== BigInt(entry.bytes)))
          || (known(expected.expiresAt) && expected.expiresAt !== entry.expiresAt)) bump(objects.errors, 'object-ledger-mismatch');
      }
      if (Date.parse(entry.expiresAt) <= now) { objects.expired++; return; }
      try {
        const actual = await reader.hash(entry.file);
        if (actual.bytes !== entry.bytes) bump(objects.errors, 'object-size-mismatch');
        if (actual.sha256 !== entry.sha256) bump(objects.errors, 'object-checksum-mismatch');
        if (actual.bytes === entry.bytes && actual.sha256 === entry.sha256) objects.verified++;
      } catch (e) { bump(objects.errors, failureCode(e)); }
    });
    objects.sha256 = actual.sha256;
    if (actual.sha256 !== metadata.sha256) bump(objects.errors, 'objects-checksum-mismatch');
    if (actual.rows !== metadata.count) bump(objects.errors, 'objects-count-mismatch');
    if (objects.bytes !== metadata.totalBytes) bump(objects.errors, 'objects-bytes-mismatch');
  } catch (e) { bump(objects.errors, failureCode(e)); }
}

async function writeReport(directory: string, report: ValidationReport): Promise<void> {
  const summary = [
    '# Offline Daily validation', '', report.valid ? 'PASS' : 'FAIL', '',
    `Rows: ${report.totals.sourceRows}`, `Errors: ${report.totals.errors}`,
    `Warnings: ${report.totals.warnings}`, `Blocked tables: ${report.totals.blockedTables}`,
    `Objects: ${report.objects.count}; verified: ${report.objects.verified}; expired: ${report.objects.expired}`, '',
    'See validation-report.json for stable failure codes. This is not import or private-source acceptance.', '',
  ].join('\n');
  for (const [name, text] of [['validation-report.json', `${JSON.stringify(report, null, 2)}\n`], ['validation-summary.md', summary]]) {
    const destination = join(directory, name!);
    try {
      const existing = await lstat(destination);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) fail('unsafe-report-file');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const staging = join(directory, `.daily-report-${randomUUID()}`);
    try {
      const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(text!); } finally { await handle.close(); }
      // Replace only the directory entry, never truncate an existing inode/hard link.
      await rename(staging, destination);
    } finally { await unlink(staging).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }); }
  }
}

export async function validateBundle(options: ValidateOptions): Promise<ValidationReport> {
  try { return await validate(options); }
  catch (e) { if (e instanceof ValidationFailure) throw e; return fail('report-io'); }
}

async function validate(options: ValidateOptions): Promise<ValidationReport> {
  const bundlePath = resolve(options.bundle), reportPath = resolve(options.reportDir);
  if (reportPath === bundlePath || reportPath.startsWith(`${bundlePath.endsWith(sep) ? bundlePath : bundlePath + sep}`)) fail('report-location-invalid');
  const report: ValidationReport = {
    formatVersion: 1, valid: false, errors: {}, tables: {}, unknownTables: { count: 0, digest: null },
    objects: { count: 0, bytes: 0, expired: 0, verified: 0, errors: {}, sha256: null },
    totals: { sourceRows: 0, errors: 0, warnings: 0, blockedTables: 0 },
  };
  const output = await safeDirectory(options.reportDir, true);
  let reader: BundleReader | undefined, index: DiskIndex | undefined;
  try {
    const budget = options.memoryBudgetBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(budget) || budget < 65536) fail('memory-budget-invalid');
    if (options.now !== undefined && !timestamp(options.now)) fail('validation-time-invalid');
    const now = options.now === undefined ? Date.now() : Date.parse(options.now);
    const lineLimit = Math.min(1024 * 1024, Math.floor(budget / 8));
    reader = await BundleReader.create(options.bundle, lineLimit);
    const manifest = parseManifest(await reader.boundedJson('manifest.json', Math.min(262144, Math.floor(budget / 2))));
    index = await DiskIndex.create(output);
    const allowedFiles = new Set(['manifest.json', ...Object.values(manifest.tables).map(t => t.file),
      ...(manifest.objects ? ['objects.ndjson', 'objects'] : [])]);
    for (const file of await reader.entries()) if (!allowedFiles.has(file)) bump(report.errors, 'unexpected-files');
    for (const name of Object.keys(manifest.tables)) if (!ownDecision(name)) {
      report.unknownTables.count++;
      report.unknownTables.digest = sha256(`${report.unknownTables.digest ?? ''}\0${name}`).slice(0, 24);
      bump(report.errors, 'unknown-table');
    }
    for (const name of Object.keys(manifest.rulings ?? {})) {
      if (!(MIXED_TABLES as readonly string[]).includes(name)) bump(report.errors, 'unknown-ruling');
    }
    for (const table of [...IMPORT_ORDER, ...Object.keys(decisions).filter(name => decisions[name]?.decision === 'exclude')]) {
      const decision = decisions[table]!;
      const metadata = manifest.tables[table];
      const ruling = manifest.rulings?.[table];
      const result: TableReport = {
        decision: ruling?.decision === 'exclude' ? 'exclude' : decision.decision,
        sourceRows: 0, manifestRows: metadata?.rowCount ?? 0, sha256: null, checksumMatch: false,
        warnings: {}, errors: {}, blocked: false, ticktickRows: 0, unclassifiedRows: 0, excludedRows: 0, evidenceDigest: null,
      };
      report.tables[table] = result;
      if (!metadata) { bump(result.errors, 'missing-table'); continue; }
      if (metadata.file !== `${table}.ndjson`) { bump(result.errors, 'unsafe-table-file'); continue; }
      if (decision.decision === 'import-after-ruling' && !ruling) { result.blocked = true; bump(result.errors, 'blocked-needs-ruling'); }
      if (decision.target) {
        const definition = dailyTables[decision.target];
        for (const key of decision.sourceKey) if (!metadata.columns.includes(key)) bump(result.errors, 'missing-key-column');
        for (const column of metadata.columns) if (!(definition.columns as readonly string[]).includes(column) && !decision.excludedColumns.includes(column)) {
          bump(result.errors, 'unknown-column'); evidence(result, column);
        }
        for (const column of definition.columns) if (!metadata.columns.includes(column) && !(definition.keys as readonly string[]).includes(column)) bump(result.warnings, 'missing-optional-column');
      }
      try {
        const actual = await reader.lines(metadata.file, async line => {
          result.sourceRows++;
          if (!decision.target) { result.excludedRows++; return; }
          await inspectRow(decision.target, line, decision, ruling, result, index!, metadata.columns);
        });
        result.sha256 = actual.sha256;
        result.checksumMatch = actual.sha256 === metadata.sha256;
        if (!result.checksumMatch) bump(result.errors, 'checksum-mismatch');
        if (actual.rows !== metadata.rowCount) bump(result.errors, 'row-count-mismatch');
      } catch (e) { bump(result.errors, failureCode(e)); }
    }
    await inspectObjects(manifest, reader, index, now, report);
  } catch (e) { bump(report.errors, failureCode(e)); }
  finally {
    await reader?.close().catch(() => bump(report.errors, 'cleanup-failed'));
    await index?.close().catch(() => bump(report.errors, 'cleanup-failed'));
  }
  for (const table of Object.values(report.tables)) {
    report.totals.sourceRows += table.sourceRows;
    report.totals.errors += sum(table.errors);
    report.totals.warnings += sum(table.warnings);
    if (table.blocked) report.totals.blockedTables++;
  }
  report.totals.errors += sum(report.errors) + sum(report.objects.errors);
  report.valid = report.totals.errors === 0;
  await writeReport(output, report);
  return report;
}
