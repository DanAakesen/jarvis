import type { FastifyRequest } from 'fastify';
import type { ConversationMessage } from '../../core/conversation-store.js';
import { ToolRefusal } from '../../core/tool-registry.js';

export async function currentDailyMessage(request: FastifyRequest, signal: AbortSignal): Promise<ConversationMessage> {
  const direct = request.jarvisConversationMessage;
  if (direct?.role === 'dan' && request.principal && !request.agentPrincipal) return direct;
  const id = request.headers['x-jarvis-message-id'] ?? request.jarvisMemorySourceMessageId;
  if (!request.agentPrincipal || typeof id !== 'string' || !/^[1-9]\d{0,18}$/u.test(id) ||
      BigInt(id) > 9223372036854775807n || !request.server.conversationStore) {
    throw new ToolRefusal('A verified current Dan message is required for a Daily change.');
  }
  const page = await request.server.conversationStore.getHistory({ limit: 1 });
  signal.throwIfAborted();
  const message = page.messages[0];
  if (!message || message.id !== id || message.role !== 'dan') throw new ToolRefusal('The current Daily message could not be verified.');
  return message;
}

export async function activeDailySession(request: FastifyRequest, source: ConversationMessage, signal: AbortSignal, clock: number) {
  if (!(source.at instanceof Date) || !Number.isFinite(source.at.getTime()) ||
      source.at.getTime() > clock + 300_000 || clock - source.at.getTime() > 600_000) {
    throw new ToolRefusal('The Daily request is no longer current. Nothing was changed.');
  }
  const session = await request.server.conversationStore?.getSession(source.sessionId);
  signal.throwIfAborted();
  if (!session || session.id !== source.sessionId || session.channel === 'phone' || session.endedAt !== null) {
    throw new ToolRefusal('An active verified chat or voice session is required for a Daily change.');
  }
  return session;
}

export async function requireDailyReviewPresence(request: FastifyRequest, signal: AbortSignal) {
  try {
    if (!request.server.awayModeStore || (await request.server.awayModeStore.read()).mode !== 'present') {
      throw new ToolRefusal('Daily review requires Dan to be present and approve the exact proposal in Now.');
    }
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted || error instanceof ToolRefusal) throw error;
    throw new ToolRefusal('Presence is unavailable. No Daily change was authorised.');
  }
}
