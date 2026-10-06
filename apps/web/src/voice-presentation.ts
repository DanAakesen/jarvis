import type { JarvisActivityEvent } from '@jarvis/contracts';
import type { MicrophoneState, VoiceStatus } from './voice-client';

/** Behaviour of the persistent Jarvis orb, independent of whether voice is awake. */
export type JarvisOrbState = 'idle' | 'listening' | 'thinking' | 'tool' | 'speaking';

export type VoicePresentationState =
  | 'connecting' | 'microphone-pending' | 'microphone-blocked' | 'listening' | 'muted' | 'thinking'
  | 'tool' | 'tool-finished' | 'speaking' | 'interrupted' | 'reconnecting' | 'stopping' | 'unavailable';

export type VoicePresentation = {
  state: VoicePresentationState;
  label: string;
  detail: string;
  /** The detail only repeats the label's routine meaning, so it can be visually hidden. */
  routine: boolean;
  orb: JarvisOrbState;
  /** The microphone needs Dan's explicit Retry microphone action. */
  canRetryMicrophone: boolean;
};

export type VoicePresentationInput = {
  status: VoiceStatus;
  message: string;
  microphone: MicrophoneState;
  muted: boolean;
  /** Voice runtime activity from this browser session only; stale or chat events must be filtered out. */
  activity: JarvisActivityEvent | null;
};

const toolOutcome = {
  ok: { label: 'Tool finished', verb: 'finished' },
  refused: { label: 'Tool declined', verb: 'was declined' },
  error: { label: 'Tool failed', verb: 'failed' },
} as const;

function present(
  state: VoicePresentationState,
  label: string,
  detail: string,
  orb: JarvisOrbState,
  routine = false,
  canRetryMicrophone = false,
): VoicePresentation {
  return { state, label, detail, routine, orb, canRetryMicrophone };
}

/**
 * One truthful voice presentation for both the HTML status beneath the orb and the orb itself.
 * The browser transport and microphone win over runtime activity: connecting, a pending or denied
 * permission, or a stale event can never claim Jarvis is listening or speaking. Speaking is shown
 * only when the client reports audible playback, not merely a received network chunk.
 */
export function voicePresentation({ status, message, microphone, muted, activity }: VoicePresentationInput): VoicePresentation {
  switch (status) {
    case 'stopped':
    case 'error':
      return present('unavailable', status === 'error' ? 'Voice unavailable' : 'Voice off', message, 'idle');
    case 'connecting':
      return present('connecting', 'Connecting', message, 'idle', message === 'Connecting to Jarvis voice…');
    case 'reconnecting':
      return present('reconnecting', 'Reconnecting', message, 'idle', message === 'Voice connection ended. Reconnecting…');
    case 'stopping':
      return present('stopping', 'Ending voice', message, 'idle');
    default:
      break;
  }

  if (microphone !== 'live' || status === 'ready') {
    if (microphone === 'requesting' || microphone === 'granted') {
      return present('microphone-pending', 'Waiting for microphone', message, 'idle');
    }
    const label = microphone === 'missing' ? 'No microphone found'
      : microphone === 'denied' ? 'Microphone blocked' : 'Microphone unavailable';
    return present('microphone-blocked', label, message, 'idle', false, true);
  }

  const audible = status === 'speaking';
  const base: VoicePresentation = status === 'speaking'
    ? present('speaking', 'Speaking', 'Jarvis is speaking.', 'speaking', true)
    : status === 'thinking'
      ? present('thinking', 'Thinking', 'Jarvis is thinking.', 'thinking', true)
      : present('listening', 'Listening', 'Listening for your voice.', 'listening', true);

  let current = base;
  if (activity) {
    switch (activity.type) {
      case 'tool-call-started':
        current = present('tool', 'Using a tool', `Jarvis is using ${activity.toolName}.`, 'tool');
        break;
      case 'tool-call-finished': {
        const outcome = toolOutcome[activity.outcome];
        current = present('tool-finished', outcome.label, `${activity.toolName} ${outcome.verb}.`, base.orb);
        break;
      }
      case 'interrupted':
        current = present('interrupted', 'Interrupted', 'Jarvis’s response was interrupted.', audible ? 'speaking' : 'listening', true);
        break;
      case 'failed':
        current = { ...base, detail: 'Voice activity failed.', routine: false };
        break;
      case 'thinking':
        current = audible ? base : present('thinking', 'Thinking', 'Jarvis is thinking.', 'thinking', true);
        break;
      case 'reconnecting':
        current = present('reconnecting', 'Reconnecting', 'Voice connection ended. Reconnecting…', 'idle', true);
        break;
      case 'speaking':
      case 'listening':
      case 'ended':
        // Runtime speaking is not proof of audible playback, and runtime listening never overrides
        // the client's own playback/response state.
        break;
    }
  }

  if (muted) {
    if (current.state === 'listening' || current.state === 'interrupted') {
      return present('muted', 'Microphone muted', 'Jarvis can’t hear you. Unmute from More options.', 'idle');
    }
    return { ...current, detail: `${current.detail} Your microphone is muted.`, routine: false };
  }
  return current;
}
