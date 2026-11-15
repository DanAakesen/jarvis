import { VaultFileTooLargeError } from '../vault/github-client.js';
import type { InboxIndex } from './item-index.js';
import { InboxError, appendTrail, inboxDate, noteId } from './note.js';
import {
  buildDigest, parseReview, MAX_WEEKLY_FULL_NOTES, MAX_FULL_NOTES, type ReviewMode, reviewSystemPrompt, reviewUserMessage,
  type NudgeTier, type Reaction, type ReviewNudge,
} from './review.js';
import type { InboxStore } from './store.js';

export interface NudgeDelivery {
  /** Creates the card (and, for medium and high, the push) and returns the id of the proactive item. Null means nothing was delivered. */
  deliver(nudge: ReviewNudge & { readonly itemTitle: string }, signal: AbortSignal): Promise<string | null>;
}

export interface ProactiveReactions {
  /** The thumb on a proactive item, when the owner gave one: useful is a thumbs up, wrong a thumbs down. */
  thumb(proactiveItemId: string, signal: AbortSignal): Promise<'up' | 'down' | null>;
}

export type NudgePassOutcome =
  | { readonly status: 'skipped'; readonly reason: 'inbox_unavailable' | 'nothing_to_review' | 'model_unavailable' | 'invalid_model_output' }
  | { readonly status: 'done'; readonly nudged: { readonly itemId: string; readonly tier: NudgeTier } | null; readonly rewrites: number };

const day = 24 * 60 * 60 * 1000;

/**
 * One review of the inbox, run inside a proactive slot. The model sees a bounded digest and returns at most one nudge and
 * three rewrites; the server checks every id and rail, applies rewrites with expectedSha, and only then asks the delivery
 * to reach Dan. Nothing here can close, delete, send or create an issue.
 */
export function createInboxNudgePass(options: {
  readonly store: InboxStore;
  readonly index: InboxIndex;
  /** One tool-less JSON completion; undefined means no usable model. */
  readonly model: (prompt: { system: string; user: string }, signal: AbortSignal) => Promise<string | undefined>;
  readonly delivery: NudgeDelivery;
  readonly reactions: ProactiveReactions;
  readonly guidance?: () => Promise<string>;
  readonly nudgeStyle?: () => Promise<string>;
  /** Stores the weekly rewrite of the nudge style. */
  readonly saveNudgeStyle?: (style: string, signal: AbortSignal) => Promise<void>;
  readonly now?: () => Date;
  readonly log?: (fields: { readonly outcome: string }) => void;
}) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});

  /** Brings the owner's thumbs on earlier nudges into the index and the note trail. Best effort. */
  async function syncReactions(signal: AbortSignal): Promise<Reaction[]> {
    const at = now();
    const rows = await options.index.rows(signal);
    const reactions: Reaction[] = [];
    for (const row of rows) {
      if (!row.lastNudgeItemId || !row.lastNudgedAt) continue;
      let thumb = row.lastFeedback;
      // The card's thumb can be changed after the first read (useful to wrong and back), so it is read every pass.
      try {
        const found = await options.reactions.thumb(row.lastNudgeItemId, signal);
        if (found && found !== row.lastFeedback) {
          await options.index.setFeedback(row.itemId, found, at, signal);
          thumb = found;
          if (row.path) await trail(row.path, row.lastFeedback ? `changed the thumb to ${found} on the nudge` : `thumbs ${found} on the nudge`, signal);
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
      if (thumb) {
        reactions.push({
          title: row.path?.replace(/^Inbox\/\d{4}-\d{2}-\d{2} /u, '').replace(/\.md$/u, '') ?? row.itemId,
          ageDays: Math.floor((at.getTime() - row.createdAt.getTime()) / day),
          sentHour: row.lastNudgedAt ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' }).format(row.lastNudgedAt)) : null,
          reaction: thumb,
        });
      }
    }
    return reactions.sort((left, right) => left.ageDays - right.ageDays);
  }

  /** One dated line in the note's Trail; a conflict or a missing note is simply skipped, the index keeps the fact. */
  async function trail(path: string, line: string, signal: AbortSignal): Promise<void> {
    try {
      const current = await options.store.read(path, signal);
      if (!current || current.closed) return;
      await options.store.replace(path, appendTrail(current.content, line, now(), noteId(current.content) ?? current.id), current.sha, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof InboxError) && !(error instanceof VaultFileTooLargeError)) log({ outcome: 'trail_failed' });
    }
  }

  return {
    /** allow.nudge false still tidies notes and learns the style, but delivers nothing: the run already spent its one nudge. */
    async run(signal: AbortSignal, mode: ReviewMode = 'slot', allow: { readonly nudge?: boolean } = {}): Promise<NudgePassOutcome> {
      const at = now();
      try {
        await options.index.sync(signal);
      } catch (error) {
        if (signal.aborted) throw error;
        log({ outcome: 'inbox_unavailable' });
        return { status: 'skipped', reason: 'inbox_unavailable' };
      }
      let reactions: Reaction[] = [];
      try { reactions = await syncReactions(signal); } catch (error) { if (signal.aborted) throw error; }
      let digest;
      try {
        const [listed, rows] = await Promise.all([
          options.store.list({ limit: 200 }, signal),
          options.index.rows(signal),
        ]);
        digest = buildDigest(listed.items, rows, at, mode === 'weekly' ? MAX_WEEKLY_FULL_NOTES : MAX_FULL_NOTES);
      } catch (error) {
        if (signal.aborted) throw error;
        log({ outcome: 'inbox_unavailable' });
        return { status: 'skipped', reason: 'inbox_unavailable' };
      }
      // Nothing can be nudged and nothing is shown in full: no model call.
      if (!digest.items.some((item) => item.canNudge)) {
        log({ outcome: 'nothing_to_review' });
        return { status: 'skipped', reason: 'nothing_to_review' };
      }
      const prompt = {
        system: reviewSystemPrompt({
          today: inboxDate(at),
          guidance: (await options.guidance?.().catch(() => '')) ?? '',
          nudgeStyle: (await options.nudgeStyle?.().catch(() => '')) ?? '',
          mode,
        }),
        user: reviewUserMessage(digest, reactions),
      };
      let raw: string | undefined;
      try { raw = await options.model(prompt, signal); } catch (error) {
        if (signal.aborted) throw error;
        raw = undefined;
      }
      if (raw === undefined) {
        log({ outcome: 'model_unavailable' });
        return { status: 'skipped', reason: 'model_unavailable' };
      }
      const review = parseReview(raw, digest, mode);
      if (!review) {
        log({ outcome: 'invalid_model_output' });
        return { status: 'skipped', reason: 'invalid_model_output' };
      }

      let applied = 0;
      for (const rewrite of review.rewrites) {
        const full = digest.fullNotes.get(rewrite.id)!;
        try {
          await options.store.replace(full.path, rewrite.content, full.sha, signal);
          applied += 1;
        } catch (error) {
          // A conflict means Dan edited the note meanwhile: drop the rewrite, never overwrite.
          if (signal.aborted) throw error;
        }
      }

      if (review.nudgeStyle && options.saveNudgeStyle) {
        try { await options.saveNudgeStyle(review.nudgeStyle, signal); } catch (error) { if (signal.aborted) throw error; }
      }

      let nudged: { itemId: string; tier: NudgeTier } | null = null;
      if (review.nudge && allow.nudge !== false) {
        const item = digest.items.find((entry) => entry.id === review.nudge!.id)!;
        const itemId = await options.delivery.deliver({ ...review.nudge, itemTitle: item.title }, signal);
        if (itemId) {
          await options.index.markNudged(review.nudge.id, now(), signal, itemId);
          const row = await options.index.get(review.nudge.id, signal);
          if (row?.path) await trail(row.path, `nudged (${review.nudge.tier}): ${review.nudge.why}`, signal);
          nudged = { itemId: review.nudge.id, tier: review.nudge.tier };
        }
      }
      log({ outcome: nudged ? 'nudged' : 'quiet' });
      return { status: 'done', nudged, rewrites: applied };
    },
  };
}

export type InboxNudgePass = ReturnType<typeof createInboxNudgePass>;
