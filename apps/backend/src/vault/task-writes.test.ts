import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseTodosWithContext } from '../proactive/todo-file.js';
import { MAX_VAULT_FILE_BYTES, VaultWriteConflictError, type VaultFile } from './github-client.js';
import { taskWriteHelpers } from './index.js';
import {
  createTaskWriter,
  TaskWriteError,
  validateTaskCompleteInput,
  validateTaskCreateInput,
  validateTaskEditInput,
  type TaskCompleteInput,
  type TaskWriterOptions,
} from './task-writes.js';

const path = 'Personal/Inbox.md';
const firstSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const commit = 'c'.repeat(40);

function taskIdentity({ path, line, text, version }: TaskCompleteInput) {
  return { path, line, text, version };
}

function fixture(content: string | null = '- [ ] Review the release\n', overrides: Partial<TaskWriterOptions> = {}) {
  let file: VaultFile | null = content === null ? null : { path, content, sha: firstSha };
  const client = {
    read: vi.fn(async () => file),
    write: vi.fn(async (target: string, next: string, _message: string, expectedSha?: string) => {
      if (expectedSha !== file?.sha) throw new VaultWriteConflictError();
      file = { path: target, content: next, sha: nextSha };
      return commit;
    }),
  };
  const onWrite = vi.fn();
  const log = vi.fn();
  const options: TaskWriterOptions = {
    client,
    ...taskWriteHelpers,
    onWrite, log,
    ...overrides,
  };
  return {
    writer: createTaskWriter(options), client, onWrite, log,
    file: () => file,
    replace: (next: string) => { file = { path, content: next, sha: nextSha }; },
    input(done = true): TaskCompleteInput {
      const task = parseTodosWithContext(file!.content, path)[0]!;
      return { path, line: task.line, text: options.shouldRedact(task.text) ? '[redacted]' : task.text, version: task.version, done };
    },
  };
}

describe('task write input validation', () => {
  it('validates raw tool arguments without coercion or extra fields', () => {
    const current = fixture().input();
    expect(validateTaskCompleteInput(current)).toBe(true);
    for (const invalid of [
      null, [], { ...current, line: '1' }, { ...current, done: 'true' },
      { ...current, version: 'a'.repeat(63) }, { ...current, version: 'A'.repeat(64) },
      { ...current, path: '' }, { ...current, line: 1_000_001 }, { ...current, extra: true },
      { ...current, text: 'x'.repeat(301) },
    ]) expect(validateTaskCompleteInput(invalid)).toBe(false);
    expect(validateTaskEditInput({ ...current, done: undefined, newText: 'New words' })).toBe(false);
    expect(validateTaskCreateInput({ text: 'Review this', scope: 'Personal' })).toBe(false);
    expect(validateTaskCreateInput({ text: 'Review this', scope: 'personal', due: null })).toBe(false);
    expect(validateTaskCreateInput({ text: 'x'.repeat(401), scope: 'personal' })).toBe(false);
  });

  it('checks calendar dates, times, nullable edits and Unicode bounds', () => {
    const base = { text: 'Review this', scope: 'work' };
    expect(validateTaskCreateInput({ ...base, due: '2028-02-29', time: '23:59' })).toBe(true);
    for (const due of ['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', 'tomorrow']) {
      expect(validateTaskCreateInput({ ...base, due })).toBe(false);
    }
    for (const time of ['24:00', '12:60', '9:00', '12:00\n']) {
      expect(validateTaskCreateInput({ ...base, time })).toBe(false);
    }
    const identity = taskIdentity(fixture().input());
    expect(validateTaskEditInput({ ...identity, newText: 'Review it', due: null, time: null, priority: 'normal' })).toBe(true);
    expect(validateTaskEditInput({ ...identity, newText: 'Review it', priority: 'urgent' })).toBe(false);
    expect(validateTaskCreateInput({ text: '🙂'.repeat(400), scope: 'personal' })).toBe(true);
    expect(validateTaskCreateInput({ text: '🙂'.repeat(401), scope: 'personal' })).toBe(false);
  });
});

describe('shared task writer', () => {
  it('returns the committed parsed task, not the raw requested wording', async () => {
    const state = fixture(null);
    const result = await state.writer.create({
      text: 'Review [release](https://example.test) <b>notes</b>',
      scope: 'personal', due: '2026-10-25', time: '09:30',
    });
    const parsed = parseTodosWithContext(state.file()!.content, path)[0]!;
    expect(result).toEqual({
      id: createHash('sha256').update(`${path}\0${parsed.line}`).digest('hex'),
      path, line: 3, text: 'Review release notes', done: false, commit,
      dueDate: parsed.dueDate, dueTime: parsed.dueTime, dueAt: parsed.dueAt,
      priority: 'normal', version: parsed.version,
    });
    expect(state.client.read).toHaveBeenCalledTimes(1);
    expect(state.onWrite).toHaveBeenCalledTimes(1);
    expect(state.log).toHaveBeenLastCalledWith('vault.write', { outcome: 'ok', folder: 'Personal' });
  });

  it('completes only the checkbox and preserves BOM, CRLF and task markers', async () => {
    const content = '\uFEFF# Inbox\r\n\r\n* [ ] Review release 📅 2026-10-25 🕒 09:30 ⏫ 🔁 every week 🆔 abc\r\n';
    const state = fixture(content);
    const result = await state.writer.complete(state.input());
    expect(state.file()!.content).toBe(content.replace('* [ ]', '* [x]'));
    const parsed = parseTodosWithContext(state.file()!.content, path)[0]!;
    expect(result).toMatchObject({
      text: parsed.text, version: parsed.version, done: true,
      dueDate: '2026-10-25', dueTime: '09:30', priority: 'high', commit,
    });
  });

  it('edits through the existing marker-preserving helper and returns actual metadata', async () => {
    const content = '# Inbox\r\n- [ ] Review release 📅 2026-10-25 🕒 09:30 ⏫ 🔁 every week 🆔 abc ⛔ def 🏁 keep\r\n';
    const state = fixture(content);
    const identity = taskIdentity(state.input());
    const result = await state.writer.edit({ ...identity, newText: 'Review revised release' });
    expect(state.file()!.content).toBe(content.replace('Review release', 'Review revised release'));
    expect(result).toMatchObject({
      text: 'Review revised release', done: false, dueDate: '2026-10-25', dueTime: '09:30', priority: 'high',
    });
    const next = await state.writer.edit({
      path, line: result.line, text: result.text, version: result.version,
      newText: result.text, due: null, priority: 'normal',
    });
    expect(next).toMatchObject({ dueDate: null, dueTime: null, dueAt: null, priority: 'normal' });
    expect(state.file()!.content).toContain('🔁 every week 🆔 abc ⛔ def 🏁 keep');
    expect(state.file()!.content).toContain('\r\n');
  });

  it('returns no-op data without writing or scheduling an index refresh', async () => {
    const state = fixture();
    const complete = state.input(false);
    expect(await state.writer.complete(complete)).toMatchObject({ done: false, commit: null, version: complete.version });
    const identity = taskIdentity(complete);
    expect(await state.writer.edit({ ...identity, newText: complete.text })).toMatchObject({ commit: null });
    expect(state.client.write).not.toHaveBeenCalled();
    expect(state.onWrite).not.toHaveBeenCalled();
  });

  it.each(['complete', 'edit'] as const)('retries %s once for unrelated edits using the latest file SHA', async (operation) => {
    const state = fixture();
    const input = state.input();
    state.client.write.mockImplementationOnce(async () => {
      state.replace('- [ ] Review the release\nUnrelated note changed\n');
      throw new VaultWriteConflictError();
    });
    const result = operation === 'complete'
      ? await state.writer.complete(input)
      : await state.writer.edit({
        path: input.path, line: input.line, text: input.text, version: input.version, newText: 'Review revised release',
      });
    expect(state.client.write).toHaveBeenCalledTimes(2);
    expect(state.client.write.mock.calls[1]![3]).toBe(nextSha);
    expect(state.file()!.content).toContain('Unrelated note changed');
    expect(result.commit).toBe(commit);
  });

  it('retries append once without losing an unrelated append or duplicating the new task', async () => {
    const state = fixture();
    state.client.write.mockImplementationOnce(async () => {
      state.replace('- [ ] Review the release\n- [ ] Another task\n');
      throw new VaultWriteConflictError();
    });
    const result = await state.writer.create({ text: 'Review next release', scope: 'personal' });
    expect(result.line).toBe(3);
    expect(state.file()!.content).toBe('- [ ] Review the release\n- [ ] Another task\n- [ ] Review next release\n');
    expect(state.client.write).toHaveBeenCalledTimes(2);
  });

  it.each([
    '- [ ] Review the release 📅 2026-10-25\n',
    '- [ ] Review the release ⏫\n',
    'Moved down\n- [ ] Review the release\n',
    '- [x] Review the release\n',
  ])('refuses a stale exact-line version before writing', async (changed) => {
    const state = fixture();
    const input = state.input();
    state.replace(changed);
    await expect(state.writer.complete(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it('rechecks exact task identity after a conflict and never overwrites a changed task', async () => {
    const state = fixture();
    const input = state.input();
    state.client.write.mockImplementationOnce(async () => {
      state.replace('- [ ] Another task\n');
      throw new VaultWriteConflictError();
    });
    await expect(state.writer.complete(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.client.write).toHaveBeenCalledTimes(1);
    expect(state.onWrite).not.toHaveBeenCalled();
  });

  it('bounds explicit-conflict retries to two writes', async () => {
    const state = fixture();
    state.client.write.mockRejectedValue(new VaultWriteConflictError());
    await expect(state.writer.complete(state.input())).rejects.toMatchObject({ statusCode: 409 });
    expect(state.client.read).toHaveBeenCalledTimes(2);
    expect(state.client.write).toHaveBeenCalledTimes(2);
  });

  it.each(['complete', 'edit', 'create'] as const)('does not retry an unknown %s outcome even when the write may have persisted', async (operation) => {
    const state = fixture();
    state.client.write.mockImplementationOnce(async (_target, content) => {
      state.replace(content);
      throw new Error('Provider details must not escape');
    });
    const input = state.input();
    const action = operation === 'create'
      ? state.writer.create({ text: 'Review next release', scope: 'personal' })
      : operation === 'complete'
        ? state.writer.complete(input)
        : state.writer.edit({ path, line: input.line, text: input.text, version: input.version, newText: 'Revised release' });
    await expect(action).rejects.toMatchObject({ statusCode: 503, message: expect.stringMatching(/Refresh.*read the note.*do not blindly retry/u) });
    expect(state.client.write).toHaveBeenCalledTimes(1);
    expect(state.client.read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(state.log.mock.calls)).not.toContain('Provider details');
  });

  it('does not retry read failures or attempt writes after cancellation', async () => {
    const state = fixture();
    state.client.read.mockRejectedValueOnce(new Error('Read failed'));
    await expect(state.writer.complete(state.input())).rejects.toMatchObject({ statusCode: 503 });
    expect(state.client.read).toHaveBeenCalledTimes(1);
    expect(state.client.write).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(state.writer.create({ text: 'Review this', scope: 'personal' }, controller.signal)).rejects.toMatchObject({ statusCode: 503 });
    expect(state.client.read).toHaveBeenCalledTimes(1);
  });

  it('preserves confirmed write success when refresh or logging throws', async () => {
    const state = fixture(null, {
      onWrite: () => { throw new Error('Refresh failed'); },
      log: () => { throw new Error('Log failed'); },
    });
    await expect(state.writer.create({ text: 'Review this', scope: 'work' })).resolves.toMatchObject({ commit, path: 'Work/Inbox.md' });
    expect(state.client.write).toHaveBeenCalledTimes(1);
  });

  it('refuses secret input, unsafe paths, out-of-scope notes and malformed raw input', async () => {
    const state = fixture();
    for (const text of ['Store password', `${'x'.repeat(220)} secret`]) {
      await expect(state.writer.create({ text, scope: 'personal' })).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(state.writer.complete({ ...state.input(), path: '../Personal/Inbox.md' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(state.writer.complete({ ...state.input(), path: 'General/Inbox.md' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(state.writer.complete(null as unknown as TaskCompleteInput)).rejects.toBeInstanceOf(TaskWriteError);
    await expect(state.writer.complete(null as unknown as TaskCompleteInput)).rejects.toMatchObject({ statusCode: 400 });
    expect(state.client.read).not.toHaveBeenCalled();
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it('refuses missing notes and mismatched visible text', async () => {
    const state = fixture();
    const input = state.input();
    await expect(state.writer.complete({ ...input, text: 'Different words' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(fixture(null).writer.complete(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it('can tick a redacted task without exposing its sensitive text', async () => {
    const state = fixture('- [ ] Rotate password\n');
    const result = await state.writer.complete(state.input());
    expect(result.text).toBe('[redacted]');
    expect(state.file()!.content).toBe('- [x] Rotate password\n');
  });

  it('refuses an Inbox ending in a code block and a time without a date', async () => {
    const state = fixture('```md\n');
    await expect(state.writer.create({ text: 'Review this', scope: 'personal' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(state.writer.create({ text: 'Review this', scope: 'personal', time: '09:30' })).rejects.toMatchObject({ statusCode: 400 });
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it('bounds all proposed content by UTF-8 bytes, not character count', async () => {
    const oversized = fixture(`${'🙂'.repeat(MAX_VAULT_FILE_BYTES / 4)}\n`);
    await expect(oversized.writer.create({ text: 'Review this', scope: 'personal' })).rejects.toMatchObject({ statusCode: 400 });
    const almostFull = `- [ ] Review the release\n${'x'.repeat(MAX_VAULT_FILE_BYTES - 24)}`;
    const edit = fixture(almostFull);
    const identity = taskIdentity(edit.input());
    await expect(edit.writer.edit({ ...identity, newText: 'Review the significantly longer release checklist' })).rejects.toMatchObject({ statusCode: 400 });
    const complete = fixture(`- [ ] Review the release\n${'x'.repeat(MAX_VAULT_FILE_BYTES)}`);
    await expect(complete.writer.complete(complete.input())).rejects.toMatchObject({ statusCode: 400 });
    expect(oversized.client.write).not.toHaveBeenCalled();
    expect(edit.client.write).not.toHaveBeenCalled();
    expect(complete.client.write).not.toHaveBeenCalled();
  });

  it('sanitizes and caps newly created task text using the existing helper', async () => {
    const state = fixture(null);
    const result = await state.writer.create({ text: `Review\n<!-- -->${'a'.repeat(300)}📅`, scope: 'personal' });
    expect(Array.from(result.text).length).toBe(200);
    expect(state.file()!.content.split('\n')).toHaveLength(4);
    await expect(state.writer.create({ text: '📅', scope: 'personal' })).rejects.toMatchObject({ statusCode: 400 });
  });
});
