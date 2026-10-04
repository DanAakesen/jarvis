import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendFetch } from './backend-request';
import { DatabaseWakeStatus } from './DatabaseWakeStatus';
import { streamTaskEvents } from './task-events';

const base = 'https://api.example.com';
const token = vi.fn(async () => 'fixture-token');
const fetchMock = vi.fn<typeof fetch>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function status(waking: unknown) {
  return new Response(JSON.stringify({ waking }), { headers: { 'Content-Type': 'application/json' } });
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared database wake status', () => {
  it('never polls while idle or invents waking for a slow request', async () => {
    const data = deferred<Response>();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status') ? status(false) : data.promise);
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    const request = backendFetch(`${base}/settings`);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByText('Waking Jarvis…')).toBeNull();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await act(async () => { data.resolve(new Response('{}')); await request; });
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('uses authenticated backend status and remains waking across concurrent requests', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let backendWaking = true;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/database/status')) return status(backendWaking);
      return String(url).endsWith('/settings') ? first.promise : second.promise;
    });
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const one = backendFetch(`${base}/settings`);
    const two = backendFetch(`${base}/factory/tasks`);
    await flush();
    expect(screen.getByRole('status').textContent).toBe('Waking Jarvis…');
    expect(fetchMock).toHaveBeenCalledWith(`${base}/database/status`, expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} fixture-token`, Accept: 'application/json' },
      cache: 'no-store',
    }));
    await act(async () => { first.resolve(new Response('{}')); await one; });
    expect(screen.getByRole('status').textContent).toBe('Waking Jarvis…');
    backendWaking = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByRole('status')).toBeNull();
    backendWaking = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole('status').textContent).toBe('Waking Jarvis…');
    await act(async () => { second.resolve(new Response('{}', { status: 503 })); await two; });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('resets on network failure without replaying a write', async () => {
    const data = deferred<Response>();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status') ? status(true) : data.promise);
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const request = backendFetch(`${base}/settings`, { method: 'PATCH', body: '{}' });
    const failed = expect(request).rejects.toThrow('Offline');
    await flush();
    expect(screen.getByRole('status')).not.toBeNull();
    await act(async () => { data.reject(new Error('Offline')); await failed; });
    expect(screen.queryByRole('status')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/settings'))).toHaveLength(1);
  });

  it('cancels probes and ignores stale waking responses after cancellation and unmount', async () => {
    const probe = deferred<Response>();
    const data = deferred<Response>();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status') ? probe.promise : data.promise);
    const view = render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const controller = new AbortController();
    const request = backendFetch(`${base}/settings`, { signal: controller.signal });
    await flush();
    const probeSignal = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/database/status'))![1]!.signal!;
    await act(async () => { controller.abort(); });
    expect(probeSignal.aborted).toBe(true);
    view.unmount();
    await act(async () => {
      probe.resolve(status(true));
      data.resolve(new Response('{}'));
      await request;
    });
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling in the background and resumes only for remaining pending data', async () => {
    const data = deferred<Response>();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status') ? status(true) : data.promise);
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const request = backendFetch(`${base}/settings`);
    await flush();
    expect(screen.getByRole('status')).not.toBeNull();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(screen.queryByRole('status')).toBeNull();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(screen.getByRole('status')).not.toBeNull();
    await act(async () => { data.resolve(new Response('{}')); await request; });
    vi.restoreAllMocks();
  });

  it('allows a 90-second cold start, but aborts the data request after 120 seconds', async () => {
    const data = deferred<Response>();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status') ? status(true) : data.promise);
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const request = backendFetch(`${base}/settings`);
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(signal.aborted).toBe(false);
    expect(screen.getByRole('status')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => { data.resolve(new Response('{}')); await request; });
  });

  it.each([true, false])('tracks replay (with task data: %s) through heartbeats until ready, not the idle stream lifetime', async (hasTaskData) => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status')
      ? status(true)
      : new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const controller = new AbortController();
    const streaming = streamTaskEvents({
      backendUrl: base, taskId: '42', getAccessToken: token,
      onEvent: () => {}, signal: controller.signal,
    });
    await flush();
    expect(screen.getByRole('status')).not.toBeNull();
    await act(async () => { bodyController.enqueue(new TextEncoder().encode(': heartbeat\n\n')); });
    expect(screen.getByRole('status')).not.toBeNull();
    if (hasTaskData) {
      await act(async () => {
        bodyController.enqueue(new TextEncoder().encode('id: 1\nevent: task\ndata: {"id":"1"}\n\n'));
      });
    }
    expect(screen.getByRole('status')).not.toBeNull();
    const beforeNextPage = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(beforeNextPage);
    expect(screen.getByRole('status')).not.toBeNull();
    await act(async () => { bodyController.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n')); });
    expect(screen.queryByRole('status')).toBeNull();
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    await act(async () => { controller.abort(); bodyController.close(); await streaming; });
  });

  it.each([new Response('{}', { status: 503 }), status('true')])('does not infer waking from failed or malformed status', async (probe) => {
    const data = deferred<Response>();
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/database/status') ? probe : data.promise);
    render(<DatabaseWakeStatus backendUrl={base} getAccessToken={token} />);
    const request = backendFetch(`${base}/settings`);
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => { data.resolve(new Response('{}')); await request; });
  });
});
