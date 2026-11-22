import type {
  ConversationChannel, ConversationHistoryMessage, ConversationLanguage, ConversationMessage, ConversationRole,
  ConversationSession, ConversationStore,
} from '../core/conversation-store.js';
import type { ToolCallRecord } from '../core/tool-calls.js';

/** One stored message with the facts the parity report compares; `replyNotification` is the chat-only durable push. */
export interface StoredMessage extends ConversationMessage {
  readonly channel: ConversationChannel;
  readonly language: ConversationLanguage;
  readonly interrupted: boolean;
  readonly sourceItemId: string | null;
  readonly replyNotification: boolean;
}

export interface MemoryConversationStore extends ConversationStore {
  readonly sessions: ConversationSession[];
  /** Every message of every session, oldest first, by numeric id. */
  readonly messages: StoredMessage[];
  /** Tool calls recorded by the tool route, by owner message id. */
  readonly toolCalls: ToolCallRecord[];
  readonly endedUsage: Array<{ sessionId: string; providerVoiceSeconds?: number | undefined; allowWallClockFallback?: boolean | undefined }>;
}

const baseTime = Date.parse('2026-11-21T22:00:00Z');

/**
 * A conversation store with the same observable rules as the SQL one: numeric ids that only grow, messages that join a
 * live session only, `getHistory` returning the newest page below `before` oldest first, and no uniqueness on
 * `sourceItemId`, so a duplicate write by the relay or the chat route shows up here instead of being hidden.
 */
export function createMemoryConversationStore(): MemoryConversationStore {
  const sessions: ConversationSession[] = [];
  const messages: StoredMessage[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const endedUsage: MemoryConversationStore['endedUsage'] = [];
  let nextSession = 7;
  let nextMessage = 100;
  const channelOf = (sessionId: string): ConversationChannel =>
    sessions.find(session => session.id === sessionId)?.channel ?? 'chat';
  const history = (message: StoredMessage): ConversationHistoryMessage => ({
    id: message.id, sessionId: message.sessionId, role: message.role, text: message.text, model: message.model, at: message.at,
    channel: message.channel, language: message.language, interrupted: message.interrupted, voiceMinutes: null,
    toolCalls: toolCalls.filter(call => call.messageId === message.id).map((call, index) => ({
      id: String(index + 1), tool: call.tool, outcome: call.outcome, taskId: null,
    })),
    attachments: [],
  });

  const store: MemoryConversationStore = {
    sessions, messages, toolCalls, endedUsage,
    async createSession(input) {
      const session: ConversationSession = {
        id: String(nextSession), channel: input.channel, language: input.language,
        startedAt: new Date(baseTime + nextSession), endedAt: null,
      };
      nextSession += 1;
      sessions.push(session);
      return session;
    },
    async getSession(sessionId) { return sessions.find(session => session.id === sessionId) ?? null; },
    async endSession(sessionId, voiceUsage) {
      const index = sessions.findIndex(session => session.id === sessionId);
      if (index === -1) return false;
      const session = sessions[index]!;
      if (session.endedAt === null) {
        sessions[index] = { ...session, endedAt: new Date(baseTime + 60_000) };
        endedUsage.push({
          sessionId, providerVoiceSeconds: voiceUsage?.providerVoiceSeconds, allowWallClockFallback: voiceUsage?.allowWallClockFallback,
        });
      }
      return true;
    },
    async addMessage(input) {
      const session = sessions.find(candidate => candidate.id === input.sessionId);
      if (!session || (session.endedAt !== null && input.allowEndedSession !== true)) return null;
      const message: StoredMessage = {
        id: String(nextMessage), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model,
        at: new Date(baseTime + nextMessage * 1_000), channel: session.channel, language: input.language ?? session.language,
        interrupted: input.interrupted ?? false, sourceItemId: input.sourceItemId ?? null,
        replyNotification: input.replyNotification !== undefined,
        ...(input.blocks ? { blocks: input.blocks } : {}),
      };
      nextMessage += 1;
      messages.push(message);
      return message;
    },
    async updateMessage(input) {
      const index = messages.findIndex(message =>
        message.id === input.messageId && message.sessionId === input.sessionId && message.role === input.role);
      if (index === -1) return null;
      messages[index] = { ...messages[index]!, text: input.text };
      return messages[index]!;
    },
    async getDanMessageIdBySourceItemId(sourceItemId) {
      return messages.find(message => message.role === 'dan' && message.sourceItemId === sourceItemId)?.id ?? null;
    },
    async getMessageSessionId(messageId) { return messages.find(message => message.id === messageId)?.sessionId ?? null; },
    async readRecentUserMessages(limit = 5) {
      return messages.filter(message => message.role === 'dan' && channelOf(message.sessionId) === 'chat')
        .map(message => message.text).reverse().slice(0, limit);
    },
    async getHistory({ limit, before, sessionId }) {
      const eligible = messages.filter(message =>
        (before === undefined || BigInt(message.id) < BigInt(before)) && (sessionId === undefined || message.sessionId === sessionId));
      const page = eligible.slice(-limit).map(history);
      return { messages: page, nextCursor: eligible.length > limit ? page[0]?.id ?? null : null };
    },
    async getDanMessagesAfter({ sessionId, after, limit }) {
      return messages.filter(message => message.sessionId === sessionId && message.role === 'dan' && BigInt(message.id) > BigInt(after))
        .slice(0, limit).map(message => ({ id: message.id, text: message.text }));
    },
  };
  return store;
}

/** `dan#1`, `jarvis#2` ...: ids by role and order, so two runs with different numeric ids compare equal. */
export function messageRefs(store: MemoryConversationStore, ignored: ReadonlySet<string> = new Set()): Map<string, string> {
  const counts: Record<ConversationRole, number> = { dan: 0, jarvis: 0 };
  const refs = new Map<string, string>();
  for (const message of store.messages.filter(candidate => !ignored.has(candidate.id))) {
    counts[message.role] += 1;
    refs.set(message.id, `${message.role}#${counts[message.role]}`);
  }
  return refs;
}
