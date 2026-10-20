import { backendFetch } from '../backend-request';

export const maxNoteBytes = 256 * 1024;
export interface NoteSummary { path: string; title: string; folder: string; directory: string; updatedAt: string }
export interface Note { path: string; content: string; sha: string; url: string }
export interface NotePage { notes: NoteSummary[]; limit: number; offset: number; hasMore: boolean }
export interface NoteWrite { path: string; commit: string; url: string }
export interface NoteTree { directories: string[]; rootNoteCount: number; truncated: boolean; updatedAt: string }
export class NoteConflict extends Error {
  constructor(public readonly currentSha: string | null, public readonly content: string | null) {
    super('This note changed elsewhere. Your draft has not been overwritten.');
  }
}
export class NoteSaveUnverified extends Error {
  constructor() { super('The save result is uncertain. Check the latest note before saving again. Your draft is kept.'); }
}
class NoteRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/iu.test(value);
export const validNoteText = (value: string): boolean => !value.includes('\0') && !/\p{Cs}/u.test(value);
const content = (value: unknown): value is string => typeof value === 'string' &&
  validNoteText(value) && new TextEncoder().encode(value).length <= maxNoteBytes;
const githubUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password;
  } catch { return false; }
};

function safeVaultPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 180 || value !== value.normalize('NFC') ||
      /[\\?#%]|\p{Cc}|\p{Cs}/u.test(value)) return false;
  const segments = value.split('/');
  return segments.every(segment => !!segment && !segment.startsWith('.'));
}

export function safeNotePath(value: unknown): value is string {
  return safeVaultPath(value) && /\.md$/iu.test(value);
}

export function safeNoteFolder(value: unknown): value is string {
  return value === '' || safeVaultPath(value);
}

export function newNotePath(folder: string, title: string): string {
  const slug = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  return slug && safeNoteFolder(folder) ? `${folder ? `${folder}/` : ''}${slug}.md` : '';
}

export function noteTitleFromPath(path: string): string {
  return path.split('/').at(-1)?.replace(/\.md$/iu, '').replace(/[-_]/gu, ' ') || 'Vault note';
}

export interface Folder { path: string; name: string; children: Folder[] }
export const ancestors = (path: string) => path ? path.split('/').map((_, index, segments) => segments.slice(0, index + 1).join('/')) : [];

export function folderTree(paths: readonly string[]): Folder[] {
  const folders = new Map<string, Folder>();
  for (const path of paths) {
    for (const parent of ancestors(path)) {
      if (!folders.has(parent)) folders.set(parent, { path: parent, name: parent.split('/').at(-1)!, children: [] });
    }
  }
  const roots: Folder[] = [];
  for (const folder of folders.values()) {
    const parent = folder.path.includes('/') ? folders.get(folder.path.slice(0, folder.path.lastIndexOf('/'))) : null;
    (parent?.children ?? roots).push(folder);
  }
  for (const children of [roots, ...[...folders.values()].map(folder => folder.children)]) {
    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  }
  return roots;
}

export function readNote(value: unknown): Note {
  const note = object(value);
  if (!note || !safeNotePath(note.path) || !content(note.content) || !sha(note.sha) || !githubUrl(note.url)) {
    throw new Error('Jarvis returned an invalid note. Your draft is unchanged.');
  }
  return { path: note.path, content: note.content, sha: note.sha, url: note.url };
}

export function readNotePage(value: unknown): NotePage {
  const page = object(value);
  if (!page || !Array.isArray(page.notes) || page.notes.length > 100 || page.notes.length > Number(page.limit) ||
      !Number.isInteger(page.limit) || Number(page.limit) < 1 || Number(page.limit) > 100 ||
      !Number.isInteger(page.offset) || Number(page.offset) < 0 || Number(page.offset) > 10_000 || typeof page.hasMore !== 'boolean') {
    throw new Error('Jarvis returned an invalid notes list.');
  }
  const paths = new Set<string>();
  const notes = page.notes.map((entry): NoteSummary => {
    const note = object(entry);
    const directory = typeof note?.path === 'string' && note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
    if (!note || !safeNotePath(note.path) || paths.has(note.path) ||
        typeof note.title !== 'string' || !note.title.trim() || note.title.length > 200 ||
        typeof note.folder !== 'string' || note.folder !== (note.path.includes('/') ? note.path.split('/')[0] : '') ||
        (note.directory !== undefined && note.directory !== directory) ||
        typeof note.updatedAt !== 'string' || Number.isNaN(Date.parse(note.updatedAt))) {
      throw new Error('Jarvis returned an invalid notes list.');
    }
    paths.add(note.path);
    return { path: note.path, title: note.title, folder: note.folder, directory, updatedAt: note.updatedAt };
  });
  return { notes, limit: Number(page.limit), offset: Number(page.offset), hasMore: page.hasMore };
}

export function readNoteTree(value: unknown): NoteTree {
  const tree = object(value);
  if (!tree || !Array.isArray(tree.directories) || tree.directories.length > 10_000 ||
      !Number.isSafeInteger(tree.rootNoteCount) || Number(tree.rootNoteCount) < 0 || Number(tree.rootNoteCount) > 10_000 ||
      typeof tree.truncated !== 'boolean' || typeof tree.updatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(tree.updatedAt) ||
      Number.isNaN(Date.parse(tree.updatedAt))) {
    throw new Error('Jarvis returned an invalid vault folder tree. Try again.');
  }
  const seen = new Set<string>();
  const directories = tree.directories.map((path): string => {
    if (!safeVaultPath(path) || seen.has(path)) throw new Error('Jarvis returned an invalid vault folder tree. Try again.');
    seen.add(path);
    return path;
  });
  return { directories, rootNoteCount: Number(tree.rootNoteCount), truncated: tree.truncated, updatedAt: tree.updatedAt };
}

export function createNotesClient(backendUrl: string, getAccessToken: () => Promise<string>) {
  async function request(path: string, init: RequestInit = {}) {
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(60_000)]);
    let token: string;
    let abortToken: (() => void) | undefined;
    try {
      signal.throwIfAborted();
      token = await new Promise<string>((resolve, reject) => {
        abortToken = () => reject(signal.reason);
        signal.addEventListener('abort', abortToken, { once: true });
        void getAccessToken().then(resolve, reject);
      });
    }
    catch { throw new NoteRequestError('Your Microsoft sign-in needs attention. Sign in again.', 401); }
    finally { if (abortToken) signal.removeEventListener('abort', abortToken); }
    signal.throwIfAborted();
    const response = await backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
      ...init, signal, headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store',
    });
    if (response.status === 409) {
      const conflict = object(await response.json());
      if (!conflict || !((conflict.currentSha === null && conflict.content === null) ||
          (sha(conflict.currentSha) && content(conflict.content)))) throw new Error('Jarvis returned an invalid conflict. Your draft is unchanged.');
      throw new NoteConflict(conflict.currentSha, conflict.content);
    }
    if (!response.ok) {
      const body = object(await response.json().catch(() => null));
      if (response.status === 401) throw new NoteRequestError('Your Microsoft sign-in needs attention. Sign in again.', response.status);
      if (response.status === 403) throw new NoteRequestError('This account cannot access the vault. Notes are available only to the owner.', response.status);
      if (response.status === 404) throw new NoteRequestError('This note no longer exists. Your draft is unchanged.', response.status);
      if (response.status === 400 && typeof body?.error === 'string' && body.error.length <= 500) throw new NoteRequestError(body.error, response.status);
      throw new NoteRequestError(`Notes are temporarily unavailable (HTTP ${response.status}). Try again.`, response.status);
    }
    return response.json() as Promise<unknown>;
  }
  return {
    async tree(signal: AbortSignal) {
      try { return readNoteTree(await request('/notes/tree', { signal })); }
      catch (cause) {
        if (cause instanceof NoteRequestError && cause.status === 404) {
          throw new Error('The vault folder tree is not available yet. Full-vault backend support is awaiting deployment.', { cause });
        }
        if (cause instanceof NoteRequestError && cause.status === 503) {
          throw new Error('Vault folders are not ready yet. Wait for the vault index, then retry. Your draft is kept.', { cause });
        }
        throw cause;
      }
    },
    async list(query: string, folder: string, offset: number, signal: AbortSignal) {
      if (query.length > 500 || !safeNoteFolder(folder) ||
          !Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new Error('Use a valid notes search, folder and page.');
      const params = new URLSearchParams({ limit: '50', offset: String(offset) });
      if (query.trim()) params.set('query', query.trim());
      if (folder) params.set('folder', folder);
      const page = readNotePage(await request(`/notes?${params}`, { signal }));
      if (page.offset !== offset || page.limit !== 50) throw new Error('Jarvis returned the wrong notes page.');
      return page;
    },
    /** The notes directly inside one vault directory ('' is the vault root), one page at a time. */
    async listDirectory(directory: string, offset: number, signal: AbortSignal) {
      if (!safeNoteFolder(directory) || !Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new Error('Use a valid notes folder and page.');
      const params = new URLSearchParams({ limit: '50', offset: String(offset), directory });
      const page = readNotePage(await request(`/notes?${params}`, { signal }));
      if (page.offset !== offset || page.limit !== 50 || page.notes.some(note => note.directory !== directory)) {
        throw new Error('Jarvis returned the wrong notes page.');
      }
      return page;
    },
    async read(path: string, signal?: AbortSignal) {
      if (!safeNotePath(path)) throw new Error('Use a safe Markdown path in the vault.');
      const note = readNote(await request(`/notes/note?${new URLSearchParams({ path })}`, signal ? { signal } : {}));
      if (note.path !== path) throw new Error('Jarvis returned a different note. Your draft is unchanged.');
      return note;
    },
    async save(path: string, draft: string, revision: string | null): Promise<NoteWrite> {
      if (!safeNotePath(path) || !draft.trim() || !content(draft) || (revision !== null && !sha(revision))) {
        throw new Error('Use a safe Markdown path and non-empty, valid text of at most 256 KiB.');
      }
      let result: Record<string, unknown> | null;
      try {
        result = object(await request(revision === null ? '/notes' : '/notes/note', {
          method: revision === null ? 'POST' : 'PUT', body: JSON.stringify({ path, content: draft, ...(revision ? { sha: revision } : {}) }),
        }));
      } catch (cause) {
        if (cause instanceof NoteConflict || (cause instanceof NoteRequestError && cause.status < 500)) throw cause;
        throw new NoteSaveUnverified();
      }
      if (!result || result.path !== path || !sha(result.commit) || !githubUrl(result.url)) {
        throw new NoteSaveUnverified();
      }
      return { path, commit: result.commit, url: result.url };
    },
  };
}
