import type { CSSProperties } from 'react';
import type { VoiceStatus } from './voice-client';

type Glyph = 'off' | 'progress' | 'microphone-off' | 'listening' | 'thinking' | 'speaking' | 'tool' | 'interrupted' | 'unavailable';

type VoiceBarState = {
  className: string;
  label: string;
  glyph: Glyph;
  /** The runtime's routine message for this state; repeating it visibly adds no information. */
  routineDetail?: string;
};

const voiceBarStates: Record<VoiceStatus | 'tool_call' | 'interrupted', VoiceBarState> = {
  stopped: { className: 'off', label: 'Voice off', glyph: 'off', routineDetail: 'Voice is off.' },
  connecting: { className: 'connecting', label: 'Connecting', glyph: 'progress', routineDetail: 'Connecting to Jarvis voice…' },
  ready: {
    className: 'ready',
    label: 'Ready',
    glyph: 'microphone-off',
    routineDetail: 'Voice is ready. Microphone is off; enable it when you want to speak.',
  },
  stopping: { className: 'stopping', label: 'Ending voice', glyph: 'progress' },
  listening: { className: 'listening', label: 'Listening', glyph: 'listening', routineDetail: 'Listening for your voice.' },
  thinking: { className: 'thinking', label: 'Thinking', glyph: 'thinking', routineDetail: 'Jarvis is thinking.' },
  speaking: { className: 'speaking', label: 'Speaking', glyph: 'speaking', routineDetail: 'Jarvis is speaking.' },
  reconnecting: { className: 'reconnecting', label: 'Reconnecting', glyph: 'progress', routineDetail: 'Voice connection ended. Reconnecting…' },
  error: { className: 'unavailable', label: 'Voice unavailable', glyph: 'unavailable' },
  tool_call: { className: 'tool-call', label: 'Using a tool', glyph: 'tool' },
  interrupted: { className: 'interrupted', label: 'Interrupted', glyph: 'interrupted', routineDetail: 'Jarvis’s response was interrupted.' },
};

function StateGlyph({ glyph }: { glyph: Glyph }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (glyph) {
    case 'off':
      return <svg {...common}><circle cx="12" cy="12" r="7" /></svg>;
    case 'progress':
      return <svg {...common}><circle cx="12" cy="12" r="8" opacity=".28" /><path className="voice-bar-glyph-arc" d="M12 4a8 8 0 0 1 8 8" /></svg>;
    case 'microphone-off':
      return <svg {...common}><path d="M12 3a3 3 0 0 0-3 3v4m6 0V6a3 3 0 0 0-4.8-2.4M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.5 2.6M12 19v3M3 3l18 18" /></svg>;
    case 'listening':
      return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /><circle className="voice-bar-glyph-ring" cx="12" cy="12" r="7.5" opacity=".55" /></svg>;
    case 'thinking':
      return <svg {...common} fill="currentColor" stroke="none"><circle className="voice-bar-glyph-dot" cx="6" cy="12" r="1.8" /><circle className="voice-bar-glyph-dot" cx="12" cy="12" r="1.8" /><circle className="voice-bar-glyph-dot" cx="18" cy="12" r="1.8" /></svg>;
    case 'speaking':
      return <svg {...common}><path className="voice-bar-glyph-bar" d="M7 9v6" /><path className="voice-bar-glyph-bar" d="M12 6v12" /><path className="voice-bar-glyph-bar" d="M17 9v6" /></svg>;
    case 'tool':
      return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.6-.6-2.6Z" /></svg>;
    case 'interrupted':
      return <svg {...common}><path d="M9 7v10M15 7v10" /></svg>;
    case 'unavailable':
      return <svg {...common}><path d="M12 4 3 20h18Z" /><path d="M12 10v4m0 3h.01" /></svg>;
  }
}

/** Compact, runtime-driven voice state for the luminous-glass voice bar: a quiet glyph and readable text. */
export function VoiceBarStatus({
  status,
  message,
  muted = false,
  audioLevel = 0,
}: {
  status: string;
  message: string;
  muted?: boolean;
  audioLevel?: number;
}) {
  const known = voiceBarStates[status as keyof typeof voiceBarStates];
  const state = known ?? { className: 'unavailable', label: 'Voice unavailable', glyph: 'unavailable' as const };
  const unavailable = state.className === 'unavailable';
  const mutedWhileListening = muted && status === 'listening';
  const label = mutedWhileListening ? 'Microphone muted' : state.label;
  const glyph = mutedWhileListening ? 'microphone-off' : state.glyph;
  const detail = !known
    ? `${message} Voice status was not recognized.`
    : mutedWhileListening
      ? 'Jarvis can’t hear you. Unmute from More options.'
      : muted && (status === 'thinking' || status === 'speaking' || status === 'tool_call')
        ? `${message} Your microphone is muted.`
        : message;
  const routine = !mutedWhileListening && detail === state.routineDetail;
  const level = Number.isFinite(audioLevel) ? Math.max(0, Math.min(1, audioLevel)) : 0;

  return (
    <div className="voice-bar-status" data-state={mutedWhileListening ? 'muted' : state.className}
      role={unavailable ? undefined : 'status'} aria-atomic={unavailable ? undefined : 'true'}>
      <span className="voice-bar-glyph" aria-hidden="true" style={{ '--voice-level': level } as CSSProperties}>
        <StateGlyph glyph={glyph} />
      </span>
      <span className="voice-bar-copy">
        <span id="voice-status" className={unavailable ? 'voice-bar-label error-text' : 'voice-bar-label'}
          aria-live={unavailable ? 'assertive' : undefined} aria-atomic={unavailable ? 'true' : undefined}>
          {label}
        </span>
        <span id="voice-status-detail" className={routine ? 'visually-hidden' : 'voice-bar-detail'}
          role={unavailable ? 'alert' : undefined}>
          {detail}
        </span>
      </span>
    </div>
  );
}
