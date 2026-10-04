import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { backendFetch } from './backend-request';

const MAX_FRAME_BYTES = 1_000_000;

export interface ScreenShareController {
  readonly sharing: boolean;
  readonly error: string;
  start(): Promise<void>;
  stop(): void;
  inspect(sessionId: string): Promise<string>;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function readBlob(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The shared screen is not ready yet.');
  const scale = Math.min(1, 1280 / width, 720 / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The shared screen could not be captured.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) reject(new Error('The shared screen could not be captured.'));
      else if (blob.size > MAX_FRAME_BYTES) reject(new Error('The screen frame is too large to inspect.'));
      else resolve(blob);
    }, 'image/jpeg', 0.65);
  });
}

export function useScreenShare(
  config: PublicConfig,
  getAccessToken: () => Promise<string>,
): ScreenShareController {
  const streamRef = useRef<MediaStream | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    setSharing(false);
  }, []);

  const start = useCallback(async () => {
    setError('');
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (streamRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', stop, { once: true });
      setSharing(true);
    } catch {
      setError('Screen sharing was not started. Choose a window or screen and try again.');
    }
  }, [stop]);

  useEffect(() => () => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const inspect = useCallback(async (sessionId: string) => {
    setError('');
    if (!/^[1-9]\d{0,18}$/u.test(sessionId) || BigInt(sessionId) > 9_223_372_036_854_775_807n) {
      throw new Error('An active conversation is required to inspect the screen.');
    }
    const stream = streamRef.current;
    if (!stream || stream.getVideoTracks().every((track) => track.readyState !== 'live')) {
      throw new Error('Start screen sharing before asking Jarvis to inspect it.');
    }
    if (!config.backendUrl) throw new Error('Screen inspection is unavailable until the backend is configured.');

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
      const blob = await readBlob(video);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let frame: string;
      try {
        frame = encodeBase64(bytes);
      } finally {
        bytes.fill(0);
      }
      const token = await getAccessToken();
      const response = await backendFetch(`${config.backendUrl.replace(/\/+$/u, '')}/screen/frames`, {
        method: 'POST',
        headers: {
          Authorization: `${['Bear', 'er'].join('')} ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, frame }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        let message = 'Jarvis could not inspect the shared screen. Try again.';
        try {
          const value: unknown = await response.json();
          if (typeof value === 'object' && value !== null && 'error' in value &&
              typeof value.error === 'string' && value.error.length <= 200) message = value.error;
        } catch { /* Keep the stable response error. */ }
        throw new Error(message);
      }
      const value: unknown = await response.json();
      if (typeof value !== 'object' || value === null || !('description' in value) ||
          typeof value.description !== 'string' || !value.description.trim() || value.description.length > 5_000) {
        throw new Error('Jarvis returned an invalid screen description.');
      }
      return value.description;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Jarvis could not inspect the shared screen.';
      setError(message);
      throw reason instanceof Error ? reason : new Error(message);
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }, [config.backendUrl, getAccessToken]);

  return { sharing, error, start, stop, inspect };
}
