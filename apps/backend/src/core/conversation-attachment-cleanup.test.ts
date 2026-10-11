import { afterEach, describe, expect, it, vi } from 'vitest';
import { startConversationAttachmentCleanupJob } from './conversation-attachment-cleanup.js';

describe('conversation attachment cleanup job', () => {
  afterEach(() => vi.useRealTimers());

  it('runs cleanup immediately and reports a safe failure before stopping', async () => {
    vi.useFakeTimers();
    const cleanupExpired = vi.fn(async () => { throw new Error('private storage details'); });
    const onError = vi.fn();
    const stop = startConversationAttachmentCleanupJob({ cleanupExpired }, onError, 60_000);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(cleanupExpired).toHaveBeenCalledWith(100);
    stop();
  });
});
