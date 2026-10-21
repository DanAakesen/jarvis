import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { VaultAppNotInstalledError, VaultWriteConflictError } from '../vault/github-client.js';
import { createMemoryProactiveStore } from './store.js';
import { createProactiveTodoWriter } from './todo-writer.js';
import { createMemoryProactiveTodoReceiptStore } from './todo-store.js';
import type { FindingsStoredContext } from './engine.js';

const runId = '11111111-1111-4111-8111-111111111111';
const currentTime = new Date('2026-10-18T10:00:00.000Z');

function key(index: number): string {
  return index.toString(16).padStart(16, '0') + '0'.repeat(16);
}

function actionKey(index: number, identity = `synthetic-action:${key(index)}`): string {
  return createHash('sha256').update(JSON.stringify([identity])).digest('hex').slice(0, 32);
}

function fakeVault(options: {
  paths?: string[];
  content?: string | null;
  conflicts?: number;
  conflictContent?: string;
  writeError?: Error;
} = {}) {
  const paths = options.paths ?? ['Personal/Inbox.md', 'Work/Inbox.md', 'Tasks.md'];
  const contents = new Map(paths.map((path) =>
    [path, options.content === undefined ? '# Synthetic inbox\n' : options.content]));
  const shas = new Map(paths.map((path) => [path, 'a'.repeat(40)]));
  let conflicts = options.conflicts ?? 0;
  const calls = {
    tree: vi.fn(async () => paths.map((path) => ({ path, sha: shas.get(path)! }))),
    read: vi.fn(async (path: string) => {
      const content = contents.get(path);
      return content === undefined || content === null ? null : ({ path, sha: shas.get(path)!, content });
    }),
    write: vi.fn(async (...args: [string, string, string, string | undefined]) => {
      const [path, next] = args;
      if (conflicts > 0) {
        conflicts -= 1;
        if (options.conflictContent !== undefined) contents.set(path, options.conflictContent);
        shas.set(path, String.fromCharCode(98 + (options.conflicts! - conflicts - 1)).repeat(40));
        throw new VaultWriteConflictError();
      }
      if (options.writeError) throw options.writeError;
      contents.set(path, next);
      shas.set(path, 'f'.repeat(40));
      return shas.get(path)!;
    }),
    delete: vi.fn(() => { throw new Error('delete must not be used'); }),
  };
  return {
    ...calls,
    content: (path = 'Personal/Inbox.md') => contents.get(path),
    sha: (path = 'Personal/Inbox.md') => shas.get(path),
    replaceContent(path: string, content: string) { contents.set(path, content); },
  };
}

async function fixture(options: Parameters<typeof fakeVault>[0] = {}, at = currentTime) {
  const store = createMemoryProactiveStore();
  const receipts = createMemoryProactiveTodoReceiptStore();
  const vault = fakeVault(options);
  const logger = { warn: vi.fn() };
  const now = vi.fn(() => new Date(at));
  const writer = createProactiveTodoWriter({ vault, store, receipts, now, logger });
  return { store, receipts, vault, logger, now, writer };
}

async function context(
  store: ReturnType<typeof createMemoryProactiveStore>,
  todos: {
    key: number;
    text: string;
    dueAt?: string | null;
    category?: 'suggestion' | 'todo' | 'prep';
    identity?: string | null;
    scope?: 'personal' | 'work' | 'ambiguous';
    source?: 'mail' | 'calendar' | 'factory' | 'weather';
    evidenceText?: string;
    projectRelated?: boolean;
  }[],
  options: { trigger?: FindingsStoredContext['trigger']; signal?: AbortSignal; runId?: string } = {},
): Promise<FindingsStoredContext> {
  const findings: FindingsStoredContext['findings'] = [];
  for (const todo of todos) {
    const dedupeKey = key(todo.key);
    const item = await store.items.upsertFinding({
      dedupeKey,
      title: 'Synthetic finding',
      body: 'Synthetic evidence only.',
      category: todo.category ?? 'suggestion',
      urgency: 'normal',
      dueAt: todo.dueAt ?? null,
      evidence: [],
      runId: options.runId ?? runId,
      language: 'en',
    });
    findings.push({
      itemId: item.id,
      dedupeKey,
      evidenceRefs: [`fact:${todo.key}`],
      category: todo.category ?? 'suggestion',
      urgency: 'normal',
      dueAt: todo.dueAt ?? null,
      dueHasTime: false,
      highPriority: false,
      language: 'en',
      suggestedTodo: todo.text,
    });
  }
  return {
    runId: options.runId ?? runId,
    trigger: options.trigger ?? 'manual',
    now: currentTime,
    signal: options.signal ?? new AbortController().signal,
    findings,
    facts: todos.map((todo) => ({
      ref: `fact:${todo.key}`,
      ...(todo.identity === null ? {} : { identity: todo.identity ?? `synthetic-action:${key(todo.key)}` }),
      ...(todo.scope === 'ambiguous' ? {} : { taskScope: todo.scope ?? 'personal' }),
      ...(todo.projectRelated ? { projectRelated: true } : {}),
      source: todo.source ?? 'mail',
      kind: todo.source === 'factory' ? 'factory' : 'mail',
      text: todo.evidenceText ?? 'Synthetic evidence only.',
    })),
    sources: [],
  };
}

describe('proactive todo writer', () => {
  it('writes sorted suggestions in one safe add-only commit and marks their items', async () => {
    const fixtureState = await fixture();
    const run = await context(fixtureState.store, [
      { key: 3, text: 'Later synthetic work', scope: 'work' },
      { key: 2, text: 'Soon synthetic work', scope: 'work', dueAt: '2026-10-20T12:00:00.000Z' },
      { key: 1, text: 'Earlier synthetic work', scope: 'work', dueAt: '2026-10-19T23:30:00.000Z' },
      { key: 4, text: 'Excess synthetic work' },
      { key: 5, text: 'Not a writer finding', category: 'todo' },
    ]);

    await fixtureState.writer(run);

    expect(fixtureState.vault.write).toHaveBeenCalledTimes(1);
    const [path, content, message, sha] = fixtureState.vault.write.mock.calls[0]!;
    expect(path).toBe('Work/Inbox.md');
    expect(sha).toBe('a'.repeat(40));
    expect(content).not.toContain('## Suggested by Jarvis');
    expect(content).toContain('- [ ] (proactive) Earlier synthetic work');
    expect(content).toContain('- [ ] (proactive) Soon synthetic work');
    expect(content.match(/\(proactive\)/gu)).toHaveLength(3);
    expect(content.indexOf('Earlier synthetic work')).toBeLessThan(content.indexOf('Soon synthetic work'));
    expect(content.indexOf('Soon synthetic work')).toBeLessThan(content.indexOf('Later synthetic work'));
    expect(content).not.toContain('Excess synthetic work');
    expect(content).toContain('📅 2026-10-20');
    expect(message).toBe('jarvis: add 3 proactive todos from a proactive check\n\nCo-authored-by: Jarvis');
    expect(message).not.toContain('synthetic work');
    expect(fixtureState.vault.delete).not.toHaveBeenCalled();
    expect(fixtureState.vault.tree).toHaveBeenCalledTimes(1);
    expect(await fixtureState.receipts.list([key(4)])).toEqual([]);
    for (const finding of run.findings.slice(0, 3)) {
      expect(await fixtureState.store.items.get(finding.itemId)).toMatchObject({ todoAdded: true });
    }
    expect(await fixtureState.receipts.countAdded('2026-10-18')).toBe(3);
  });

  it('routes scoped personal and work tasks only to their corresponding existing inboxes', async () => {
    const state = await fixture();
    await state.writer(await context(state.store, [
      { key: 6, text: 'Pick up synthetic groceries', scope: 'personal' },
      { key: 7, text: 'Send synthetic client invoice', scope: 'work' },
    ]));

    expect(state.vault.write.mock.calls.map(([path]) => path)).toEqual([
      'Personal/Inbox.md', 'Work/Inbox.md',
    ]);
    expect(state.vault.content('Personal/Inbox.md')).toContain('- [ ] (proactive) Pick up synthetic groceries');
    expect(state.vault.content('Work/Inbox.md')).toContain('- [ ] (proactive) Send synthetic client invoice');
    expect(state.vault.content('Tasks.md')).toBe('# Synthetic inbox\n');
  });

  it.each([
    { source: 'factory' as const },
    { evidenceText: 'Synthetic pull request awaiting review' },
    { evidenceText: 'Synthetic software project build checks failed' },
    { evidenceText: 'Synthetic build failed' },
    { evidenceText: 'Engineering follow-up for a synthetic repository' },
  ])('keeps project and engineering suggestions as observations (%s)', async (evidence) => {
    const state = await fixture();
    const run = await context(state.store, [{
      key: 8, text: 'Review the synthetic report', scope: 'work', category: 'prep',
      ...evidence,
    }]);

    await state.writer(run);

    expect(state.vault.write).not.toHaveBeenCalled();
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'project_related' }), 'proactive.todo_writer',
    );
    expect(await state.receipts.list([actionKey(8)])).toMatchObject([{ skipped: true }]);
    expect(await state.store.items.get(run.findings[0]!.itemId)).toBeDefined();
  });

  it('skips ambiguous scope without selecting a default inbox', async () => {
    const state = await fixture();
    await state.writer(await context(state.store, [
      { key: 9, text: 'Review a synthetic note', scope: 'ambiguous' },
    ]));

    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(state.vault.write).not.toHaveBeenCalled();
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'scope_ambiguous' }), 'proactive.todo_writer',
    );
    expect(await state.receipts.list([actionKey(9)])).toMatchObject([{ skipped: true }]);
  });

  it('fails closed with a content-free reason when source identity is unavailable', async () => {
    const state = await fixture();
    const run = await context(state.store, [{
      key: 18, text: 'Pick up synthetic groceries', scope: 'personal', identity: null,
    }]);

    await state.writer(run);

    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(state.vault.write).not.toHaveBeenCalled();
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'source_identity_unavailable' }), 'proactive.todo_writer',
    );
  });

  it('leaves existing dashboard suggestions untouched and never uses them as a destination', async () => {
    const state = await fixture();
    const legacy = '## Suggested by Jarvis\n- [ ] Review synthetic report <!-- jarvis:p:aaaaaaaaaaaaaaaa -->\n';
    state.vault.replaceContent('Tasks.md', legacy);
    await state.writer(await context(state.store, [
      { key: 10, text: 'Review synthetic report', scope: 'personal' },
    ]));

    expect(state.vault.write).not.toHaveBeenCalled();
    expect(state.vault.content('Tasks.md')).toBe(legacy);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'duplicate' }), 'proactive.todo_writer',
    );
  });

  it('does not append to an existing suggested section in a routed inbox', async () => {
    const existing = '## Suggested by Jarvis\n- [ ] Existing synthetic task\n';
    const state = await fixture({ content: existing });
    await state.writer(await context(state.store, [
      { key: 19, text: 'Review a synthetic note', scope: 'personal' },
    ]));

    expect(state.vault.write).not.toHaveBeenCalled();
    expect(state.vault.content()).toBe(existing);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'todo_destination_unwritable' }), 'proactive.todo_writer',
    );
  });

  it('does not turn findings without a suggested todo into proactive task writes', async () => {
    const state = await fixture();
    const run = await context(state.store, [{ key: 11, text: 'A user-requested synthetic task' }]);
    delete run.findings[0]!.suggestedTodo;

    await state.writer(run);

    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(state.vault.write).not.toHaveBeenCalled();
    expect(await state.store.items.get(run.findings[0]!.itemId)).toBeDefined();
  });

  it('deduplicates a changed suggestion across source, category, due date and inbox routing', async () => {
    const state = await fixture();
    const identity = 'stable synthetic source item';
    await state.writer(await context(state.store, [{
      key: 13, identity, text: 'Send a synthetic client update', scope: 'work', source: 'mail',
      dueAt: '2026-10-20T12:00:00.000Z',
    }]));
    state.now.mockReturnValue(new Date('2026-10-19T10:00:00.000Z'));
    await state.writer(await context(state.store, [{
      key: 14, identity, text: 'Buy synthetic groceries for home', scope: 'personal', source: 'calendar',
      category: 'prep', dueAt: '2026-10-22T12:00:00.000Z', evidenceText: 'Changed synthetic source wording.',
    }], { runId: '22222222-2222-4222-8222-222222222222' }));

    expect(state.vault.write).toHaveBeenCalledOnce();
    expect(state.vault.write.mock.calls[0]?.[0]).toBe('Work/Inbox.md');
    expect(await state.receipts.list([actionKey(13, identity)])).toMatchObject([{ added: true }]);
  });

  it('does not re-add a receipt-backed task after it was completed or removed', async () => {
    const state = await fixture();
    const identity = 'completed synthetic source action';
    await state.writer(await context(state.store, [{
      key: 15, identity, text: 'Pick up synthetic groceries', scope: 'personal',
    }]));
    state.vault.replaceContent(
      'Personal/Inbox.md',
      state.vault.content('Personal/Inbox.md')!.replace('- [ ] (proactive)', '- [x] (proactive)'),
    );
    await state.writer(await context(state.store, [{
      key: 16, identity, text: 'Buy synthetic groceries', scope: 'personal', category: 'prep',
    }], { runId: '33333333-3333-4333-8333-333333333333' }));
    state.vault.replaceContent('Personal/Inbox.md', '# Owner removed the task\n');
    await state.writer(await context(state.store, [{
      key: 17, identity, text: 'Get synthetic groceries', scope: 'personal',
    }], { runId: '44444444-4444-4444-8444-444444444444' }));

    expect(state.vault.write).toHaveBeenCalledOnce();
  });

  it.each([
    ['paused', async (state: Awaited<ReturnType<typeof fixture>>) => state.store.settings.patch({ paused: true }), 'manual', currentTime],
    ['todos disabled', async (state: Awaited<ReturnType<typeof fixture>>) => state.store.settings.patch({ sources: { todos: false } }), 'manual', currentTime],
    ['scheduled quiet window', async () => {}, 'scheduled', new Date('2026-10-18T01:00:00.000Z')],
    ['catch-up quiet window', async () => {}, 'catchup', new Date('2026-10-18T01:00:00.000Z')],
  ] as const)('does not call the vault or add receipts when %s blocks the write', async (_reason, configure, trigger, at) => {
    const state = await fixture({}, at);
    await configure(state);
    const run = await context(state.store, [{ key: 10, text: 'Blocked synthetic task' }], { trigger });
    await state.writer(run);
    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(state.vault.read).not.toHaveBeenCalled();
    expect(state.vault.write).not.toHaveBeenCalled();
    expect(await state.receipts.list([key(10)])).toEqual([]);
  });

  it('does not call the vault or write receipts for an aborted run', async () => {
    const state = await fixture();
    const controller = new AbortController();
    controller.abort();
    const run = await context(state.store, [{ key: 11, text: 'Aborted synthetic task' }], { signal: controller.signal });
    await state.writer(run);
    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(state.vault.write).not.toHaveBeenCalled();
    expect(await state.receipts.list([key(11)])).toEqual([]);
  });

  it('allows manual writes during quiet hours', async () => {
    const state = await fixture({}, new Date('2026-10-18T01:00:00.000Z'));
    const run = await context(state.store, [{ key: 12, text: 'Manual synthetic task' }]);
    await state.writer(run);
    expect(state.vault.write).toHaveBeenCalledOnce();
  });

  it('applies the daily cap and starts a new allowance on the Copenhagen date change', async () => {
    const atBeforeMidnight = new Date('2026-10-17T21:59:00.000Z');
    const state = await fixture({}, atBeforeMidnight);
    for (let index = 100; index < 104; index += 1) {
      await state.receipts.insert({
        itemId: null, dedupeKey: key(index), dayKey: '2026-10-17', runId,
        status: 'added', reason: null, commitSha: 'c'.repeat(40),
      });
    }
    const first = await context(state.store, [
      { key: 20, text: 'One before midnight' },
      { key: 21, text: 'Two before midnight' },
      { key: 22, text: 'Three before midnight' },
    ]);
    await state.writer(first);
    expect(state.vault.write).toHaveBeenCalledOnce();
    expect(state.vault.write.mock.calls[0]?.[1].match(/^- \[ \]/gmu)).toHaveLength(1);

    state.now.mockReturnValue(new Date('2026-10-17T22:00:00.000Z'));
    const nextDay = await context(state.store, [
      { key: 23, text: 'One after midnight' },
      { key: 24, text: 'Two after midnight' },
      { key: 25, text: 'Three after midnight' },
    ], { runId: '22222222-2222-4222-8222-222222222222' });
    await state.writer(nextDay);
    expect(state.vault.write).toHaveBeenCalledTimes(2);
    expect(state.vault.write.mock.calls[1]?.[1].match(/^- \[ \]/gmu)).toHaveLength(4);
  });

  it('never falls back to a root task file when an inbox destination is missing', async () => {
    for (const paths of [[], ['task.md', 'tasks.md']]) {
      const state = await fixture({ paths, content: null });
      const run = await context(state.store, [{ key: paths.length, text: 'Resolver synthetic task' }]);
      await state.writer(run);
      expect(state.vault.write).not.toHaveBeenCalled();
      expect(state.vault.read).not.toHaveBeenCalled();
      expect(state.vault.delete).not.toHaveBeenCalled();
      expect(state.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'todo_destination_missing' }), 'proactive.todo_writer',
      );
      expect(await state.receipts.list([key(paths.length)])).toEqual([]);
    }
  });

  it('skips invalid and unsafe text with code-only receipts', async () => {
    const state = await fixture();
    const run = await context(state.store, [
      { key: 30, text: 'ok' },
      { key: 31, text: 'Save my password somewhere' },
    ]);
    await state.writer(run);
    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(await state.receipts.list([actionKey(30), actionKey(31)])).toEqual([
      { dedupeKey: actionKey(30), added: false, skipped: true, failedAttempts: 0 },
      { dedupeKey: actionKey(31), added: false, skipped: true, failedAttempts: 0 },
    ]);
  });

  it('checks only new text, not old sensitive mentions in the existing file', async () => {
    const state = await fixture({ content: 'Synthetic file already mentions a bank.' });
    const run = await context(state.store, [{ key: 32, text: 'Review the synthetic report' }]);
    await state.writer(run);
    expect(state.vault.write).toHaveBeenCalledOnce();
    expect(state.vault.content()).toContain('Review the synthetic report');
  });

  it('skips duplicates in open and done task lines and recovers an existing marker', async () => {
    const state = await fixture({
      content: [
        '- [ ] review, the synthetic report',
        '- [x] Another existing item',
        `- [ ] Orphaned text <!-- jarvis:p:${key(42).slice(0, 16)} -->`,
      ].join('\n'),
    });
    const run = await context(state.store, [
      { key: 40, text: 'REVIEW the synthetic report!' },
      { key: 42, text: 'Orphaned, text' },
    ]);
    await state.writer(run);
    expect(state.vault.write).not.toHaveBeenCalled();
    expect(await state.receipts.list(run.findings.map(({ itemId }) =>
      itemId === run.findings[0]!.itemId ? actionKey(40) : actionKey(42)))).toEqual([
      { dedupeKey: actionKey(40), added: false, skipped: true, failedAttempts: 0 },
      { dedupeKey: actionKey(42), added: true, skipped: false, failedAttempts: 0 },
    ]);
    expect(await state.store.items.get(run.findings[1]!.itemId)).toMatchObject({ todoAdded: true });
  });

  it('does not write into code fences or beyond the vault byte limit', async () => {
    const fenced = await fixture({ content: '```md\n- [ ] enclosed' });
    await fenced.writer(await context(fenced.store, [{ key: 50, text: 'Outside synthetic task' }]));
    expect(fenced.vault.write).not.toHaveBeenCalled();
    expect(fenced.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'todo_destination_unwritable' }), 'proactive.todo_writer',
    );

    const oversized = await fixture({ content: `# Notes\n${'x'.repeat(256 * 1024 - 8)}` });
    await oversized.writer(await context(oversized.store, [{ key: 51, text: 'Too large synthetic task' }]));
    expect(oversized.vault.write).not.toHaveBeenCalled();
    expect(oversized.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'todo_file_too_large' }), 'proactive.todo_writer',
    );
  });

  it.each([0, 1, 2])('re-reads fresh content and sha after %s write conflicts', async (conflicts) => {
    const state = await fixture({ conflicts });
    const run = await context(state.store, [{ key: 60 + conflicts, text: 'Conflict synthetic task' }]);
    await state.writer(run);
    expect(state.vault.write).toHaveBeenCalledTimes(conflicts + 1);
    expect(state.vault.read).toHaveBeenCalledTimes(conflicts + 3);
    expect(state.vault.write.mock.calls.map((call) => call[3])).toEqual(
      ['a', ...Array.from({ length: conflicts }, (_, index) => String.fromCharCode(98 + index))]
        .map((character) => character.repeat(40)),
    );
    expect(await state.receipts.list([actionKey(60 + conflicts)])).toMatchObject([
      { added: true, failedAttempts: 0 },
    ]);
  });

  it('records one failed attempt after the third consecutive write conflict', async () => {
    const state = await fixture({ conflicts: 3 });
    const run = await context(state.store, [{ key: 69, text: 'Conflict limit synthetic task' }]);
    await state.writer(run);
    expect(state.vault.write).toHaveBeenCalledTimes(3);
    expect(state.vault.read).toHaveBeenCalledTimes(5);
    expect(await state.receipts.list([actionKey(69)])).toMatchObject([{ failedAttempts: 1, added: false }]);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'vault_conflict_exhausted' }), 'proactive.todo_writer',
    );
  });

  it('rechecks duplicates against freshly-read content after a conflict', async () => {
    const state = await fixture({
      conflicts: 1,
      conflictContent: '- [ ] Existing synthetic task\n- [ ] Conflict synthetic task',
    });
    const run = await context(state.store, [{ key: 68, text: 'Conflict synthetic task' }]);
    await state.writer(run);
    expect(state.vault.write).toHaveBeenCalledOnce();
    expect(state.vault.read).toHaveBeenCalledTimes(4);
    expect(await state.receipts.list([actionKey(68)])).toMatchObject([{ added: false, skipped: true }]);
  });

  it('records two failed write attempts and then settles without another vault call', async () => {
    const state = await fixture({ writeError: new VaultAppNotInstalledError() });
    const item = { key: 70, text: 'Unavailable synthetic task' };
    await state.writer(await context(state.store, [item]));
    await state.writer(await context(state.store, [item], { runId: '33333333-3333-4333-8333-333333333333' }));
    await state.writer(await context(state.store, [item], { runId: '44444444-4444-4444-8444-444444444444' }));
    expect(state.vault.write).toHaveBeenCalledTimes(2);
    expect(await state.receipts.list([actionKey(70)])).toMatchObject([{ failedAttempts: 2 }]);
  });

  it('makes no vault calls once the daily cap is already full', async () => {
    const state = await fixture();
    for (let index = 200; index < 205; index += 1) {
      await state.receipts.insert({
        itemId: null, dedupeKey: key(index), dayKey: '2026-10-18', runId,
        status: 'added', reason: null, commitSha: 'd'.repeat(40),
      });
    }
    await state.writer(await context(state.store, [{ key: 80, text: 'At cap synthetic task' }]));
    expect(state.vault.tree).not.toHaveBeenCalled();
    expect(await state.receipts.list([key(80)])).toEqual([]);
  });

  it('never writes when the resolved file disappears before its read', async () => {
    const state = await fixture({ content: null });
    await state.writer(await context(state.store, [{ key: 90, text: 'Missing synthetic task' }]));
    expect(state.vault.tree).toHaveBeenCalledOnce();
    expect(state.vault.read).toHaveBeenCalledOnce();
    expect(state.vault.write).not.toHaveBeenCalled();
  });
});
