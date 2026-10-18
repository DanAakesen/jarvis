import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_VAULT_FILE_BYTES, VaultFileTooLargeError } from '../../vault/github-client.js';
import { defaultProactiveSettings } from '../store.js';
import type { SourceContext } from '../types.js';
import { createTodosSource } from './todos.js';

const now = new Date('2026-10-20T12:00:00.000Z');

function context(signal = new AbortController().signal): SourceContext {
  return { now, signal, settings: defaultProactiveSettings() };
}

function vault(content = '- [ ] synthetic todo') {
  return {
    tree: vi.fn(async () => [{ path: 'Tasks.md', sha: 'a'.repeat(40) }]),
    read: vi.fn(async () => ({
      path: 'Tasks.md', sha: 'a'.repeat(40), content,
    })),
    write: vi.fn(),
  };
}

afterEach(() => vi.useRealTimers());

describe('proactive todos source', () => {
  it('prioritizes the 24-hour-before through 72-hour-after window and caps facts at 40', async () => {
    const overdue = Array.from({ length: 50 }, (_, index) => `- [ ] Old ${index} due: 2026-08-01`).join('\n');
    const source = createTodosSource(vault(`${overdue}\n- [ ] Due tomorrow 📅 2026-10-21`));
    const result = await source.read(context());

    expect(result.state).toBe('ok');
    expect(result.facts).toHaveLength(40);
    expect(result.facts[0]).toMatchObject({
      ref: 'todo:51',
      kind: 'todo',
      label: 'Todo list',
      text: 'Due tomorrow',
      dueAt: '2026-10-21T21:59:00.000Z',
      dueHasTime: false,
    });
    expect(result.facts.every(({ text }) => text.length <= 300)).toBe(true);
  });

  it('keeps the soonest 40 when more than 40 due todos fall inside the priority window', async () => {
    const tasks = Array.from({ length: 42 }, (_, index) => {
      const minute = String(index).padStart(2, '0');
      return `- [ ] Window ${minute} 📅 2026-10-21 14:${minute}`;
    }).reverse().join('\n');
    const result = await createTodosSource(vault(tasks)).read(context());

    expect(result.facts).toHaveLength(40);
    expect(result.facts[0]?.text).toBe('Window 00');
    expect(result.facts.at(-1)?.text).toBe('Window 39');
    expect(result.facts.map(({ dueAt }) => dueAt)).toEqual(
      [...result.facts.map(({ dueAt }) => dueAt)].sort(),
    );
  });

  it('returns an empty successful result for an empty or fully completed file', async () => {
    const empty = await createTodosSource(vault('')).read(context());
    const done = await createTodosSource(vault('- [x] completed')).read(context());
    expect(empty).toMatchObject({ state: 'ok', facts: [] });
    expect(done).toMatchObject({ state: 'ok', facts: [] });
  });

  it('maps missing dependencies, missing or ambiguous files, size errors, read failures and timeouts', async () => {
    await expect(createTodosSource().read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'not_connected', facts: [],
    });

    const missing = vault();
    missing.tree.mockResolvedValue([]);
    await expect(createTodosSource(missing).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'todo_file_missing', facts: [],
    });

    const ambiguous = vault();
    ambiguous.tree.mockResolvedValue([
      { path: 'task.md', sha: 'a'.repeat(40) },
      { path: 'TASKS.MD', sha: 'b'.repeat(40) },
    ]);
    await expect(createTodosSource(ambiguous).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'todo_file_ambiguous', facts: [],
    });

    const failedTree = vault();
    failedTree.tree.mockRejectedValue(new Error('synthetic'));
    await expect(createTodosSource(failedTree).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'read_failed', facts: [],
    });

    const oversized = vault('x'.repeat(MAX_VAULT_FILE_BYTES + 1));
    await expect(createTodosSource(oversized).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'too_large', facts: [],
    });

    const vaultRejectingLargeFile = vault();
    vaultRejectingLargeFile.read.mockRejectedValue(new VaultFileTooLargeError());
    await expect(createTodosSource(vaultRejectingLargeFile).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'too_large', facts: [],
    });

    const failed = vault();
    failed.read.mockRejectedValue(new Error('synthetic'));
    await expect(createTodosSource(failed).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'read_failed', facts: [],
    });

    vi.useFakeTimers();
    const stalled = vault();
    stalled.tree.mockImplementation((_signal) => new Promise((_resolve, reject) => {
      _signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = createTodosSource(stalled).read(context());
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toMatchObject({ state: 'unavailable', reason: 'timeout', facts: [] });
  });

  it('only calls the vault tree and read operations', async () => {
    const fakeVault = vault();
    await createTodosSource(fakeVault).read(context());
    expect(fakeVault.tree).toHaveBeenCalledOnce();
    expect(fakeVault.read).toHaveBeenCalledOnce();
    expect(fakeVault.write).not.toHaveBeenCalled();
  });
});
