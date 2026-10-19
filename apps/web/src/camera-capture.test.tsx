import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCamera, VisionInspectionError, type VisionContext } from './screen-sharing';
import type { VisualTurnContext } from './visual-context';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com' };
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalCanvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
const originalToBlob = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob');
const originalVideoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth');
const originalVideoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight');
const originalPlay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'play');
const originalPause = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'pause');
const originalReadyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');

function cameraStream(facing: 'user' | 'environment' | null = 'user') {
  const track = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn(),
    getSettings: () => facing ? { facingMode: facing } : {} } as unknown as MediaStreamTrack;
  return {
    track,
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
  };
}

function CameraHarness({ onError, token = async () => 'fixture-token', question, onResult, onFailure,
  conversation = false, sessionId = '42', signal, turnId }: {
  onError?: (message: string) => void;
  token?: () => Promise<string>;
  question?: string;
  onResult?: (context: VisionContext | VisualTurnContext) => void;
  onFailure?: (reason: unknown) => void;
  conversation?: boolean;
  sessionId?: string;
  signal?: AbortSignal;
  turnId?: string;
} = {}) {
  const camera = useCamera(config, token, conversation);
  const [description, setDescription] = useState('');
  const [watchFrame, setWatchFrame] = useState('');
  return (
    <section>
      <button type="button" onClick={() => void camera.start(onError)} disabled={camera.starting}>
        {camera.sharing ? 'Turn camera off' : 'Turn camera on'}
      </button>
      <button type="button" onClick={() => void (conversation && camera.inspectTurn
        ? camera.inspectTurn(sessionId, question ?? 'What next?', signal, turnId)
        : camera.inspect(sessionId, 'inline', signal, question, turnId)).then((context) => {
        setDescription(context.description ?? '');
        onResult?.(context);
      }, onFailure ?? (() => {}))}
        disabled={!camera.sharing || camera.inspecting}>
        Request camera frame
      </button>
      <button type="button" onClick={() => void camera.captureFrame?.().then(setWatchFrame, (reason: Error) => setWatchFrame(reason.message))}>
        Capture watch frame
      </button>
      {watchFrame && <p data-testid="watch-frame">{watchFrame}</p>}
      <button type="button" onClick={camera.stop}>Stop camera</button>
      <button type="button" onClick={() => camera.recordActivity?.()}>User turn</button>
      <button type="button" onClick={() => void camera.switchCamera?.()}>Switch camera</button>
      <button type="button" onClick={() => void camera.selectFacing?.('environment', onError)}>Face rear</button>
      <button type="button" onClick={() => void camera.selectFacing?.('user', onError)}>Face front</button>
      <p role="status">{camera.sharing ? 'Camera is on' : 'Camera is off'}</p>
      <span aria-label="Camera direction">{camera.facing ?? 'unknown'}</span>
      {description && <p>{description}</p>}
      {camera.error && <p role="alert">{camera.error}</p>}
      {camera.observationNotice && <p data-testid="observation-notice">{camera.observationNotice}</p>}
    </section>
  );
}

function readyVideoCapture() {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async () => {}) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 2 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ({ drawImage: vi.fn() }) });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true,
    value: (callback: BlobCallback) => callback(new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })) });
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
    [HTMLMediaElement.prototype, 'readyState', originalReadyState],
  ] as const) {
    if (descriptor) Object.defineProperty(prototype, property, descriptor);
    else Reflect.deleteProperty(prototype, property);
  }
});

describe('camera frame capture', () => {
  it('uploads a frame handle without captioning and never replays its single-use reference', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T21:20:00Z'));
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const { question, turnId } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        frameId: 'single_use_handle', capturedAt: new Date().toISOString(), question, turnId,
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = vi.fn();
    const failure = vi.fn();
    render(<CameraHarness conversation question="What is this?" turnId="turn_1" onResult={result} onFailure={failure} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    const request = async () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    await request();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      sessionId: '42', mode: 'handle', question: 'What is this?', turnId: 'turn_1',
    });
    expect(result).toHaveBeenCalledWith({
      source: 'camera', frameId: 'single_use_handle', capturedAt: '2026-10-12T21:20:00.000Z',
      question: 'What is this?', turnId: 'turn_1',
    });
    act(() => vi.advanceTimersByTime(1_000));
    await request();
    expect(result).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'frame_rate_limited' }));
    expect(screen.getByTestId('observation-notice').textContent).toContain('No previous camera observation');
  });

  it('accepts the deployed generic null-question response without inventing a question', async () => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      description: 'Fixture scene.', capturedAt: '2026-10-11T19:23:33.000Z', question: null,
    }))));
    const onResult = vi.fn();
    render(<CameraHarness onResult={onResult} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(onResult).toHaveBeenCalledWith({ description: 'Fixture scene.', capturedAt: '2026-10-11T19:23:33.000Z' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([500, 501])('uses the deployed Unicode code-point question limit at %i characters', async (characters) => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const question = String.fromCodePoint(0x1f44b).repeat(characters);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      description: 'Fixture scene.', capturedAt: '2026-10-11T19:23:33.000Z', question,
    })));
    vi.stubGlobal('fetch', fetchMock);
    const onResult = vi.fn();
    render(<CameraHarness question={question} onResult={onResult} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(fetchMock).toHaveBeenCalledTimes(characters === 500 ? 1 : 0);
    expect(onResult).toHaveBeenCalledTimes(characters === 500 ? 1 : 0);
    if (characters === 501) expect(screen.getByRole('alert').textContent).toContain('at most 500');
  });

  it.each(['item_1', 'different', undefined])('requires the server to echo the correlated capture item: %j', async (echo) => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      description: 'Fixture scene.', capturedAt: '2026-10-11T19:23:33.000Z', question: 'And now?', turnId: echo,
    })));
    vi.stubGlobal('fetch', fetchMock);
    const result = vi.fn();
    render(<CameraHarness question="And now?" turnId="item_1" onResult={result} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).turnId).toBe('item_1');
    expect(result).toHaveBeenCalledTimes(echo === 'item_1' ? 1 : 0);
    if (echo !== 'item_1') expect(screen.getByRole('alert').textContent).toContain('different visual turn');
  });

  it('captures each fresh turn and reuses only age-labelled captions inside the pacing window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T19:23:33.000Z'));
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const { question } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        description: 'Three fingers.', capturedAt: new Date().toISOString(), question, frameId: 'single_use_fixture',
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = vi.fn();
    const view = render(<CameraHarness conversation question="Count fingers" onResult={result} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    const request = async () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    await request();
    expect(result.mock.calls[0]?.[0].frameId).toBe('single_use_fixture');
    act(() => vi.advanceTimersByTime(1_000));
    view.rerender(<CameraHarness conversation question="And now?" onResult={result} />);
    await request();
    expect(fetchMock).toHaveBeenCalledOnce();
    const cached = result.mock.calls[1]?.[0];
    expect(cached.frameId).toBeUndefined();
    expect(cached.question).toBe('Count fingers');
    expect(cached.description).toContain('(1 second ago)');
    expect(cached.description).toContain('cannot confirm changes');
    expect(screen.getByTestId('observation-notice').textContent).toContain('rate-limited');
    expect(screen.getByTestId('observation-notice').textContent).toContain('from 1 second ago.');
    act(() => vi.advanceTimersByTime(1_000));
    await request();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.mock.calls[2]?.[0].description).toContain('(2 seconds ago)');
    expect(screen.getByTestId('observation-notice').textContent).toContain('from 2 seconds ago.');
    act(() => vi.advanceTimersByTime(3_000));
    await request();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.mock.calls[3]?.[0].question).toBe('And now?');
    expect(screen.queryByTestId('observation-notice')).toBeNull();
  });

  it.each(['frame_rate_limited', 'daily_limit'] as const)('honours backend %s without replaying an image handle', async (code) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T19:23:33.000Z'));
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        description: 'Three fingers.', question: 'Count fingers', capturedAt: new Date().toISOString(), frameId: 'fixture_id',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Limit reached', code, retryAfterMs: 6_000 }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = vi.fn();
    const failure = vi.fn();
    const view = render(<CameraHarness conversation question="Count fingers" onResult={result} onFailure={failure} />);
    const request = async () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await request();
    act(() => vi.advanceTimersByTime(4_000));
    await request();
    expect(result.mock.calls[1]?.[0].frameId).toBeUndefined();
    act(() => vi.advanceTimersByTime(3_500));
    await request();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
    view.rerender(<CameraHarness conversation sessionId="43" question="New session" onResult={result} onFailure={failure} />);
    await request();
    expect(failure.mock.calls[0]?.[0]).toMatchObject({ status: 429, code });
    expect(result).toHaveBeenCalledTimes(3);
    if (code === 'daily_limit') {
      act(() => fireEvent.click(screen.getByRole('button', { name: 'Stop camera' })));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
      await request();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('observation-notice').textContent).toContain('No previous camera observation');
    }
  });

  it('keeps a capture budget denial typed without substituting a cached caption or handle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T19:23:33.000Z'));
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        description: 'Three fingers.', question: 'Count fingers', capturedAt: new Date().toISOString(), frameId: 'fixture_id',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Daily vision budget reached.', code: 'budget_exhausted', turnId: 'budget-item',
      }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = vi.fn();
    const failure = vi.fn();
    const view = render(<CameraHarness conversation question="Count fingers" onResult={result} onFailure={failure} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    act(() => vi.advanceTimersByTime(4_000));
    view.rerender(<CameraHarness conversation question="And now?" turnId="budget-item" onResult={result} onFailure={failure} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(failure.mock.calls[0]?.[0]).toBeInstanceOf(VisionInspectionError);
    expect(failure.mock.calls[0]?.[0]).toMatchObject({ status: 429, code: 'budget_exhausted' });
    expect(result).toHaveBeenCalledOnce();
    expect(screen.getByTestId('observation-notice').textContent).toBe('Daily vision budget reached.');
  });

  it('does not mask an inspection failure with a cached observation or truncate an oversized question', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T19:23:33.000Z'));
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      description: 'Three fingers.', question: 'Count fingers', capturedAt: new Date().toISOString(), frameId: 'fixture_handle',
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Inspection service failed.' }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = vi.fn();
    const failure = vi.fn();
    const view = render(<CameraHarness conversation question="Count fingers" onResult={result} onFailure={failure} />);
    const request = async () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await request();
    act(() => vi.advanceTimersByTime(4_000));
    await request();
    expect(result).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0]?.[0].message).toBe('Inspection service failed.');
    view.rerender(<CameraHarness conversation question={'x'.repeat(501)} onResult={result} onFailure={failure} />);
    await request();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failure.mock.calls[1]?.[0].message).toContain('at most 500');
  });

  it.each([' How many fingers am I holding up? ', 'x'.repeat(500)])(
    'sends the bounded question and preserves server capture time and the echoed question', async (requestedQuestion) => {
      readyVideoCapture();
      const { stream } = cameraStream();
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
      const question = requestedQuestion.trim();
      const result = { description: 'Three fingers.', capturedAt: '2026-10-11T19:23:33.000Z', question };
      const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(result)));
      vi.stubGlobal('fetch', fetchMock);
      const onResult = vi.fn();
      render(<CameraHarness question={requestedQuestion} onResult={onResult} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).question).toBe(question);
      expect(onResult).toHaveBeenCalledWith(result);
    },
  );

  it.each([
    { capturedAt: '2026-10-11T19:23:33.000Z', question: 'Another question?' },
    { capturedAt: '2026-02-31T19:23:33.000Z', question: 'Count fingers' },
    { capturedAt: 'invalid', question: 'Count fingers' },
    { capturedAt: null, question: 'Count fingers' },
    { capturedAt: '2026-10-11T19:23:33.000Z' },
    { capturedAt: '2026-10-11T19:23:33.000Z', question: null },
    {},
  ])('refuses mismatched or missing question provenance instead of claiming a fresh answer: %j', async (provenance) => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ description: 'Generic scene.', ...provenance }))));
    const onResult = vi.fn();
    render(<CameraHarness question="Count fingers" onResult={onResult} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('preserves an optional opaque image reference without decoding or storing image bytes', async () => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const result = {
      description: 'Three fingers.', capturedAt: '2026-10-11T19:23:33.000Z',
      question: 'Count fingers', frameId: 'opaque_fixture-reference_123',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(result))));
    const onResult = vi.fn();
    render(<CameraHarness question="Count fingers" onResult={onResult} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(onResult).toHaveBeenCalledWith(result);
  });

  it.each([null, 42, '', '   ', 'unsafe/reference', 'x'.repeat(129)])('rejects an invalid optional image reference: %j', async (frameId) => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ description: 'Scene.', frameId }))));
    const onResult = vi.fn();
    render(<CameraHarness onResult={onResult} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(screen.getByRole('alert').textContent).toBe('Jarvis returned an invalid image reference.');
    expect(onResult).not.toHaveBeenCalled();
  });

  it.each(['frame_rate_limited', 'daily_limit', 'budget_exhausted'] as const)('preserves typed %s inspection refusals', async (code) => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Fixture frame limit.', code, retryAfterMs: 3_000,
    }), { status: 429 })));
    const onFailure = vi.fn();
    render(<CameraHarness onFailure={onFailure} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(onFailure.mock.calls[0]?.[0]).toBeInstanceOf(VisionInspectionError);
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ status: 429, code, retryAfterMs: 3_000 });
    expect(screen.getByRole('alert').textContent).toBe('Fixture frame limit.');
  });

  it('rejects an oversized question before capturing or uploading rather than truncating it', async () => {
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness question={'x'.repeat(501)} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(screen.getByRole('alert').textContent).toContain('at most 500 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 429, body: { error: 'Legacy limit.' } },
    { status: 429, body: { error: 'Unknown limit.', code: 'unknown' } },
    { status: 503, body: { error: 'Service failed.', code: 'frame_rate_limited' } },
  ])('does not guess a typed limit from a legacy or unrelated failure: %j', async ({ status, body }) => {
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
    const onFailure = vi.fn();
    render(<CameraHarness onFailure={onFailure} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ message: body.error, status, code: undefined, retryAfterMs: undefined });
  });

  it('faces the camera a requested way on the existing capture, restarting only when the facing changes', async () => {
    const getUserMedia = vi.fn().mockResolvedValueOnce(cameraStream('environment').stream)
      .mockResolvedValueOnce(cameraStream('user').stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    render(<CameraHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Face rear' }));
    await screen.findByText('Camera is on');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      video: expect.objectContaining({ facingMode: { exact: 'environment' } }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Face rear' }));
    await act(async () => { await Promise.resolve(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Face front' }));
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      video: expect.objectContaining({ facingMode: { exact: 'user' } }),
    }));
    await screen.findByText('Camera is on');
  });

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
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 2 });
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

  it('captures a watch frame locally only while the camera is on, without calling the backend', async () => {
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 2 });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async () => {}) });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true, value: vi.fn(() => ({ drawImage: vi.fn() })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: vi.fn((callback: BlobCallback) => callback(new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }))),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Capture watch frame' })); });
    expect(screen.getByTestId('watch-frame').textContent).toBe('The camera is not being shared.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Capture watch frame' })); });
    expect(screen.getByTestId('watch-frame').textContent).toBe(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'));
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('reports the actual facing rather than the ideal request, and keeps unknown direction honest', async () => {
    const getUserMedia = vi.fn().mockResolvedValueOnce(cameraStream('environment').stream)
      .mockResolvedValueOnce(cameraStream(null).stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    render(<CameraHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    expect(screen.getByLabelText('Camera direction').textContent).toBe('environment');
    fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    expect(screen.getByLabelText('Camera direction').textContent).toBe('unknown');
  });

  it('does not claim a rear switch succeeded when the browser returns the front camera', async () => {
    const front = cameraStream('user');
    const fallback = cameraStream('user');
    const getUserMedia = vi.fn().mockResolvedValueOnce(front.stream).mockResolvedValueOnce(fallback.stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    render(<CameraHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch camera' })); });
    expect(screen.getByRole('alert').textContent).toBe('The back camera is not available. Try the other camera.');
    expect(screen.getByRole('status').textContent).toBe('Camera is off');
    expect(front.track.stop).toHaveBeenCalledOnce();
    expect(fallback.track.stop).toHaveBeenCalledOnce();
  });

  it('waits for current video data before encoding and posting a JPEG', async () => {
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const videos: HTMLVideoElement[] = [];
    let ready = false;
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true,
      value: function (this: HTMLVideoElement) { videos.push(this); return Promise.resolve(); } });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => ready ? 2 : 1 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => ready ? 640 : 0 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => ready ? 480 : 0 });
    const drawImage = vi.fn();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ({ drawImage }) });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true,
      value: (callback: BlobCallback) => callback(new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })) });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ description: 'Fixture image.' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(drawImage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { ready = true; videos[0]?.dispatchEvent(new Event('loadeddata')); });
    expect(await screen.findByText('Fixture image.')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(videos[0]?.srcObject).toBeNull();
  });

  it('bounds a stalled video play and releases the temporary video without posting a frame', async () => {
    vi.useFakeTimers();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    const videos: HTMLVideoElement[] = [];
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true,
      value: function (this: HTMLVideoElement) { videos.push(this); return new Promise<void>(() => {}); } });
    const pause = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('alert').textContent).toContain('could not inspect the camera frame');
    expect(screen.getByRole('button', { name: 'Request camera frame' }).hasAttribute('disabled')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledOnce();
    expect(videos[0]?.srcObject).toBeNull();
  });

  it('bounds token acquisition and never uploads after a late token arrives', async () => {
    vi.useFakeTimers();
    readyVideoCapture();
    const { stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    let resolveToken!: (value: string) => void;
    const token = vi.fn(() => new Promise<string>(resolve => { resolveToken = resolve; }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness token={token} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    expect(token).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('alert').textContent).toContain('could not inspect the camera frame');
    await act(async () => { resolveToken('late-token'); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Request camera frame' }).hasAttribute('disabled')).toBe(false);
  });

  it('cancels an inspection on camera off before waiting for the video to become ready', async () => {
    readyVideoCapture();
    const { stream, track } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 1 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request camera frame' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop camera' })); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('Camera is off');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('turns off camera access after ten idle minutes and reports why', async () => {
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
    act(() => { vi.advanceTimersByTime(10 * 60_000 - 1); });
    expect(track.stop).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });

    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('Camera is off');
    expect(screen.getByRole('alert').textContent).toContain('ten minutes without a user turn');
  });

  it('keeps a long conversation live, resets on each user turn and cancels the idle timer on stop', async () => {
    vi.useFakeTimers();
    const { track, stream } = cameraStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(async () => stream),
    } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CameraHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' })); });
    for (let turn = 0; turn < 3; turn += 1) {
      act(() => { vi.advanceTimersByTime(9 * 60_000); });
      fireEvent.click(screen.getByRole('button', { name: 'User turn' }));
    }
    expect(track.stop).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Camera is on');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'User turn' }));
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
