import { VaultFileTooLargeError } from '../vault/github-client.js';
import { isInboxId } from './note.js';
import type { InboxStore } from './store.js';

export type InboxFeedback = 'up' | 'down';

/** The only facts the database keeps about an item; everything else is the note in the vault. */
export interface InboxIndexRow {
  readonly itemId: string;
  /** Null while a capture is reserved and the vault write has not been confirmed. */
  readonly path: string | null;
  readonly sha: string | null;
  readonly lastNudgedAt: Date | null;
  /** The proactive item (card) the last nudge created, so its thumbs can be read back. */
  readonly lastNudgeItemId: string | null;
  readonly lastFeedback: InboxFeedback | null;
  readonly lastFeedbackAt: Date | null;
  readonly createdAt: Date;
}

export interface InboxIndexStore {
  all(signal: AbortSignal): Promise<InboxIndexRow[]>;
  get(itemId: string, signal: AbortSignal): Promise<InboxIndexRow | null>;
  /** Creates a row with no location when the id is new. */
  reserve(itemId: string, signal: AbortSignal): Promise<{ readonly row: InboxIndexRow; readonly inserted: boolean }>;
  /** Records where the note is. lastNudgedAt only applies when the row is created; later calls keep nudges and feedback. */
  upsert(
    value: { readonly itemId: string; readonly path: string; readonly sha: string; readonly lastNudgedAt?: Date | null },
    signal: AbortSignal,
  ): Promise<void>;
  /** All rows in one transaction, with the same rules as upsert. A rebuild is all or nothing, so a retry starts over. */
  upsertMany(
    values: ReadonlyArray<{ readonly itemId: string; readonly path: string; readonly sha: string; readonly lastNudgedAt?: Date | null }>,
    signal: AbortSignal,
  ): Promise<void>;
  remove(itemIds: readonly string[], signal: AbortSignal): Promise<void>;
  markNudged(itemId: string, at: Date, signal: AbortSignal, nudgeItemId?: string): Promise<boolean>;
  setFeedback(itemId: string, feedback: InboxFeedback, at: Date, signal: AbortSignal): Promise<boolean>;
}

export interface InboxSyncResult {
  /** Live notes known to the index after the sync. */
  readonly live: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  /** Notes that share a hidden id with an earlier note; they are left out. */
  readonly duplicates: number;
  /** Notes too large to read. */
  readonly unreadable: number;
  /** True when the table was empty and every nudge time was restored or reset. */
  readonly rebuilt: boolean;
}

const reservationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const readConcurrency = 6;

/**
 * The small, rebuildable index. The vault is the truth: this keeps only when an item
 * was last nudged and the owner's last thumb, plus a reservation row while a capture
 * is being written. Losing the table costs at most a conservative restart of the
 * nudge clock.
 */
export function createInboxIndex(options: {
  readonly store: InboxIndexStore;
  readonly inbox: Pick<InboxStore, 'entries' | 'read'>;
  readonly now?: () => Date;
  /** Last nudge times recovered from proactive history, used only when the table is rebuilt. */
  readonly restoreLastNudged?: (itemIds: readonly string[], signal: AbortSignal) => Promise<ReadonlyMap<string, Date>>;
}) {
  const { store, inbox } = options;
  const now = options.now ?? (() => new Date());
  let running: Promise<InboxSyncResult> | undefined;

  async function run(signal: AbortSignal): Promise<InboxSyncResult> {
    const at = now();
    const [files, rows] = await Promise.all([inbox.entries(signal), store.all(signal)]);
    const live = files.filter((entry) => !entry.closed).sort((left, right) => left.path.localeCompare(right.path));
    const byPath = new Map(rows.flatMap((row) => row.path === null ? [] : [[row.path, row] as const]));
    const rebuilt = rows.length === 0 && live.length > 0;

    let unreadable = 0;
    const failedPaths = new Set<string>();
    const known = new Map<string, { readonly itemId: string; readonly sha: string; readonly changed: boolean }>();
    const stale = live.filter((entry) => byPath.get(entry.path)?.sha !== entry.sha);
    for (const entry of live) {
      const row = byPath.get(entry.path);
      if (row && row.sha === entry.sha) known.set(entry.path, { itemId: row.itemId, sha: entry.sha, changed: false });
    }
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(readConcurrency, stale.length) }, async () => {
      while (next < stale.length) {
        const entry = stale[next]!;
        next += 1;
        signal.throwIfAborted();
        try {
          const item = await inbox.read(entry.path, signal);
          if (item) known.set(entry.path, { itemId: item.id, sha: item.sha, changed: true });
        } catch (error) {
          if (!(error instanceof VaultFileTooLargeError)) throw error;
          unreadable += 1;
          failedPaths.add(entry.path);
        }
      }
    }));

    const owners = new Map<string, string>();
    const keep: Array<{ readonly path: string; readonly itemId: string; readonly sha: string; readonly changed: boolean }> = [];
    let duplicates = 0;
    for (const entry of live) {
      const value = known.get(entry.path);
      if (!value) continue;
      if (owners.has(value.itemId)) {
        duplicates += 1;
        continue;
      }
      owners.set(value.itemId, entry.path);
      keep.push({ path: entry.path, ...value });
    }

    const writes = keep.filter((value) => value.changed);
    const existing = new Set(rows.map((row) => row.itemId));
    const fresh = writes.filter((value) => !existing.has(value.itemId)).map((value) => value.itemId);
    const restored = rebuilt && fresh.length > 0 && options.restoreLastNudged
      ? await options.restoreLastNudged(fresh, signal)
      : new Map<string, Date>();
    let added = 0;
    for (const value of writes) if (!existing.has(value.itemId)) added += 1;
    if (writes.length > 0) {
      signal.throwIfAborted();
      await store.upsertMany(writes.map((value) => ({
        itemId: value.itemId,
        path: value.path,
        sha: value.sha,
        ...(!existing.has(value.itemId) && rebuilt ? { lastNudgedAt: restored.get(value.itemId) ?? at } : {}),
      })), signal);
    }

    const removable = rows.filter((row) => row.path === null
      ? !owners.has(row.itemId) && at.getTime() - row.createdAt.getTime() > reservationLifetimeMs
      : !owners.has(row.itemId) && !failedPaths.has(row.path));
    if (removable.length > 0) await store.remove(removable.map((row) => row.itemId), signal);

    return {
      live: owners.size,
      added,
      changed: writes.length - added,
      removed: removable.length,
      duplicates,
      unreadable,
      rebuilt,
    };
  }

  return {
    /** Brings the index in line with the vault: new notes are added, edited ones refreshed, gone or closed ones dropped. */
    sync(signal: AbortSignal): Promise<InboxSyncResult> {
      running ??= run(signal).finally(() => { running = undefined; });
      return running;
    },
    get: (itemId: string, signal: AbortSignal) => {
      if (!isInboxId(itemId)) return Promise.resolve(null);
      return store.get(itemId, signal);
    },
    /** First step of an idempotent capture. A row without a path means an earlier attempt's outcome is unknown: reread the vault by id before writing again. */
    reserve: (itemId: string, signal: AbortSignal) => store.reserve(itemId, signal),
    complete: (itemId: string, path: string, sha: string, signal: AbortSignal) =>
      store.upsert({ itemId, path, sha }, signal),
    /** Called by the nudge pass when a nudge for the item was sent. */
    markNudged: (itemId: string, at: Date, signal: AbortSignal, nudgeItemId?: string) => store.markNudged(itemId, at, signal, nudgeItemId),
    setFeedback: (itemId: string, feedback: InboxFeedback, at: Date, signal: AbortSignal) =>
      store.setFeedback(itemId, feedback, at, signal),
    /** Rows for live items, for building the digest. */
    rows: (signal: AbortSignal) => store.all(signal),
    /** Called after the store closes a note, so a closed item stops being tracked straight away. */
    forget: (itemId: string, signal: AbortSignal) => store.remove([itemId], signal),
  };
}

export type InboxIndex = ReturnType<typeof createInboxIndex>;
