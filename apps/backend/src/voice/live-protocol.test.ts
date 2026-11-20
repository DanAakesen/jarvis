import { describe, expect, it } from 'vitest';
import {
  commentaryParts,
  isCompatibleLiveSessionFormat,
  LiveVoiceUsageTracker,
  MAX_COMMENTARY_UTF8_BYTES,
  settleVoiceSessionCreation,
} from './live-protocol.js';

describe('GPT-Live protocol boundaries', () => {
  it('accepts an omitted optional format and rejects only explicit conflicts', () => {
    expect(isCompatibleLiveSessionFormat({ session: { audio: {} } })).toBe(true);
    expect(isCompatibleLiveSessionFormat({ session: {} })).toBe(true);
    expect(isCompatibleLiveSessionFormat({
      session: { audio: { format: { type: 'audio/pcm', rate: 24_000 } } },
    })).toBe(true);
    expect(isCompatibleLiveSessionFormat({
      session: { audio: { format: { type: 'audio/pcm', rate: 16_000 } } },
    })).toBe(false);
    expect(isCompatibleLiveSessionFormat({
      session: { audio: { format: { type: 'audio/wav', rate: 24_000 } } },
    })).toBe(false);
  });

  it('keeps every commentary append below the conservative byte-token ceiling', () => {
    const sentence = 'Jarvis has the Danish calendar update, including København, and the result is ready. ';
    const text = sentence.repeat(20).trim();
    const parts = commentaryParts(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => Buffer.byteLength(part) <= MAX_COMMENTARY_UTF8_BYTES)).toBe(true);
    expect(parts.join(' ')).toBe(text);
  });

  it('deduplicates cumulative usage and retains the largest provider duration', () => {
    const usage = new LiveVoiceUsageTracker();
    expect(usage.accept({ type: 'session.usage.updated', event_id: 'u1', usage: { seconds: 12 } })).toBe(12);
    expect(usage.accept({ type: 'session.usage.updated', event_id: 'u1', usage: { seconds: 99 } })).toBe(12);
    expect(usage.accept({ type: 'session.usage.updated', event_id: 'u2', usage: { seconds: 10 } })).toBe(12);
    expect(usage.accept({ type: 'session.closed', event_id: 'done', usage: { seconds: 15.5 } })).toBe(15.5);
    expect(usage.seconds).toBe(15.5);
    expect(() => usage.accept({ type: 'session.usage.updated', event_id: 'bad', usage: { seconds: -1 } }))
      .toThrowError('Invalid provider voice usage');
  });

  it('ends a SQL session that resolves after startup was cancelled', async () => {
    let resolve!: (session: { id: string }) => void;
    const creation = new Promise<{ id: string }>((done) => { resolve = done; });
    const controller = new AbortController();
    const ended: string[] = [];
    const settled = settleVoiceSessionCreation(
      creation,
      controller.signal,
      () => false,
      () => { throw new Error('cancelled session must not become active'); },
      async (sessionId) => { ended.push(sessionId); },
    );
    controller.abort(new Error('startup stopped'));
    resolve({ id: 'late-7' });
    await expect(settled).rejects.toThrow('startup stopped');
    expect(ended).toEqual(['late-7']);
  });
});
