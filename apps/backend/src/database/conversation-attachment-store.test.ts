import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { ConversationAttachmentStore, attachmentRetentionDays } from './conversation-attachment-store.js';

function fixture(query: ReturnType<typeof vi.fn>) {
  const request = { input: vi.fn(), query };
  request.input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  const deleteIfExists = vi.fn(async () => {});
  const container = {
    getBlockBlobClient: vi.fn(() => ({ deleteIfExists, uploadData: vi.fn(async () => {}) })),
  };
  const store = new ConversationAttachmentStore({
    pool,
    container: container as never,
    storageAccount: 'jarvisstorage',
    artifacts: { privateReadUrl: vi.fn(async () => 'https://private.invalid/signed') },
    retentionDays: 30,
    now: () => new Date('2026-10-10T00:00:00Z'),
    createReadUrl: vi.fn(async () => 'https://private.invalid/signed'),
  });
  return { store, request, container, deleteIfExists };
}

describe('conversation attachment store', () => {
  it('validates retention settings with a safe default and hard bounds', () => {
    expect(attachmentRetentionDays(undefined)).toBe(30);
    expect(attachmentRetentionDays('90')).toBe(90);
    expect(() => attachmentRetentionDays('0')).toThrow('between 1 and 90');
    expect(() => attachmentRetentionDays('91')).toThrow('between 1 and 90');
  });

  it('deletes expired blobs before removing their rows', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        recordset: [{ id: '7b96c6a9-9f80-4a8b-8a73-51517fe37512', blob_name: 'attachments/7b96c6a9-9f80-4a8b-8a73-51517fe37512' }],
      })
      .mockResolvedValueOnce({ rowsAffected: [1] });
    const { store, container, deleteIfExists } = fixture(query);

    await expect(store.cleanupExpired()).resolves.toBe(1);
    expect(container.getBlockBlobClient).toHaveBeenCalledWith(
      'attachments/7b96c6a9-9f80-4a8b-8a73-51517fe37512',
    );
    expect(deleteIfExists).toHaveBeenCalledOnce();
    expect(query.mock.calls[1]?.[0]).toContain('DELETE dbo.conversation_attachments');
  });

  it('leaves the metadata row when blob deletion fails so cleanup can retry', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      recordset: [{ id: '7b96c6a9-9f80-4a8b-8a73-51517fe37512', blob_name: 'attachments/7b96c6a9-9f80-4a8b-8a73-51517fe37512' }],
    });
    const { store } = fixture(query);
    const getBlockBlobClient = vi.fn(() => ({
      deleteIfExists: vi.fn(async () => { throw new Error('storage unavailable'); }),
    }));
    (store as unknown as { options: { container: { getBlockBlobClient: typeof getBlockBlobClient } } })
      .options.container.getBlockBlobClient = getBlockBlobClient;

    await expect(store.cleanupExpired()).resolves.toBe(0);
    expect(query).toHaveBeenCalledOnce();
  });
});
