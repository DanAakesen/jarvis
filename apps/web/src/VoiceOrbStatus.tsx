import type { VoicePresentation, VoicePresentationState } from './voice-presentation';

type Glyph = 'progress' | 'microphone-off' | 'listening' | 'thinking' | 'speaking' | 'tool' | 'interrupted' | 'unavailable';

const glyphs: Record<VoicePresentationState, Glyph> = {
  connecting: 'progress',
  'microphone-pending': 'progress',
  'microphone-blocked': 'unavailable',
  listening: 'listening',
  muted: 'microphone-off',
  thinking: 'thinking',
  tool: 'tool',
  'tool-finished': 'tool',
  speaking: 'speaking',
  interrupted: 'interrupted',
  reconnecting: 'progress',
  stopping: 'progress',
  unavailable: 'unavailable',
};

function StateGlyph({ glyph }: { glyph: Glyph }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (glyph) {
    case 'progress':
      return <svg {...common}><circle cx="12" cy="12" r="8" opacity=".28" /><path className="voice-status-glyph-arc" d="M12 4a8 8 0 0 1 8 8" /></svg>;
    case 'microphone-off':
      return <svg {...common}><path d="M12 3a3 3 0 0 0-3 3v4m6 0V6a3 3 0 0 0-4.8-2.4M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.5 2.6M12 19v3M3 3l18 18" /></svg>;
    case 'listening':
      return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /><circle className="voice-status-glyph-ring" cx="12" cy="12" r="7.5" opacity=".55" /></svg>;
    case 'thinking':
      return <svg {...common} fill="currentColor" stroke="none"><circle className="voice-status-glyph-dot" cx="6" cy="12" r="1.8" /><circle className="voice-status-glyph-dot" cx="12" cy="12" r="1.8" /><circle className="voice-status-glyph-dot" cx="18" cy="12" r="1.8" /></svg>;
    case 'speaking':
      return <svg {...common}><path className="voice-status-glyph-bar" d="M7 9v6" /><path className="voice-status-glyph-bar" d="M12 6v12" /><path className="voice-status-glyph-bar" d="M17 9v6" /></svg>;
    case 'tool':
      return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.6-.6-2.6Z" /></svg>;
    case 'interrupted':
      return <svg {...common}><path d="M9 7v10M15 7v10" /></svg>;
    case 'unavailable':
      return <svg {...common}><path d="M12 4 3 20h18Z" /><path d="M12 10v4m0 3h.01" /></svg>;
  }
}

/**
 * Readable voice state beneath the orb. It is plain HTML, so it stays available as the text
 * alternative when WebGL is unavailable; recovery problems are announced assertively.
 */
export function VoiceOrbStatus({ presentation }: { presentation: VoicePresentation }) {
  const urgent = presentation.state === 'microphone-blocked' || presentation.state === 'unavailable';
  return (
    <div className="voice-status" data-state={presentation.state}
      role={urgent ? 'alert' : 'status'} aria-live={urgent ? 'assertive' : 'polite'} aria-atomic="true">
      <span className="voice-status-heading">
        <span className="voice-status-glyph" aria-hidden="true">
          <StateGlyph glyph={glyphs[presentation.state]} />
        </span>
        <span id="voice-status" className="voice-status-label">{presentation.label}</span>
      </span>
      <span id="voice-status-detail" className={presentation.routine ? 'visually-hidden' : 'voice-status-detail'}>
        {presentation.detail}
      </span>
    </div>
  );
}
