import type { ConversationMessage, ConversationSession, ConversationStore } from '../../core/conversation-store.js';
import type { ConformanceContext } from './types.testkit.js';

/**
 * Fakes every group shares, so no two groups have to supply the same `buildApp` option. The world installs
 * `conversationStore`; a group that builds a module around a message store (memory, vault, inbox, watches) uses
 * `ownerMessageSource`. Both answer with the text of `context.ownerMessage`, which the suite sets before every call.
 */

/** The stored Dan message of the current turn (id 42 in session 7), as the real stores would return it. */
export function currentDanMessage(context: ConformanceContext): ConversationMessage {
  return { id: context.ownerMessage.id, sessionId: context.ownerMessage.sessionId, role: 'dan', text: context.ownerMessage.text, model: null, at: new Date() };
}

/** What `MemoryStore.getSourceMessage` gives memory, vault, inbox and watch tools: the stored Dan message, or null for another id. */
export function ownerMessageSource(context: ConformanceContext) {
  return {
    getSourceMessage: async (id: string) => (id === context.ownerMessage.id
      ? { id, text: context.ownerMessage.text, sessionId: context.ownerMessage.sessionId, at: new Date() } : null),
  };
}

/** An in-memory conversation store with one open chat session (7) whose latest Dan message is the current owner message. */
export function createConformanceConversations(context: ConformanceContext): ConversationStore & { readonly messages: ConversationMessage[] } {
  const started = new Date('2026-11-21T08:00:00Z');
  const sessions: ConversationSession[] = [{ id: context.ownerMessage.sessionId, channel: 'chat', language: 'en', startedAt: started, endedAt: null }];
  const messages: ConversationMessage[] = [];
  let next = 1000;
  const store = {
    messages,
    async initialize() {},
    async createSession(input: { channel: ConversationSession['channel']; language: ConversationSession['language'] }) {
      next += 1;
      const session: ConversationSession = { id: String(next), channel: input.channel, language: input.language, startedAt: new Date(), endedAt: null };
      sessions.push(session);
      return session;
    },
    async getSession(id: string) { return sessions.find((session) => session.id === id) ?? null; },
    async endSession() { return true; },
    async addMessage(input: { sessionId: string; role: ConversationMessage['role']; text: string; model: string | null }) {
      next += 1;
      const message: ConversationMessage = { id: String(next), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, at: new Date() };
      messages.push(message);
      return message;
    },
    async getDanMessageIdBySourceItemId() { return context.ownerMessage.id; },
    async getMessageSessionId(id: string) { return id === context.ownerMessage.id ? context.ownerMessage.sessionId : null; },
    async getLatestDanMessageText() { return context.ownerMessage.text; },
    async readDanMessagesSince() { return []; },
    async readRecentUserMessages() { return [context.ownerMessage.text]; },
    async getHistory(input: { limit: number; sessionId?: string; before?: string }) {
      const current = currentDanMessage(context);
      const page = [...messages, current].filter((message) => (input.sessionId === undefined || message.sessionId === input.sessionId)
        && (input.before === undefined || BigInt(message.id) < BigInt(input.before)));
      return {
        messages: page.slice(-input.limit).map((message) => ({
          ...message, channel: 'chat' as const, language: 'en' as const, interrupted: false, voiceMinutes: null, toolCalls: [], attachments: [],
        })),
        nextCursor: null,
      };
    },
    async getDanMessagesAfter() { return []; },
  };
  return store as unknown as ConversationStore & { readonly messages: ConversationMessage[] };
}
