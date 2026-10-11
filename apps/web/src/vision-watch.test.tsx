import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisionWatch, WATCH_INTERVAL_MS } from './vision-watch';

const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://api.example.com/' };
const getToken = async () => 'fixture-token';

function Harness({ sharing, sessionId, captureFrame, onStopped }: {
  sharing: boolean;
  sessionId: string | null;
  captureFrame: () => Promise<string>;
  onStopped?: (message: string) => void;
}) {
  const watch = useVisionWatch(config, getToken, { sharing, captureFrame }, 'screen', sessionId, onStopped);
  return (
    <section>
      <button type="button" onClick={watch.start}>Start</button>
      <button type="button" onClick={watch.stop}>Stop</button>
      <p role="status">{watch.watching ? 'watching' : 'idle'}</p>
      <p data-testid="budget">{watch.budget ? `${watch.budget.usedUsd}/${watch.budget.limitUsd}` : 'none'}</p>
    </section>
  );
}

function ok(usedUsd: number) {
  return new Response(JSON.stringify({ summary: 's', speak: null, budget: { usedUsd, limitUsd: 1 } }), { status: 200 });
}

async function click(name: string) {
  await act(async () => { screen.getByRole('button', { name }).click(); });
}

async function tick(ms = WATCH_INTERVAL_MS) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useVisionWatch', () => {
  it('posts changed frames to /vision/watch, skips unchanged ones and reports the budget', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ok(0.25));
    vi.stubGlobal('fetch', fetchMock);
    const frames = ['AAAA', 'AAAA', 'BBBB'];
    const captureFrame = vi.fn(async () => frames.shift() ?? 'BBBB');
    render(<Harness sharing sessionId="42" captureFrame={captureFrame} />);
    expect(screen.getByRole('status').textContent).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();

    await click('Start');
    expect(screen.getByRole('status').textContent).toBe('watching');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/vision/watch');
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: '42', source: 'screen', frame: 'AAAA' });
    expect(screen.getByTestId('budget').textContent).toBe('0.25/1');

    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)).frame).toBe('BBBB');
  });

  it('stops sending when Dan stops watching', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ok(0));
    vi.stubGlobal('fetch', fetchMock);
    let n = 0;
    render(<Harness sharing sessionId="42" captureFrame={async () => `F${n++}`} />);
    await click('Start');
    await click('Stop');
    expect(screen.getByRole('status').textContent).toBe('idle');
    await tick(WATCH_INTERVAL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends watching when the share ends or there is no conversation session', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ok(0)));
    const captureFrame = async () => 'AAAA';
    const { rerender } = render(<Harness sharing sessionId={null} captureFrame={captureFrame} />);
    await click('Start');
    expect(screen.getByRole('status').textContent).toBe('idle');
    rerender(<Harness sharing sessionId="42" captureFrame={captureFrame} />);
    await click('Start');
    expect(screen.getByRole('status').textContent).toBe('watching');
    rerender(<Harness sharing={false} sessionId="42" captureFrame={captureFrame} />);
    expect(screen.getByRole('status').textContent).toBe('idle');
    rerender(<Harness sharing sessionId="42" captureFrame={captureFrame} />);
    expect(screen.getByRole('status').textContent).toBe('idle');
  });

  it('stops with the backend message when the daily budget is exhausted', async () => {
    vi.useFakeTimers();
    const message = 'The daily vision budget is exhausted. Watching resumes on the next UTC day.';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: message }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const onStopped = vi.fn();
    render(<Harness sharing sessionId="42" captureFrame={async () => 'AAAA'} onStopped={onStopped} />);
    await click('Start');
    expect(onStopped).toHaveBeenCalledWith(message);
    expect(screen.getByRole('status').textContent).toBe('idle');
  });

  it('keeps watching through a rate-limit answer but gives up after repeated failures', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Please wait 2.5 seconds before watching another frame from this source.' }), { status: 429 }))
      .mockImplementation(async () => new Response(JSON.stringify({ error: 'Vision watching is unavailable.' }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const onStopped = vi.fn();
    render(<Harness sharing sessionId="42" captureFrame={async () => 'AAAA'} onStopped={onStopped} />);
    await click('Start');
    expect(screen.getByRole('status').textContent).toBe('watching');
    await tick(); await tick(); await tick();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onStopped).toHaveBeenCalledWith('Watching stopped: Vision watching is unavailable.');
    expect(screen.getByRole('status').textContent).toBe('idle');
  });

  it('aborts the in-flight request on unmount', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    }));
    const { unmount } = render(<Harness sharing sessionId="42" captureFrame={async () => 'AAAA'} />);
    await click('Start');
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
