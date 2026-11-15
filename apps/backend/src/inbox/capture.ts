import type { ApprovalModelPort } from '../core/approval-interpreter.js';
import { SlidingWindowRateLimiter } from '../auth/session/rate-limit.js';
import type { InboxIndex } from './item-index.js';
import { InboxError, cleanText, captureNoteId, inboxDate, MAX_INBOX_QUOTE_BYTES } from './note.js';
import { shouldRedact } from '../vault/index.js';
import type { InboxStore } from './store.js';
import { triageCapture } from './triage.js';

export const captureSources = ['watch', 'shortcut', 'app', 'other'] as const;
export type CaptureSource = typeof captureSources[number];

export interface RawCapture {
  /** Client-generated unique key (a UUID, or 16-64 letters, digits, dots, hyphens or underscores); a retry with the same key never makes a second note. */
  readonly captureId: string;
  readonly text: string;
  readonly source?: CaptureSource;
}

export interface CaptureResult {
  readonly items: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  /** False when the model was not used (busy, over the daily allowance, or unusable) and the raw text became the note. */
  readonly triaged: boolean;
  /** True when an earlier attempt with the same capture id had already saved it. */
  readonly repeated: boolean;
}

export const MAX_RAW_CAPTURE_CHARACTERS = 4_000;
const captureKey = /^[A-Za-z0-9._-]{16,64}$/u;
const sourceLabels: Record<CaptureSource, string> = { watch: 'Watch', shortcut: 'Shortcut', app: 'app', other: 'API' };
const maxConcurrentTriage = 4;
const maxTriageCallsPerMinute = 20;
/** About 0.9 DKK at the design's estimate of 0.015 DKK a call, inside the 1 DKK/day inbox ceiling. Per replica until step 8 measures. */
const maxTriageCallsPerDay = 60;

export function validRawCapture(value: unknown): value is RawCapture {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every((key) => ['captureId', 'text', 'source'].includes(key)) &&
    typeof body.captureId === 'string' && captureKey.test(body.captureId) &&
    typeof body.text === 'string' && body.text.trim().length > 0 && Array.from(body.text).length <= MAX_RAW_CAPTURE_CHARACTERS &&
    (body.source === undefined || captureSources.includes(body.source as CaptureSource));
}

/**
 * Raw text in, structured notes out, for clients with no model of their own (Watch, Shortcut). A triage model that is
 * missing, busy, over its daily allowance or wrong only costs structure: the capture is never refused for cost and
 * always keeps the owner's own words.
 */
export function createInboxCapture(options: {
  readonly store: InboxStore;
  readonly index?: InboxIndex | undefined;
  readonly model?: ApprovalModelPort | undefined;
  readonly now?: () => Date;
  readonly log?: (event: 'inbox.index_unavailable' | 'inbox.triage', fields: { readonly outcome: string }) => void;
}) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const minute = new SlidingWindowRateLimiter([{ windowMs: 60_000, max: maxTriageCallsPerMinute }], now);
  let triaging = 0;
  let day = '';
  let dayCalls = 0;

  function allowTriage(at: Date): boolean {
    const today = inboxDate(at);
    if (today !== day) { day = today; dayCalls = 0; }
    if (!options.model || triaging >= maxConcurrentTriage || dayCalls >= maxTriageCallsPerDay ||
        !minute.consume('owner').allowed) return false;
    dayCalls += 1;
    return true;
  }

  async function bestEffort<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T | undefined> {
    try { return await work(); } catch (error) {
      if (signal.aborted) throw error;
      log('inbox.index_unavailable', { outcome: 'error' });
      return undefined;
    }
  }

  async function existing(captureId: string, signal: AbortSignal): Promise<CaptureResult['items']> {
    const items: Array<{ id: string; title: string }> = [];
    for (let position = 0; position < 5; position += 1) {
      const id = captureNoteId(captureId, position);
      const row = await options.index?.get(id, signal);
      if (!row?.path) continue;
      const note = await options.store.read(row.path, signal);
      if (note) items.push({ id, title: note.title });
    }
    return items;
  }

  return async function capture(value: unknown, signal: AbortSignal): Promise<CaptureResult> {
    if (!validRawCapture(value)) {
      throw new InboxError('invalid', 'Send a unique captureId (16-64 letters, digits, dots, hyphens or underscores) and up to 4000 characters of text.');
    }
    const text = cleanText(value.text, 'text', MAX_INBOX_QUOTE_BYTES);
    if (!text) throw new InboxError('invalid', 'There is nothing to capture.');
    if (shouldRedact(text)) {
      throw new InboxError('refused', 'Secrets and credentials can never be saved to the vault. Nothing was written.');
    }
    const at = now();
    const firstId = captureNoteId(value.captureId, 0);
    const reserved = options.index ? await bestEffort(() => options.index!.reserve(firstId, signal), signal) : undefined;
    if (reserved && !reserved.inserted) {
      // The first note is written last, so a row with a location means the whole capture landed.
      if (reserved.row.path) {
        const items = await existing(value.captureId, signal);
        if (items.length > 0) return { items, triaged: true, repeated: true };
      } else {
        const earlier = await options.store.find(firstId, signal);
        if (earlier) {
          if (options.index) await bestEffort(() => options.index!.complete(earlier.id, earlier.path, earlier.sha, signal), signal);
          return { items: [{ id: earlier.id, title: earlier.title }], triaged: true, repeated: true };
        }
      }
    }

    let triaged = false;
    let notes = (await triageCapture(text, undefined, signal)).notes;
    if (allowTriage(at)) {
      triaging += 1;
      try {
        const result = await triageCapture(text, options.model, signal);
        notes = result.notes;
        triaged = result.triaged;
      } finally { triaging -= 1; }
    }
    log('inbox.triage', { outcome: triaged ? 'model' : 'raw' });

    const items: Array<{ id: string; title: string }> = [];
    let writes = 0;
    const source = value.source === undefined ? undefined : sourceLabels[value.source];
    for (const position of [...notes.keys()].reverse()) {
      const draft = notes[position]!;
      const id = captureNoteId(value.captureId, position);
      const { item, created } = await options.store.create({
        title: draft.title,
        ...(draft.note ? { note: draft.note } : {}),
        quote: text,
        ...(source === undefined ? {} : { source }),
        id,
        at,
      }, signal);
      if (created) writes += 1;
      if (options.index) await bestEffort(() => options.index!.complete(item.id, item.path, item.sha, signal), signal);
      items.unshift({ id: item.id, title: item.title });
    }
    return { items, triaged, repeated: writes === 0 };
  };
}

export type InboxCapture = ReturnType<typeof createInboxCapture>;
