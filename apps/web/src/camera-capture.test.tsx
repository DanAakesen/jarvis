import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from './screen-sharing';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalCanvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
const originalToBlob = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob');
const originalVideoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth');
const originalVideoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight');
const originalPlay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'play');
const originalPause = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'pause');

function cameraStream() {
  const track = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() } as unknown as MediaStreamTrack;
  return {
    track,
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
  };
}

function CameraHarness({ onError }: { onError?: (message: string) => void } = {}) {
  const camera = useCamera(config, async () => 'fixture-token');
  const [description, setDescription] = useState('');
  return (
    <section>
      <button type="button" onClick={() => void camera.start(onError)} disabled={camera.starting}>
        {camera.sharing ? 'Turn camera off' : 'Turn camera on'}
      </button>
      <button type="button" onClick={() => void camera.inspect('42').then(({ description }) => setDescription(description), () => {})}
        disabled={!camera.sharing || camera.inspecting}>
        Request camera frame
      </button>
      <button type="button" onClick={camera.stop}>Stop camera</button>
      <p role="status">{camera.sharing ? 'Camera is on' : 'Camera is off'}</p>
      {description && <p>{description}</p>}
      {camera.error && <p role="alert">{camera.error}</p>}
    </section>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
  if (originalCanvasContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalCanvasContext);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
  if (originalToBlob) Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', originalToBlob);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toBlob');
  for (const [prototype, property, descriptor] of [
    [HTMLVideoElement.prototype, 'videoWidth', originalVideoWidth],
    [HTMLVideoElement.prototype, 'videoHeight', originalVideoHeight],
    [HTMLMediaElement.prototype, 'play', originalPlay],
    [HTMLMediaElement.prototype, 'pause', originalPause],
  ] as const) {
    if (descriptor) Object.defineProperty(prototype, property, descriptor);
    else Reflect.deleteProperty(prototype, property);
  }
});

describe('camera frame capture', () => {
  it('reports a denied permission to the caller without starting or sending capture', async () => {
    const onError = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); }),
    } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness onError={onError} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    expect(onError).toHaveBeenCalledWith('Camera access was not started. Allow camera access and try again.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Camera is off');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captures only on request and sends the frame through the authenticated screen vision bridge', async () => {
    const { track, stream } = cameraStream();
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async () => {}) });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({ drawImage: vi.fn() })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: vi.fn((callback: BlobCallback) => callback(new Blob([
        Uint8Array.from([0xff, 0xd8, 0x00, 0xff, 0xd9]),
      ], { type: 'image/jpeg' }))),
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`${['Bear', 'er'].join('')} fixture-token`);
      return new Response(JSON.stringify({
        description: 'A red mug.',
        inputTokens: 12,
        outputTokens: 4,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness />);

    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    });
    expect(screen.getByRole('status').textContent).toBe('Camera is on');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
      audio: false,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' }));
    });
    expect(await screen.findByText('A red mug.')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe('/screen/frames');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      sessionId: '42',
      frame: Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString('base64'),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('Camera is off');
  });

  it('stops a camera stream that resolves after its owner unmounts', async () => {
    const { track, stream } = cameraStream();
    let resolveStream!: (value: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { resolveStream = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const view = render(<CameraHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
    view.unmount();

    await act(async () => { resolveStream(stream); });
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('turns off camera access automatically after five minutes', async () => {
    vi.useFakeTimers();
    const { track, stream } = cameraStream();
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    render(<CameraHarness />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe('Camera is on');
    act(() => { vi.advanceTimersByTime(5 * 60_000); });

    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('Camera is off');
  });
});
