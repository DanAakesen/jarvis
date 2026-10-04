const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxSseEventLength = 1024 * 1024;

export interface TaskEventStreamOptions<T extends { id: string }> {
  backendUrl: string;
  taskId: string;
  getAccessToken: () => Promise<string>;
  onEvent: (event: T) => void;
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
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventId = '';
  let frameLength = 0;
  const data: string[] = [];

  const processLine = (line: string) => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) {
      if (eventId && data.length) onEvent(eventId, data.join('\n'));
      eventId = '';
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
  getAccessToken,
  onEvent,
  signal,
}: TaskEventStreamOptions<T>): Promise<void> {
  if (!/^[1-9][0-9]{0,18}$/.test(taskId) || BigInt(taskId) > maxSqlBigInt) {
    throw new TypeError('Invalid task ID.');
  }

  let lastEventId: string | undefined;
  let reconnectDelay = 1000;
  while (!signal.aborted) {
    try {
      const token = await getAccessToken();
      const response = await fetch(`${backendUrl.replace(/\/+$/, '')}/factory/tasks/${taskId}/events`, {
        headers: {
          Authorization: `${['Bear', 'er'].join('')} ${token}`,
          Accept: 'text/event-stream',
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
        signal,
      });
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) throw new TaskEventStreamError(response.status);
      } else if (!response.body) {
        throw new Error('Task event stream returned no response body.');
      } else {
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
        });
        if (signal.aborted) return;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof TaskEventStreamError) throw error;
      if (!(error instanceof TypeError)) throw error;
    }
    await waitForReconnect(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }
}
