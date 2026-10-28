import { describe, expect, it, vi } from 'vitest';
import { conversationRecoveryKey, readConversationRecovery, saveConversationRecovery } from './conversation-recovery';

describe('tab conversation recovery', () => {
  it('isolates backend/account scopes and retains text, language, files and failure uncertainty', () => {
    const key = conversationRecoveryKey('https://api.example.com', 'owner-a');
    const queue = [{ id: 2, text: 'Synthetic queued request', language: 'da' as const,
      attachments: [{ id: '12345678-1234-4234-8234-123456789abc', name: 'synthetic.png', contentType: 'image/png', size: 100 }] }];
    const failedTurns = [{ id: 1, text: 'Synthetic failed request', language: 'en' as const, messageId: '42',
      error: 'An action may have completed; check status before retrying.', partialReply: 'Partial', acknowledgment: 'I will check.' }];
    expect(saveConversationRecovery(key, { queue, failedTurns })).toBe(true);
    expect(readConversationRecovery(key)).toEqual({ queue, failedTurns });
    expect(readConversationRecovery(conversationRecoveryKey('https://api.example.com', 'owner-b')).queue).toEqual([]);
    expect(readConversationRecovery(conversationRecoveryKey('https://other.example.com', 'owner-a')).queue).toEqual([]);
  });
  it('rejects corrupt, expired and invalid stored data and removes an emptied queue', () => {
    const key = 'synthetic-recovery';
    sessionStorage.setItem(key, '{invalid');
    expect(readConversationRecovery(key)).toEqual({ queue: [], failedTurns: [] });
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - 86_400_001, queue: [], failedTurns: [] }));
    expect(readConversationRecovery(key).queue).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), queue: [{ text: 'No validated identity' }], failedTurns: [] }));
    expect(readConversationRecovery(key).queue).toEqual([]);
    saveConversationRecovery(key, { queue: [], failedTurns: [] });
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('reports storage failure instead of claiming recovery was saved', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Synthetic quota limit'); });
    expect(saveConversationRecovery('synthetic-recovery', { queue: [{ id: 1, text: 'Request', language: 'en' }], failedTurns: [] })).toBe(false);
    write.mockRestore();
  });
});
