import { useEffect, useState } from 'react';
import type { CameraController } from './screen-sharing';

const mobileCameraQuery = '(pointer: coarse) and (hover: none)';
function CameraGlyph({ name }: { name: 'camera' | 'switch' | 'off' }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'switch') return <svg {...common}><path d="M20 7H4l4-4M4 17h16l-4 4" /></svg>;
  return <svg {...common}><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" />
    <circle cx="12" cy="12" r="3" />{name === 'off' && <path d="m3 3 18 18" />}</svg>;
}

export function CameraStatus({ camera }: { camera: CameraController }) {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(mobileCameraQuery).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(mobileCameraQuery);
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  if (!camera.sharing && !camera.starting) {
    return camera.error ? <div className="camera-status"><span className="chat-error" role="alert">{camera.error}</span></div> : null;
  }
  return <div className="camera-status">
    <span className="camera-status-label" role="status"><CameraGlyph name="camera" />{camera.starting ? 'Starting camera…' : camera.facing === 'user' ? 'Front camera on'
      : camera.facing === 'environment' ? 'Back camera on' : 'Camera on - direction unavailable'}</span>
    <div className="camera-status-actions">
      {mobile && camera.switchCamera && <button type="button" className="camera-status-control" disabled={camera.starting || camera.inspecting}
        aria-label={camera.facing === 'user' ? 'Switch to back camera' : camera.facing === 'environment' ? 'Switch to front camera' : 'Switch camera'}
        title={camera.facing === 'user' ? 'Switch to back camera' : camera.facing === 'environment' ? 'Switch to front camera' : 'Switch camera'}
        onClick={() => { void camera.switchCamera?.(); }}><CameraGlyph name="switch" /><span>Switch</span></button>}
      <button type="button" className="camera-status-control" aria-label="Camera off" title="Turn camera off" onClick={camera.stop}>
        <CameraGlyph name="off" /><span>Turn off</span>
      </button>
    </div>
    {camera.error && <span className="chat-error" role="alert">{camera.error}</span>}
  </div>;
}
