import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotesClient, maxNoteBytes, newNotePath, NoteConflict, NoteSaveUnverified, readNote, readNotePage, safeNotePath } from './notes-data';

const oldSha = 'a'.repeat(40);
const newSha = 'b'.repeat(40);
const commit = 'c'.repeat(40);
const note = { path: 'Work/fixture.md', content: '---\ntags: [fixture]\n---\n# Fixture\n\nRaw text.\n', sha: oldSha, url: 'https://github.com/example/vault/blob/master/Work/fixture.md' };
const summary = { path: note.path, title: 'Fixture', folder: 'Work', updatedAt: '2026-10-11T00:00:00Z' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const client = () => createNotesClient('https://api.example.com/', async () => 'fixture-token');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Notes contract', () => {
  it('keeps raw front matter and exact whitespace with the Contents SHA', () => {
    expect(readNote(note)).toEqual(note);
    expect(readNotePage({ notes: [summary], limit: 50, offset: 0, hasMore: false }).notes).toEqual([summary]);
  });
  it.each(['../Work/a.md', 'Work/.hidden.md', 'Work/../a.md', 'Work//a.md', 'Work/a\\b.md', 'Work/a.md?x', 'Other/a.md', 'Work/a%20.md', 'Work/a\0.md', `Work/${'a'.repeat(180)}.md`, 'Work/cafe\u0301.md'])('rejects unsafe or noncanonical paths: %s', path => {
    expect(safeNotePath(path)).toBe(false);
  });
  it('accepts nested routed Unicode Markdown and creates safe title slugs', () => {
    expect(safeNotePath('Work/project/Notes.md')).toBe(true);
    expect(safeNotePath('People/René.md')).toBe(true);
    expect(newNotePath('General', ' Café / test? #100% ')).toBe('General/cafe-test-100.md');
    expect(newNotePath('Work', '...')).toBe('');
  });
  it.each([
    { ...note, sha: commit.slice(1) }, { ...note, path: 'Work/.hidden.md' },
    { ...note, url: 'javascript:alert(1)' }, { ...note, url: 'https://github.com.evil.example/a' },
    { ...note, content: '\ud800' }, { ...note, content: 'a'.repeat(maxNoteBytes + 1) },
  ])('rejects malformed notes', value => expect(() => readNote(value)).toThrow('invalid note'));
  it('rejects duplicate, invalid folder, invalid timestamp and oversized pages', () => {
    for (const notes of [[summary, summary], [{ ...summary, folder: 'General' }], [{ ...summary, updatedAt: 'not a date' }], Array(101).fill(summary)]) {
      expect(() => readNotePage({ notes, limit: 50, offset: 0, hasMore: false })).toThrow('invalid notes list');
    }
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
