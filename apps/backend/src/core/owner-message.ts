import type { FastifyRequest } from 'fastify';
import type { ConversationMessage, ConversationStore } from './conversation-store.js';

const maxSqlMessageId = 9_223_372_036_854_775_807n;
export const messageIdPattern = /^[1-9]\d{0,18}$/u;

/** The id of the owner message attached to this request (voice item, PI turn header or memory source), if it is a valid id. */
export function attachedOwnerMessageId(request: FastifyRequest): string | undefined {
  const direct = request.jarvisConversationMessage;
  if (direct?.role === 'dan' && messageIdPattern.test(direct.id) &&
      BigInt(direct.id) <= maxSqlMessageId) return direct.id;
  const id = request.jarvisMemorySourceMessageId ?? request.headers['x-jarvis-message-id'];
  return typeof id === 'string' && messageIdPattern.test(id) && BigInt(id) <= maxSqlMessageId ? id : undefined;
}

export async function readOwnerMessageById(
  store: ConversationStore,
  id: string,
  signal: AbortSignal,
): Promise<ConversationMessage | undefined> {
  if (!messageIdPattern.test(id) || BigInt(id) > maxSqlMessageId) return undefined;
  const numeric = BigInt(id);
  const before = numeric < maxSqlMessageId ? String(numeric + 1n) : undefined;
  const page = await store.getHistory({ limit: 20, ...(before ? { before } : {}) });
  signal.throwIfAborted();
  return page.messages.find(message => message.id === id && message.role === 'dan');
}

/**
 * Resolve the exact owner message already attached to this request. A newer assistant or proactive message is not a
 * replacement for it, and does not invalidate it.
 */
export async function readAttachedOwnerMessage(
  request: FastifyRequest,
  signal: AbortSignal,
): Promise<ConversationMessage | undefined> {
  const direct = request.jarvisConversationMessage;
  const id = attachedOwnerMessageId(request);
  if (!id) return undefined;
  if (direct?.role === 'dan' && direct.id === id) {
    signal.throwIfAborted();
    if (!request.agentPrincipal && !request.principal) return undefined;
    return direct;
  }
  if (!request.agentPrincipal && !request.principal) return undefined;
  const store: ConversationStore | undefined = request.server.conversationStore ?? undefined;
  if (!store) return undefined;
  return readOwnerMessageById(store, id, signal);
}
