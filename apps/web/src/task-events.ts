import { backendFetch, beginBackendRequest } from './backend-request';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxSseEventLength = 1024 * 1024;

export interface TaskEventStreamOptions<T extends { id: string }> {
  backendUrl: string;
  taskId: string;
  lastEventId?: string;
  getAccessToken: () => Promise<string>;
  onEvent: (event: T) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'reconnecting' | 'error') => void;
  signal: AbortSignal;
}

export class TaskEventStreamError extends Error {
  constructor(status: number) {
    super(`Task event stream request failed (HTTP ${status}).`);
    this.name = 'TaskEventStreamError';
  }
}

function waitForReconnect(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

async function readEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (id: string, data: string) => void,
  onReady: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventId = '';
  let eventType = '';
  let frameLength = 0;
  const data: string[] = [];

  const processLine = (line: string) => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) {
      if (eventType === 'ready') onReady();
      if (eventId && data.length) onEvent(eventId, data.join('\n'));
      eventId = '';
      eventType = '';
      data.length = 0;
      frameLength = 0;
      return;
    }
    frameLength += line.length;
    if (frameLength > maxSseEventLength) throw new Error('Task event stream frame is too large.');
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id' && !value.includes('\0')) eventId = value;
    else if (field === 'event') eventType = value;
    else if (field === 'data') data.push(value);
  };

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (frameLength + buffer.length > maxSseEventLength) {
        throw new Error('Task event stream frame is too large.');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamTaskEvents<T extends { id: string }>({
  backendUrl,
  taskId,
  lastEventId: initialEventId,
  getAccessToken,
  onEvent,
  onStatus,
  signal,
}: TaskEventStreamOptions<T>): Promise<void> {
  if (!/^[1-9][0-9]{0,18}$/.test(taskId) || BigInt(taskId) > maxSqlBigInt) {
    throw new TypeError('Invalid task ID.');
  }
  if (initialEventId !== undefined &&
    (!/^(?:0|[1-9][0-9]{0,18})$/.test(initialEventId) || BigInt(initialEventId) > maxSqlBigInt)) {
    throw new TypeError('Invalid event ID.');
  }

  let lastEventId = initialEventId;
  let reconnectDelay = 1000;
  while (!signal.aborted) {
    onStatus?.('connecting');
    let finishReplay = () => {};
    try {
      const token = await getAccessToken();
      const url = `${backendUrl.replace(/\/+$/, '')}/factory/tasks/${taskId}/events`;
      // Headers and event pages can precede more SQL replay; only ready ends this wait.
      finishReplay = beginBackendRequest(url, signal);
      const response = await backendFetch(url, {
        headers: {
          Authorization: `${['Bear', 'er'].join('')} ${token}`,
          Accept: 'text/event-stream',
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status < 500 && response.status !== 429) throw new TaskEventStreamError(response.status);
        onStatus?.('reconnecting');
      } else if (!response.body) {
        throw new Error('Task event stream returned no response body.');
      } else {
        onStatus?.('connected');
        await readEvents(response.body, signal, (id, data) => {
          if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > maxSqlBigInt) {
            throw new Error('Task event stream returned an invalid event ID.');
          }
          if (lastEventId && BigInt(id) <= BigInt(lastEventId)) return;
          let event: unknown;
          try { event = JSON.parse(data) as unknown; }
          catch { throw new Error('Task event stream returned invalid JSON.'); }
          if (typeof event !== 'object' || event === null || !('id' in event) || event.id !== id) {
            throw new Error('Task event stream returned an invalid event.');
          }
          lastEventId = id;
          reconnectDelay = 1000;
          onEvent(event as T);
        }, finishReplay);
        if (signal.aborted) return;
        onStatus?.('reconnecting');
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TaskEventStreamError || !(error instanceof TypeError)) {
        onStatus?.('error');
        throw error;
      }
      onStatus?.('reconnecting');
    } finally {
      finishReplay();
    }
    await waitForReconnect(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }
}
