import { Readable } from 'node:stream';
import type { BlobClient } from '@azure/storage-blob';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vaultMirrorStatusViewSchema } from '@jarvis/contracts';
import { createVaultMirrorStatusReader } from './vault-mirror-status.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const document = {
  runId: 'private-run', startedAt: '2026-10-19T11:59:00Z', finishedAt: '2026-10-19T12:00:00Z',
  outcome: 'ok', writeBack: 'dry-run', approved: 2, pushed: 1, writtenBack: 0, deleted: 0,
  conflicts: 0, skipped: 0, credentialMatches: 0, pendingWriteBack: 0, consecutiveFailures: 0,
  lastSuccessAt: '2026-10-19T12:00:00Z', conflictPaths: ['private/note.md'],
};
function fixture(value: unknown = document) {
  const download = vi.fn(async () => ({
    readableStreamBody: Readable.from([JSON.stringify(value)]),
  }));
  let now = NOW;
  const reader = createVaultMirrorStatusReader({ download } as unknown as BlobClient, () => now);
  return { download, reader, advance: (ms: number) => { now += ms; } };
}
afterEach(() => vi.useRealTimers());

describe('vault mirror status reader', () => {
  it('shares a 30 second single flight across safe and authenticated projections', async () => {
    const f = fixture();
    const results = await Promise.all([f.reader.read(), f.reader.readForStatus(), f.reader.read()]);
    expect(f.download).toHaveBeenCalledOnce();
    expect(results[0]).not.toHaveProperty('conflictPaths');
    expect(results[1]).toMatchObject({ state: 'healthy', conflictPaths: ['private/note.md'] });
    expect(results[1]).not.toHaveProperty('runId');
    expect(results[1]).not.toHaveProperty('startedAt');
    expect(results[1]).not.toHaveProperty('finishedAt');
    expect(vaultMirrorStatusViewSchema.safeParse(results[1]).success).toBe(true);
    f.advance(29_999);
    await f.reader.read();
    expect(f.download).toHaveBeenCalledOnce();
    f.advance(1);
    await f.reader.read();
    expect(f.download).toHaveBeenCalledTimes(2);
    expect(f.download).toHaveBeenCalledWith(0, undefined, expect.objectContaining({ maxRetryRequests: 0 }));
  });

  it.each(['ContainerNotFound', 'BlobNotFound', 'AuthorizationFailure'])(
    'caches missing/errors without exposing provider details: %s', async (code) => {
      const f = fixture();
      f.download.mockRejectedValue({ code, message: 'private/note.md' });
      const expected = { state: code === 'AuthorizationFailure' ? 'read-error' : 'not-set-up', lastSuccessAt: null };
      expect(await f.reader.readForStatus()).toEqual(expected);
      expect(await f.reader.read()).toEqual(expected);
      expect(f.download).toHaveBeenCalledOnce();
      f.advance(30_000);
      await f.reader.read();
      expect(f.download).toHaveBeenCalledTimes(2);
    },
  );

  it('treats absent storage as not set up', async () => {
    expect(await createVaultMirrorStatusReader().read()).toEqual({ state: 'not-set-up', lastSuccessAt: null });
  });

  it.each([
    { ...document, extra: 'private' }, { ...document, outcome: 'other' },
    { ...document, pushed: -1 }, { ...document, lastSuccessAt: 'yesterday' },
    { ...document, conflictPaths: Array(11).fill('private') },
    { ...document, reason: 'private arbitrary error' },
  ])('strictly rejects malformed document %#', async (value) => {
    expect(await fixture(value).reader.readForStatus()).toEqual({ state: 'read-error', lastSuccessAt: null });
  });

  it('rejects invalid JSON and oversized streaming bodies and destroys them', async () => {
    for (const text of ['{bad', ' '.repeat(32 * 1024 + 1)]) {
      const body = Readable.from([text.slice(0, 20), text.slice(20)]);
      const download = vi.fn(async () => ({ readableStreamBody: body }));
      const reader = createVaultMirrorStatusReader({ download } as unknown as BlobClient);
      expect(await reader.read()).toEqual({ state: 'read-error', lastSuccessAt: null });
      expect(body.destroyed).toBe(true);
    }
  });

  it('rejects advertised oversized bodies without consuming them', async () => {
    const body = new Readable({ read() {} });
    const download = vi.fn(async () => ({ contentLength: 32 * 1024 + 1, readableStreamBody: body }));
    const reader = createVaultMirrorStatusReader({ download } as unknown as BlobClient);
    expect(await reader.read()).toEqual({ state: 'read-error', lastSuccessAt: null });
    expect(body.destroyed).toBe(true);
  });

  it('accepts exactly 32KiB and counts the body against the headers deadline', async () => {
    const text = JSON.stringify(document);
    const download = vi.fn(async () => ({
      readableStreamBody: Readable.from([text.padEnd(32 * 1024, ' ')]),
    }));
    expect(await createVaultMirrorStatusReader({ download } as unknown as BlobClient, () => NOW).read())
      .toMatchObject({ state: 'healthy' });
    vi.useFakeTimers();
    const body = new Readable({ read() {} });
    const delayed = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return { readableStreamBody: body };
    });
    const work = createVaultMirrorStatusReader({ download: delayed } as unknown as BlobClient).read();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await work).toEqual({ state: 'read-error', lastSuccessAt: null });
    expect(body.destroyed).toBe(true);
  });

  it.each(['headers', 'body'])('enforces one five second deadline through %s', async (stage) => {
    vi.useFakeTimers();
    const body = new Readable({ read() {} });
    const download = vi.fn(async () => stage === 'headers'
      ? new Promise<never>(() => {})
      : { readableStreamBody: body });
    const reader = createVaultMirrorStatusReader({ download } as unknown as BlobClient);
    const work = reader.readForStatus();
    await vi.advanceTimersByTimeAsync(4_999);
    let complete = false;
    void work.then(() => { complete = true; });
    await Promise.resolve();
    expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await work).toEqual({ state: 'read-error', lastSuccessAt: null });
    expect(download).toHaveBeenCalledWith(0, undefined, expect.objectContaining({
      abortSignal: expect.objectContaining({ aborted: true }),
    }));
    if (stage === 'body') expect(body.destroyed).toBe(true);
  });

  it.each([
    ['ok', '2026-10-19T11:30:00Z', 'healthy'],
    ['ok-noop', '2026-10-19T11:29:59Z', 'stale'],
    ['skipped-busy', '2026-10-19T12:00:00Z', 'healthy'],
    ['ok', null, 'stale'],
    ['needs-attention', null, 'needs-attention'],
    ['failed', '2026-10-19T10:00:00Z', 'failed'],
  ])('projects %s with success %s as %s', async (outcome, lastSuccessAt, state) => {
    expect(await fixture({ ...document, outcome, lastSuccessAt }).reader.read()).toMatchObject({ state });
  });
});
