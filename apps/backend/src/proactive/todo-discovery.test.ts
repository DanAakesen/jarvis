import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MAX_VAULT_FILE_BYTES } from '../vault/github-client.js';
import { filterVaultTasks, inScope, MAX_TODO_FILES, MAX_TODO_SCAN_BYTES, readVaultTasks, readVaultTodos, TODO_READ_CONCURRENCY } from './todo-discovery.js';
import { createTodosSource } from './sources/todos.js';
import { defaultProactiveSettings } from './store.js';

function fixture(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes));
  const sha = (content: string) => createHash('sha1').update(content).digest('hex');
  const vault = {
    tree: vi.fn(async () => [...files].map(([path, content]) => ({
      path, sha: sha(content), size: Buffer.byteLength(content),
    }))),
    read: vi.fn(async (path: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      const content = files.get(path);
      return content === undefined ? null : { path, sha: sha(content), content };
    }),
  };
  const source = createTodosSource(vault);
  const read = () => source.read({
    now: new Date('2031-04-09T10:00:00Z'),
    signal: new AbortController().signal,
    settings: defaultProactiveSettings(),
  });
  return { vault, files, read };
}

describe('vault task discovery', () => {
  it('shares the proactive scope and coalesces concurrent scans into one tree listing', async () => {
    expect([
      'Personal/Inbox.md', 'Work/Projects/Inbox.md', 'tasks.MD',
    ].every(inScope)).toBe(true);
    expect([
      'Other/Inbox.md', 'Personal/.hidden/Inbox.md', 'Work/Archive/Inbox.md', 'Personal/Inbox.txt',
    ].some(inScope)).toBe(false);
    const f = fixture({ 'Personal/Inbox.md': '# Home\n- [ ] Synthetic task' });
    const [first, second] = await Promise.all([
      readVaultTasks(f.vault, new AbortController().signal),
      readVaultTasks(f.vault, new AbortController().signal),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject([{ path: 'Personal/Inbox.md', line: 2, heading: 'Home' }]);
    expect(f.vault.tree).toHaveBeenCalledTimes(1);
  });

  it('filters read-model tasks by state, query and an optional date window', async () => {
    const f = fixture({
      'Personal/Inbox.md': [
        '- [ ] Synthetic overdue 📅 2031-04-08',
        '- [ ] Synthetic today 📅 2031-04-09',
        '- [x] Synthetic done',
      ].join('\n'),
    });
    const tasks = await readVaultTasks(f.vault, new AbortController().signal);
    expect(filterVaultTasks(tasks, { query: 'TODAY', state: 'open' }).map(({ text }) => text))
      .toEqual(['Synthetic today']);
    expect(filterVaultTasks(tasks, { state: 'done' }).map(({ text }) => text))
      .toEqual(['Synthetic done']);
    expect(filterVaultTasks(tasks, { state: 'all', dueWindowDays: 1, today: '2031-04-09' })
      .map(({ text }) => text)).toEqual(['Synthetic today']);
  });

  it('discovers scoped notes and root tasks, excludes archives and unsafe paths, and reuses unchanged SHAs', async () => {
    const task = (text: string) => `- [ ] Synthetic ${text} 🕒 14:00 ⏫ 📅 2031-04-09`;
    const f = fixture({
      'Personal/Inbox.md': task('personal'),
      'Work/Inbox.md': task('work'),
      'Work/Projects/Source.md': task('nested'),
      'Personal/Archive/Old.md': task('archived'),
      'Work/Nested/Archive/Old.md': task('also archived'),
      'Tasks.md': task('suggestion'),
      'Other/Note.md': task('unrelated'),
      'Personal/../Outside.md': task('traversal'),
      'Personal/.obsidian/Note.md': task('hidden'),
      'Personal/Unsafe%2f.md': task('encoded'),
      'Personal/Note.txt': task('not markdown'),
    });
    expect((await f.read()).facts.map(({ text }) => text)).toEqual([
      'Synthetic personal', 'Synthetic work', 'Synthetic nested', 'Synthetic suggestion',
    ]);
    expect(f.vault.read).toHaveBeenCalledTimes(4);
    await f.read();
    expect(f.vault.tree).toHaveBeenCalledTimes(2);
    expect(f.vault.read).toHaveBeenCalledTimes(4);
    f.files.set('Work/Inbox.md', task('changed'));
    expect((await f.read()).facts.map(({ text }) => text)).toContain('Synthetic changed');
    expect(f.vault.read).toHaveBeenCalledTimes(5);
  });

  it('works without a root dashboard and deduplicates by normalized text and due instant', async () => {
    const f = fixture({
      'Personal/Inbox.md': '- [ ] Synthetic task 🕒 14:00 ⏫ 📅 2031-04-09',
      'Work/Source.md': '- [ ] SYNTHETIC   task ⏫ 📅 2031-04-09 14:00',
    });
    expect((await f.read()).facts).toHaveLength(1);
    f.files.delete('Personal/Inbox.md');
    expect((await f.read()).facts).toHaveLength(1);
    expect(f.vault.read).toHaveBeenCalledTimes(2);
  });

  it('retains timed reminder eligibility when a date-only duplicate appears first', async () => {
    const f = fixture({
      'Personal/Inbox.md': '- [ ] Synthetic task ⏫ 📅 2031-04-09',
      'Work/Inbox.md': '- [ ] Synthetic task ⏫ 📅 2031-04-09 🕒 23:59',
    });
    expect(await f.read()).toMatchObject({
      state: 'ok',
      facts: [{ text: 'Synthetic task', dueAt: '2031-04-09T21:59:00.000Z', dueHasTime: true }],
    });
  });

  it('reports unavailable for file and byte caps without reading partial task lists', async () => {
    const many = fixture(Object.fromEntries(Array.from({ length: MAX_TODO_FILES + 1 }, (_, index) =>
      [`Personal/Note${index}.md`, '- [ ] Synthetic ⏫'])));
    expect(await many.read()).toMatchObject({ state: 'unavailable', reason: 'scan_limit', facts: [] });
    expect(many.vault.read).not.toHaveBeenCalled();

    const large = fixture({ 'Personal/Large.md': 'x'.repeat(MAX_VAULT_FILE_BYTES + 1) });
    expect(await large.read()).toMatchObject({ state: 'unavailable', reason: 'too_large', facts: [] });
    expect(large.vault.read).not.toHaveBeenCalled();

    const total = fixture(Object.fromEntries(Array.from({ length: MAX_TODO_SCAN_BYTES / MAX_VAULT_FILE_BYTES + 1 },
      (_, index) => [`Work/Note${index}.md`, 'x'.repeat(MAX_VAULT_FILE_BYTES)])));
    expect(await total.read()).toMatchObject({ state: 'unavailable', reason: 'scan_limit', facts: [] });
    expect(total.vault.read).not.toHaveBeenCalled();
  });

  it('never turns failed, missing or SHA-mismatched reads into empty or stale success', async () => {
    const f = fixture({ 'Personal/Inbox.md': '- [ ] Synthetic ⏫' });
    await f.read();
    f.files.set('Personal/Inbox.md', '- [ ] Synthetic changed ⏫');
    f.vault.read.mockRejectedValueOnce(new Error('synthetic'));
    expect(await f.read()).toMatchObject({ state: 'unavailable', facts: [] });
    f.vault.read.mockResolvedValueOnce(null);
    expect(await f.read()).toMatchObject({ state: 'unavailable', facts: [] });
    f.vault.read.mockResolvedValueOnce({ path: 'Personal/Inbox.md', sha: '0'.repeat(40), content: '' });
    expect(await f.read()).toMatchObject({ state: 'unavailable', facts: [] });
    expect((await f.read()).facts[0]?.text).toBe('Synthetic changed');
  });

  it('bounds concurrent file reads', async () => {
    const f = fixture(Object.fromEntries(Array.from({ length: TODO_READ_CONCURRENCY + 2 },
      (_, index) => [`Personal/Note${index}.md`, '- [ ] Synthetic ⏫'])));
    const original = f.vault.read.getMockImplementation()!;
    let active = 0;
    let peak = 0;
    f.vault.read.mockImplementation(async (path, signal) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const result = await original(path, signal);
      active -= 1;
      return result;
    });
    await readVaultTodos(f.vault, new AbortController().signal);
    expect(peak).toBe(TODO_READ_CONCURRENCY);
    expect(active).toBe(0);
  });

  it('aborts a stalled read at the source deadline without returning partial tasks', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ 'Personal/Inbox.md': '- [ ] Synthetic ⏫' });
      f.vault.read.mockImplementation(() => new Promise(() => {}));
      const pending = f.read();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toMatchObject({ state: 'unavailable', reason: 'timeout', facts: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});
