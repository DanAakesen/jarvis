import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { TokenCredential } from '@azure/core-auth';
import type { BlobClient, ContainerClient } from '@azure/storage-blob';
import type { VaultMirrorStatus } from '@jarvis/contracts';
import { AzureMirrorStorage, readMirrorStatusBlob, StateCorruptError } from '../src/runner/storage.js';
import { checksum } from '../src/runner/state.js';

const status: VaultMirrorStatus = {
  runId: 'synthetic-run',
  startedAt: '2026-10-19T12:00:00.000Z',
  finishedAt: '2026-10-19T12:00:01.000Z',
  outcome: 'ok',
  writeBack: 'dry-run',
  approved: 2,
  pushed: 1,
  writtenBack: 0,
  deleted: 0,
  conflicts: 0,
  skipped: 0,
  credentialMatches: 0,
  pendingWriteBack: 0,
  consecutiveFailures: 0,
  lastSuccessAt: '2026-10-19T12:00:01.000Z',
  conflictPaths: [],
};

function blob(download: (...args: unknown[]) => Promise<unknown>): Pick<BlobClient, 'download'> {
  return { download } as unknown as Pick<BlobClient, 'download'>;
}

describe('readMirrorStatusBlob', () => {
  it('reads and validates a realistic status body below the size cap', async () => {
    const content = JSON.stringify(status);
    const download = vi.fn(async () => ({
      contentLength: Buffer.byteLength(content),
      readableStreamBody: Readable.from([content]),
    }));

    await expect(readMirrorStatusBlob(blob(download))).resolves.toEqual(status);
    expect(download).toHaveBeenCalledWith(0, undefined, expect.objectContaining({
      abortSignal: expect.any(AbortSignal),
      maxRetryRequests: 0,
    }));
  });

  describe('AzureMirrorStorage state lease', () => {
    function storageWithStateBlob(bytes: Uint8Array, expectedChecksum = checksum(bytes)) {
      const lease = {
        leaseId: 'synthetic-lease',
        acquireLease: vi.fn(async () => {}),
        renewLease: vi.fn(async () => {}),
        releaseLease: vi.fn(async () => {}),
      };
      const blob = {
        uploadData: vi.fn(async () => {}),
        getBlobLeaseClient: () => lease,
        getProperties: vi.fn(async () => ({
          etag: 'synthetic-etag',
          contentLength: bytes.byteLength,
          metadata: bytes.byteLength === 0 ? {} : { sha256: expectedChecksum },
        })),
        downloadToBuffer: vi.fn(async () => Buffer.from(bytes)),
      };
      const container = { getBlockBlobClient: () => blob } as unknown as ContainerClient;
      const storage = new AzureMirrorStorage(
        'https://example.blob.core.windows.net',
        {} as TokenCredential,
      );
      Object.defineProperty(storage, 'state', { value: container });
      return { storage, blob, lease };
    }

    it('acquires the state lease and verifies the stored checksum', async () => {
      const bytes = Buffer.from('synthetic archive');
      const { storage, blob, lease } = storageWithStateBlob(bytes);

      const result = await storage.acquireLease(new AbortController().signal);

      expect(result.busy).toBe(false);
      if (result.busy) return;
      expect(result.lease.archive).toEqual(bytes);
      expect(result.lease.checksum).toBe(checksum(bytes));
      expect(lease.acquireLease).toHaveBeenCalledWith(60, expect.any(Object));
      expect(blob.downloadToBuffer).toHaveBeenCalledWith(0, bytes.byteLength, expect.any(Object));
    });

    it.each(['checksum', 'size'] as const)('rejects a corrupt state archive (%s)', async problem => {
      const bytes = Buffer.from('synthetic archive');
      const { storage, lease } = storageWithStateBlob(
        bytes,
        problem === 'checksum' ? '0'.repeat(64) : checksum(bytes),
      );
      if (problem === 'size') {
        const state = storage as unknown as { state: ContainerClient };
        Object.defineProperty(state, 'state', {
          value: {
            getBlockBlobClient: () => ({
              uploadData: vi.fn(async () => {}),
              getBlobLeaseClient: () => lease,
              getProperties: vi.fn(async () => ({
                etag: 'synthetic-etag',
                contentLength: 64 * 1024 * 1024 + 1,
                metadata: {},
              })),
            }),
          },
        });
      }

      await expect(storage.acquireLease(new AbortController().signal)).rejects.toBeInstanceOf(StateCorruptError);
      expect(lease.releaseLease).toHaveBeenCalledOnce();
    });
  });

  it('rejects an advertised oversized body without consuming it', async () => {
    let consumed = false;
    const body = new Readable({ read() { consumed = true; } });
    const download = vi.fn(async () => ({
      contentLength: 32 * 1024 + 1,
      readableStreamBody: body,
    }));

    await expect(readMirrorStatusBlob(blob(download))).resolves.toBeNull();
    expect(consumed).toBe(false);
    expect(body.destroyed).toBe(true);
  });

  it.each([
    ['invalid JSON', '{'],
    ['schema mismatch', JSON.stringify({ ...status, outcome: 'private error' })],
  ])('returns null for %s', async (_description, content) => {
    await expect(readMirrorStatusBlob(blob(async () => ({
      contentLength: Buffer.byteLength(content),
      readableStreamBody: Readable.from([content]),
    })))).resolves.toBeNull();
  });

  it('returns null for a missing blob', async () => {
    await expect(readMirrorStatusBlob(blob(async () => {
      throw Object.assign(new Error('missing'), { statusCode: 404 });
    }))).resolves.toBeNull();
  });

  it('returns null when the response stream fails', async () => {
    const body = Readable.from((async function* () {
      yield Buffer.from('{');
      throw new Error('stream-failed');
    })());

    await expect(readMirrorStatusBlob(blob(async () => ({ readableStreamBody: body }))))
      .resolves.toBeNull();
  });

  it('returns null when the five-second deadline expires while downloading', async () => {
    vi.useFakeTimers();
    try {
      const download = vi.fn(() => new Promise<never>(() => {}));
      const result = readMirrorStatusBlob(blob(download));
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(result).resolves.toBeNull();
      expect(download).toHaveBeenCalledWith(0, undefined, expect.objectContaining({
        abortSignal: expect.objectContaining({ aborted: true }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
