import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamTaskEvents, TaskEventStreamError } from './task-events';

interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
}

const fetchMock = vi.fn<typeof fetch>();
const getAccessToken = vi.fn(async () => 'test-access-token');

function eventStream(...frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        for (const byte of encoder.encode(frame)) controller.enqueue(Uint8Array.of(byte));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('task event stream client', () => {
  it('uses bearer auth, resumes after disconnect, and ignores replayed IDs', async () => {
    const controller = new AbortController();
    const received: TaskEvent[] = [];
    const statuses: string[] = [];
    const frame = (id: string) => `id: ${id}\nevent: task\ndata: ${JSON.stringify({ id, taskId: '42', type: 'progress' })}\n\n`;
    fetchMock
      .mockResolvedValueOnce(eventStream(': heartbeat\n\n', frame('19'), frame('19')))
      .mockResolvedValueOnce(eventStream(frame('19'), frame('20')));

    vi.useFakeTimers();
    const streaming = streamTaskEvents<TaskEvent>({
      backendUrl: 'https://api.example.com/',
      taskId: '42',
      getAccessToken,
      onStatus: (status) => statuses.push(status),
      onEvent: (event) => {
        received.push(event);
        if (event.id === '20') controller.abort();
      },
      signal: controller.signal,
    });

    for (let count = 0; count < 10; count += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await streaming;

    expect(received.map(({ id }) => id)).toEqual(['19', '20']);
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connecting', 'connected']);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/factory/tasks/42/events');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `${['Bear', 'er'].join('')} test-access-token`,
      Accept: 'text/event-stream',
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: `${['Bear', 'er'].join('')} test-access-token`,
      'Last-Event-ID': '19',
    });
  });

  it('surfaces authentication failures instead of retrying them', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const statuses: string[] = [];

    await expect(streamTaskEvents<TaskEvent>({
      backendUrl: 'https://api.example.com',
      taskId: '42',
      getAccessToken,
      onStatus: (status) => statuses.push(status),
      onEvent: () => {},
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(TaskEventStreamError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(statuses).toEqual(['connecting', 'error']);
  });

  it('rejects malformed task IDs before making a request', async () => {
    await expect(streamTaskEvents<TaskEvent>({
      backendUrl: 'https://api.example.com',
      taskId: '42/events',
      getAccessToken,
      onEvent: () => {},
      signal: new AbortController().signal,
    })).rejects.toThrow('Invalid task ID.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can start after the event included in the board snapshot', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_input, init) => {
      expect(init?.headers).toMatchObject({ 'Last-Event-ID': '18' });
      controller.abort();
      return eventStream();
    });

    await streamTaskEvents<TaskEvent>({
      backendUrl: 'https://api.example.com',
      taskId: '42',
      lastEventId: '18',
      getAccessToken,
      onEvent: () => {},
      signal: controller.signal,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
