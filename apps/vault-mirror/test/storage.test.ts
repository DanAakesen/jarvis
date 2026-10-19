import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { BlobClient } from '@azure/storage-blob';
import type { VaultMirrorStatus } from '@jarvis/contracts';
import { readMirrorStatusBlob } from '../src/runner/storage.js';

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
