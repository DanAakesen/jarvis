import { createHash } from 'node:crypto';

/** Internal synthetic-tested primitives, not a D1/R2 API or live adapter. */
export class ExportValidationError extends Error {
  constructor(code) {
    super(`Protected export validation failed: ${code}`);
    this.code = code;
  }
}

export class TransientReadError extends Error {
  constructor() { super('Transient protected read failure'); }
}

const fail = (code) => { throw new ExportValidationError(code); };
const identifier = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;

/** Canonical JSON; rejects values that JSON would silently lose or reinterpret. */
export function canonicalJson(value) {
  const visiting = new Set();
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) fail('invalid_number');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || visiting.has(item)) fail('invalid_json');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) fail('invalid_json');
    visiting.add(item);
    if (Object.values(Object.getOwnPropertyDescriptors(item)).some((descriptor) =>
      !Object.hasOwn(descriptor, 'value'))) fail('invalid_json');
    let result;
    if (Array.isArray(item)) {
      const keys = Object.keys(item);
      if (keys.length !== item.length || keys.some((key, index) => key !== String(index))) fail('invalid_json');
      result = `[${item.map(encode).join(',')}]`;
    } else {
      if (Object.getOwnPropertySymbols(item).length) fail('invalid_json');
      result = `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
    }
    visiting.delete(item);
    return result;
  }
  try { return encode(value); }
  catch (error) {
    if (error instanceof ExportValidationError) throw error;
    fail('invalid_json');
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Adapter must translate verified provider pagination into this internal shape.
 * Count and snapshot identity must come from independent, consistent source evidence.
 * This validates that evidence; it cannot prove a provider's evidence is truthful.
 */
export async function collectVerifiedPages(readPage, {
  snapshotId, expectedCount, maxPages = 10000, maxItems = 100000, maxBytes = 64 * 1024 * 1024,
  attempts = 3,
}) {
  if (!identifier(snapshotId) || !Number.isSafeInteger(expectedCount) || expectedCount < 0 ||
      ![maxPages, maxItems, maxBytes, attempts].every((n) => Number.isSafeInteger(n) && n > 0) ||
      attempts > 5 || expectedCount > maxItems) fail('invalid_limits');
  const ids = new Set();
  const cursors = new Set();
  const items = [];
  let cursor = null;
  let bytes = 0;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    let page;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { page = await readPage(cursor); break; }
      catch (error) {
        if (!(error instanceof TransientReadError) || attempt === attempts - 1) fail('read_failed');
      }
    }
    if (!page || page.snapshotId !== snapshotId || page.totalCount !== expectedCount ||
        !Array.isArray(page.items) || (page.nextCursor !== null && !identifier(page.nextCursor))) fail('invalid_page');
    if (page.items.length > maxItems - items.length) fail('item_limit');
    if (!page.items.length && page.nextCursor !== null) fail('empty_continuation');
    for (const item of page.items) {
      const encoded = canonicalJson(item);
      const normalized = JSON.parse(encoded);
      if (!normalized || !identifier(normalized.id) || ids.has(normalized.id)) fail('duplicate_or_invalid_id');
      bytes += Buffer.byteLength(encoded);
      if (bytes > maxBytes) fail('byte_limit');
      ids.add(normalized.id);
      items.push(normalized);
    }
    if (page.nextCursor === null) {
      if (items.length !== expectedCount) fail('count_mismatch');
      items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return { snapshotId, count: items.length, items, checksum: sha256(canonicalJson(items)) };
    }
    if (cursors.has(page.nextCursor)) fail('cursor_cycle');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  fail('page_limit');
}

/** Missing originals require explicit retention evidence, never reconstruction. */
export function verifyObjectCoverage(expected, retained) {
  const keys = new Set();
  const objects = new Map();
  for (const object of retained) {
    if (!identifier(object.key) || objects.has(object.key) ||
        !Number.isSafeInteger(object.size) || object.size < 0 ||
        !/^[a-f0-9]{64}$/.test(object.sha256)) fail('invalid_object');
    objects.set(object.key, object);
  }
  const result = [];
  for (const entry of expected) {
    if (!identifier(entry.key) || keys.has(entry.key)) fail('duplicate_or_invalid_object_key');
    keys.add(entry.key);
    const object = objects.get(entry.key);
    if (entry.state === 'retained') {
      if (!object || object.size !== entry.size || object.sha256 !== entry.sha256) fail('object_mismatch');
      result.push({ ...object, state: 'retained' });
    } else if (entry.state === 'expired' && identifier(entry.retentionEvidence) && !object) {
      result.push({ key: entry.key, state: 'expired', retentionEvidence: entry.retentionEvidence });
    } else fail('unproven_missing_object');
  }
  if (keys.size !== objects.size + result.filter((item) => item.state === 'expired').length) fail('unlisted_object');
  return result.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
