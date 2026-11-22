import { createHash } from 'node:crypto';
import type { SourceFact } from './types.js';

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
