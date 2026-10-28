import type { ChatAttachment } from './chat-attachments';

export type SavedQueuedMessage = { id: number; text: string; language: 'da' | 'en'; attachments?: ChatAttachment[] };
export type SavedFailedTurn = SavedQueuedMessage & { messageId?: string; error: string; partialReply: string; acknowledgment: string };
export type ConversationRecovery = { queue: SavedQueuedMessage[]; failedTurns: SavedFailedTurn[] };
const lifetimeMs = 24 * 60 * 60 * 1000;
const empty = (): ConversationRecovery => ({ queue: [], failedTurns: [] });

export function conversationRecoveryKey(backend: string | null, account: string) {
  return `jarvis.chat.recovery.v1:${JSON.stringify([backend, account])}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
function queued(value: unknown): value is SavedQueuedMessage {
  return object(value) && Number.isSafeInteger(value.id) && Number(value.id) > 0 && text(value.text, 20_000) &&
    (value.language === 'da' || value.language === 'en') &&
    (value.attachments === undefined || Array.isArray(value.attachments) && value.attachments.length <= 5 && value.attachments.every(file =>
      object(file) && typeof file.id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(file.id) &&
      text(file.name, 255) && text(file.contentType, 128) && Number.isSafeInteger(file.size) && Number(file.size) > 0));
}
function failed(value: unknown): value is SavedFailedTurn {
  if (!object(value) || !queued(value)) return false;
  const entry: Record<string, unknown> = value;
  return (entry.messageId === undefined || typeof entry.messageId === 'string' && /^[1-9]\d{0,18}$/u.test(entry.messageId)) &&
    text(entry.error, 10_000) && text(entry.partialReply, 100_000) && text(entry.acknowledgment, 2_000);
}

export function readConversationRecovery(key: string, now = Date.now()): ConversationRecovery {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 2_000_000) return empty();
    const value: unknown = JSON.parse(raw);
    if (!object(value) || typeof value.savedAt !== 'number' || value.savedAt > now || now - value.savedAt >= lifetimeMs ||
        !Array.isArray(value.queue) || !value.queue.every(queued) || !Array.isArray(value.failedTurns) || !value.failedTurns.every(failed)) return empty();
    const restoreQueued = ({ id, text, language, attachments }: SavedQueuedMessage): SavedQueuedMessage =>
      ({ id, text, language, ...(attachments ? { attachments } : {}) });
    return { queue: value.queue.map(restoreQueued), failedTurns: value.failedTurns.map(entry => ({
      ...restoreQueued(entry), ...(entry.messageId ? { messageId: entry.messageId } : {}),
      error: entry.error, partialReply: entry.partialReply, acknowledgment: entry.acknowledgment,
    })) };
  } catch { return empty(); }
}

export function saveConversationRecovery(key: string, value: ConversationRecovery): boolean {
  try {
    if (!value.queue.length && !value.failedTurns.length) sessionStorage.removeItem(key);
    else {
      const serialized = JSON.stringify({ ...value, savedAt: Date.now() });
      if (serialized.length > 2_000_000) return false;
      sessionStorage.setItem(key, serialized);
    }
    return true;
  } catch { return false; }
}
