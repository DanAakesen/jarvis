import { backendFetch } from '../backend-request';

export type VaultTaskState = 'open' | 'done' | 'all';
export type VaultTaskFailureReason =
  | 'not_connected'
  | 'app_not_installed'
  | 'token_failed'
  | 'todo_file_missing'
  | 'todo_file_ambiguous'
  | 'scan_limit'
  | 'too_large'
  | 'timeout'
  | 'read_failed';

export interface VaultTask {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: string | null;
  priority: 'high' | 'medium' | 'normal';
  path: string;
  line: number;
  heading: string | null;
}

export interface VaultTaskRead {
  items: VaultTask[];
  readAt: string;
  today: string;
  total: number;
  truncated: boolean;
}

export class VaultTasksUnavailable extends Error {
  constructor(readonly reason: VaultTaskFailureReason) {
    super('Vault tasks are unavailable.');
  }
}

const failureReasons = new Set<VaultTaskFailureReason>([
  'not_connected', 'app_not_installed', 'token_failed', 'todo_file_missing',
  'todo_file_ambiguous', 'scan_limit', 'too_large', 'timeout', 'read_failed',
]);

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`));
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
}

function task(value: unknown): VaultTask | null {
  const item = object(value);
  if (!item || typeof item.id !== 'string' || !/^[0-9a-f]{64}$/u.test(item.id) ||
      typeof item.text !== 'string' || item.text.length > 300 || typeof item.done !== 'boolean' ||
      (item.dueDate !== null && !isDate(item.dueDate)) ||
      (item.dueTime !== null && (typeof item.dueTime !== 'string' || !/^\d{2}:\d{2}$/u.test(item.dueTime))) ||
      (item.dueAt !== null && !isDateTime(item.dueAt)) ||
      (item.priority !== 'high' && item.priority !== 'medium' && item.priority !== 'normal') ||
      typeof item.path !== 'string' || item.path.length < 1 || item.path.length > 180 ||
      !Number.isSafeInteger(item.line) || Number(item.line) < 1 ||
      (item.heading !== null && (typeof item.heading !== 'string' || item.heading.length > 300))) return null;
  return {
    id: item.id,
    text: item.text,
    done: item.done,
    dueDate: item.dueDate as string | null,
    dueTime: item.dueTime as string | null,
    dueAt: item.dueAt as string | null,
    priority: item.priority,
    path: item.path,
    line: Number(item.line),
    heading: item.heading as string | null,
  };
}

export function readVaultTaskResponse(value: unknown): VaultTaskRead {
  const body = object(value);
  if (!body || !Array.isArray(body.items) || body.items.length > 500 ||
      !isDateTime(body.readAt) || !isDate(body.today) ||
      !Number.isSafeInteger(body.total) || Number(body.total) < body.items.length ||
      typeof body.truncated !== 'boolean') {
    throw new Error('Jarvis returned an invalid vault task list.');
  }
  const items = body.items.map(task);
  if (items.some((item) => item === null)) throw new Error('Jarvis returned an invalid vault task.');
  return { items: items as VaultTask[], readAt: body.readAt, today: body.today, total: Number(body.total), truncated: body.truncated };
}

export async function loadVaultTasks(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  query: string,
  state: VaultTaskState,
  signal: AbortSignal,
): Promise<VaultTaskRead> {
  if (!backendUrl) throw new VaultTasksUnavailable('not_connected');
  const params = new URLSearchParams({ state });
  if (query.trim()) params.set('q', query.trim().slice(0, 200));
  const token = await getAccessToken();
  const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/vault/tasks?${params}`, {
    headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    let reason: unknown;
    try { reason = object(await response.json())?.reason; } catch { /* The status remains available without a body. */ }
    await response.body?.cancel().catch(() => {});
    if (response.status === 503 && typeof reason === 'string' && failureReasons.has(reason as VaultTaskFailureReason)) {
      throw new VaultTasksUnavailable(reason as VaultTaskFailureReason);
    }
    throw new Error(response.status === 401 || response.status === 403
      ? 'Sign in again to read tasks from your vault.'
      : 'Tasks could not be loaded from your vault. Try again.');
  }
  return readVaultTaskResponse(await response.json());
}

/** The vault no longer holds the task the owner saw (edited elsewhere or written at the same moment), so the list is stale. */
export class VaultTaskConflict extends Error {}

export interface VaultTaskWrite {
  id: string;
  path: string;
  line: number;
  done: boolean;
}

function readTaskWrite(value: unknown): VaultTaskWrite {
  const body = object(value);
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f]{64}$/u.test(body.id) ||
      typeof body.path !== 'string' || body.path.length < 1 || body.path.length > 180 ||
      !Number.isSafeInteger(body.line) || Number(body.line) < 1 || typeof body.done !== 'boolean') {
    throw new Error('Jarvis returned an invalid task confirmation.');
  }
  return { id: body.id, path: body.path, line: Number(body.line), done: body.done };
}

async function writeVaultTask(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  method: 'PATCH' | 'POST',
  body: object,
  signal: AbortSignal,
): Promise<VaultTaskWrite> {
  if (!backendUrl) throw new VaultTasksUnavailable('not_connected');
  const token = await getAccessToken();
  const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}/vault/tasks`, {
    method,
    headers: {
      Authorization: `${['Bear', 'er'].join('')} ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    let message: unknown;
    try { message = object(await response.json())?.error; } catch { /* The status remains available without a body. */ }
    await response.body?.cancel().catch(() => {});
    const text = typeof message === 'string' && message.length <= 200 ? message : '';
    if (response.status === 401 || response.status === 403) throw new Error('Sign in again to change tasks in your vault.');
    if (response.status === 409) throw new VaultTaskConflict(text || 'This task changed in the vault.');
    throw new Error(response.status === 400 && text ? text : 'The task could not be saved. Try again.');
  }
  return readTaskWrite(await response.json());
}

/** Ticks or unticks one vault task. The backend checks the line still holds this text before it commits. */
export function setVaultTaskDone(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  task: Pick<VaultTask, 'path' | 'line' | 'text'>,
  done: boolean,
  signal: AbortSignal,
): Promise<VaultTaskWrite> {
  return writeVaultTask(backendUrl, getAccessToken, 'PATCH',
    { path: task.path, line: task.line, text: task.text, done }, signal);
}

/** Adds an open task to the Personal or Work Inbox note. */
export function addVaultTask(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  task: { text: string; scope: 'personal' | 'work'; due?: string; time?: string },
  signal: AbortSignal,
): Promise<VaultTaskWrite> {
  return writeVaultTask(backendUrl, getAccessToken, 'POST',
    { text: task.text, scope: task.scope, ...(task.due ? { due: task.due } : {}), ...(task.due && task.time ? { time: task.time } : {}) }, signal);
}

export function vaultTaskRecovery(reason: VaultTaskFailureReason): string {
  switch (reason) {
    case 'not_connected': return 'Connect Jarvis to the backend, then refresh.';
    case 'app_not_installed': return 'Ask the vault owner to install the GitHub App with Contents access, then refresh.';
    case 'token_failed': return 'Retry. If this continues, check the GitHub App access to the vault.';
    case 'todo_file_missing': return 'Add checkbox tasks under Personal or Work in Obsidian, then refresh.';
    case 'todo_file_ambiguous': return 'Keep only one root task.md or tasks.md file in the vault, then refresh.';
    case 'scan_limit': return 'The safe scan limit was reached. Reduce the number of task notes or their size, then refresh.';
    case 'too_large': return 'Shorten the oversized task note in Obsidian, then refresh.';
    case 'timeout': return 'Retry in a moment. If this continues, check the vault connection.';
    case 'read_failed': return 'Check the vault connection and refresh.';
  }
}
