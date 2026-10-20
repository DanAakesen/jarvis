import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotesClient, maxNoteBytes, newNotePath, NoteConflict, NoteSaveUnverified, readNote, readNotePage, readNoteTree, safeNoteFolder, safeNotePath } from './notes-data';

const oldSha = 'a'.repeat(40);
const newSha = 'b'.repeat(40);
const commit = 'c'.repeat(40);
const note = { path: 'Work/fixture.md', content: '---\ntags: [fixture]\n---\n# Fixture\n\nRaw text.\n', sha: oldSha, url: 'https://github.com/example/vault/blob/master/Work/fixture.md' };
const summary = { path: note.path, title: 'Fixture', folder: 'Work', directory: 'Work', updatedAt: '2026-10-11T00:00:00Z' };
const tree = { directories: ['Assets', 'Customers', 'Customers/Novaro', 'Meetings', '_agent-log'], rootNoteCount: 3, truncated: false, updatedAt: '2026-10-11T17:00:00Z' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const client = () => createNotesClient('https://api.example.com/', async () => 'fixture-token');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Notes contract', () => {
  it('keeps raw front matter and exact whitespace with the Contents SHA', () => {
    expect(readNote(note)).toEqual(note);
    expect(readNotePage({ notes: [summary], limit: 50, offset: 0, hasMore: false }).notes).toEqual([summary]);
  });
  it.each(['../Work/a.md', './a.md', 'Work/../a.md', 'Work//a.md', 'Work/a\\b.md', 'Work/a.md?x', '/a.md', 'Work/a%20.md', 'Work/a\0.md', `Work/${'a'.repeat(180)}.md`, 'Work/cafe\u0301.md', 'Work/\ud800.md', '.github/review.md', 'Work/.obsidian/review.md', 'Work/.hidden.md'])('rejects unsafe or noncanonical paths: %s', path => {
    expect(safeNotePath(path)).toBe(false);
  });
  it('accepts full-vault, root and nested Unicode Markdown and creates safe title slugs', () => {
    expect(safeNotePath('Work/project/Notes.md')).toBe(true);
    expect(safeNotePath('People/René.md')).toBe(true);
    expect(newNotePath('General', ' Café / test? #100% ')).toBe('General/cafe-test-100.md');
    expect(newNotePath('Work', '...')).toBe('');
    expect(safeNotePath('Customers/Novaro/review.md')).toBe(true);
    expect(safeNotePath('_agent-log/latest.md')).toBe(true);
    expect(safeNotePath('.archive/review.md')).toBe(false);
    expect(safeNotePath('AGENTS.md')).toBe(true);
    expect(newNotePath('Customers/Novaro', 'Review')).toBe('Customers/Novaro/review.md');
    expect(newNotePath('', 'Review')).toBe('review.md');
    expect(newNotePath('../Customers', 'Review')).toBe('');
    expect(safeNoteFolder('')).toBe(true);
    expect(safeNoteFolder('Meetings/2026')).toBe(true);
    expect(safeNoteFolder('Work/..')).toBe(false);
    expect(safeNoteFolder(`Assets/${'a'.repeat(173)}`)).toBe(true);
    expect(safeNotePath(`Assets/${'a'.repeat(173)}/a.md`)).toBe(false);
  });
  it.each([
    { ...note, sha: commit.slice(1) }, { ...note, path: 'Work/../hidden.md' },
    { ...note, url: 'javascript:alert(1)' }, { ...note, url: 'https://github.com.evil.example/a' },
    { ...note, content: '\ud800' }, { ...note, content: 'a'.repeat(maxNoteBytes + 1) },
  ])('rejects malformed notes', value => expect(() => readNote(value)).toThrow('invalid note'));
  it('rejects duplicate, invalid folder, invalid timestamp and oversized pages', () => {
    for (const notes of [[summary, summary], [{ ...summary, folder: 'General' }], [{ ...summary, updatedAt: 'not a date' }], Array(101).fill(summary)]) {
      expect(() => readNotePage({ notes, limit: 50, offset: 0, hasMore: false })).toThrow('invalid notes list');
    }
  });
  it('reads summaries for any top-level folder and root-level notes', () => {
    const notes = [{ ...summary, path: 'Customers/Novaro/review.md', folder: 'Customers', directory: 'Customers/Novaro' },
      { ...summary, path: 'AGENTS.md', folder: '', directory: '' }];
    expect(readNotePage({ notes, limit: 50, offset: 0, hasMore: false }).notes).toEqual(notes);
  });
  it('derives a full parent directory for older responses and rejects contradictory new metadata', () => {
    expect(readNotePage({ notes: [{ ...summary, directory: undefined }], limit: 50, offset: 0, hasMore: false }).notes[0]?.directory).toBe('Work');
    expect(() => readNotePage({ notes: [{ ...summary, directory: 'General' }], limit: 50, offset: 0, hasMore: false })).toThrow('invalid notes list');
  });
  it('validates actual vault trees and retains explicit partial/freshness metadata', () => {
    expect(readNoteTree(tree)).toEqual(tree);
    expect(readNoteTree({ ...tree, directories: [], rootNoteCount: 0, truncated: true })).toMatchObject({ directories: [], rootNoteCount: 0, truncated: true });
    expect(readNoteTree({ ...tree, directories: [], rootNoteCount: 3 })).toMatchObject({ directories: [], rootNoteCount: 3 });
  });
  it('accepts exactly 10,000 unique directories and rejects the next entry', () => {
    const directories = Array.from({ length: 10_000 }, (_, index) => `Folder-${String(index).padStart(5, '0')}`);
    expect(readNoteTree({ ...tree, directories, rootNoteCount: 10_000, truncated: true }).directories).toEqual(directories);
    expect(() => readNoteTree({ ...tree, directories: [...directories, 'Folder-10000'] })).toThrow('invalid vault folder tree');
  });
  it.each([
    { ...tree, directories: ['Customers', 'Customers'] },
    { ...tree, directories: ['../Customers'] },
    { ...tree, directories: ['.obsidian'] },
    { ...tree, directories: ['Work/a\\b'] },
    { ...tree, directories: ['Work/cafe\u0301'] },
    { ...tree, directories: Array(10_001).fill('Work') },
    { ...tree, directories: [''] },
    { ...tree, directories: undefined },
    { ...tree, directories: ['Customers', ''] },
    { ...tree, rootNoteCount: -1 },
    { ...tree, rootNoteCount: 1.5 },
    { ...tree, rootNoteCount: 10_001 },
    { ...tree, truncated: 'false' },
    { ...tree, updatedAt: undefined },
    { ...tree, updatedAt: null },
    { ...tree, updatedAt: 'not a date' },
    { ...tree, updatedAt: '2026-10-11' },
  ])('rejects malformed vault tree responses', value => expect(() => readNoteTree(value)).toThrow('invalid vault folder tree'));
  it('loads the authenticated git-tree endpoint and exposes deployment/permission errors without a list fallback', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(tree));
    vi.stubGlobal('fetch', fetch);
    expect(await client().tree(new AbortController().signal)).toEqual(tree);
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.example.com/notes/tree');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer fixture-token' } });
    fetch.mockImplementationOnce(async () => json({ error: 'Not found' }, 404));
    await expect(client().tree(new AbortController().signal)).rejects.toThrow('awaiting deployment');
    fetch.mockImplementationOnce(async () => json({ error: 'Forbidden' }, 403));
    await expect(client().tree(new AbortController().signal)).rejects.toThrow('only to the owner');
    fetch.mockImplementationOnce(async () => json({ error: 'Index not ready' }, 503));
    await expect(client().tree(new AbortController().signal)).rejects.toThrow('Wait for the vault index');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('sends authenticated bounded filter/page requests', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ notes: [], limit: 50, offset: 50, hasMore: false }));
    vi.stubGlobal('fetch', fetch);
    await client().list('  review  ', 'Work', 50, new AbortController().signal);
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('query')).toBe('review');
    expect(new URL(String(url)).searchParams.get('folder')).toBe('Work');
    expect(new URL(String(url)).searchParams.get('limit')).toBe('50');
    expect(new URL(String(url)).searchParams.get('offset')).toBe('50');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
    expect(init?.cache).toBe('no-store');
  });
  it('lists one directory at a time, including the vault root, and rejects a page from another directory', async () => {
    const rootNote = { path: 'Readme.md', title: 'Readme', folder: '', directory: '', updatedAt: '2026-10-11T00:00:00Z' };
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ notes: [rootNote], limit: 50, offset: 0, hasMore: false }))
      .mockResolvedValueOnce(json({ notes: [summary], limit: 50, offset: 50, hasMore: true }))
      .mockResolvedValueOnce(json({ notes: [summary], limit: 50, offset: 0, hasMore: false }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const root = await client().listDirectory('', 0, signal);
    expect(root.notes.map(item => item.path)).toEqual(['Readme.md']);
    const first = new URL(String(fetch.mock.calls[0]![0])).searchParams;
    expect(first.get('directory')).toBe('');
    expect(first.has('directory')).toBe(true);
    expect(first.get('limit')).toBe('50');
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });

    const work = await client().listDirectory('Work', 50, signal);
    expect(work.hasMore).toBe(true);
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('directory')).toBe('Work');
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('offset')).toBe('50');
    await expect(client().listDirectory('Customers', 0, signal)).rejects.toThrow('wrong notes page');
    await expect(client().listDirectory('../Work', 0, signal)).rejects.toThrow('valid notes folder');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('uses POST without a revision for create and PUT with the loaded blob SHA for edit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ path: note.path, commit, url: `https://github.com/example/vault/commit/${commit}` }));
    vi.stubGlobal('fetch', fetch);
    await client().save(note.path, note.content, null);
    await client().save(note.path, note.content, oldSha);
    expect(fetch.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method, JSON.parse(String(init?.body))])).toEqual([
      ['/notes', 'POST', { path: note.path, content: note.content }],
      ['/notes/note', 'PUT', { path: note.path, content: note.content, sha: oldSha }],
    ]);
  });
  it('enforces the exact 256 KiB UTF-8 limit, accepts astral text, rejects limit + 1 and invalid text', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ path: note.path, commit, url: `https://github.com/example/vault/commit/${commit}` }));
    vi.stubGlobal('fetch', fetch);
    await client().save(note.path, 'a'.repeat(maxNoteBytes), oldSha);
    await client().save(note.path, '\u{1f642}'.repeat(maxNoteBytes / 4), oldSha);
    for (const draft of ['a'.repeat(maxNoteBytes + 1), 'é'.repeat(maxNoteBytes / 2 + 1), '\ud800', '\0', '   ']) {
      await expect(client().save(note.path, draft, oldSha)).rejects.toThrow('256 KiB');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('exposes a conflict without retrying or overwriting', async () => {
    const fetch = vi.fn(async () => json({ error: 'Changed', currentSha: newSha, content: 'Latest' }, 409));
    vi.stubGlobal('fetch', fetch);
    await expect(client().save(note.path, 'Draft', oldSha)).rejects.toMatchObject({ currentSha: newSha, content: 'Latest' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new NoteConflict(null, null).message).toContain('changed elsewhere');
  });
  it.each([
    () => Promise.resolve(json({ error: 'Unavailable' }, 503)),
    () => Promise.resolve(json({ path: note.path, commit: 'invalid', url: note.url })),
    () => Promise.reject(new TypeError('network unavailable')),
  ])('distinguishes uncertain writes and does not retry them', async response => {
    const fetch = vi.fn(response);
    vi.stubGlobal('fetch', fetch);
    await expect(client().save(note.path, 'Draft', oldSha)).rejects.toBeInstanceOf(NoteSaveUnverified);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports safe write refusals without treating them as a successful save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Nothing was written.' }, 400)));
    await expect(client().save(note.path, 'Draft', oldSha)).rejects.toThrow('Nothing was written.');
  });
  it('rejects a mismatched note response instead of opening another file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...note, path: 'General/other.md' })));
    await expect(client().read(note.path)).rejects.toThrow('different note');
  });
  it('cancels a read while sign-in is pending without making a backend request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = createNotesClient('https://api.example.com', () => new Promise<string>(() => {}))
      .read(note.path, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('sign-in needs attention');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds sign-in before a save and never submits after its deadline', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let finish!: (token: string) => void;
    const pending = createNotesClient('https://api.example.com', () => new Promise<string>(resolve => { finish = resolve; }))
      .save(note.path, 'Draft', oldSha);
    deadline.abort();
    await expect(pending).rejects.toThrow('sign-in needs attention');
    finish('fixture-token');
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
});
