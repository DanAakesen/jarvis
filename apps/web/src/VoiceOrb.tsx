import type { CSSProperties } from 'react';
import type { VoiceStatus } from './voice-client';

type VoiceOrbState = {
  className: string;
  message: string;
};

const voiceOrbStates: Record<VoiceStatus | 'tool_call', VoiceOrbState> = {
  stopped: { className: 'off', message: '' },
  connecting: { className: 'connecting', message: '' },
  ready: { className: 'off', message: '' },
  stopping: { className: 'stopping', message: '' },
  listening: { className: 'listening', message: '' },
  thinking: { className: 'thinking', message: '' },
  speaking: { className: 'speaking', message: '' },
  reconnecting: { className: 'reconnecting', message: '' },
  error: { className: 'unavailable', message: '' },
  tool_call: { className: 'tool-call', message: '' },
};

export function VoiceOrb({ status, message, audioLevel = 0 }: { status: string; message: string; audioLevel?: number }) {
  const state = voiceOrbStates[status as keyof typeof voiceOrbStates] ?? {
    className: 'unavailable',
    message: 'Voice status unavailable. The runtime reported an unrecognized status.',
  };
  const statusMessage = state.message || (status === 'error' ? `Voice unavailable. ${message}` : message);
  const level = Number.isFinite(audioLevel) ? Math.max(0, Math.min(1, audioLevel)) : 0;

  return (
    <div className={`voice-orb-presentation voice-orb-${state.className}`} data-state={state.className}
      style={{ '--voice-level': level * 0.08 } as CSSProperties}>
      <div className="voice-orb" aria-hidden="true"><span /></div>
      <div className="voice-orb-copy">
        <p
          id="voice-status"
          className={state.className === 'unavailable' ? 'voice-orb-status error-text' : 'voice-orb-status'}
          role={state.className === 'unavailable' ? 'alert' : 'status'}
          aria-live="polite"
          aria-atomic="true"
        >
          {statusMessage}
        </p>
        <p className="voice-orb-limitation">
          Tool-call activity is unavailable because the voice runtime does not publish that state yet.
        </p>
      </div>
    </div>
  );
}
