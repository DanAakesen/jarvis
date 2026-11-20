export const outreachTiers = ['low', 'medium', 'high'] as const;
export type OutreachTier = typeof outreachTiers[number];
export type OutreachRating = 'up' | 'down';

export const EVENT_SUMMARY_MAX = 400;
export const EVENT_DETAIL_MAX_BYTES = 4_096;
export const EVENT_SOURCE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
export const EVENT_KIND_PATTERN = /^[a-z][a-z0-9_.:-]{0,95}$/u;

/** Source and kind are free text on purpose: a new producer needs no schema or enum change. */
export interface ProactiveEventInput {
  source: string;
  kind: string;
  dedupeKey: string;
  summary: string;
  detail?: Record<string, unknown>;
  occurredAt: Date;
  /** Stable source object identity. Dedupe and updates are scoped to this, not prose. */
  identity?: string;
  /** The material state that changed. It is hashed at the queue boundary. */
  material?: unknown;
  /** Earliest time the existing queue may claim this event. */
  notBeforeAt?: Date;
  /** Record the event as already seen so a first poll never floods the model. */
  baseline?: boolean;
}

export interface QueuedEvent {
  id: string;
  source: string;
  kind: string;
  dedupeKey: string;
  summary: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
  receivedAt: Date;
  attempts: number;
  identity?: string | null;
  materialHash?: string | null;
  notBeforeAt?: Date | null;
}

export interface ProactiveEventSink {
  enqueue(event: ProactiveEventInput): Promise<void>;
}

export const outreachCategories = [
  'deadline', 'clash', 'travel', 'todo', 'prep', 'news', 'weather', 'status', 'suggestion',
] as const;

export interface OutreachDecision {
  eventIds: string[];
  tier: OutreachTier;
  title: string;
  body: string;
  why: string;
  category: typeof outreachCategories[number];
}

export interface QuietDecision {
  eventId: string;
  why: string;
}

export interface ChannelOutcome {
  channel: string;
  status: 'sent' | 'failed' | 'skipped';
  reason: string | null;
}

export interface OutreachRecord extends OutreachDecision {
  id: string;
  batchId: string;
  itemId: string | null;
  delivery: ChannelOutcome[];
  pushedAt: string | null;
  rating: OutreachRating | null;
  ratingNote: string | null;
  createdAt: string;
}

/**
 * A way to reach the owner. The tier policy asks every channel registered for a tier to deliver.
 * A later VoIP call is one more channel with `tiers: ['high']`; nothing else changes.
 */
export interface OutreachChannel {
  id: string;
  tiers: readonly OutreachTier[];
  deliver(outreach: OutreachRecord, signal: AbortSignal): Promise<ChannelOutcome>;
}
