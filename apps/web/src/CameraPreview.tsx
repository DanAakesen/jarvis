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
  const container = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const measuredStream = useRef<MediaStream | null>(null);
  const [playback, setPlayback] = useState<{ stream: MediaStream; error: string } | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  const stream = camera.previewStream;
  useEffect(() => {
    const element = video.current;
    if (!element || !stream) return;
    let active = true;
    if (measuredStream.current !== stream) {
      measuredStream.current = stream;
      setVideoSize(null);
    }
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
  useEffect(() => {
    const element = container.current;
    const pictureElement = picture.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const statusLabel = pictureElement?.querySelector<HTMLElement>('.camera-status-label');
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === element) setPreviewSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        if (entry.target === statusLabel) {
          const statusHeight = entry.borderBoxSize?.[0]?.blockSize ?? statusLabel?.getBoundingClientRect().height ?? 0;
          pictureElement?.style.setProperty('--camera-preview-status-height', `${statusHeight}px`);
        }
      }
    });
    observer.observe(element);
    if (statusLabel) observer.observe(statusLabel);
    return () => observer.disconnect();
  }, [camera.sharing, camera.starting]);
  const scale = videoSize && previewSize.width > 0 && previewSize.height > 0
    ? Math.min(previewSize.width / videoSize.width, previewSize.height / videoSize.height)
    : 0;
  const pictureSize = scale > 0 && videoSize
    ? { width: videoSize.width * scale, height: videoSize.height * scale }
    : videoSize ? { width: '100%', aspectRatio: `${videoSize.width} / ${videoSize.height}` } : undefined;
  const playbackError = playback && playback.stream === stream ? playback.error : '';
  const live = Boolean(stream && camera.sharing && playback && playback.stream === stream && !playback.error);
  const updateVideoSize = (element: HTMLVideoElement) => {
    if (element.videoWidth > 0 && element.videoHeight > 0) {
      setVideoSize({ width: element.videoWidth, height: element.videoHeight });
    }
  };
  return <div ref={container} className="camera-preview" data-inactive={!camera.sharing && !camera.starting}>
    <div ref={picture} className="camera-preview-picture" data-facing={camera.facing} style={pictureSize}>
      <video ref={video} autoPlay muted playsInline aria-label="Live camera preview" data-readback="off"
        onLoadedMetadata={(event) => updateVideoSize(event.currentTarget)}
        onResize={(event) => updateVideoSize(event.currentTarget)} />
      {(!stream || camera.starting) && <p role="status">{camera.starting ? 'Starting camera...' : 'No camera frame available.'}</p>}
      {live && !camera.starting && <span className="camera-preview-live" role="status">Live</span>}
      {(camera.sharing || camera.starting) && <CameraStatus camera={camera} />}
      {(playbackError || camera.observationNotice) && <div className="camera-preview-feedback">
        {playbackError && <div className="camera-preview-error" role="alert">
          <span>{playbackError}</span>
          <button className="secondary-button" type="button" onClick={() => setAttempt((current) => current + 1)}>Retry preview</button>
        </div>}
        {camera.observationNotice && <p className="camera-preview-notice" role="status">{camera.observationNotice}</p>}
      </div>}
    </div>
    {!camera.sharing && !camera.starting && <CameraStatus camera={camera} />}
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
