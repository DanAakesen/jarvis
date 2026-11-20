import { describe, expect, it } from 'vitest';
import {
  commentaryParts,
  endLateVoiceSession,
  isCompatibleLiveSessionFormat,
  LiveVoiceUsageTracker,
  MAX_COMMENTARY_UTF8_BYTES,
  settleVoiceSessionCreation,
  VoiceTerminationStateMachine,
  type VoiceTerminationEvent,
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

  it.each<{
    name: string;
    events: VoiceTerminationEvent[];
    phase: 'ended' | 'failed';
    closeCode: 1000 | 1011;
  }>([
    {
      name: 'clean provider and Jarvis acknowledgement',
      events: [
        { type: 'end-requested', canSendClose: true, reason: 'Voice session ended', notifyClient: true },
        { type: 'provider-closed' },
        { type: 'finalization-succeeded' },
        { type: 'ack-sent' },
      ],
      phase: 'ended',
      closeCode: 1000,
    },
    {
      name: 'pre-provider End',
      events: [
        { type: 'end-requested', canSendClose: false, reason: 'Voice session ended', notifyClient: true },
        { type: 'finalization-succeeded' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'connecting End',
      events: [
        { type: 'end-requested', canSendClose: false, reason: 'Voice session ended', notifyClient: true },
        { type: 'finalization-succeeded' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'close send failure',
      events: [
        { type: 'end-requested', canSendClose: true, reason: 'Voice session ended', notifyClient: true },
        { type: 'failed', closeCode: 1011, reason: 'Voice close send failed', notifyClient: true },
        { type: 'finalization-succeeded' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'provider close drain timeout',
      events: [
        { type: 'end-requested', canSendClose: true, reason: 'Voice session ended', notifyClient: true },
        { type: 'failed', closeCode: 1011, reason: 'Voice session close was not confirmed', notifyClient: true },
        { type: 'finalization-succeeded' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'transport loss',
      events: [
        { type: 'failed', closeCode: 1011, reason: 'Browser disconnected', notifyClient: false },
        { type: 'finalization-succeeded' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'provider close without a Jarvis request',
      events: [
        { type: 'provider-closed' },
        { type: 'finalization-succeeded' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'clean provider close with failed cleanup',
      events: [
        { type: 'end-requested', canSendClose: true, reason: 'Voice session ended', notifyClient: true },
        { type: 'provider-closed' },
        { type: 'finalization-failed' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'terminal Jarvis acknowledgement failure',
      events: [
        { type: 'end-requested', canSendClose: true, reason: 'Voice session ended', notifyClient: true },
        { type: 'provider-closed' },
        { type: 'finalization-succeeded' },
        { type: 'ack-failed' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
    {
      name: 'late failure after acknowledged End',
      events: [
        { type: 'end-requested', canSendClose: true, reason: 'Voice session ended', notifyClient: true },
        { type: 'provider-closed' },
        { type: 'finalization-succeeded' },
        { type: 'ack-sent' },
        { type: 'failed', closeCode: 1011, reason: 'late failure', notifyClient: true },
      ],
      phase: 'ended',
      closeCode: 1000,
    },
    {
      name: 'late acknowledgement after failure',
      events: [
        { type: 'failed', closeCode: 1011, reason: 'transport lost', notifyClient: true },
        { type: 'finalization-succeeded' },
        { type: 'ack-sent' },
      ],
      phase: 'failed',
      closeCode: 1011,
    },
  ])('enforces terminal ownership for $name', ({ events, phase, closeCode }) => {
    const termination = new VoiceTerminationStateMachine();
    const effects = events.map((event) => termination.apply(event));
    const terminal = effects.filter((effect) =>
      effect.type === 'close-ended' || effect.type === 'close-failed'
    );

    expect(termination.phase).toBe(phase);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ closeCode });
    if (phase === 'failed') {
      expect(effects.some((effect) => effect.type === 'close-ended')).toBe(false);
    }
  });

  it('ends a SQL session that resolves after startup was cancelled', async () => {
    let resolve!: (session: { id: string }) => void;
    const creation = new Promise<{ id: string }>((done) => { resolve = done; });
    const controller = new AbortController();
    let abandoned = false;
    const ended: string[] = [];
    const settled = settleVoiceSessionCreation(
      creation,
      controller.signal,
      () => abandoned,
      () => { throw new Error('cancelled session must not become active'); },
      async (sessionId) => { ended.push(sessionId); },
    );
    abandoned = true;
    resolve({ id: 'late-7' });
    await expect(settled).rejects.toThrow('Voice startup was cancelled');
    expect(ended).toEqual(['late-7']);
  });

  it('retries thrown or false late-session cleanup results within a fixed bound', async () => {
    const attempts: number[] = [];
    await endLateVoiceSession(
      'late-8',
      async () => {
        attempts.push(attempts.length + 1);
        if (attempts.length === 1) throw new Error('transient');
        return attempts.length === 3;
      },
      async () => undefined,
    );
    expect(attempts).toEqual([1, 2, 3]);
  });
});
