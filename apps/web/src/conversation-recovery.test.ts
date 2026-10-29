import { describe, expect, it, vi } from 'vitest';
import { conversationRecoveryKey, readConversationRecovery, saveConversationRecovery, type SavedFailedTurn } from './conversation-recovery';

const queue = [{ id: 2, text: 'Synthetic queued request', language: 'en' as const }];
const warning: SavedFailedTurn = { id: 1, text: 'Synthetic failed request', language: 'en', messageId: '42',
  error: 'An action may have completed; check status before retrying.', partialReply: 'Partial', acknowledgment: 'I will check.' };

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
  it.each([100_000, 100_001, 512 * 1024])('round-trips a supported %i-byte partial reply without losing its queue or warning', length => {
    const failedTurns = [{ ...warning, partialReply: 'x'.repeat(length) }];
    expect(saveConversationRecovery('synthetic-boundary', { queue, failedTurns })).toBe(true);
    expect(readConversationRecovery('synthetic-boundary')).toEqual({ queue, failedTurns });
  });
  it('round-trips a multibyte reply at the supported 512 KiB UTF-8 limit', () => {
    const failedTurns = [{ ...warning, partialReply: '🙂'.repeat(128 * 1024) }];
    expect(new TextEncoder().encode(failedTurns[0]!.partialReply).byteLength).toBe(512 * 1024);
    expect(saveConversationRecovery('synthetic-multibyte', { queue, failedTurns })).toBe(true);
    expect(readConversationRecovery('synthetic-multibyte')).toEqual({ queue, failedTurns });
  });
  it.each([
    ['oversized ASCII reply', { partialReply: 'x'.repeat(512 * 1024 + 1) }],
    ['oversized multibyte reply', { partialReply: '🙂'.repeat(128 * 1024 + 1) }],
    ['oversized error', { error: 'x'.repeat(10_001) }],
    ['oversized acknowledgment', { acknowledgment: 'x'.repeat(2_001) }],
    ['invalid message ID', { messageId: 'invalid' }],
  ] as const)('preserves valid queue entries and warnings beside an %s', (_label, invalid) => {
    const bad = { ...warning, ...invalid, id: 3 };
    const key = 'synthetic-invalid-warning';
    sessionStorage.setItem(key, JSON.stringify({ queue, failedTurns: [bad, warning], savedAt: Date.now() }));
    expect(readConversationRecovery(key)).toEqual({ queue, failedTurns: [warning] });
    expect(saveConversationRecovery(key, { queue, failedTurns: [bad, warning] })).toBe(false);
    expect(readConversationRecovery(key)).toEqual({ queue, failedTurns: [warning] });
  });
  it('restores a valid queue even when the warning collection is malformed', () => {
    sessionStorage.setItem('synthetic-malformed-warning', JSON.stringify({ queue, failedTurns: null, savedAt: Date.now() }));
    expect(readConversationRecovery('synthetic-malformed-warning')).toEqual({ queue, failedTurns: [] });
  });
  it('retains queued messages and uncertainty warnings when partial contexts exceed the snapshot budget', () => {
    const failedTurns = Array.from({ length: 4 }, (_, index) => ({ ...warning, id: index + 3, partialReply: 'x'.repeat(512 * 1024) }));
    expect(saveConversationRecovery('synthetic-snapshot-budget', { queue, failedTurns })).toBe(false);
    expect(readConversationRecovery('synthetic-snapshot-budget')).toEqual({
      queue, failedTurns: failedTurns.map(turn => ({ ...turn, partialReply: '' })),
    });
  });
  it('saves the valid queue when warning metadata alone exceeds the snapshot budget', () => {
    const failedTurns = Array.from({ length: 201 }, (_, index) => ({ ...warning, id: index + 3, error: 'x'.repeat(10_000) }));
    expect(saveConversationRecovery('synthetic-warning-budget', { queue, failedTurns })).toBe(false);
    expect(readConversationRecovery('synthetic-warning-budget')).toEqual({ queue, failedTurns: [] });
  });
});
