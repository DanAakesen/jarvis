import type { VoicePresentation } from './voice-presentation';

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
        <span key={presentation.state} id="voice-status" className="voice-status-label">{presentation.label}</span>
      </span>
      <span id="voice-status-detail" className={presentation.routine ? 'visually-hidden' : 'voice-status-detail'}>
        {presentation.detail}
      </span>
    </div>
  );
}
