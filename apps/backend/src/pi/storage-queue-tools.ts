import type { QueueServiceClient } from '@azure/storage-queue';
import { ToolFailure, ToolRefusal, type JarvisTool } from '../core/tool-registry.js';

type StorageQueueService = Pick<QueueServiceClient, 'listQueues' | 'getQueueClient'>;

const queueName = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/u;
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const queueArg = { type: 'string', minLength: 3, maxLength: 63, pattern: '^[a-z0-9-]{3,63}$' };

function asQueueName(value: unknown): string {
  if (typeof value !== 'string' || !queueName.test(value)) throw new ToolRefusal('Use a valid Azure Storage queue name (3–63 lowercase letters, numbers, or single hyphens).');
  return value;
}
function safeFailure(signal: AbortSignal, outcomeUnknown = false): ToolFailure {
  if (signal.aborted) throw signal.reason;
  return new ToolFailure('The Jarvis Storage Queue operation failed. No successful change is confirmed.', outcomeUnknown ? { outcomeUnknown: true } : undefined);
}

/** Jarvis-owned Storage Queue tools. Reads use peekMessages, which never leases or consumes messages. */
export function createStorageQueueTools(client: StorageQueueService): JarvisTool[] {
  const list: JarvisTool = {
    name: 'azure_storage_queue_names', sensitive: true,
    description: 'Use this when Dan asks for a bounded page of queue names in the existing Jarvis Storage account; continue with the returned token.',
    inputSchema: schema({ prefix: { type: 'string', maxLength: 63 }, continuationToken: { type: 'string', maxLength: 4096 } }, []),
    execute: async (input, _request, signal) => {
      const args = input as { prefix?: string; continuationToken?: string };
      try {
        const pages = client.listQueues({ ...(args.prefix ? { prefix: args.prefix } : {}), abortSignal: signal })
          .byPage({ maxPageSize: 100, ...(args.continuationToken ? { continuationToken: args.continuationToken } : {}) });
        const page = (await pages[Symbol.asyncIterator]().next()).value;
        return { queues: (page?.queueItems ?? []).map((item) => item.name), continuationToken: page?.continuationToken ?? null };
      } catch { throw safeFailure(signal); }
    },
  };
  const properties: JarvisTool = {
    name: 'azure_storage_queue_properties', sensitive: true,
    description: 'Use this when you need the properties and approximate message count for a named Jarvis Storage queue.',
    inputSchema: schema({ queue: queueArg }, ['queue']),
    execute: async (input, _request, signal) => {
      const name = asQueueName((input as { queue: string }).queue);
      try { return await client.getQueueClient(name).getProperties({ abortSignal: signal }); }
      catch { throw safeFailure(signal); }
    },
  };
  const create: JarvisTool = {
    name: 'azure_storage_queue_create',
    description: 'Use this when Dan asks to create a queue in the existing Jarvis Storage account.',
    inputSchema: schema({ queue: queueArg }, ['queue']),
    execute: async (input, _request, signal) => {
      const name = asQueueName((input as { queue: string }).queue);
      try {
        const result = await client.getQueueClient(name).createIfNotExists({ abortSignal: signal });
        return { created: result.succeeded };
      } catch { throw safeFailure(signal); }
    },
  };
  const send: JarvisTool = {
    name: 'azure_storage_queue_send', sensitive: true,
    description: 'Use this when Dan asks to send a text message to a named Jarvis Storage queue. Message body is limited to 48 KB UTF-8.',
    inputSchema: schema({ queue: queueArg, message: { type: 'string', minLength: 1, maxLength: 49152 } }, ['queue', 'message']),
    execute: async (input, _request, signal) => {
      const args = input as { queue: string; message: string };
      if (Buffer.byteLength(args.message, 'utf8') > 48 * 1024) throw new ToolRefusal('Queue messages must be no larger than 48 KB in UTF-8.');
      const name = asQueueName(args.queue);
      try {
        const result = await client.getQueueClient(name).sendMessage(args.message, { abortSignal: signal });
        return { queued: true, messageId: result.messageId };
      } catch { throw safeFailure(signal, true); }
    },
  };
  const peek: JarvisTool = {
    name: 'azure_storage_queue_peek', sensitive: true,
    description: 'Use this when asked to peek at up to 10 messages without receiving, leasing, deleting, or changing visibility.',
    inputSchema: schema({ queue: queueArg, count: { type: 'integer', minimum: 1, maximum: 10 } }, ['queue']),
    execute: async (input, _request, signal) => {
      const args = input as { queue: string; count?: number };
      const name = asQueueName(args.queue);
      try {
        const result = await client.getQueueClient(name).peekMessages({ numberOfMessages: args.count ?? 5, abortSignal: signal });
        return { messages: result.peekedMessageItems.map(({ messageId, messageText, insertedOn }) => ({ messageId, messageText, insertedOn })) };
      } catch { throw safeFailure(signal); }
    },
  };
  const receive: JarvisTool = {
    name: 'azure_storage_queue_receive', sensitive: true,
    description: 'Receive up to 10 messages from a Jarvis Storage queue and temporarily hide them until their visibility timeout expires. This changes queue state; use peek to inspect without consuming or leasing.',
    inputSchema: schema({ queue: queueArg, count: { type: 'integer', minimum: 1, maximum: 10 }, visibilityTimeoutSeconds: { type: 'integer', minimum: 1, maximum: 60 } }, ['queue']),
    execute: async (input, _request, signal) => {
      const args = input as { queue: string; count?: number; visibilityTimeoutSeconds?: number };
      const name = asQueueName(args.queue);
      try {
        const result = await client.getQueueClient(name).receiveMessages({ numberOfMessages: args.count ?? 1, visibilityTimeout: args.visibilityTimeoutSeconds ?? 30, abortSignal: signal });
        return { messages: result.receivedMessageItems.map(({ messageId, popReceipt, messageText, insertedOn, nextVisibleOn, dequeueCount }) => ({
          messageId, popReceipt, messageText, insertedOn, nextVisibleOn, dequeueCount,
        })) };
      } catch { throw safeFailure(signal, true); }
    },
  };
  const deleteMessage: JarvisTool = {
    name: 'azure_storage_queue_delete_message', sensitive: true,
    description: 'Use this only after receiving a Jarvis queue message. Deleting it requires Dan’s explicit browser confirmation.',
    inputSchema: schema({ queue: queueArg, messageId: { type: 'string', minLength: 1, maxLength: 256 }, popReceipt: { type: 'string', minLength: 1, maxLength: 8192 } }, ['queue', 'messageId', 'popReceipt']),
    execute: async (input, request, signal) => {
      const args = input as { queue: string; messageId: string; popReceipt: string };
      const name = asQueueName(args.queue);
      if (!request.server.ownerInteractions) throw new ToolRefusal('Owner confirmation for deleting a queue message is unavailable.');
      await request.server.ownerInteractions.requestConfirmation('delete', `Delete message ${args.messageId} from the Jarvis Storage queue ${name}?`, signal);
      try { await client.getQueueClient(name).deleteMessage(args.messageId, args.popReceipt, { abortSignal: signal }); return { deleted: true }; }
      catch { throw safeFailure(signal, true); }
    },
  };
  const remove: JarvisTool = {
    name: 'azure_storage_queue_delete',
    description: 'Use this when Dan asks to delete a Jarvis Storage queue and every message it contains. He must confirm in the browser.',
    inputSchema: schema({ queue: queueArg }, ['queue']),
    execute: async (input, request, signal) => {
      const name = asQueueName((input as { queue: string }).queue);
      if (!request.server.ownerInteractions) throw new ToolRefusal('Owner confirmation for deleting a queue is unavailable.');
      const selected = client.getQueueClient(name);
      try { await selected.getProperties({ abortSignal: signal }); }
      catch { throw safeFailure(signal); }
      await request.server.ownerInteractions.requestConfirmation('delete', `Delete the Jarvis Storage queue ${name} and every message it contains?`, signal);
      try { await selected.delete({ abortSignal: signal }); return { deleted: true }; }
      catch { throw safeFailure(signal, true); }
    },
  };
  return [list, properties, create, send, peek, receive, deleteMessage, remove];
}
