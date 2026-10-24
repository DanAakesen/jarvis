import type { FeedbackAction } from './store.js';

export const itemIdPattern = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/u;

export function itemFeedback(value: unknown, now: Date): { action: FeedbackAction; snoozeUntil?: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['action', 'snoozeUntil'].includes(key)) ||
      typeof body.action !== 'string' ||
      !['seen', 'dismiss', 'snooze', 'useful', 'wrong'].includes(body.action)) return undefined;
  if (body.action !== 'snooze') {
    if (Object.hasOwn(body, 'snoozeUntil')) return undefined;
    return { action: body.action as Exclude<FeedbackAction, 'snooze'> };
  }
  if (typeof body.snoozeUntil !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/u.test(body.snoozeUntil)) return undefined;
  const until = new Date(body.snoozeUntil);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(body.snoozeUntil);
  if (!parts || !Number.isFinite(until.getTime()) ||
      until.getUTCFullYear() !== Number(parts[1]) || until.getUTCMonth() + 1 !== Number(parts[2]) ||
      until.getUTCDate() !== Number(parts[3]) || until.getUTCHours() !== Number(parts[4]) ||
      until.getUTCMinutes() !== Number(parts[5]) || until.getUTCSeconds() !== Number(parts[6]) ||
      until.getTime() <= now.getTime() ||
      until.getTime() > now.getTime() + 7 * 24 * 60 * 60_000) return undefined;
  return { action: 'snooze', snoozeUntil: until.toISOString() };
}
