import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, collectVerifiedPages, ExportValidationError, sha256, TransientReadError, verifyObjectCoverage } from './safety.mjs';

const options = { snapshotId: 'synthetic-snapshot', expectedCount: 2 };
const page = (items, nextCursor = null) => ({ ...options, totalCount: options.expectedCount, items, nextCursor });
const rejects = (reader, code, limits = {}) => assert.rejects(
  collectVerifiedPages(reader, { ...options, ...limits }),
  (error) => error instanceof ExportValidationError && error.code === code,
);

test('complete pagination produces stable IDs/count/checksum regardless of page/key order', async () => {
  const a = await collectVerifiedPages(async (cursor) => cursor === null
    ? page([{ id: 'b', value: 2 }], 'next') : page([{ value: 1, id: 'a' }]), options);
  const b = await collectVerifiedPages(async () => page([{ id: 'a', value: 1 }, { id: 'b', value: 2 }]), options);
  assert.deepEqual(a, b);
  assert.equal(a.count, 2);
  assert.equal(a.checksum, sha256(canonicalJson(a.items)));
});

test('rejects duplicate IDs, repeated cursors and silent terminal truncation', async () => {
  await rejects(async () => page([{ id: 'a' }, { id: 'a' }]), 'duplicate_or_invalid_id');
  let i = 0;
  await rejects(async () => page([{ id: String(i++) }], 'cycle'), 'cursor_cycle');
  await rejects(async () => page([{ id: 'a' }]), 'count_mismatch');
  await rejects(async () => page([], 'next'), 'empty_continuation');
});

test('rejects changing count/snapshot, absent cursor and configured resource limits', async () => {
  await rejects(async () => ({ ...page([]), snapshotId: 'changed' }), 'invalid_page');
  await rejects(async () => ({ ...page([]), totalCount: 0 }), 'invalid_page');
  await rejects(async () => ({ ...page([]), nextCursor: undefined }), 'invalid_page');
  await rejects(async () => page([{ id: 'a' }], 'next'), 'page_limit', { maxPages: 1 });
  await rejects(async () => page([{ id: 'a' }, { id: 'b' }]), 'byte_limit', { maxBytes: 1 });
  await rejects(async () => page([]), 'invalid_limits', { maxItems: 1 });
});

test('bounded transient retries do not expose provider credentials or content', async () => {
  let attempts = 0;
  const result = await collectVerifiedPages(async () => {
    if (++attempts < 3) throw new TransientReadError();
    return page([{ id: 'a' }, { id: 'b' }]);
  }, options);
  assert.equal(result.count, 2);
  assert.equal(attempts, 3);
  await rejects(async () => { throw new Error('SYNTHETIC-CREDENTIAL private-row'); }, 'read_failed');
  attempts = 0;
  await rejects(async () => { attempts++; throw new TransientReadError(); }, 'read_failed');
  assert.equal(attempts, 3);
});

test('canonical checksums reject lossy or non-JSON input', () => {
  const circular = {}; circular.self = circular;
  for (const item of [undefined, NaN, Infinity, 1n, Number.MAX_SAFE_INTEGER + 1, new Date(), circular, Array(1)]) {
    assert.throws(() => canonicalJson(item), ExportValidationError);
  }
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('canonicalization rejects accessors and strips thrown sensitive diagnostics', () => {
  const item = { get id() { throw new Error('SYNTHETIC-CREDENTIAL'); } };
  assert.throws(() => canonicalJson(item), (error) => error.code === 'invalid_json' &&
    !error.message.includes('SYNTHETIC-CREDENTIAL'));
  const sparse = Array(1); sparse.extra = 1;
  assert.throws(() => canonicalJson(sparse), ExportValidationError);
});

test('retained-object coverage requires exact checksums and evidence for expired originals', () => {
  const object = { key: 'synthetic-object', size: 3, sha256: sha256('raw') };
  const expired = { key: 'synthetic-expired', state: 'expired', retentionEvidence: 'synthetic retention ledger' };
  assert.equal(verifyObjectCoverage([{ ...object, state: 'retained' }, expired], [object]).length, 2);
  assert.throws(() => verifyObjectCoverage([{ ...object, state: 'retained' }], []), ExportValidationError);
  assert.throws(() => verifyObjectCoverage([expired], [object]), ExportValidationError);
  assert.throws(() => verifyObjectCoverage([{ key: 'missing', state: 'expired' }], []), ExportValidationError);
  assert.throws(() => verifyObjectCoverage([{ ...object, state: 'retained' }], [{ ...object, sha256: sha256('different') }]), ExportValidationError);
});
