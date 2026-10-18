import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, mkdtemp, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import type { ConnectionPool, Transaction } from 'mssql';
import type { FastifyRequest } from 'fastify';
import { loadAuthConfig } from '../../auth/config.js';
import { resolveDailyOwner } from '../owner.js';
import { dailyTables, type DailyTable } from '../store/schema.js';
import { columnTypes, decisions, EXCLUDED_TABLES, IMPORT_ORDER } from './decisions.js';
import { BundleReader, safeDirectory, sha256 } from './io.js';
import { parseManifest, type Manifest, type Ruling } from './manifest.js';
import { isImportableRow, validateBundle } from './validate.js';

export const IMPORT_CONFLICT_EXIT_CODE = 3;
const STATE_FILE = '.daily-import-state.json';
const LOCK_FILE = '.daily-import.lock';
const MAX_ATTEMPTS = 3;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const textKeyMetadata = (table: DailyTable, column: string) =>
  (dailyTables[table].keyTypes as Record<string, { type: string; maxLength?: number }>)[column];

export interface ImportOptions {
  bundle: string;
  ownerObjectId: string;
  stateDir: string;
  execute?: boolean;
  batchSize?: number;
  tables?: readonly string[];
}

export interface ReconcileOptions {
  bundle: string;
  ownerObjectId: string;
  batchSize?: number;
  tables?: readonly string[];
}

export interface MigrationTableReport {
  sourceRows: number;
  importableRows: number;
  excludedRows: number;
  inserted: number;
  skipped: number;
  conflicts: number;
  wouldInsert: number;
  wouldSkip: number;
  wouldConflict: number;
  sourceSha256: string;
  targetSha256: string | null;
  missing: number;
  extra: number;
  different: number;
  dateRangeDigest: string | null;
  mealTotalsDigest: string | null;
}

export interface MigrationReport {
  formatVersion: 1;
  operation: 'import' | 'reconcile';
  status: 'complete' | 'conflicts' | 'differences' | 'failed';
  bundleDigest: string;
  tables: Partial<Record<DailyTable, MigrationTableReport>>;
  excludedTables: number;
}

interface BatchCounts {
  sourceRows: number;
  importableRows: number;
  excludedRows: number;
  inserted: number;
  skipped: number;
  conflicts: number;
  wouldInsert: number;
  wouldSkip: number;
  wouldConflict: number;
}
interface BatchCheckpoint extends BatchCounts { digest: string }
interface TableCheckpoint { complete: boolean; batches: BatchCheckpoint[] }
interface ImportCheckpoint {
  version: 1;
  manifestDigest: string;
  batchSize: number;
  tables: Partial<Record<DailyTable, TableCheckpoint>>;
}
interface SourceRow { line: string; value: Record<string, unknown> }
interface PreparedRow { source: Record<string, unknown>; values: Record<string, unknown> }

const emptyCounts = (): BatchCounts => ({
  sourceRows: 0, importableRows: 0, excludedRows: 0, inserted: 0, skipped: 0, conflicts: 0,
  wouldInsert: 0, wouldSkip: 0, wouldConflict: 0,
});
const isWithin = (directory: string, path: string): boolean => path === directory || path.startsWith(`${directory}${sep}`);
const addReportCounts = (target: MigrationTableReport, source: BatchCounts): void => {
  for (const key of Object.keys(source) as (keyof BatchCounts)[]) target[key] += source[key];
};

export function canonicalValue(table: DailyTable, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const type = columnTypes[table][column];
  if (type === 'bigint') return BigInt(value as string | number | bigint).toString();
  if (type === 'float') return Object.is(Number(value), -0) ? 0 : Number(value);
  if (type === 'date') return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (type === 'bit') return value === true || value === 1;
  if (column.endsWith('_json')) return canonicalJson(String(value));
  return String(value);
}

function canonicalJson(value: string): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort()
        .map(key => [key, normalize((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return JSON.stringify(normalize(JSON.parse(value)));
}

function canonicalRow(table: DailyTable, row: Record<string, unknown>): string {
  return JSON.stringify(dailyTables[table].columns.map(column => [column, canonicalValue(table, column, row[column])]));
}

function projectRow(table: DailyTable, row: Record<string, unknown>): PreparedRow {
  const values = Object.fromEntries(dailyTables[table].columns.map(column => [column, row[column] ?? null]));
  return { source: row, values };
}

function valueForBinding(table: DailyTable, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const type = columnTypes[table][column];
  if (type === 'bigint') return BigInt(value as string | number | bigint);
  if (type === 'date') return value instanceof Date ? value : new Date(`${String(value)}T00:00:00.000Z`);
  if (type === 'bit') return value === true || value === 1;
  return value;
}

export function classifyImportRow(table: string, row: Record<string, unknown>, ruling?: Ruling): boolean {
  const decision = decisions[table];
  return Boolean(decision?.target && decision.decision !== 'exclude' && isImportableRow(table, row, ruling));
}

export function isTransientSqlError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === 'object') {
      const value = current as { code?: unknown; number?: unknown; originalError?: unknown; cause?: unknown };
      if (typeof value.code === 'string' && [
        'ETIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ECONNREFUSED', 'ENETRESET', 'EPIPE', 'ESOCKET',
      ].includes(value.code.toUpperCase())) return true;
      if (typeof value.number === 'number' && [
        -2, 1205, 10928, 10929, 40197, 40501, 40613, 49918, 49919, 49920,
      ].includes(value.number)) return true;
      current = value.originalError ?? value.cause;
    } else break;
  }
  return false;
}

async function retryTransient<T>(operation: () => Promise<T>, pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!isTransientSqlError(error) || attempt + 1 >= MAX_ATTEMPTS) throw error;
      await pause(100 * 2 ** attempt + Math.floor(Math.random() * 100));
    }
  }
}

function validateOptions(bundle: string, ownerObjectId: string, batchSize = 500): void {
  if (!bundle || !ownerObjectId || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(ownerObjectId)
    || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error('options-invalid');
}

export function assertConfiguredOwner(ownerObjectId: string, configuredOwner: string): string {
  const request = {
    server: { ownerObjectId: configuredOwner },
    principal: null,
    agentPrincipal: { kind: 'jarvis-agent', objectId: '00000000-0000-4000-8000-000000000001' },
    nutritionExportPrincipal: null,
    runnerPrincipal: null,
    pcBridgePrincipal: null,
    phoneEventGridPrincipal: null,
    deployPrincipal: null,
  } as unknown as FastifyRequest;
  const resolved = resolveDailyOwner(request);
  if (resolved.toLowerCase() !== ownerObjectId.toLowerCase()) throw new Error('owner-mismatch');
  return resolved;
}

async function readManifest(bundle: string): Promise<{ manifest: Manifest; digest: string }> {
  const reader = await BundleReader.create(bundle, 262144);
  try {
    const bytes: Buffer[] = [];
    for await (const chunk of reader.chunks('manifest.json')) bytes.push(Buffer.from(chunk));
    const content = Buffer.concat(bytes);
    return { manifest: parseManifest(JSON.parse(content.toString('utf8'))), digest: sha256(content) };
  } finally { await reader.close(); }
}

function selectedTables(tables: readonly string[] | undefined): DailyTable[] {
  if (!tables) return [...IMPORT_ORDER];
  if (!tables.length || new Set(tables).size !== tables.length) throw new Error('tables-invalid');
  for (const table of tables) if (!Object.hasOwn(dailyTables, table)) throw new Error('tables-invalid');
  return IMPORT_ORDER.filter(table => tables.includes(table));
}

async function preflight(bundle: string, workspace: string): Promise<Manifest> {
  const report = await validateBundle({ bundle, reportDir: workspace });
  if (!report.valid || Object.values(report.tables).some(table => table.blocked)) throw new Error('validation-failed');
  const { manifest } = await readManifest(bundle);
  return manifest;
}

async function acquireState(stateDirectory: string, manifestDigest: string, batchSize: number): Promise<{
  directory: string; checkpoint: ImportCheckpoint; release: () => Promise<void>;
}> {
  const directory = resolve(stateDirectory);
  if (!isAbsolute(stateDirectory) || isWithin(repositoryRoot, directory)) throw new Error('state-location-invalid');
  await safeDirectory(directory, true);
  const directoryInfo = await lstat(directory);
  if ((directoryInfo.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && directoryInfo.uid !== process.getuid())) {
    throw new Error('state-permissions-invalid');
  }
  const entries = await readdir(directory);
  for (const name of entries) {
    if (name.startsWith('.checkpoint-')) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('state-invalid');
      await unlink(path);
    } else if (![STATE_FILE, LOCK_FILE].includes(name)) throw new Error('state-unknown');
  }
  const lockPath = join(directory, LOCK_FILE);
  try {
    const info = await lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('state-running');
    let lock: { pid?: unknown } | undefined;
    try { lock = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown }; } catch { throw new Error('state-running'); }
    if (typeof lock.pid !== 'number' || !Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error('state-running');
    try { process.kill(lock.pid, 0); throw new Error('state-running'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await unlink(lockPath);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  const release = async () => { await unlink(lockPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); };
  let checkpoint: ImportCheckpoint = { version: 1, manifestDigest, batchSize, tables: {} };
  const statePath = join(directory, STATE_FILE);
  try {
    const info = await lstat(statePath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('state-invalid');
    checkpoint = JSON.parse(await readFile(statePath, 'utf8')) as ImportCheckpoint;
    if (checkpoint.version !== 1 || checkpoint.manifestDigest !== manifestDigest || checkpoint.batchSize !== batchSize
      || !checkpoint.tables || typeof checkpoint.tables !== 'object'
      || Object.keys(checkpoint).some(key => !['version', 'manifestDigest', 'batchSize', 'tables'].includes(key))
      || Object.keys(checkpoint.tables).some(table => !Object.hasOwn(dailyTables, table))) {
      throw new Error('state-bundle-mismatch');
    }
    for (const table of Object.keys(checkpoint.tables) as DailyTable[]) validateCheckpointTable(table, checkpoint.tables[table]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { await release(); throw error; }
  }
  return { directory, checkpoint, release };
}

async function writeCheckpoint(directory: string, checkpoint: ImportCheckpoint): Promise<void> {
  const destination = join(directory, STATE_FILE);
  try {
    const info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('state-invalid');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = join(directory, `.checkpoint-${randomUUID()}`);
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${JSON.stringify(checkpoint)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(staging, destination);
  } finally { await unlink(staging).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}

function validateCheckpointTable(table: DailyTable, checkpoint: TableCheckpoint | undefined): TableCheckpoint {
  if (!checkpoint) return { complete: false, batches: [] };
  if (typeof checkpoint !== 'object' || typeof checkpoint.complete !== 'boolean' || !Array.isArray(checkpoint.batches)
    || Object.keys(checkpoint).some(key => !['complete', 'batches'].includes(key))) throw new Error('state-invalid');
  const countKeys: (keyof BatchCounts)[] = [
    'sourceRows', 'importableRows', 'excludedRows', 'inserted', 'skipped', 'conflicts',
    'wouldInsert', 'wouldSkip', 'wouldConflict',
  ];
  for (const batch of checkpoint.batches) {
    if (typeof batch !== 'object' || batch === null || Object.keys(batch).length !== countKeys.length + 1
      || typeof batch.digest !== 'string' || !/^[a-f0-9]{64}$/.test(batch.digest)
      || countKeys.some(key => !Number.isSafeInteger(batch[key]) || batch[key] < 0)
      || Object.keys(batch).some(key => key !== 'digest' && !countKeys.includes(key as keyof BatchCounts))) throw new Error('state-invalid');
  }
  if (!dailyTables[table]) throw new Error('state-invalid');
  return checkpoint;
}

async function verifyLiveSchema(pool: ConnectionPool, tables: readonly DailyTable[]): Promise<void> {
  const result = await retryTransient(() => pool.request().query<{
    TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string; CHARACTER_MAXIMUM_LENGTH: number | null;
  }>(`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = N'daily';`));
  const live = new Map(result.recordset.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
  for (const table of tables) {
    const names = ['owner_object_id', ...dailyTables[table].columns];
    for (const column of names) {
      const entry = live.get(`${table}.${column}`);
      const expected = column === 'owner_object_id' ? 'uniqueidentifier' : columnTypes[table][column];
      if (!entry || entry.DATA_TYPE.toLowerCase() !== expected) throw new Error('schema-mismatch');
      if (column === 'owner_object_id') continue;
      const key = textKeyMetadata(table, column);
      if (key?.type === 'text' && entry.CHARACTER_MAXIMUM_LENGTH !== -1 && (entry.CHARACTER_MAXIMUM_LENGTH ?? 0) < key.maxLength!) {
        throw new Error('schema-mismatch');
      }
    }
  }
}

function keyWhere(table: DailyTable, request: sql.Request, values: Record<string, unknown>): string {
  const definition = dailyTables[table];
  if (definition.keys.length === 0) return 'owner_object_id = @owner';
  return definition.keys.map((column, index) => {
    const metadata = textKeyMetadata(table, column);
    const type = metadata?.type === 'bigint' ? sql.BigInt : metadata?.type === 'date' ? sql.Date : sql.NVarChar(metadata?.maxLength ?? 256);
    const value = metadata?.type === 'bigint' ? BigInt(String(values[column]))
      : metadata?.type === 'date' ? new Date(`${String(values[column])}T00:00:00.000Z`)
        : values[column];
    request.input(`key${index}`, type, value);
    return metadata?.type === 'text'
      ? `[${column}] = @key${index} AND DATALENGTH([${column}]) = DATALENGTH(@key${index})`
      : `[${column}] = @key${index}`;
  }).join(' AND ');
}

function bindRow(request: sql.Request, table: DailyTable, values: Record<string, unknown>): void {
  for (const [index, column] of dailyTables[table].columns.entries()) {
    const type = columnTypes[table][column]!;
    const sqlType = type === 'nvarchar' ? sql.NVarChar(textKeyMetadata(table, column)?.maxLength ?? sql.MAX)
      : type === 'bigint' ? sql.BigInt
        : type === 'float' ? sql.Float
          : type === 'date' ? sql.Date : sql.Bit;
    request.input(`value${index}`, sqlType,
      valueForBinding(table, column, values[column]));
  }
}

async function rowStatus(
  pool: ConnectionPool,
  transaction: Transaction | undefined,
  table: DailyTable,
  owner: string,
  row: PreparedRow,
  execute: boolean,
): Promise<'insert' | 'skip' | 'conflict'> {
  const request = transaction ? new sql.Request(transaction) : pool.request();
  request.input('owner', sql.UniqueIdentifier, owner);
  const where = keyWhere(table, request, row.values);
  const query = `SELECT ${dailyTables[table].columns.map(column => `[${column}]`).join(', ')}
    FROM daily.[${table}]${transaction ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE ${where};`;
  const selected = transaction
    ? await request.query<Record<string, unknown>>(query)
    : await retryTransient(() => request.query<Record<string, unknown>>(query));
  const existing = selected.recordset[0];
  if (!existing) {
    if (!execute) return 'insert';
    const insert = transaction ? new sql.Request(transaction) : pool.request();
    insert.input('owner', sql.UniqueIdentifier, owner);
    bindRow(insert, table, row.values);
    const columns = ['owner_object_id', ...dailyTables[table].columns].map(column => `[${column}]`).join(', ');
    const parameters = ['@owner', ...dailyTables[table].columns.map((_, index) => `@value${index}`)].join(', ');
    if (transaction) await insert.query(`INSERT daily.[${table}] (${columns}) VALUES (${parameters});`);
    else await retryTransient(() => insert.query(`INSERT daily.[${table}] (${columns}) VALUES (${parameters});`));
    return 'insert';
  }
  return dailyTables[table].columns.every(column =>
    JSON.stringify(canonicalValue(table, column, existing[column])) === JSON.stringify(canonicalValue(table, column, row.values[column])))
    ? 'skip' : 'conflict';
}

async function processBatch(
  pool: ConnectionPool,
  table: DailyTable,
  owner: string,
  rows: PreparedRow[],
  execute: boolean,
): Promise<BatchCounts> {
  const result = emptyCounts();
  result.sourceRows = rows.length;
  result.importableRows = rows.length;
  const evaluate = async (transaction?: Transaction): Promise<void> => {
    for (const row of rows) {
      const status = await rowStatus(pool, transaction, table, owner, row, execute);
      if (status === 'insert') execute ? result.inserted++ : result.wouldInsert++;
      else if (status === 'skip') execute ? result.skipped++ : result.wouldSkip++;
      else execute ? result.conflicts++ : result.wouldConflict++;
    }
  };
  if (!execute) { await evaluate(); return result; }
  await retryTransient(async () => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try { await evaluate(transaction); await transaction.commit(); }
    catch (error) { await transaction.rollback().catch(() => undefined); throw error; }
  });
  return result;
}

function makeTableReport(): MigrationTableReport {
  return {
    sourceRows: 0, importableRows: 0, excludedRows: 0, inserted: 0, skipped: 0, conflicts: 0,
    wouldInsert: 0, wouldSkip: 0, wouldConflict: 0, sourceSha256: '', targetSha256: null,
    missing: 0, extra: 0, different: 0, dateRangeDigest: null, mealTotalsDigest: null,
  };
}

async function streamTable(
  reader: BundleReader,
  table: DailyTable,
  manifest: Manifest,
  batchSize: number,
  consume: (batch: SourceRow[], batchIndex: number) => Promise<void>,
): Promise<void> {
  const metadata = manifest.tables[table];
  if (!metadata) throw new Error('validation-failed');
  const batch: SourceRow[] = [];
  let index = 0;
  await reader.lines(metadata.file, async line => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new Error('validation-failed'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('validation-failed');
    batch.push({ line, value: parsed as Record<string, unknown> });
    if (batch.length === batchSize) {
      await consume(batch.splice(0), index++);
    }
  });
  if (batch.length) await consume(batch, index);
}

function sourceRowDigest(rows: readonly SourceRow[]): string {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row.line).update('\n');
  return hash.digest('hex');
}

async function loadProgressReport(
  pool: ConnectionPool,
  table: DailyTable,
  owner: string,
  report: MigrationTableReport,
  checkpoint: TableCheckpoint | undefined,
  manifest: Manifest,
  reader: BundleReader,
  batchSize: number,
  execute: boolean,
  checkpointStore: ImportCheckpoint,
  stateDirectory: string,
): Promise<void> {
  const tableState = validateCheckpointTable(table, checkpoint);
  const sourceHash = createHash('sha256');
  let batchesSeen = 0;
  await streamTable(reader, table, manifest, batchSize, async (sourceRows, index) => {
    batchesSeen++;
    const digest = sourceRowDigest(sourceRows);
    const importable = sourceRows.filter(row => classifyImportRow(table, row.value, manifest.rulings?.[table]));
    const excluded = sourceRows.length - importable.length;
    for (const row of importable) sourceHash.update(canonicalRow(table, projectRow(table, row.value).values)).update('\n');
    if (index < tableState.batches.length) {
      const saved = tableState.batches[index]!;
      if (saved.digest !== digest) throw new Error('state-bundle-mismatch');
      addReportCounts(report, saved);
      return;
    }
    if (tableState.complete) throw new Error('state-invalid');
    const counts = await processBatch(pool, table, owner, importable.map(row => projectRow(table, row.value)), execute);
    counts.sourceRows = sourceRows.length;
    counts.importableRows = importable.length;
    counts.excludedRows = excluded;
    addReportCounts(report, counts);
    if (execute) {
      tableState.batches.push({ ...counts, digest });
      checkpointStore.tables[table] = tableState;
      await writeCheckpoint(stateDirectory, checkpointStore);
    }
  });
  if (tableState.batches.length > batchesSeen
    || tableState.complete && tableState.batches.length !== Math.ceil((manifest.tables[table]?.rowCount ?? 0) / batchSize)) {
    throw new Error('state-invalid');
  }
  if (execute) {
    tableState.complete = true;
    checkpointStore.tables[table] = tableState;
    await writeCheckpoint(stateDirectory, checkpointStore);
  }
  report.sourceSha256 = sourceHash.digest('hex');
}

async function createImportContext(bundle: string): Promise<{ workspace: string; manifest: Manifest; digest: string; reader: BundleReader }> {
  const workspace = await mkdtemp(join(tmpdir(), 'daily-import-validation-'));
  try {
    const manifest = await preflight(bundle, workspace);
    const data = await readManifest(bundle);
    const reader = await BundleReader.create(bundle, 1024 * 1024);
    return { workspace, manifest, digest: data.digest, reader };
  } catch (error) { await rm(workspace, { recursive: true, force: true }); throw error; }
}

export async function importBundle(
  options: ImportOptions,
  pool: ConnectionPool,
  configuredOwner = loadAuthConfig(process.env).ownerObjectId,
): Promise<MigrationReport> {
  validateOptions(options.bundle, options.ownerObjectId, options.batchSize);
  const owner = assertConfiguredOwner(options.ownerObjectId, configuredOwner);
  const tables = selectedTables(options.tables);
  const context = await createImportContext(options.bundle);
  let state: Awaited<ReturnType<typeof acquireState>> | undefined;
  const report: MigrationReport = {
    formatVersion: 1, operation: 'import', status: 'complete', bundleDigest: context.digest, tables: {}, excludedTables: EXCLUDED_TABLES.length,
  };
  try {
    state = await acquireState(options.stateDir, context.digest, options.batchSize ?? 500);
    await verifyLiveSchema(pool, tables);
    for (const table of tables) {
      const tableReport = makeTableReport();
      report.tables[table] = tableReport;
      await loadProgressReport(pool, table, owner, tableReport, state.checkpoint.tables[table], context.manifest,
        context.reader, options.batchSize ?? 500, options.execute === true, state.checkpoint, state.directory);
      if (tableReport.conflicts + tableReport.wouldConflict > 0) report.status = 'conflicts';
    }
    return report;
  } catch {
    report.status = 'failed';
    throw Object.assign(new Error('import-failed'), { report });
  } finally {
    await context.reader.close();
    await rm(context.workspace, { recursive: true, force: true });
    await state?.release();
  }
}

export async function reconcileBundle(
  options: ReconcileOptions,
  pool: ConnectionPool,
  configuredOwner = loadAuthConfig(process.env).ownerObjectId,
): Promise<MigrationReport> {
  validateOptions(options.bundle, options.ownerObjectId, options.batchSize);
  const owner = assertConfiguredOwner(options.ownerObjectId, configuredOwner);
  const tables = selectedTables(options.tables);
  const context = await createImportContext(options.bundle);
  const report: MigrationReport = {
    formatVersion: 1, operation: 'reconcile', status: 'complete', bundleDigest: context.digest, tables: {}, excludedTables: EXCLUDED_TABLES.length,
  };
  try {
    await verifyLiveSchema(pool, tables);
    for (const table of tables) {
      const tableReport = makeTableReport();
      report.tables[table] = tableReport;
      const rowHashes = new Map<string, string>();
      const sourceHash = createHash('sha256');
      await streamTable(context.reader, table, context.manifest, options.batchSize ?? 500, async rows => {
        for (const row of rows) {
          if (!classifyImportRow(table, row.value, context.manifest.rulings?.[table])) {
            tableReport.excludedRows++;
            continue;
          }
          tableReport.sourceRows++;
          tableReport.importableRows++;
          const canonical = canonicalRow(table, projectRow(table, row.value).values);
          sourceHash.update(canonical).update('\n');
          const key = JSON.stringify(dailyTables[table].keys.map(column => canonicalValue(table, column, row.value[column])));
          rowHashes.set(key, canonical);
        }
      });
      tableReport.sourceSha256 = sourceHash.digest('hex');
      const targetHash = createHash('sha256');
      const result = await pool.request().input('owner', sql.UniqueIdentifier, owner).query<Record<string, unknown>>(
        `SELECT ${dailyTables[table].columns.map(column => `[${column}]`).join(', ')}
         FROM daily.[${table}] WHERE owner_object_id = @owner;`,
      );
      for (const row of result.recordset) {
        const key = JSON.stringify(dailyTables[table].keys.map(column => canonicalValue(table, column, row[column])));
        const canonical = canonicalRow(table, row);
        targetHash.update(canonical).update('\n');
        const source = rowHashes.get(key);
        if (source === undefined) tableReport.extra++;
        else if (source !== canonical) tableReport.different++;
        else rowHashes.delete(key);
      }
      tableReport.missing = rowHashes.size;
      tableReport.targetSha256 = targetHash.digest('hex');
      if (tableReport.missing || tableReport.extra || tableReport.different) report.status = 'differences';
      const dates = dailyTables[table].columns.filter(column => column.endsWith('_date') || column.endsWith('_on'));
      if (dates.length) {
        const boundaries = dates.flatMap(column => {
          const values = [...rowHashes.values()].map(value => JSON.parse(value) as [string, unknown][]);
          return values.flatMap(valuesForRow => {
            const value = valuesForRow.find(([name]) => name === column)?.[1];
            return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) ? [value] : [];
          });
        });
        tableReport.dateRangeDigest = sha256(boundaries.sort().join('\0')).slice(0, 24);
      }
      if (table === 'nutrition_meals') {
        const totals = result.recordset.map(row => [
          canonicalValue(table, 'meal_date', row.meal_date),
          ...['energy_kcal', 'protein_grams', 'carbohydrates_grams', 'fat_grams', 'fiber_grams']
            .map(column => canonicalValue(table, column, row[column])),
        ]);
        tableReport.mealTotalsDigest = sha256(JSON.stringify(totals)).slice(0, 24);
      }
    }
    return report;
  } catch {
    report.status = 'failed';
    throw Object.assign(new Error('reconcile-failed'), { report });
  } finally {
    await context.reader.close();
    await rm(context.workspace, { recursive: true, force: true });
  }
}

export async function writeMigrationReport(path: string, bundle: string, stateDir: string | undefined, report: MigrationReport): Promise<void> {
  const destination = resolve(path);
  if (isWithin(repositoryRoot, destination) || isWithin(resolve(bundle), destination)
    || (stateDir && isWithin(resolve(stateDir), destination))) throw new Error('report-location-invalid');
  await safeDirectory(dirname(destination), true);
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error('report-file-invalid');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = join(dirname(destination), `.daily-report-${randomUUID()}`);
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(staging, destination);
  } finally { await unlink(staging).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}
