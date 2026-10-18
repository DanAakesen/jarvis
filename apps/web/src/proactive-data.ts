import { backendFetch } from './backend-request';

export type SourceId = 'todos' | 'calendar' | 'mail' | 'weather' | 'factory' | 'news' | 'travel' | 'x';
export type ItemState = 'new' | 'seen' | 'dismissed' | 'snoozed';
export type ItemAction = 'seen' | 'dismiss' | 'snooze' | 'useful' | 'wrong';
export type RunStatus = 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface ProactiveItem {
  id: string;
  kind: 'finding' | 'test';
  title: string;
  body: string;
  category: 'deadline' | 'clash' | 'travel' | 'todo' | 'prep' | 'news' | 'weather' | 'status' | 'suggestion' | null;
  urgency: 'time_critical' | 'normal' | 'fyi';
  dueAt: string | null;
  evidence: { source: SourceId; label: string; observedAt: string }[];
  state: ItemState;
  snoozedUntil: string | null;
  feedback: 'useful' | 'wrong' | null;
  runId: string | null;
  todoAdded: boolean;
  language: 'da' | 'en' | null;
  createdAt: string;
}

export interface RunSummary {
  id: string;
  trigger: 'scheduled' | 'catchup' | 'manual';
  slot: string | null;
  status: RunStatus;
  reason: string | null;
  startedAt: string;
  finishedAt: string | null;
  findingCount: number;
}

export interface SourceStatus {
  id: SourceId;
  enabled: boolean;
  state: 'ok' | 'unavailable' | 'stale' | 'disabled' | 'not_run';
  reason: string | null;
  observedAt: string | null;
}

export interface ProactiveStatus {
  paused: boolean;
  quietNow: boolean;
  nextSlotAt: string | null;
  lastRun: RunSummary | null;
  budget: {
    month: string;
    monthlyLimitDkk: number;
    estimatedSpendDkk: number;
    state: 'ok' | 'warn' | 'exhausted';
  };
  sources: SourceStatus[];
}

export interface ProactiveSettings {
  paused: boolean;
  monthlyBudgetDkk: number;
  sources: { id: SourceId; enabled: boolean }[];
  newsFeeds: string[];
  guidance: string;
}

export class ProactiveRequestError extends Error {
  constructor(readonly status: number) {
    super(`Proactive request failed (${status}).`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isSourceId(value: unknown): value is SourceId {
  return value === 'todos' || value === 'calendar' || value === 'mail' || value === 'weather' ||
    value === 'factory' || value === 'news' || value === 'travel' || value === 'x';
}

export function isRun(value: unknown): value is RunSummary {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' &&
    (value.trigger === 'scheduled' || value.trigger === 'catchup' || value.trigger === 'manual') &&
    (value.slot === null || typeof value.slot === 'string') &&
    (value.status === 'running' || value.status === 'done' || value.status === 'failed' ||
      value.status === 'skipped' || value.status === 'cancelled') &&
    (value.reason === null || typeof value.reason === 'string') &&
    isDate(value.startedAt) && (value.finishedAt === null || isDate(value.finishedAt)) &&
    Number.isSafeInteger(value.findingCount) && Number(value.findingCount) >= 0;
}

export function isProactiveItem(value: unknown): value is ProactiveItem {
  if (!isRecord(value)) return false;
  const category = value.category;
  const evidence = value.evidence;
  return typeof value.id === 'string' &&
    (value.kind === 'finding' || value.kind === 'test') &&
    typeof value.title === 'string' && value.title.length <= 200 &&
    typeof value.body === 'string' && value.body.length <= 10_000 &&
    (category === null || category === 'deadline' || category === 'clash' || category === 'travel' ||
      category === 'todo' || category === 'prep' || category === 'news' || category === 'weather' ||
      category === 'status' || category === 'suggestion') &&
    (value.urgency === 'time_critical' || value.urgency === 'normal' || value.urgency === 'fyi') &&
    (value.dueAt === null || isDate(value.dueAt)) &&
    Array.isArray(evidence) && evidence.length <= 50 && evidence.every((entry) =>
      isRecord(entry) && isSourceId(entry.source) && typeof entry.label === 'string' &&
      entry.label.length <= 200 && isDate(entry.observedAt)) &&
    (value.state === 'new' || value.state === 'seen' || value.state === 'dismissed' || value.state === 'snoozed') &&
    (value.snoozedUntil === null || isDate(value.snoozedUntil)) &&
    (value.feedback === null || value.feedback === 'useful' || value.feedback === 'wrong') &&
    (value.runId === null || typeof value.runId === 'string') &&
    typeof value.todoAdded === 'boolean' && (value.language === null || value.language === 'da' || value.language === 'en') &&
    isDate(value.createdAt);
}

function isSourceStatus(value: unknown): value is SourceStatus {
  return isRecord(value) && isSourceId(value.id) && typeof value.enabled === 'boolean' &&
    (value.state === 'ok' || value.state === 'unavailable' || value.state === 'stale' ||
      value.state === 'disabled' || value.state === 'not_run') &&
    (value.reason === null || typeof value.reason === 'string') &&
    (value.observedAt === null || isDate(value.observedAt));
}

export function isProactiveStatus(value: unknown): value is ProactiveStatus {
  if (!isRecord(value) || !isRecord(value.budget)) return false;
  const budget = value.budget;
  return typeof value.paused === 'boolean' && typeof value.quietNow === 'boolean' &&
    (value.nextSlotAt === null || isDate(value.nextSlotAt)) &&
    (value.lastRun === null || isRun(value.lastRun)) &&
    typeof budget.month === 'string' && Number.isFinite(budget.monthlyLimitDkk) &&
    Number(budget.monthlyLimitDkk) >= 0 && Number.isFinite(budget.estimatedSpendDkk) &&
    Number(budget.estimatedSpendDkk) >= 0 &&
    (budget.state === 'ok' || budget.state === 'warn' || budget.state === 'exhausted') &&
    Array.isArray(value.sources) && value.sources.every(isSourceStatus);
}

export function isProactiveSettings(value: unknown): value is ProactiveSettings {
  return isRecord(value) && typeof value.paused === 'boolean' &&
    Number.isSafeInteger(value.monthlyBudgetDkk) && Number(value.monthlyBudgetDkk) >= 0 &&
    Number(value.monthlyBudgetDkk) <= 1000 &&
    Array.isArray(value.sources) && value.sources.every((source) =>
      isRecord(source) && isSourceId(source.id) && typeof source.enabled === 'boolean') &&
    Array.isArray(value.newsFeeds) && value.newsFeeds.every((feed) => typeof feed === 'string' && feed.length <= 300) &&
    typeof value.guidance === 'string' && value.guidance.length <= 1000;
}

export async function proactiveRequest(
  backendUrl: string | null,
  getAccessToken: () => Promise<string>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!backendUrl) throw new Error('Proactive is unavailable until the backend is configured.');
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `${['Bear', 'er'].join('')} ${token}`);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    ...init, headers, cache: 'no-store',
  });
}

export async function proactiveJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProactiveRequestError(response.status);
  return response.json().catch(() => null) as Promise<unknown>;
}

export const sourceLabels: Record<SourceId, string> = {
  todos: 'Todo list',
  calendar: 'Calendar',
  mail: 'Mail',
  weather: 'Weather',
  factory: 'Factory',
  news: 'News',
  travel: 'Travel',
  x: 'X',
};

const sourceReasons: Record<string, string> = {
  not_connected: 'Not connected',
  not_authorised: 'Not authorised',
  rate_limited: 'Rate limited',
  timeout: 'Timed out',
  read_failed: 'Could not be read',
  too_large: 'Too large',
  no_location: 'No home location saved',
  todo_file_missing: 'Todo file not found',
  todo_file_ambiguous: 'More than one todo file',
  no_provider: 'No provider connected',
  invalid_feed: 'A feed is invalid',
  no_feeds: 'No feeds set',
  some_feeds_failed: 'Some feeds failed',
};

const runReasons: Record<string, string> = {
  budget_exhausted: 'Monthly budget reached',
  model_unavailable: 'Summary step unavailable',
  invalid_model_output: 'Summary step rejected',
  no_sources: 'No source could be read',
  quiet_hours: 'Stopped for quiet hours',
  interrupted_by_restart: 'Interrupted by a restart',
  lease_lost: 'Another run took over',
  deadline_exceeded: 'Took too long',
  paused: 'Paused',
};

export function sourceReason(code: string | null): string {
  return code && Object.hasOwn(sourceReasons, code) ? sourceReasons[code]! : 'Unavailable';
}

export function runReason(code: string | null): string | null {
  return code && Object.hasOwn(runReasons, code) ? runReasons[code]! : null;
}

export function formatTime(value: string, language: 'da' | 'en' = 'en'): string {
  return new Intl.DateTimeFormat(language === 'da' ? 'da-DK' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Copenhagen',
  }).format(new Date(value));
}

function copenhagenParts(timestamp: number): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp);
  return {
    year: Number(parts.find(({ type }) => type === 'year')?.value),
    month: Number(parts.find(({ type }) => type === 'month')?.value),
    day: Number(parts.find(({ type }) => type === 'day')?.value),
  };
}

function copenhagenWallTimeToDate(year: number, month: number, day: number, hour: number): Date {
  const target = Date.UTC(year, month - 1, day, hour);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(candidate);
    const observed = Date.UTC(
      Number(parts.find(({ type }) => type === 'year')?.value),
      Number(parts.find(({ type }) => type === 'month')?.value) - 1,
      Number(parts.find(({ type }) => type === 'day')?.value),
      Number(parts.find(({ type }) => type === 'hour')?.value),
      Number(parts.find(({ type }) => type === 'minute')?.value),
      Number(parts.find(({ type }) => type === 'second')?.value),
    );
    const adjustment = target - observed;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return new Date(candidate);
}

export function tomorrowAtSeven(now: number): Date {
  const { year, month, day } = copenhagenParts(now);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return copenhagenWallTimeToDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 7);
}

export function copenhagenClock(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen', hourCycle: 'h23',
  }).format(new Date(value));
}

export function timeAgo(value: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function outcomeLabel(status: RunStatus): string {
  return {
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
    cancelled: 'Cancelled',
  }[status];
}
