import type { JarvisActivityEvent } from '@jarvis/contracts';
import { describe, expect, it } from 'vitest';
import { voicePresentation, type VoicePresentationInput } from './voice-presentation';

const activityId = '11111111-1111-4111-8111-111111111111';
const live: VoicePresentationInput = {
  status: 'listening',
  message: 'Listening for your voice.',
  microphone: 'live',
  muted: false,
  activity: null,
};

function present(input: Partial<VoicePresentationInput>) {
  return voicePresentation({ ...live, ...input });
}

describe('voicePresentation', () => {
  it('never claims Listening or Speaking while connecting, reconnecting or waiting for permission', () => {
    const speaking: JarvisActivityEvent = { type: 'speaking', activityId, source: 'voice' };
    for (const input of [
      { status: 'connecting', microphone: 'requesting' },
      { status: 'reconnecting', microphone: 'granted' },
      { status: 'ready', microphone: 'requesting' },
      { status: 'ready', microphone: 'denied' },
      { status: 'ready', microphone: 'missing' },
      { status: 'ready', microphone: 'failed' },
    ] as const) {
      const result = present({ ...input, activity: speaking });
      expect(result.state).not.toMatch(/listening|speaking/);
      expect(result.orb).toBe('idle');
    }
    expect(present({ status: 'ready', microphone: 'denied' })).toMatchObject({
      label: 'Microphone blocked', canRetryMicrophone: true,
    });
    expect(present({ status: 'ready', microphone: 'missing' }).label).toBe('No microphone found');
    expect(present({ status: 'ready', microphone: 'requesting' }).canRetryMicrophone).toBe(false);
  });

  it('only shows speaking from audible client playback, not runtime speaking events', () => {
    expect(present({ activity: { type: 'speaking', activityId, source: 'voice' } })).toMatchObject({
      state: 'listening', orb: 'listening',
    });
    expect(present({ status: 'speaking' })).toMatchObject({ state: 'speaking', orb: 'speaking' });
  });

  it('settles tool work and interruption accurately', () => {
    expect(present({ status: 'thinking', activity: {
      type: 'tool-call-started', activityId, source: 'voice', toolName: 'open_window',
    } })).toMatchObject({ state: 'tool', orb: 'tool', label: 'Using a tool' });
    for (const [outcome, label] of [['ok', 'Tool finished'], ['refused', 'Tool declined'], ['error', 'Tool failed']] as const) {
      expect(present({ status: 'thinking', activity: {
        type: 'tool-call-finished', activityId, source: 'voice', toolName: 'open_window', outcome,
      } })).toMatchObject({ state: 'tool-finished', label, orb: 'thinking' });
    }
    expect(present({ activity: { type: 'interrupted', activityId, source: 'voice' } }))
      .toMatchObject({ state: 'interrupted', orb: 'listening' });
  });

  it('keeps an explicit mute visible without pretending Jarvis hears Dan', () => {
    expect(present({ muted: true })).toMatchObject({ state: 'muted', orb: 'idle', label: 'Microphone muted' });
    const speaking = present({ status: 'speaking', muted: true });
    expect(speaking.state).toBe('speaking');
    expect(speaking.detail).toContain('Your microphone is muted.');
  });
});
