import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { VaultMirrorStatus } from '@jarvis/contracts';
import { createVaultMirrorStatusReader } from './vault-mirror-status.js';

const at = Date.parse('2026-11-19T01:00:00.000Z');
const status: VaultMirrorStatus = {
  runId: 'synthetic-run',
  startedAt: '2026-11-19T00:49:00.000Z',
  finishedAt: '2026-11-19T00:50:00.000Z',
  outcome: 'ok-noop',
  writeBack: 'on',
  approved: 10,
  pushed: 0,
  writtenBack: 0,
  deleted: 0,
  conflicts: 0,
  skipped: 0,
  credentialMatches: 0,
  pendingWriteBack: 0,
  consecutiveFailures: 0,
  lastSuccessAt: '2026-11-19T00:50:00.000Z',
  conflictPaths: [],
};

function blobWith(value: VaultMirrorStatus | string) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return {
    download: vi.fn(async () => ({
      contentLength: Buffer.byteLength(body),
      readableStreamBody: Readable.from([body]),
    })),
  };
}

describe('vault mirror status reader', () => {
  it('distinguishes an unconfigured reader from a missing status blob', async () => {
    expect(await createVaultMirrorStatusReader(undefined, () => at).read()).toEqual({
      state: 'not-set-up',
      lastSuccessAt: null,
      readReason: 'backend-not-configured',
    });
    const missing = {
      download: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'BlobNotFound' });
      }),
    };
    expect(await createVaultMirrorStatusReader(missing, () => at).read()).toEqual({
      state: 'not-set-up',
      lastSuccessAt: null,
      readReason: 'status-missing',
    });
  });

  it('returns bounded read failure reasons without exposing provider text', async () => {
    const denied = {
      download: vi.fn(async () => {
        throw Object.assign(new Error('private provider detail'), { code: 'AuthorizationPermissionMismatch' });
      }),
    };
    expect(await createVaultMirrorStatusReader(denied, () => at).read()).toEqual({
      state: 'read-error',
      lastSuccessAt: null,
      readReason: 'access-denied',
    });
    expect(await createVaultMirrorStatusReader(blobWith('{invalid'), () => at).read()).toEqual({
      state: 'read-error',
      lastSuccessAt: null,
      readReason: 'invalid',
    });
  });

  it('exposes the last completed run and sanitizes conflict paths by reader purpose', async () => {
    const document: VaultMirrorStatus = {
      ...status,
      outcome: 'needs-attention',
      reason: 'conflict',
      guardReasons: ['max-changed-G'],
      changedOnGitHub: 26,
      changedOnObsidian: 11,
      conflictPaths: ['private/path.md'],
    };
    const reader = createVaultMirrorStatusReader(blobWith(document), () => at);
    expect(await reader.read()).toEqual({
      state: 'needs-attention',
      lastSuccessAt: status.lastSuccessAt,
      lastRunAt: status.finishedAt,
      outcome: 'needs-attention',
      guardReasons: ['max-changed-G'],
      changedOnGitHub: 26,
      changedOnObsidian: 11,
      writeBack: 'on',
      reason: 'conflict',
      counts: {
        approved: 10, pushed: 0, writtenBack: 0, deleted: 0, conflicts: 0, skipped: 0,
        credentialMatches: 0, pendingWriteBack: 0, consecutiveFailures: 0,
      },
    });
    expect((await reader.readForStatus()).conflictPaths).toEqual(['private/path.md']);
  });

  it('marks old or future success timestamps stale', async () => {
    for (const lastSuccessAt of ['2026-11-18T23:00:00.000Z', '2026-11-19T02:00:00.000Z']) {
      const reader = createVaultMirrorStatusReader(blobWith({ ...status, lastSuccessAt }), () => at);
      expect((await reader.read()).state).toBe('stale');
    }
  });
});
