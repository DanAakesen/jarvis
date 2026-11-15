import { randomUUID } from 'node:crypto';
import type { ChannelOutcome, OutreachDecision, OutreachRating, OutreachRecord } from './types.js';

export interface OutreachStore {
  create(input: { decision: OutreachDecision; batchId: string; itemId: string | null }, now: Date): Promise<OutreachRecord>;
  recordDelivery(id: string, delivery: readonly ChannelOutcome[], pushedAt: Date | null): Promise<void>;
  get(id: string): Promise<OutreachRecord | undefined>;
  recent(limit: number, since: Date): Promise<OutreachRecord[]>;
  rate(id: string, rating: OutreachRating, note: string | null): Promise<OutreachRecord | undefined>;
  /** The Proactive page rates the linked finding; keep the outreach rating in step. */
  rateByItem(itemId: string, rating: OutreachRating): Promise<boolean>;
  pushesSince(since: Date): Promise<number>;
}

export function createMemoryOutreachStore(): OutreachStore {
  const rows = new Map<string, OutreachRecord & { pushedAtDate: Date | null; createdAtDate: Date }>();
  const view = (row: OutreachRecord): OutreachRecord => structuredClone({
    id: row.id, eventIds: row.eventIds, tier: row.tier, title: row.title, body: row.body, why: row.why,
    category: row.category, batchId: row.batchId, itemId: row.itemId, delivery: row.delivery,
    pushedAt: row.pushedAt, rating: row.rating, ratingNote: row.ratingNote, createdAt: row.createdAt,
  });
  return {
    async create({ decision, batchId, itemId }, now) {
      const id = randomUUID();
      const row = {
        ...decision, id, batchId, itemId, delivery: [], pushedAt: null, rating: null, ratingNote: null,
        createdAt: now.toISOString(), pushedAtDate: null, createdAtDate: now,
      };
      rows.set(id, row);
      return view(row);
    },
    async recordDelivery(id, delivery, pushedAt) {
      const row = rows.get(id);
      if (!row) return;
      row.delivery = [...delivery];
      row.pushedAt = pushedAt?.toISOString() ?? null;
      row.pushedAtDate = pushedAt;
    },
    async get(id) { const row = rows.get(id); return row ? view(row) : undefined; },
    async recent(limit, since) {
      return [...rows.values()].filter((row) => row.createdAtDate >= since)
        .sort((left, right) => right.createdAtDate.getTime() - left.createdAtDate.getTime())
        .slice(0, limit).map(view);
    },
    async rate(id, rating, note) {
      const row = rows.get(id);
      if (!row) return undefined;
      row.rating = rating;
      row.ratingNote = note;
      return view(row);
    },
    async rateByItem(itemId, rating) {
      const row = [...rows.values()].find((candidate) => candidate.itemId === itemId);
      if (!row) return false;
      row.rating = rating;
      return true;
    },
    async pushesSince(since) {
      return [...rows.values()].filter((row) => row.pushedAtDate !== null && row.pushedAtDate >= since).length;
    },
  };
}
