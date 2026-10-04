import { describe, expect, it, vi } from 'vitest';
import type { ContainerClient } from '@azure/storage-blob';
import { createChecksLoopBlobStore } from './checks-loop-blob.js';

function setup() {
  const uploadData = vi.fn(async () => ({}));
  const getBlockBlobClient = vi.fn(() => ({ uploadData }));
  const store = createChecksLoopBlobStore({ getBlockBlobClient } as unknown as ContainerClient);
  return { getBlockBlobClient, store, uploadData };
}

describe('checks loop Blob store', () => {
  it('uploads a bounded task log to the private logs container as plain text', async () => {
    const { getBlockBlobClient, store, uploadData } = setup();
    const body = Buffer.from('test failed');

    await store.upload('check-logs/42/71.log', body);

    expect(getBlockBlobClient).toHaveBeenCalledWith('check-logs/42/71.log');
    expect(uploadData).toHaveBeenCalledWith(body, expect.objectContaining({
      abortSignal: expect.any(AbortSignal),
      blobHTTPHeaders: { blobContentType: 'text/plain; charset=utf-8' },
    }));
  });

  it.each([
    ['../42/71.log', Buffer.from('log')],
    ['check-logs/42/71.log', Buffer.alloc(0)],
    ['check-logs/42/71.log', Buffer.alloc(8 * 1024 * 1024 + 1)],
  ])('rejects invalid or oversized log input %s', async (name, body) => {
    const { store, uploadData } = setup();

    await expect(store.upload(name, body)).rejects.toThrow('Check log blob is invalid');

    expect(uploadData).not.toHaveBeenCalled();
  });

  it('passes caller cancellation to the Blob upload', async () => {
    const { store, uploadData } = setup();
    const controller = new AbortController();
    controller.abort();

    await store.upload('check-logs/42/71.log', Buffer.from('log'), controller.signal);

    expect(uploadData).toHaveBeenCalledOnce();
    expect(uploadData.mock.calls[0]?.[1]?.abortSignal.aborted).toBe(true);
  });
});
