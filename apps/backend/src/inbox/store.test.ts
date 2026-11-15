import { describe, expect, it } from 'vitest';
import { VaultWriteConflictError, VaultFileTooLargeError, type VaultFile, type VaultTreeFile } from '../vault/github-client.js';
import { blobSha, noteId } from './note.js';
import { createInboxStore, type InboxVault } from './store.js';

const signal = new AbortController().signal;
const at = new Date('2026-11-14T21:41:00Z');

function memoryVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  const sha = (path: string) => blobSha(files.get(path)!);
  const vault: InboxVault = {
    async tree(): Promise<VaultTreeFile[]> {
      return [...files.keys()].map((path) => ({ path, sha: sha(path) }));
    },
    async read(path: string): Promise<VaultFile | null> {
      const content = files.get(path);
      if (content === undefined) return null;
      if (content === 'TOO LARGE') throw new VaultFileTooLargeError();
      return { path, sha: sha(path), content };
    },
    async write(path: string, content: string, _message: string, expected: string | undefined) {
      calls.push(`write ${path}`);
      if (files.has(path) ? expected !== sha(path) : expected !== undefined) throw new VaultWriteConflictError();
      files.set(path, content);
      return 'c'.repeat(40);
    },
    async move(from: string, to: string, content: string, expected: string) {
      calls.push(`move ${from} -> ${to}`);
      if (!files.has(from) || sha(from) !== expected || files.has(to)) throw new VaultWriteConflictError();
      files.delete(from);
      files.set(to, content);
      return 'd'.repeat(40);
    },
  };
  return { files, calls, vault, sha };
}

function store(initial?: Record<string, string>) {
  const memory = memoryVault(initial);
  return { ...memory, inbox: createInboxStore({ vault: memory.vault, now: () => at }) };
}

describe('inbox store', () => {
  it('creates one note per item, create-only, and returns the version it wrote', async () => {
    const { inbox, files, sha } = store();
    const { item, created } = await inbox.create({ title: 'Padel night', note: 'team evening', quote: 'padel?' }, signal);
    expect(created).toBe(true);
    expect(item.path).toBe('Inbox/2026-11-14 Padel night.md');
    expect(item.sha).toBe(sha(item.path));
    expect(files.get(item.path)).toContain('> Dan, 14 Nov 22:41: "padel?"');
    expect(item.title).toBe('Padel night');
    expect(noteId(files.get(item.path)!)).toBe(item.id);
  });

  it('gives a same-name item a suffix instead of overwriting', async () => {
    const { inbox, files } = store();
    const first = await inbox.create({ title: 'Idea', note: 'one' }, signal);
    const second = await inbox.create({ title: 'Idea', note: 'two' }, signal);
    expect(second.item.path).toBe('Inbox/2026-11-14 Idea 2.md');
    expect(files.get(first.item.path)).toContain('one');
    expect(files.size).toBe(2);
  });

  it('is idempotent for a retry that carries the same id', async () => {
    const { inbox, files } = store();
    const first = await inbox.create({ title: 'Idea', note: 'one', id: 'aaaaaaaa' }, signal);
    const retry = await inbox.create({ title: 'Idea', note: 'one', id: 'aaaaaaaa' }, signal);
    expect(retry.created).toBe(false);
    expect(retry.item.path).toBe(first.item.path);
    expect(files.size).toBe(1);
    await expect(inbox.create({ title: 'Idea', note: 'x', id: 'not-an-id' }, signal)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('lists live notes first, filters by query, hides Closed unless asked, and skips what is not an inbox note', async () => {
    const { inbox } = store({
      'Inbox/2026-11-12 Older.md': '# Older\n\nabout padel\n',
      'Inbox/2026-11-14 Newer.md': '# Newer\n\nabout tax\n\n<!-- jarvis-inbox:11111111 -->\n',
      'Inbox/Closed/2026-11-01 Done.md': '# Done\n\nabout padel\n',
      'Inbox/big.md': 'TOO LARGE',
      'Personal/Task inbox.md': '- [ ] a task\n',
      'Inbox/notes.txt': 'x',
    });
    const live = await inbox.list({}, signal);
    expect(live.items.map((item) => item.title)).toEqual(['Older', 'Newer']);
    expect(live.items[1]!.id).toBe('11111111');
    expect(live.items[0]!.id).toMatch(/^[0-9a-f]{8}$/u);
    expect((await inbox.list({ includeClosed: true }, signal)).items.map((item) => item.closed)).toEqual([false, false, true]);
    expect((await inbox.list({ query: 'PADEL' }, signal)).items.map((item) => item.title)).toEqual(['Older']);
    expect((await inbox.list({ limit: 1 }, signal))).toMatchObject({ truncated: true, items: [{ title: 'Older' }] });
    expect((await inbox.find('11111111', signal))?.title).toBe('Newer');
    expect(await inbox.find('22222222', signal)).toBeNull();
  });

  it('closes by moving to Closed with a trail line, in one move, never a delete', async () => {
    const { inbox, files, calls } = store({ 'Inbox/2026-11-14 Idea.md': '# Idea\n\nbody\n' });
    const closed = await inbox.close('Inbox/2026-11-14 Idea.md', 'binned, not for this year', signal);
    expect(closed.closed).toBe(true);
    expect(closed.path).toBe('Inbox/Closed/2026-11-14 Idea.md');
    expect(files.has('Inbox/2026-11-14 Idea.md')).toBe(false);
    expect(files.get(closed.path)).toContain('- 14 Nov: closed: binned, not for this year');
    expect(noteId(files.get(closed.path)!)).toBeDefined();
    expect(calls).toEqual(['move Inbox/2026-11-14 Idea.md -> Inbox/Closed/2026-11-14 Idea.md']);
  });

  it('renames into Closed when the name is already taken, and refuses a stale or missing note', async () => {
    const { inbox, files } = store({
      'Inbox/2026-11-14 Idea.md': '# Idea\n',
      'Inbox/Closed/2026-11-14 Idea.md': '# Older idea\n',
    });
    expect((await inbox.close('Inbox/2026-11-14 Idea.md', 'done', signal)).path).toBe('Inbox/Closed/2026-11-14 Idea 2.md');
    expect(files.get('Inbox/Closed/2026-11-14 Idea.md')).toBe('# Older idea\n');
    await expect(inbox.close('Inbox/2026-11-14 Gone.md', 'x', signal)).rejects.toMatchObject({ code: 'not_found' });
    await expect(inbox.close('Inbox/Closed/2026-11-14 Idea.md', 'x', signal)).rejects.toMatchObject({ code: 'invalid' });
    await expect(inbox.close('Personal/a.md', 'x', signal)).rejects.toMatchObject({ code: 'invalid' });
    const stale = store({ 'Inbox/a.md': '# A\n' });
    await expect(stale.inbox.close('Inbox/a.md', 'x', signal, 'f'.repeat(40))).rejects.toMatchObject({ code: 'conflict' });
    expect(stale.files.has('Inbox/a.md')).toBe(true);
  });

  it('leaves the note live when the source changes during the move', async () => {
    const memory = memoryVault({ 'Inbox/a.md': '# A\n' });
    const inbox = createInboxStore({
      vault: {
        ...memory.vault,
        async move() {
          memory.files.set('Inbox/a.md', '# A edited in Obsidian\n');
          throw new VaultWriteConflictError();
        },
      },
      now: () => at,
    });
    await expect(inbox.close('Inbox/a.md', 'x', signal)).rejects.toMatchObject({ code: 'conflict' });
    expect(memory.files.get('Inbox/a.md')).toBe('# A edited in Obsidian\n');
  });

  it('replaces a live note only at the expected version, keeping the hidden id', async () => {
    const { inbox, files, sha } = store({ 'Inbox/a.md': '# A\n\nold\n\n<!-- jarvis-inbox:11111111 -->\n' });
    const updated = await inbox.replace('Inbox/a.md', '# A\n\nnew, with no id\n', sha('Inbox/a.md'), signal);
    expect(noteId(files.get('Inbox/a.md')!)).toBe('11111111');
    expect(updated.sha).toBe(sha('Inbox/a.md'));
    await expect(inbox.replace('Inbox/a.md', '# A\n', 'f'.repeat(40), signal)).rejects.toMatchObject({ code: 'conflict' });
    await expect(inbox.replace('Inbox/a.md', 'token: x\npassword: abcdefghij', sha('Inbox/a.md'), signal)).rejects.toMatchObject({ code: 'refused' });
    await expect(inbox.replace('Inbox/Closed/a.md', '# A\n', sha('Inbox/a.md'), signal)).rejects.toMatchObject({ code: 'invalid' });
    expect(files.get('Inbox/a.md')).toContain('new, with no id');
  });

  it('finds an item by id however many notes there are, live or closed', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 205; index += 1) {
      const id = index.toString(16).padStart(8, '0');
      files[`Inbox/2026-11-01 Note ${String(index).padStart(3, '0')}.md`] = `# Note ${index}\n\n<!-- jarvis-inbox:${id} -->\n`;
    }
    files['Inbox/Closed/2026-10-01 Old.md'] = '# Old\n\n<!-- jarvis-inbox:ffffffff -->\n';
    const { inbox } = store(files);
    expect((await inbox.find('000000cc', signal))?.title).toBe('Note 204');
    expect((await inbox.find('ffffffff', signal))?.closed).toBe(true);
    expect(await inbox.find('eeeeeeee', signal)).toBeNull();
  });

  it('resolves a supplied id in the vault first: no duplicate across midnight, a new title spelling, a rename or a close', async () => {
    const memory = memoryVault();
    let clock = new Date('2026-11-14T21:41:00Z');
    const inbox = createInboxStore({ vault: memory.vault, now: () => clock });
    const first = await inbox.create({ title: 'Padel night', note: 'one', id: 'aaaaaaaa' }, signal);
    clock = new Date('2026-11-14T23:30:00Z');
    expect((await inbox.create({ title: 'Padel Night', note: 'again', id: 'aaaaaaaa' }, signal)).created).toBe(false);
    const closed = await inbox.close(first.item.path, 'binned', signal);
    const retry = await inbox.create({ title: 'Something else', note: 'again', id: 'aaaaaaaa' }, signal);
    expect(retry).toMatchObject({ created: false, item: { path: closed.path, closed: true } });
    expect(memory.files.size).toBe(1);
  });

  it('never adopts an identity marker from replacement text', async () => {
    const { inbox, files, sha } = store({
      'Inbox/a.md': '# A\n\nfrom another tool\n',
      'Inbox/b.md': '# B\n\n<!-- jarvis-inbox:bbbbbbbb -->\n',
    });
    await inbox.replace('Inbox/a.md', '# A\n\ncopied <!-- jarvis-inbox:bbbbbbbb -->\n', sha('Inbox/a.md'), signal);
    const id = noteId(files.get('Inbox/a.md')!);
    expect(id).toMatch(/^[0-9a-f]{8}$/u);
    expect(id).not.toBe('bbbbbbbb');
    expect(files.get('Inbox/a.md')!.match(/jarvis-inbox/gu)).toHaveLength(1);
  });

  it('keeps the path-derived identity when the first edit adds a marker to a note from another tool', async () => {
    const { inbox, files, sha } = store({ 'Inbox/2026-11-01 From ChatGPT.md': '# From ChatGPT\n\nbody\n' });
    const before = (await inbox.read('Inbox/2026-11-01 From ChatGPT.md', signal))!.id;
    await inbox.replace('Inbox/2026-11-01 From ChatGPT.md', '# From ChatGPT\n\nbody, edited\n', sha('Inbox/2026-11-01 From ChatGPT.md'), signal);
    expect(noteId(files.get('Inbox/2026-11-01 From ChatGPT.md')!)).toBe(before);
    const closed = await inbox.close('Inbox/2026-11-01 From ChatGPT.md', 'done', signal);
    expect(closed.id).toBe(before);
  });

  it('never writes outside Inbox/', async () => {
    const { inbox, calls } = store();
    await inbox.create({ title: '../../Personal/Inbox', note: 'x' }, signal);
    expect(calls.every((call) => /^write Inbox\/[^/]+\.md$/u.test(call))).toBe(true);
    await expect(inbox.read('Personal/Task inbox.md', signal)).rejects.toMatchObject({ code: 'invalid' });
  });
});
