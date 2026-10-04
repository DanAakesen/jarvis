import type { VoiceStatus } from './voice-client';

type VoiceOrbState = {
  name: string;
  className: string;
  message: string;
};

const voiceOrbStates: Record<VoiceStatus | 'tool_call', VoiceOrbState> = {
  stopped: { name: 'Voice off', className: 'off', message: '' },
  connecting: { name: 'Connecting', className: 'connecting', message: '' },
  stopping: { name: 'Ending voice', className: 'stopping', message: '' },
  listening: { name: 'Listening', className: 'listening', message: '' },
  thinking: { name: 'Thinking', className: 'thinking', message: '' },
  speaking: { name: 'Speaking', className: 'speaking', message: '' },
  reconnecting: { name: 'Reconnecting', className: 'reconnecting', message: '' },
  error: { name: 'Voice unavailable', className: 'unavailable', message: '' },
  tool_call: { name: 'Tool call', className: 'tool-call', message: '' },
};

export function VoiceOrb({ status, message }: { status: string; message: string }) {
  const state = voiceOrbStates[status as keyof typeof voiceOrbStates] ?? {
    name: 'Voice status unavailable',
    className: 'unavailable',
    message: 'The voice runtime reported an unrecognized status.',
  };

  return (
    <div className={`voice-orb-presentation voice-orb-${state.className}`} data-state={state.className}>
      <div className="voice-orb" aria-hidden="true"><span /></div>
      <div className="voice-orb-copy">
        <p
          id="voice-status"
          className={state.className === 'unavailable' ? 'voice-orb-status error-text' : 'voice-orb-status'}
          role={state.className === 'unavailable' ? 'alert' : 'status'}
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="voice-orb-label">{state.name}</span>
          {state.message || message}
        </p>
        <p className="voice-orb-limitation">
          Tool-call activity is unavailable because the voice runtime does not publish that state yet.
        </p>
      </div>
    </div>
  );
}
