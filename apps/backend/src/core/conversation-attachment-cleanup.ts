import type { ConversationAttachmentStore } from '../database/conversation-attachment-store.js';

const cleanupIntervalMs = 60 * 60 * 1_000;

export function startConversationAttachmentCleanupJob(
  store: Pick<ConversationAttachmentStore, 'cleanupExpired'>,
  onError: () => void,
  intervalMs = cleanupIntervalMs,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await store.cleanupExpired(100);
    } catch {
      onError();
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
