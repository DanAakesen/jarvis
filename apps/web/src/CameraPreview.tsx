import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationToast } from './ConversationToast';
import type { CameraController } from './screen-sharing';
import { CameraStatus } from './CameraStatus';
import './CameraPreview.css';

export function CameraObservationToast({ message, voiceActive = false }: { message: string; voiceActive?: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  return dismissed ? null : <ConversationToast notification={{ id: 0, message, error: false }}
    onDismiss={dismiss} voiceActive={voiceActive} />;
}

export const cameraPreviewViewId = 'camera-preview';

export function CameraPreview({ camera }: { camera: CameraController }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playback, setPlayback] = useState<{ stream: MediaStream; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stream = camera.previewStream;
  useEffect(() => {
    const element = video.current;
    if (!element || !stream) return;
    let active = true;
    element.srcObject = stream;
    void element.play().then(() => {
      if (active) setPlayback({ stream, error: '' });
    }, () => {
      if (active) setPlayback({ stream, error: 'The camera preview could not play. Retry the preview.' });
    });
    return () => {
      active = false;
      element.pause();
      element.srcObject = null;
    };
  }, [attempt, stream]);
  const playbackError = playback && playback.stream === stream ? playback.error : '';
  const live = Boolean(stream && camera.sharing && playback && playback.stream === stream && !playback.error);
  return <div className="camera-preview" data-inactive={!camera.sharing && !camera.starting}>
    <div className="camera-preview-picture luminous-glass" data-facing={camera.facing}>
      <video ref={video} autoPlay muted playsInline aria-label="Live camera preview" data-readback="off" />
      {(!stream || camera.starting) && <p role="status">{camera.starting ? 'Starting camera...' : 'No camera frame available.'}</p>}
      {live && !camera.starting && <span className="camera-preview-live" role="status">Live</span>}
      {(camera.sharing || camera.starting) && <CameraStatus camera={camera} />}
    </div>
    {playbackError && <div className="camera-preview-error" role="alert">
      <span>{playbackError}</span>
      <button className="secondary-button" type="button" onClick={() => setAttempt((current) => current + 1)}>Retry preview</button>
    </div>}
    {!camera.sharing && !camera.starting && <CameraStatus camera={camera} />}
    {camera.observationNotice && <p className="camera-preview-notice" role="status">{camera.observationNotice}</p>}
    {!camera.sharing && !camera.starting && <button type="button" className="secondary-button camera-preview-retry" onClick={() => { void camera.start(); }}>
      Retry camera
    </button>}
    <span className="visually-hidden">
      Camera preview. Minimising keeps the camera on; closing turns it off. Preview video stays on this device.
      {camera.conversation
        ? 'Jarvis receives a fresh frame with each chat or voice turn while the camera is on. Image limits are reported, not hidden.'
        : 'Jarvis receives a fresh frame only when asked, or while camera watching is enabled.'}
    </span>
  </div>;
}
