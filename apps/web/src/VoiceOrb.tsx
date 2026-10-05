import type { CSSProperties } from 'react';
import type { ReactNode } from 'react';
import type { VoiceStatus } from './voice-client';

type VoiceOrbState = {
  className: string;
  heading: string;
};

const voiceOrbStates: Record<VoiceStatus | 'tool_call', VoiceOrbState> = {
  stopped: { className: 'off', heading: 'Voice off' },
  connecting: { className: 'connecting', heading: 'Connecting' },
  ready: { className: 'off', heading: 'Ready' },
  stopping: { className: 'stopping', heading: 'Ending voice' },
  listening: { className: 'listening', heading: 'Listening' },
  thinking: { className: 'thinking', heading: 'Thinking' },
  speaking: { className: 'speaking', heading: 'Speaking' },
  reconnecting: { className: 'reconnecting', heading: 'Reconnecting' },
  error: { className: 'unavailable', heading: 'Voice unavailable' },
  tool_call: { className: 'tool-call', heading: 'Using a tool' },
};

export function VoiceOrb({
  status,
  message,
  audioLevel = 0,
  children,
}: {
  status: string;
  message: string;
  audioLevel?: number;
  children?: ReactNode;
}) {
  const state = voiceOrbStates[status as keyof typeof voiceOrbStates] ?? {
    className: 'unavailable',
    heading: 'Voice unavailable',
  };
  const unavailable = state.className === 'unavailable';
  const detail = status === 'error'
    ? message
    : unavailable
      ? `${message} Voice status was not recognized.`
      : message;
  const level = Number.isFinite(audioLevel) ? Math.max(0, Math.min(1, audioLevel)) : 0;

  return (
    <div className={`voice-orb-presentation voice-orb-${state.className}`} data-state={state.className}
      style={{ '--voice-level': level * 0.08 } as CSSProperties}>
      <div className="voice-orb" aria-hidden="true"><span /></div>
      <div className="voice-orb-copy">
        <h1
          id="voice-status"
          className={state.className === 'unavailable' ? 'voice-orb-status error-text' : 'voice-orb-status'}
          aria-live={unavailable ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {state.heading}
        </h1>
        <p id="voice-status-detail" className="voice-orb-detail" role={unavailable ? 'alert' : undefined}>
          {detail}
          {status === 'tool_call' && <> <span className="tool-call tool-call-running">Tool running</span></>}
        </p>
      </div>
      {children}
    </div>
  );
}
