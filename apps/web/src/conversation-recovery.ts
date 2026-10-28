import type { ChatAttachment } from './chat-attachments';

export type SavedQueuedMessage = { id: number; text: string; language: 'da' | 'en'; attachments?: ChatAttachment[] };
export type SavedFailedTurn = SavedQueuedMessage & { messageId?: string; error: string; partialReply: string; acknowledgment: string };
export type ConversationRecovery = { queue: SavedQueuedMessage[]; failedTurns: SavedFailedTurn[] };
const lifetimeMs = 24 * 60 * 60 * 1000;
// Match the backend's UTF-8 streaming limit, including multibyte replies.
const partialReplyBytes = 512 * 1024;
const snapshotLimit = 2_000_000;
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
    text(entry.error, 10_000) && text(entry.partialReply, partialReplyBytes) &&
    new TextEncoder().encode(entry.partialReply).byteLength <= partialReplyBytes && text(entry.acknowledgment, 2_000);
}

function restore(value: Record<string, unknown>): ConversationRecovery {
  const restoreQueued = ({ id, text, language, attachments }: SavedQueuedMessage): SavedQueuedMessage =>
    ({ id, text, language, ...(attachments ? { attachments } : {}) });
  return {
    queue: Array.isArray(value.queue) ? value.queue.filter(queued).map(restoreQueued) : [],
    failedTurns: Array.isArray(value.failedTurns) ? value.failedTurns.filter(failed).map(entry => ({
      ...restoreQueued(entry), ...(entry.messageId ? { messageId: entry.messageId } : {}),
      error: entry.error, partialReply: entry.partialReply, acknowledgment: entry.acknowledgment,
    })) : [],
  };
}

export function readConversationRecovery(key: string, now = Date.now()): ConversationRecovery {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > snapshotLimit) return empty();
    const value: unknown = JSON.parse(raw);
    if (!object(value) || typeof value.savedAt !== 'number' || value.savedAt > now || now - value.savedAt >= lifetimeMs) return empty();
    return restore(value);
  } catch { return empty(); }
}

export function saveConversationRecovery(key: string, value: ConversationRecovery): boolean {
  try {
    const valid = restore(value);
    let complete = valid.queue.length === value.queue.length && valid.failedTurns.length === value.failedTurns.length;
    if (!valid.queue.length && !valid.failedTurns.length) sessionStorage.removeItem(key);
    else {
      const savedAt = Date.now();
      let serialized = JSON.stringify({ ...valid, savedAt });
      if (serialized.length > snapshotLimit) {
        // Preserve uncertainty warnings and unsent messages before optional partial reply context.
        serialized = JSON.stringify({ ...valid, failedTurns: valid.failedTurns.map(turn => ({ ...turn, partialReply: '' })), savedAt });
        complete = false;
      }
      if (serialized.length > snapshotLimit) serialized = JSON.stringify({ queue: valid.queue, failedTurns: [], savedAt });
      if (serialized.length > snapshotLimit) return false;
      sessionStorage.setItem(key, serialized);
    }
    return complete;
  } catch { return false; }
}
