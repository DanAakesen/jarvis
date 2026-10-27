import { createHash } from 'node:crypto';
import { dayKey } from './time.js';
import type { SourceFact } from './types.js';

export const DEADLINE_WINDOW_HOURS = 24;
export const CLASH_WINDOW_HOURS = 48;
const HOUR_MS = 60 * 60 * 1_000;

export interface DeterministicFinding {
  title: string;
  body: string;
  category: 'deadline' | 'clash' | 'todo';
  urgency: 'time_critical' | 'normal';
  dueAt: string | null;
  evidence: string[];
  dedupeKey: string;
  eventStartAt?: string;
  eventEndAt?: string;
}

export function normaliseFactText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

export function deterministicDedupeKey(category: string, factText: string, instantIso: string): string {
  return createHash('sha256')
    .update([category, normaliseFactText(factText), instantIso].join('|'))
    .digest('hex').slice(0, 32);
}

function instant(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function snippet(text: string, limit: number): string {
  if (text.length <= limit) return text;
  // SQL nvarchar limits UTF-16 units; never split a surrogate pair at the boundary.
  return `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`;
}

export function todosDueWithin<T extends Pick<SourceFact, 'kind' | 'dueAt'>>(
  facts: readonly T[],
  now: Date,
  minutes: number,
): T[] {
  if (!Number.isFinite(minutes) || minutes <= 0) return [];
  const from = now.getTime();
  const until = from + minutes * 60_000;
  return facts.filter((fact) => {
    const due = instant(fact.dueAt);
    return fact.kind === 'todo' && due > from && due <= until;
  });
}

export function detectFindings(facts: SourceFact[], now: Date, language: 'da' | 'en'): DeterministicFinding[] {
  const at = now.getTime();
  if (!Number.isFinite(at)) return [];
  const findings: DeterministicFinding[] = [];
  const undatedTodos = facts.filter((fact) => fact.kind === 'todo' && fact.dueAt == null);
  if (undatedTodos.length > 0) {
    const titles = undatedTodos.map(({ text }) => normaliseFactText(text) || 'untitled task').sort();
    const listedTitles = undatedTodos
      .map(({ text }) => ({ key: normaliseFactText(text) || 'untitled task', text: snippet(text || 'Untitled task', 64) }))
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      .slice(0, 5)
      .map(({ text }) => `"${text}"`)
      .join('; ');
    findings.push({
      title: language === 'da' ? 'Opgaver uden frist' : 'Tasks without due dates',
      body: language === 'da'
        ? `${undatedTodos.length} åbne opgaver med høj prioritet mangler en frist: ${listedTitles}.`
        : `${undatedTodos.length} open high-priority tasks have no due date: ${listedTitles}.`,
      category: 'todo',
      urgency: 'normal',
      dueAt: null,
      evidence: undatedTodos.map(({ ref }) => ref),
      dedupeKey: deterministicDedupeKey(
        'todo', `undated_high_priority_tasks|${JSON.stringify(titles)}`, dayKey(now),
      ),
    });
  }
  for (const fact of facts) {
    const due = instant(fact.dueAt);
    if (fact.kind !== 'todo' || !Number.isFinite(due) || due > at + DEADLINE_WINDOW_HOURS * HOUR_MS) continue;
    const dueAt = new Date(due).toISOString();
    const overdue = due < at;
    const text = snippet(fact.text, 300);
    findings.push({
      title: snippet(fact.text, 200),
      body: language === 'da'
        ? `Opgaven "${text}" ${overdue ? 'havde' : 'har'} frist ${dueAt}.`
        : `The task "${text}" ${overdue ? 'was' : 'is'} due at ${dueAt}.`,
      category: 'deadline',
      urgency: due >= at - DEADLINE_WINDOW_HOURS * HOUR_MS ? 'time_critical' : 'normal',
      dueAt,
      evidence: [fact.ref],
      dedupeKey: deterministicDedupeKey('deadline', fact.text, dueAt),
    });
  }

  const events = facts.filter((fact) =>
    fact.kind === 'event' && !fact.allDay &&
    Number.isFinite(instant(fact.startsAt)) && Number.isFinite(instant(fact.endsAt)) &&
    instant(fact.startsAt) < instant(fact.endsAt))
    .map((fact) => ({
      fact, start: instant(fact.startsAt), end: instant(fact.endsAt),
      text: normaliseFactText(fact.text),
    }))
    .sort((a, b) => {
      const left = JSON.stringify([a.text, a.start, a.end, a.fact.ref]);
      const right = JSON.stringify([b.text, b.start, b.end, b.fact.ref]);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  for (let i = 0; i < events.length; i += 1) {
    const first = events[i]!;
    for (const second of events.slice(i + 1)) {
      const start = Math.max(first.start, second.start);
      const end = Math.min(first.end, second.end);
      // An ended overlap is no longer actionable, even if one event is still running.
      if (start >= end || end <= at || first.fact.ref === second.fact.ref) continue;
      const eventStartAt = new Date(start).toISOString();
      const eventEndAt = new Date(end).toISOString();
      const firstText = snippet(first.fact.text, 160);
      const secondText = snippet(second.fact.text, 160);
      findings.push({
        title: language === 'da' ? 'Kalenderkonflikt' : 'Calendar clash',
        body: language === 'da'
          ? `"${firstText}" og "${secondText}" overlapper fra ${eventStartAt} til ${eventEndAt}.`
          : `"${firstText}" and "${secondText}" overlap from ${eventStartAt} to ${eventEndAt}.`,
        category: 'clash',
        urgency: start >= at && start <= at + CLASH_WINDOW_HOURS * HOUR_MS ? 'time_critical' : 'normal',
        dueAt: eventStartAt,
        evidence: [first.fact.ref, second.fact.ref],
        dedupeKey: deterministicDedupeKey('clash', JSON.stringify([first.text, second.text]), eventStartAt),
        eventStartAt,
        eventEndAt,
      });
    }
  }
  return findings;
}
