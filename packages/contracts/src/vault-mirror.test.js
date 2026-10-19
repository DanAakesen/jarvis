import assert from 'node:assert/strict';
import test from 'node:test';
import { vaultMirrorStatusSchema, vaultMirrorStatusViewSchema } from './index.js';

const status = {
  runId: 'synthetic-run-001',
  startedAt: '2026-10-19T10:00:00.000Z',
  finishedAt: '2026-10-19T10:01:00.000Z',
  outcome: 'ok',
  writeBack: 'dry-run',
  approved: 3,
  pushed: 2,
  writtenBack: 0,
  deleted: 0,
  conflicts: 0,
  skipped: 1,
  credentialMatches: 0,
  pendingWriteBack: 1,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  conflictPaths: [],
};

test('vault mirror view is a bounded runtime contract independent of the runner document', () => {
  for (const state of ['not-set-up', 'healthy', 'stale', 'needs-attention', 'failed', 'read-error']) {
    assert.deepEqual(vaultMirrorStatusViewSchema.parse({ state, lastSuccessAt: null }), { state, lastSuccessAt: null });
  }
  const view = {
    state: 'needs-attention', lastSuccessAt: status.finishedAt, writeBack: 'dry-run',
    reason: 'conflict', conflictPaths: ['private/note.md'],
    counts: {
      approved: 0, pushed: 0, writtenBack: 0, deleted: 0, conflicts: 1, skipped: 0,
      credentialMatches: 0, pendingWriteBack: 0, consecutiveFailures: 0,
    },
  };
  assert.deepEqual(vaultMirrorStatusViewSchema.parse(view), view);
  for (const patch of [
    { state: 'ok' }, { runId: status.runId }, { startedAt: status.startedAt },
    { finishedAt: status.finishedAt }, { reason: 'private error' },
    { conflictPaths: Array(11).fill('private') }, { conflictPaths: ['x'.repeat(1025)] },
    { counts: { ...view.counts, pushed: -1 } }, { counts: { ...view.counts, extra: 0 } },
  ]) assert.equal(vaultMirrorStatusViewSchema.safeParse({ ...view, ...patch }).success, false);
});

test('vault mirror status accepts synthetic completed runs and every documented enum', () => {
  assert.deepEqual(vaultMirrorStatusSchema.parse(status), status);
  for (const outcome of ['ok', 'ok-noop', 'skipped-busy', 'needs-attention', 'failed']) {
    assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, outcome }).success, true);
  }
  for (const reason of [
    'auth', 'policy-missing', 'repo-not-private', 'pull-failed', 'guard-tripped',
    'conflict', 'secret-match', 'push-rejected', 'upload-failed', 'state-corrupt',
    'timeout', 'unexpected',
  ]) {
    const document = {
      ...status, outcome: 'needs-attention', reason, writeBack: 'on', conflicts: 1,
      conflictPaths: ['Projects/synthetic-note.md'],
      lastSuccessAt: '2026-10-18T11:00:00+02:00',
    };
    assert.deepEqual(vaultMirrorStatusSchema.parse(document), document);
  }
});

test('vault mirror status rejects unknown keys, enums and missing required fields', () => {
  for (const patch of [
    { reason: 'new-reason' }, { reason: null }, { outcome: 'success' },
    { writeBack: 'off' }, { unexpected: true },
  ]) assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, ...patch }).success, false);
  for (const field of Object.keys(status)) {
    const document = { ...status };
    delete document[field];
    assert.equal(vaultMirrorStatusSchema.safeParse(document).success, false, field);
  }
});

test('vault mirror status requires nonnegative integer counts without coercion', () => {
  for (const field of [
    'approved', 'pushed', 'writtenBack', 'deleted', 'conflicts', 'skipped',
    'credentialMatches', 'pendingWriteBack', 'consecutiveFailures',
  ]) {
    assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, [field]: 0 }).success, true, field);
    for (const value of [-1, 0.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, [field]: value }).success, false, field);
    }
  }
});

test('vault mirror status bounds run IDs, conflict paths and ISO timestamps', () => {
  assert.equal(vaultMirrorStatusSchema.safeParse({
    ...status, runId: 'r'.repeat(128), conflictPaths: Array(10).fill('p'.repeat(1024)),
  }).success, true);
  for (const patch of [
    { runId: '' }, { runId: 'r'.repeat(129) }, { runId: 1 },
    { conflictPaths: Array(11).fill('synthetic.md') },
    { conflictPaths: ['p'.repeat(1025)] }, { conflictPaths: [''] }, { conflictPaths: [1] },
  ]) assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, ...patch }).success, false);
  for (const field of ['startedAt', 'finishedAt', 'lastSuccessAt']) {
    const longest = `2026-10-19T10:00:00.${'1'.repeat(43)}Z`;
    assert.equal(longest.length, 64);
    assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, [field]: longest }).success, true, field);
    for (const value of [
      '', 'not-a-date', '2026-02-30T10:00:00Z', '2026-10-19T10:00:00',
      '2026-10-19T25:00:00Z', `${longest.slice(0, -1)}1Z`,
    ]) {
      assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, [field]: value }).success, false, field);
    }
  }
  for (const field of ['startedAt', 'finishedAt']) {
    assert.equal(vaultMirrorStatusSchema.safeParse({ ...status, [field]: null }).success, false, field);
  }
});
