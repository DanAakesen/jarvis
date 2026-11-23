import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ToolRefusal } from '../core/tool-registry.js';
import { createStorageQueueTools } from './storage-queue-tools.js';

function setup() {
  const queueClient = {
    getProperties: vi.fn(async () => ({ approximateMessagesCount: 2 })),
    createIfNotExists: vi.fn(async () => ({ succeeded: true })),
    delete: vi.fn(async () => ({})),
    deleteMessage: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({ messageId: 'queue-message-1' })),
    peekMessages: vi.fn(async () => ({ peekedMessageItems: [{ messageId: 'queue-message-1', messageText: 'body' }] })),
    receiveMessages: vi.fn(async () => ({ receivedMessageItems: [{ messageId: 'queue-message-1', popReceipt: 'receipt-1', messageText: 'body' }] })),
  };
  const service = {
    listQueues: vi.fn(() => ({ byPage: () => ({ [Symbol.asyncIterator]: async function* () {
      yield { queueItems: [{ name: 'events' }], continuationToken: 'next' };
    } }) })),
    getQueueClient: vi.fn(() => queueClient),
  };
  const ownerInteractions = { requestConfirmation: vi.fn(async () => {}) };
  const request = { server: { ownerInteractions } } as unknown as FastifyRequest;
  const tools = Object.fromEntries(createStorageQueueTools(service as never).map((tool) => [tool.name, tool]));
  return { queueClient, service, request, ownerInteractions, tools };
}

describe('Jarvis Azure Storage Queue tools', () => {
  it('lists one bounded page and peeks without receiving or consuming messages', async () => {
    const state = setup();
    await expect(state.tools.azure_storage_queue_names!.execute({ continuationToken: 'cursor' }, state.request, new AbortController().signal))
      .resolves.toMatchObject({ queues: ['events'], continuationToken: 'next' });
    await expect(state.tools.azure_storage_queue_peek!.execute({ queue: 'events', count: 3 }, state.request, new AbortController().signal))
      .resolves.toMatchObject({ messages: [{ messageId: 'queue-message-1', messageText: 'body' }] });
    expect(state.queueClient.peekMessages).toHaveBeenCalledWith(expect.objectContaining({ numberOfMessages: 3 }));
    expect(state.queueClient.receiveMessages).not.toHaveBeenCalled();
    await expect(state.tools.azure_storage_queue_receive!.execute({ queue: 'events' }, state.request, new AbortController().signal))
      .resolves.toMatchObject({ messages: [{ messageId: 'queue-message-1', popReceipt: 'receipt-1' }] });
    expect(state.queueClient.receiveMessages).toHaveBeenCalledWith(expect.objectContaining({ visibilityTimeout: 30 }));
  });

  it('does not delete a queue until its owner confirmation completes', async () => {
    const state = setup();
    state.ownerInteractions.requestConfirmation.mockRejectedValueOnce(new ToolRefusal('Dan declined.'));
    await expect(state.tools.azure_storage_queue_delete!.execute({ queue: 'events' }, state.request, new AbortController().signal))
      .rejects.toThrow('Dan declined.');
    expect(state.queueClient.delete).not.toHaveBeenCalled();
    await expect(state.tools.azure_storage_queue_delete!.execute({ queue: 'events' }, state.request, new AbortController().signal))
      .resolves.toMatchObject({ deleted: true });
    expect(state.ownerInteractions.requestConfirmation).toHaveBeenCalledWith(
      'delete', 'Delete the Jarvis Storage queue events and every message it contains?', expect.any(AbortSignal),
    );
    expect(state.queueClient.delete).toHaveBeenCalledTimes(1);
  });

  it('requires owner confirmation before deleting a specific received message', async () => {
    const state = setup();
    state.ownerInteractions.requestConfirmation.mockRejectedValueOnce(new ToolRefusal('Dan declined.'));
    const args = { queue: 'events', messageId: 'queue-message-1', popReceipt: 'receipt-1' };
    await expect(state.tools.azure_storage_queue_delete_message!.execute(args, state.request, new AbortController().signal))
      .rejects.toThrow('Dan declined.');
    expect(state.queueClient.deleteMessage).not.toHaveBeenCalled();
    await expect(state.tools.azure_storage_queue_delete_message!.execute(args, state.request, new AbortController().signal))
      .resolves.toMatchObject({ deleted: true });
    expect(state.queueClient.deleteMessage).toHaveBeenCalledWith('queue-message-1', 'receipt-1', expect.any(Object));
  });
});
