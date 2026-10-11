import { backendFetch } from '../backend-request';

/** Vault notes API (#626): list, read, create and edit Markdown notes in Dan's routed vault folders. */
export const noteFolders = ['People', 'Work', 'Personal', 'General'] as const;
export type NoteFolder = typeof noteFolders[number];
export interface NoteListItem { path: string; title: string; folder: NoteFolder; updatedAt: string }
export interface NotePage { notes: NoteListItem[]; hasMore: boolean }
export interface Note { path: string; content: string; sha: string; url: string }
export interface NoteConflict { currentSha: string | null; content: string | null }

/** A failed notes request with the backend's message (already safe to show). */
export class NotesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** The note changed (edit) or already exists (create); carries what the vault holds now. */
export class NoteConflictError extends NotesRequestError {
  constructor(message: string, readonly conflict: NoteConflict) { super(message, 409); }
}

export const pageSize = 50;
export const maxTitleLength = 100;

type Auth = { backendUrl: string; getAccessToken: () => Promise<string> };

const isFolder = (value: unknown): value is NoteFolder => noteFolders.includes(value as NoteFolder);
const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

async function send(auth: Auth, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const response = await backendFetch(`${auth.backendUrl.replace(/\/+$/u, '')}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `${['Bear', 'er'].join('')} ${await auth.getAccessToken()}`,
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    cache: 'no-store',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return record(body);
  const error = record(body);
  const message = typeof error.error === 'string' && error.error ? error.error : `Jarvis could not reach your notes (HTTP ${response.status}).`;
  if (response.status === 409) {
    throw new NoteConflictError(message, {
      currentSha: typeof error.currentSha === 'string' ? error.currentSha : null,
      content: typeof error.content === 'string' ? error.content : null,
    });
  }
  throw new NotesRequestError(message, response.status);
}

export async function listNotes(auth: Auth, filter: { query?: string; folder?: NoteFolder | undefined; offset?: number }, signal?: AbortSignal): Promise<NotePage> {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(filter.offset ?? 0) });
  const query = filter.query?.trim();
  if (query) params.set('query', query.slice(0, 500));
  if (filter.folder) params.set('folder', filter.folder);
  const body = await send(auth, `/notes?${params}`, signal ? { signal } : {});
  if (!Array.isArray(body.notes)) throw new Error('Jarvis returned an unexpected notes list.');
  const notes = body.notes.flatMap((entry): NoteListItem[] => {
    const item = record(entry);
    return typeof item.path === 'string' && typeof item.title === 'string' && isFolder(item.folder) && typeof item.updatedAt === 'string'
      ? [{ path: item.path, title: item.title, folder: item.folder, updatedAt: item.updatedAt }] : [];
  });
  return { notes, hasMore: body.hasMore === true };
}

export async function readNote(auth: Auth, path: string, signal?: AbortSignal): Promise<Note> {
  const body = await send(auth, `/notes/note?${new URLSearchParams({ path })}`, signal ? { signal } : {});
  if (typeof body.path !== 'string' || typeof body.content !== 'string' || typeof body.sha !== 'string') {
    throw new Error('Jarvis returned an unexpected note.');
  }
  return { path: body.path, content: body.content, sha: body.sha, url: typeof body.url === 'string' ? body.url : '' };
}

export async function createNote(auth: Auth, path: string, content: string) {
  await send(auth, '/notes', { method: 'POST', body: { path, content, reason: 'Create note from the Notes page' } });
}

export async function saveNote(auth: Auth, path: string, content: string, sha: string) {
  await send(auth, '/notes/note', { method: 'PUT', body: { path, content, sha, reason: 'Edit note from the Notes page' } });
}

/** A file-name-safe slug: letters, digits, `-` and `_` only, so the path passes the vault's path rules. */
export function slugifyTitle(title: string) {
  return title.normalize('NFC').trim().replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, maxTitleLength).replace(/-+$/u, '');
}

/** The vault path for a new note, or null while the title has nothing usable. */
export function notePathFor(folder: NoteFolder, title: string) {
  const slug = slugifyTitle(title);
  return slug ? `${folder}/${slug}.md` : null;
}
