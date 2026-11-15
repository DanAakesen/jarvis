import {
  VaultFileTooLargeError, VaultWriteConflictError,
  type VaultFile, type VaultTreeFile, type createGitHubVaultClient,
} from '../vault/github-client.js';
import {
  InboxError, appendTrail, assertSavable, blobSha, closedPathFor, composeNote, datePrefix, inboxDate, inboxPath,
  isClosedInboxPath, isInboxId, isInboxPath, isLiveInboxPath, newInboxId, noteExcerpt, noteId, noteTitle,
  pathItemId, withId, type NoteDraft,
} from './note.js';

type VaultClient = ReturnType<typeof createGitHubVaultClient>;
export type InboxVault = Pick<VaultClient, 'tree' | 'read' | 'write' | 'move'>;

export interface InboxItem {
  /** The hidden id when the note has one, otherwise a stable id derived from its path. */
  readonly id: string;
  readonly path: string;
  readonly sha: string;
  readonly title: string;
  readonly closed: boolean;
  /** Date from the file name (Copenhagen), when present. */
  readonly date?: string;
  readonly excerpt: string;
  readonly content: string;
}

export interface InboxEntry {
  readonly path: string;
  readonly sha: string;
  readonly closed: boolean;
}

export interface InboxListOptions {
  readonly includeClosed?: boolean;
  readonly query?: string;
  readonly limit?: number;
}

export interface InboxListResult {
  readonly items: readonly InboxItem[];
  /** True when more notes matched than the limit allowed. */
  readonly truncated: boolean;
}

export interface InboxLogFields {
  readonly action: 'create' | 'replace' | 'close';
  readonly outcome: 'ok' | 'existing' | 'conflict' | 'error';
}

const maxCreateAttempts = 8;
const defaultListLimit = 100;
const maxListLimit = 200;
const readConcurrency = 6;

function toItem(file: VaultFile): InboxItem {
  const id = noteId(file.content) ?? pathItemId(file.path);
  const date = datePrefix(file.path);
  return {
    id,
    path: file.path,
    sha: file.sha,
    title: noteTitle(file.content, file.path),
    closed: isClosedInboxPath(file.path),
    ...(date === undefined ? {} : { date }),
    excerpt: noteExcerpt(file.content),
    content: file.content,
  };
}

function entries(tree: readonly VaultTreeFile[]): InboxEntry[] {
  return tree
    .filter(({ path }) => isInboxPath(path))
    .map(({ path, sha }) => ({ path, sha, closed: isClosedInboxPath(path) }));
}

async function mapLimited<T, R>(values: readonly T[], limit: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await task(values[index]!);
    }
  }));
  return results;
}

/**
 * The only code that writes the vault's Inbox/ folder. Every path is confined to
 * Inbox/*.md and Inbox/Closed/*.md, notes are free text with a hidden id, and a note
 * is live because of where it sits: closing it is a move, never a delete.
 */
export function createInboxStore(options: {
  readonly vault: InboxVault;
  readonly now?: () => Date;
  readonly log?: (fields: InboxLogFields) => void;
}) {
  const vault = options.vault;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  // A git blob sha never changes content, so the id found in a note can be remembered by sha; a rescan then only
  // rereads notes that are new or edited.
  const idBySha = new Map<string, string | null>();
  const maxCachedShas = 5_000;

  async function readNote(path: string, signal: AbortSignal): Promise<InboxItem | null> {
    if (!isInboxPath(path)) throw new InboxError('invalid', 'That is not an inbox note.');
    const file = await vault.read(path, signal);
    return file ? toItem(file) : null;
  }

  async function list(listOptions: InboxListOptions, signal: AbortSignal): Promise<InboxListResult> {
    const limit = Math.min(Math.max(Math.trunc(listOptions.limit ?? defaultListLimit), 1), maxListLimit);
    const wanted = entries(await vault.tree(signal))
      .filter((entry) => listOptions.includeClosed === true || !entry.closed)
      .sort((left, right) => left.closed === right.closed
        ? left.path.localeCompare(right.path)
        : left.closed ? 1 : -1);
    const query = listOptions.query?.trim().toLowerCase();
    const read = async (entry: InboxEntry): Promise<InboxItem | null> => {
      try {
        const file = await vault.read(entry.path, signal);
        return file ? toItem(file) : null;
      } catch (error) {
        if (error instanceof VaultFileTooLargeError) return null;
        throw error;
      }
    };
    if (query) {
      const matches = (await mapLimited(wanted, readConcurrency, read))
        .filter((item): item is InboxItem => item !== null && `${item.title}\n${item.content}`.toLowerCase().includes(query));
      return { items: matches.slice(0, limit), truncated: matches.length > limit };
    }
    const window = wanted.slice(0, limit);
    const items = (await mapLimited(window, readConcurrency, read)).filter((item): item is InboxItem => item !== null);
    return { items, truncated: wanted.length > limit };
  }

  /** Finds a note by id across every live and closed note, wherever it sits or whatever it is called. */
  async function find(id: string, signal: AbortSignal): Promise<InboxItem | null> {
    if (!/^[0-9a-f]{8,32}$/u.test(id)) throw new InboxError('invalid', 'The inbox id is invalid.');
    const all = entries(await vault.tree(signal));
    const identity = async (entry: InboxEntry): Promise<string | null> => {
      const cached = idBySha.get(entry.sha);
      if (cached !== undefined) return cached;
      signal.throwIfAborted();
      let found: string | null = null;
      try {
        const file = await vault.read(entry.path, signal);
        found = file ? noteId(file.content) ?? pathItemId(file.path) : null;
      } catch (error) {
        if (!(error instanceof VaultFileTooLargeError)) throw error;
      }
      if (idBySha.size >= maxCachedShas) idBySha.clear();
      idBySha.set(entry.sha, found);
      return found;
    };
    const candidates = all.filter((entry) => idBySha.get(entry.sha) === undefined || idBySha.get(entry.sha) === id);
    const ids = await mapLimited(candidates, readConcurrency, async (entry) => [entry, await identity(entry)] as const);
    const match = ids.filter(([, found]) => found === id).map(([entry]) => entry).sort((left, right) => left.path.localeCompare(right.path))[0];
    if (!match) return null;
    const file = await vault.read(match.path, signal);
    return file ? toItem(file) : null;
  }

  async function create(
    draft: NoteDraft & { readonly id?: string; readonly at?: Date },
    signal: AbortSignal,
  ): Promise<{ readonly item: InboxItem; readonly created: boolean }> {
    if (draft.id !== undefined && !isInboxId(draft.id)) throw new InboxError('invalid', 'The inbox id is invalid.');
    const id = draft.id ?? newInboxId();
    const at = draft.at ?? now();
    const content = composeNote(draft, id, at);
    const date = inboxDate(at);
    // The id is the idempotency key: resolve it in the vault before any create-only write, because a retry may land
    // on another day, with another title spelling, or after the note was renamed or closed.
    if (draft.id !== undefined) {
      const existing = await find(id, signal);
      if (existing) {
        log({ action: 'create', outcome: 'existing' });
        return { item: existing, created: false };
      }
    }
    for (let copy = 1; copy <= maxCreateAttempts; copy += 1) {
      signal.throwIfAborted();
      const path = inboxPath(date, draft.title, copy);
      try {
        await vault.write(path, content, 'jarvis: add an inbox item\n\nCo-authored-by: Jarvis', undefined, signal);
        log({ action: 'create', outcome: 'ok' });
        return { item: toItem({ path, sha: blobSha(content), content }), created: true };
      } catch (error) {
        if (!(error instanceof VaultWriteConflictError)) {
          log({ action: 'create', outcome: 'error' });
          throw error;
        }
        const existing = await vault.read(path, signal);
        if (existing && draft.id !== undefined && noteId(existing.content) === id) {
          log({ action: 'create', outcome: 'existing' });
          return { item: toItem(existing), created: false };
        }
      }
    }
    log({ action: 'create', outcome: 'conflict' });
    throw new InboxError('conflict', 'Too many inbox notes share that name. Nothing was written.');
  }

  /** Replaces a live note's content. The hidden id is kept, and expectedSha guards against a concurrent edit. */
  async function replace(
    path: string,
    content: string,
    expectedSha: string,
    signal: AbortSignal,
  ): Promise<InboxItem> {
    if (!isLiveInboxPath(path)) throw new InboxError('invalid', 'Only live inbox notes can be changed.');
    if (!/^[\da-f]{40}$/iu.test(expectedSha)) throw new InboxError('invalid', 'The note version is invalid.');
    const current = await vault.read(path, signal);
    if (!current) throw new InboxError('not_found', 'That inbox note no longer exists.');
    if (current.sha !== expectedSha.toLowerCase()) {
      log({ action: 'replace', outcome: 'conflict' });
      throw new InboxError('conflict', 'The note changed since it was read. Read it again.');
    }
    // The identity is the stored one; a marker in the caller's text is never adopted (withId strips it).
    const next = withId(content, noteId(current.content) ?? newInboxId());
    assertSavable(next);
    try {
      await vault.write(path, next, 'jarvis: update an inbox item\n\nCo-authored-by: Jarvis', current.sha, signal);
    } catch (error) {
      log({ action: 'replace', outcome: error instanceof VaultWriteConflictError ? 'conflict' : 'error' });
      if (error instanceof VaultWriteConflictError) {
        throw new InboxError('conflict', 'The note changed during the write. Read it again.', { cause: error });
      }
      throw error;
    }
    log({ action: 'replace', outcome: 'ok' });
    return toItem({ path, sha: blobSha(next), content: next });
  }

  /** Appends a trail line and moves the note to Inbox/Closed in one commit. The reason is free text. */
  async function close(path: string, reason: string, signal: AbortSignal, expectedSha?: string): Promise<InboxItem> {
    if (!isLiveInboxPath(path)) throw new InboxError('invalid', 'Only live inbox notes can be closed.');
    const current = await vault.read(path, signal);
    if (!current) throw new InboxError('not_found', 'That inbox note no longer exists.');
    if (expectedSha !== undefined && current.sha !== expectedSha.toLowerCase()) {
      log({ action: 'close', outcome: 'conflict' });
      throw new InboxError('conflict', 'The note changed since it was read. Read it again.');
    }
    const at = now();
    const id = noteId(current.content) ?? newInboxId();
    const closed = appendTrail(current.content, `closed: ${reason}`, at, id);
    for (let copy = 1; copy <= maxCreateAttempts; copy += 1) {
      signal.throwIfAborted();
      const target = closedPathFor(path, copy);
      try {
        await vault.move(path, target, closed, current.sha, 'jarvis: close an inbox item\n\nCo-authored-by: Jarvis', signal);
        log({ action: 'close', outcome: 'ok' });
        return toItem({ path: target, sha: blobSha(closed), content: closed });
      } catch (error) {
        if (!(error instanceof VaultWriteConflictError)) {
          log({ action: 'close', outcome: 'error' });
          throw error;
        }
        // The source changed, or the target name is taken: only the second is worth another name.
        const [source, taken] = await Promise.all([vault.read(path, signal), vault.read(target, signal)]);
        if (source?.sha !== current.sha) {
          log({ action: 'close', outcome: 'conflict' });
          throw new InboxError('conflict', 'The note changed during the close. Read it again.', { cause: error });
        }
        if (!taken) {
          log({ action: 'close', outcome: 'conflict' });
          throw new InboxError('conflict', 'The note could not be closed right now. Try again.', { cause: error });
        }
      }
    }
    log({ action: 'close', outcome: 'conflict' });
    throw new InboxError('conflict', 'Too many closed notes share that name. Nothing was moved.');
  }

  return {
    create,
    list,
    find,
    read: readNote,
    replace,
    close,
    async entries(signal: AbortSignal): Promise<InboxEntry[]> {
      return entries(await vault.tree(signal));
    },
  };
}

export type InboxStore = ReturnType<typeof createInboxStore>;
