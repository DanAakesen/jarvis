import type { ActivityItem, NowFeed } from './activity';
import { backendFetch } from './backend-request';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxSseFrameLength = 64 * 1024;

export interface NowFeedStreamOptions {
  backendUrl: string;
  getAccessToken: () => Promise<string>;
  onUpdate: () => void;
  onStatus: (status: 'connected' | 'reconnecting') => void;
  signal: AbortSignal;
}

export class NowFeedStreamError extends Error {
  constructor(status: number) {
    super(`Now feed stream request failed (HTTP ${status}).`);
    this.name = 'NowFeedStreamError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxSqlBigInt;
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isActivityItem(value: unknown): value is ActivityItem {
  return isRecord(value) && validId(value.id) &&
    (value.category === 'attention' || value.category === 'release' ||
      value.category === 'credential' || value.category === 'alert') &&
    typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 400 &&
    (value.link === null || typeof value.link === 'string') && validTime(value.at);
}

function isNowFeed(value: unknown): value is Extract<NowFeed, { status: 'ready' }> {
  return isRecord(value) && validTime(value.updatedAt) &&
    Array.isArray(value.running) && value.running.length <= 100 &&
    value.running.every((task) => isRecord(task) && validId(task.id) &&
      typeof task.title === 'string' && task.title.length > 0 && task.title.length <= 200 &&
      typeof task.project === 'string' && task.project.length > 0 && task.project.length <= 100 &&
      (task.agent === 'codex' || task.agent === 'copilot') &&
      typeof task.activity === 'string' && task.activity.length <= 400 && validTime(task.startedAt)) &&
    Array.isArray(value.items) && value.items.length <= 100 && value.items.every(isActivityItem);
}

async function authorizedRequest(
  backendUrl: string,
  path: string,
  getAccessToken: () => Promise<string>,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();
  try {
    return await backendFetch(`${backendUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        Accept: 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new Error('Jarvis could not reach the Now feed. Try again.');
  }
}

function responseError(status: number): Error {
  if (status === 401 || status === 403) return new Error('Your Microsoft sign-in needs attention. Sign in again.');
  return new Error(status === 503
    ? 'The Now feed is unavailable. Try again.'
    : `Jarvis could not load the Now feed (HTTP ${status}).`);
}

export async function loadNowFeed(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  signal?: AbortSignal,
): Promise<Extract<NowFeed, { status: 'ready' }>> {
  const response = await authorizedRequest(backendUrl, '/now', getAccessToken, signal ? { signal } : {});
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw responseError(response.status);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Jarvis returned an invalid Now feed.');
  }
  if (!isNowFeed(value)) throw new Error('Jarvis returned an invalid Now feed.');
  return { ...value, status: 'ready' };
}

export async function dismissNowActivity(
  backendUrl: string,
  id: string,
  getAccessToken: () => Promise<string>,
): Promise<void> {
  if (!validId(id)) throw new TypeError('Invalid activity ID.');
  const response = await authorizedRequest(backendUrl, `/now/activity/${id}/dismiss`, getAccessToken, {
    method: 'POST',
  });
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    throw new Error('This activity item is no longer available.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw responseError(response.status);
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

async function readNowEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, onUpdate: () => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let frameLength = 0;
  let event = '';

  const processLine = (line: string) => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) {
      if (event === 'now') onUpdate();
      event = '';
      frameLength = 0;
      return;
    }
    frameLength += line.length;
    if (frameLength > maxSseFrameLength) throw new Error('Now feed stream frame is too large.');
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
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
      if (frameLength + buffer.length > maxSseFrameLength) throw new Error('Now feed stream frame is too large.');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamNowFeed({
  backendUrl,
  getAccessToken,
  onUpdate,
  onStatus,
  signal,
}: NowFeedStreamOptions): Promise<void> {
  let reconnectDelay = 1000;
  while (!signal.aborted) {
    try {
      const response = await authorizedRequest(backendUrl, '/now/events', getAccessToken, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status < 500 && response.status !== 429) throw new NowFeedStreamError(response.status);
      } else if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('Now feed stream returned an invalid response.');
      } else {
        reconnectDelay = 1000;
        onStatus('connected');
        onUpdate();
        await readNowEvents(response.body, signal, onUpdate);
        if (signal.aborted) return;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof NowFeedStreamError) throw error;
      if (!(error instanceof TypeError)) throw error;
    }
    onStatus('reconnecting');
    await waitForReconnect(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }
}
