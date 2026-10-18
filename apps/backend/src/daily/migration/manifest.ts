export interface TableManifest {
  file: string;
  rowCount: number;
  sha256: string;
  complete: true;
  columns: string[];
}
export interface Ruling {
  decision: 'import-sanitised' | 'exclude';
  rule: string;
}
export interface Manifest {
  formatVersion: 1;
  createdAt: string;
  exporter: { name: string; version: string };
  sourceSchemaRef: string;
  tables: Record<string, TableManifest>;
  rulings?: Record<string, Ruling>;
  objects?: { index: string; count: number; totalBytes: number; sha256: string };
}
export interface ObjectEntry {
  file: string;
  ingestionId: string;
  bytes: number;
  sha256: string;
  expiresAt: string;
}

export class ValidationFailure extends Error {
  constructor(public readonly code: string) { super(code); }
}
export const fail = (code: string): never => { throw new ValidationFailure(code); };
export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const digestPattern = /^[a-f0-9]{64}$/;
export const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096;
export const timestamp = (v: unknown): v is string => {
  if (typeof v !== 'string'
    || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)
    || !Number.isFinite(Date.parse(v)) || v.startsWith('0000')) return false;
  const date = v.slice(0, 10);
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
};
const exact = (v: Record<string, unknown>, required: string[], optional: string[] = []): boolean =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k));

export function parseManifest(value: unknown): Manifest {
  if (!record(value) || !exact(value, ['formatVersion', 'createdAt', 'exporter', 'sourceSchemaRef', 'tables'], ['rulings', 'objects'])
    || value.formatVersion !== 1 || !timestamp(value.createdAt) || !text(value.sourceSchemaRef)
    || !record(value.exporter) || !exact(value.exporter, ['name', 'version']) || !text(value.exporter.name) || !text(value.exporter.version)
    || !record(value.tables) || Object.keys(value.tables).length > 64) return fail('manifest-invalid');
  for (const t of Object.values(value.tables)) {
    if (!record(t) || !exact(t, ['file', 'rowCount', 'sha256', 'complete', 'columns'])
      || !text(t.file) || !count(t.rowCount) || typeof t.sha256 !== 'string' || !digestPattern.test(t.sha256)
      || t.complete !== true || !Array.isArray(t.columns) || t.columns.length > 256
      || !t.columns.every(text) || new Set(t.columns).size !== t.columns.length) return fail('manifest-invalid');
  }
  if (value.rulings !== undefined) {
    if (!record(value.rulings) || Object.keys(value.rulings).length > 5) return fail('manifest-invalid');
    for (const r of Object.values(value.rulings)) {
      if (!record(r) || !exact(r, ['decision', 'rule']) || !['import-sanitised', 'exclude'].includes(String(r.decision))
        || !text(r.rule) || !r.rule.length) return fail('manifest-invalid');
    }
  }
  if (value.objects !== undefined) {
    const o = value.objects;
    if (!record(o) || !exact(o, ['index', 'count', 'totalBytes', 'sha256']) || o.index !== 'objects.ndjson'
      || !count(o.count) || !count(o.totalBytes) || typeof o.sha256 !== 'string' || !digestPattern.test(o.sha256)) return fail('manifest-invalid');
  }
  return value as unknown as Manifest;
}

export function parseObjectEntry(value: unknown): ObjectEntry {
  if (!record(value) || !exact(value, ['file', 'ingestionId', 'bytes', 'sha256', 'expiresAt'])
    || typeof value.file !== 'string' || !/^objects\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?$/.test(value.file)
    || typeof value.ingestionId !== 'string' || value.ingestionId.length > 256
    || !count(value.bytes) || typeof value.sha256 !== 'string' || !digestPattern.test(value.sha256)
    || !timestamp(value.expiresAt)) return fail('object-entry-invalid');
  return value as unknown as ObjectEntry;
}
