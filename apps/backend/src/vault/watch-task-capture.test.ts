import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseTodosWithContext } from '../proactive/todo-file.js';
import type { ApprovalModelPort } from '../core/approval-interpreter.js';
import { VaultWriteConflictError, type VaultFile } from './github-client.js';
import { taskWriteHelpers } from './index.js';
import { createTaskWriter } from './task-writes.js';
import {
  createWatchTaskCapture, resolveWatchTask, validateWatchTaskSubmission, watchTaskEditInput,
  type WatchTaskReceipt, type WatchTaskSubmission, type WatchTaskSubmissionStore,
} from './watch-task-capture.js';

const owner = '11111111-2222-4333-8444-555555555555';
const submission: WatchTaskSubmission = {
  submissionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  submittedAt: '2026-11-10T12:15:27.123Z', timeZone: 'Europe/Copenhagen',
  mode: 'auto', input: 'Husk at købe mælk',
};
const signal = () => AbortSignal.timeout(30_000);
const modelResult = (fields: Record<string, unknown> = {}) => JSON.stringify({
  text: 'Køb mælk', due: null, time: null, priority: null, notes: null, ...fields,
});

function fixture(model: ApprovalModelPort = vi.fn(async () => modelResult())) {
  const files = new Map<string, VaultFile>();
  const receipts = new Map<string, WatchTaskReceipt>();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const store: WatchTaskSubmissionStore = {
    get: vi.fn(async (owner, id) => clone(receipts.get(`${owner}:${id}`) ?? null)),
    reserve: vi.fn(async (owner, id, receipt) => {
      const key = `${owner}:${id}`;
      if (!receipts.has(key)) receipts.set(key, clone(receipt));
      return clone(receipts.get(key)!);
    }),
    complete: vi.fn(async (owner, id, hash, result) => {
      const receipt = receipts.get(`${owner}:${id}`)!;
      expect(receipt.requestHash).toBe(hash);
      receipt.result ??= clone(result);
    }),
  };
  const client = {
    read: vi.fn(async (path: string) => clone(files.get(path) ?? null)),
    write: vi.fn(async (path: string, content: string, _message: string, expectedSha?: string) => {
      if (files.get(path)?.sha !== expectedSha) throw new VaultWriteConflictError();
      const sha = createHash('sha1').update(content).digest('hex');
      files.set(path, { path, content, sha });
      return sha;
    }),
  };
  const writer = () => createTaskWriter({ ...taskWriteHelpers, client, onWrite: vi.fn(), log: vi.fn() });
  const restart = () => createWatchTaskCapture({ writer: writer(), store, model, shouldRedact: taskWriteHelpers.shouldRedact });
  return { files, receipts, store, client, model, writer, restart, capture: restart() };
}

describe('Watch task parsing and independent defaults', () => {
  it.each([
    [{}, '2026-11-10', '14:15', 'normal'],
    [{ priority: 'high' }, '2026-11-10', '14:15', 'high'],
    [{ due: '2026-11-12', time: '09:30' }, '2026-11-12', '09:30', 'normal'],
    [{ due: '2026-11-12', time: '09:30', priority: 'medium' }, '2026-11-12', '09:30', 'medium'],
    [{ due: '2026-11-12' }, '2026-11-12', '14:15', 'normal'],
    [{ time: '16:00' }, '2026-11-10', '16:00', 'normal'],
  ])('defaults only missing fields: %j', async (fields, due, time, priority) => {
    const model = vi.fn(async () => modelResult(fields));
    const parsed = await resolveWatchTask(submission, model, signal());
    expect(parsed).toMatchObject({ text: 'Køb mælk', due, time, priority, scope: 'personal', timeZone: 'Europe/Copenhagen' });
    if (!('due' in fields) && !('time' in fields)) expect(parsed.dueAt).toBe('2026-11-10T13:15:27.123Z');
  });

  it.each([
    ['Buy milk tomorrow at 9, high priority', 'Buy milk', 'high'],
    ['Køb mælk i morgen klokken 9, høj prioritet', 'Køb mælk', 'high'],
    ['Køb mælk på fredag, lav prioritet', 'Køb mælk', 'normal'],
  ])('uses the existing tool-free model port with English/Danish context: %s', async (input, text, priority) => {
    const model = vi.fn(async () => modelResult({ text, due: '2026-11-11', time: '09:00', priority }));
    expect(await resolveWatchTask({ ...submission, input }, model, signal())).toMatchObject({ text, priority });
    const [prompt, boundedSignal] = model.mock.calls[0]!;
    expect(Object.keys(prompt).sort()).toEqual(['system', 'user']);
    expect(prompt.system).toContain('English or Danish');
    expect(prompt.system).toContain('i morgen');
    expect(prompt.system).toContain('no tools');
    expect(prompt.system).toContain('Use null for every omitted');
    expect(JSON.parse(prompt.user)).toEqual({ input, submittedAt: submission.submittedAt, timeZone: submission.timeZone });
    expect(boundedSignal).toBeInstanceOf(AbortSignal);
  });

  it('Manual needs no model and retains explicit fields including Low and multiline notes', async () => {
    const parsed = await resolveWatchTask({
      ...submission, mode: 'manual', input: undefined,
      fields: { text: 'Review launch', scope: 'work', due: '2026-11-15', time: '08:05', priority: 'normal', notes: 'First line\nSecond line' },
    } as WatchTaskSubmission, undefined, signal());
    expect(parsed).toMatchObject({
      text: 'Review launch', scope: 'work', due: '2026-11-15', time: '08:05', priority: 'normal',
      dueAt: '2026-11-15T07:05:00.000Z', notes: 'First line\nSecond line',
    });
  });

  it('keeps Manual undated/date-only semantics rather than applying Auto defaults', async () => {
    const state = fixture();
    const manual = { ...submission, mode: 'manual', input: undefined, fields: { text: 'Manual task' } };
    const undated = await state.capture(owner, manual, signal());
    expect(undated).toMatchObject({ dueDate: null, dueTime: null, dueAt: null, priority: 'normal' });
    const receipt = [...state.receipts.values()][0]!;
    expect(receipt.resolved).not.toHaveProperty('due');
    expect(receipt.resolved).not.toHaveProperty('time');
    expect(receipt.resolved).not.toHaveProperty('dueAt');
    expect(receipt.resolved).not.toHaveProperty('priority');
    const dated = await state.capture(owner, {
      ...manual, submissionId: randomUUID(), fields: { text: 'Date-only task', due: '2026-11-12', priority: 'medium' },
    }, signal());
    expect(dated).toMatchObject({ dueDate: '2026-11-12', dueTime: null, dueAt: '2026-11-12T22:59:00.000Z', priority: 'medium' });
    await expect(state.capture(owner, {
      ...manual, submissionId: randomUUID(), fields: { text: 'Time-only task', time: '09:00' },
    }, signal())).rejects.toMatchObject({ statusCode: 400, outcomeUnknown: false });
    expect(state.model).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-11-10T22:30:45.000Z', 'Europe/Copenhagen', '2026-11-11', '00:30', '2026-11-10T23:30:45.000Z'],
    ['2026-03-29T00:30:12.000Z', 'Europe/Copenhagen', '2026-03-29', '03:30', '2026-03-29T01:30:12.000Z'],
    ['2026-10-25T00:30:12.000Z', 'Europe/Copenhagen', '2026-10-25', '02:30', '2026-10-25T01:30:12.000Z'],
    ['2026-11-10T17:30:00.000Z', 'Asia/Kolkata', '2026-11-11', '00:00', '2026-11-10T18:30:00.000Z'],
    ['2026-11-10T22:30:00.000Z', 'America/New_York', '2026-11-10', '18:30', '2026-11-10T23:30:00.000Z'],
    ['2026-11-10T22:30:00.000Z', 'GMT', '2026-11-10', '23:30', '2026-11-10T23:30:00.000Z'],
  ])('uses elapsed +1 hour across midnight/DST: %s %s', async (submittedAt, timeZone, due, time, dueAt) => {
    const state = fixture();
    const result = await state.capture(owner, { ...submission, submittedAt, timeZone }, signal());
    expect(result).toMatchObject({ dueDate: due, dueTime: time, dueAt, timeZone });
    const task = parseTodosWithContext(state.files.get(result.path)!.content, result.path)[0]!;
    expect(task).toMatchObject({ dueDate: due, dueTime: time, dueAt, timeZone });
  });

  it('rejects nonexistent DST time rather than shifting an explicit time', async () => {
    const state = fixture(vi.fn(async () => modelResult({ due: '2026-03-29', time: '02:30' })));
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('does not exist') });
    expect(state.store.reserve).not.toHaveBeenCalled();
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it.each([
    undefined, 'not json', '{}', '{"error":"no_task"}',
    modelResult({ due: '2026-02-30' }), modelResult({ time: '25:30' }),
    modelResult({ priority: 'critical' }), modelResult({ tools: ['write'] }),
    modelResult({ notes: 'x'.repeat(2001) }),
  ])('fails safely on malformed extraction: %s', async (raw) => {
    const state = fixture(vi.fn(async () => raw));
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({ statusCode: 400 });
    expect(state.store.reserve).not.toHaveBeenCalled();
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it('does not convert model failure or cancellation into a saved task', async () => {
    const state = fixture(vi.fn(async () => { throw new Error('private provider details'); }));
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({ statusCode: 503, message: 'Automatic task parsing failed. Retry or use Manual.' });
    expect(state.client.write).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(resolveWatchTask(submission, async () => new Promise(() => {}), controller.signal)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('uses the caller lifetime without a separate parsing deadline and releases its listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const model = vi.fn(async (_prompt, receivedSignal) => {
      expect(receivedSignal).toBe(controller.signal);
      return modelResult();
    });
    await expect(resolveWatchTask(submission, model, controller.signal)).resolves.toMatchObject({ text: 'Køb mælk' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));

    const pending = resolveWatchTask(submission, async () => new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ statusCode: 503 });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('bounds schema inputs without coercion or untrusted extra fields', () => {
    expect(validateWatchTaskSubmission(submission)).toBe(true);
    for (const invalid of [
      null, [], { ...submission, submissionId: 'not-a-uuid' }, { ...submission, submittedAt: 'now' },
      { ...submission, submittedAt: '2026-02-30T12:00:00Z' }, { ...submission, timeZone: '+01:00' },
      { ...submission, timeZone: 'Europe/DoesNotExist' }, { ...submission, input: 'x'.repeat(2001) },
      { ...submission, input: '  ' }, { ...submission, mode: 'manual', fields: {} },
      { ...submission, extra: true }, { ...submission, fields: { due: '2026-02-29' } },
      { ...submission, fields: { notes: 'x'.repeat(2001) } }, { ...submission, fields: { scope: 'factory' } },
      { ...submission, submittedAt: '2026-11-10T24:00:00Z' }, { ...submission, fields: { scope: ['personal'] } },
    ]) expect(validateWatchTaskSubmission(invalid)).toBe(false);
  });
});

describe('durable Watch submission orchestration and CAS writes', () => {
  it('replays the persisted receipt after backend restart without reparsing or moving due time', async () => {
    const state = fixture();
    const result = await state.capture(owner, submission, signal());
    const receipt = [...state.receipts.values()][0]!;
    expect(receipt.resolved).toMatchObject({ dueAt: '2026-11-10T13:15:27.123Z', priority: 'normal' });
    expect(await state.restart()(owner, submission, signal())).toEqual(result);
    expect(state.client.write).toHaveBeenCalledOnce();
    expect(state.model).toHaveBeenCalledOnce();
  });

  it('reserves the winning resolution before any vault side effect, even when parallel model output differs', async () => {
    const model = vi.fn<ApprovalModelPort>()
      .mockResolvedValueOnce(modelResult({ text: 'First title', priority: 'normal' }))
      .mockResolvedValueOnce(modelResult({ text: 'Different title', priority: 'high', due: '2026-12-01', time: '12:00' }));
    const state = fixture(model);
    const results = await Promise.all([
      state.capture(owner, submission, signal()), state.restart()(owner, submission, signal()),
    ]);
    expect(results[0]).toMatchObject({ text: 'First title', dueAt: '2026-11-10T13:15:27.123Z', priority: 'normal' });
    expect(results[1]).toMatchObject({ text: results[0]!.text, dueAt: results[0]!.dueAt, priority: results[0]!.priority });
    expect([...state.files.values()].flatMap(file => parseTodosWithContext(file.content, file.path))).toHaveLength(1);
    expect(state.client.write).toHaveBeenCalledTimes(2);
    expect(state.store.reserve).toHaveBeenCalledTimes(2);
  });

  it('recovers an unknown persisted vault write after restart, without blind retry in the failed request', async () => {
    const state = fixture();
    const write = state.client.write.getMockImplementation()!;
    state.client.write.mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new Error('private GitHub response details');
    });
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({ statusCode: 503, outcomeUnknown: true });
    expect(state.client.write).toHaveBeenCalledOnce();
    expect([...state.receipts.values()][0]!.result).toBeNull();
    const recovered = await state.restart()(owner, submission, signal());
    expect(recovered).toMatchObject({ text: 'Køb mælk', dueAt: '2026-11-10T13:15:27.123Z', commit: null });
    expect(state.client.write).toHaveBeenCalledOnce();
    expect(state.model).toHaveBeenCalledOnce();
    expect(parseTodosWithContext(state.files.get(recovered.path)!.content, recovered.path)).toHaveLength(1);
  });

  it('recovers a failed durable completion receipt without creating another task', async () => {
    const state = fixture();
    vi.mocked(state.store.complete).mockRejectedValueOnce(new Error('SQL response lost'));
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({ statusCode: 503 });
    const result = await state.restart()(owner, submission, signal());
    expect(result.commit).toBeNull();
    expect(state.client.write).toHaveBeenCalledOnce();
    expect([...state.receipts.values()][0]!.result).toEqual(result);
  });

  it('never writes if durable reservation failed, and reports a real error', async () => {
    const state = fixture();
    vi.mocked(state.store.reserve).mockRejectedValueOnce(new Error('SQL unavailable'));
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({
      statusCode: 503, message: expect.stringContaining('could not be saved'), outcomeUnknown: false,
    });
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it.each([
    { submittedAt: '2026-11-10T12:16:27.123Z' }, { timeZone: 'UTC' },
    { input: 'A different task' }, { fields: { scope: 'work' } },
  ])('rejects reused identity with different details: %j', async (changes) => {
    const state = fixture();
    await state.capture(owner, submission, signal());
    await expect(state.restart()(owner, { ...submission, ...changes }, signal())).rejects.toMatchObject({ statusCode: 409 });
    expect(state.model).toHaveBeenCalledOnce();
    expect(state.client.write).toHaveBeenCalledOnce();
  });

  it('rejects a parallel conflicting request after the durable unique-key reservation', async () => {
    const state = fixture();
    const settled = await Promise.allSettled([
      state.capture(owner, submission, signal()),
      state.restart()(owner, { ...submission, fields: { scope: 'work' } }, signal()),
    ]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect([...state.files.keys()]).toEqual(['Personal/Inbox.md']);
    expect(state.client.write).toHaveBeenCalledOnce();
  });

  it('rebases unrelated parallel submissions without losing either task', async () => {
    const state = fixture();
    const results = await Promise.all([
      state.capture(owner, submission, signal()),
      state.capture(owner, { ...submission, submissionId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, signal()),
    ]);
    expect(results).toHaveLength(2);
    expect(parseTodosWithContext(state.files.get(results[0]!.path)!.content, results[0]!.path)).toHaveLength(2);
    expect(state.client.write).toHaveBeenCalledTimes(3);
  });

  it('does not persist a false success after bounded GitHub conflicts', async () => {
    const state = fixture();
    state.client.write.mockRejectedValue(new VaultWriteConflictError());
    await expect(state.capture(owner, submission, signal())).rejects.toMatchObject({ statusCode: 409 });
    expect(state.client.write).toHaveBeenCalledTimes(2);
    expect(state.store.complete).not.toHaveBeenCalled();
    expect([...state.receipts.values()][0]!.result).toBeNull();
  });

  it('refuses creation without durable storage or with secrets, before model/save', async () => {
    const state = fixture();
    const noStore = createWatchTaskCapture({ writer: state.writer(), shouldRedact: taskWriteHelpers.shouldRedact });
    await expect(noStore(owner, submission, signal())).rejects.toMatchObject({ statusCode: 503 });
    await expect(state.capture(owner, { ...submission, input: 'Save password: not-a-real-secret' }, signal())).rejects.toMatchObject({ statusCode: 400 });
    expect(state.model).not.toHaveBeenCalled();
    expect(state.client.write).not.toHaveBeenCalled();
  });

  it('bounds parser calls per replica while allowing durable replays and Manual recovery', async () => {
    const state = fixture();
    let now = new Date('2026-11-10T12:15:27Z');
    const capture = createWatchTaskCapture({
      writer: state.writer(), store: state.store, model: state.model,
      shouldRedact: taskWriteHelpers.shouldRedact, now: () => now,
    });
    const original = await capture(owner, submission, signal());
    for (let attempt = 0; attempt < 19; attempt += 1) {
      vi.mocked(state.model).mockResolvedValueOnce('{"error":"no_task"}');
      await expect(capture(owner, { ...submission, submissionId: randomUUID() }, signal())).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(capture(owner, { ...submission, submissionId: randomUUID() }, signal())).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('busy') });
    expect(await capture(owner, submission, signal())).toEqual(original);
    await expect(capture(owner, {
      ...submission, submissionId: randomUUID(), mode: 'manual', input: undefined, fields: { text: 'Manual recovery' },
    }, signal())).resolves.toMatchObject({ text: 'Manual recovery' });
    expect(state.model).toHaveBeenCalledTimes(20);
    now = new Date(now.getTime() + 60_001);
    await expect(capture(owner, { ...submission, submissionId: randomUUID() }, signal())).resolves.toMatchObject({ text: 'Køb mælk' });
    expect(state.model).toHaveBeenCalledTimes(21);
  });
});

describe('Watch full task edit', () => {
  it('preserves done state, notes, zone, reminders and foreign markers while updating all requested fields', async () => {
    const state = fixture();
    const created = await state.capture(owner, { ...submission, mode: 'manual', input: undefined, fields: {
      text: 'Review launch', due: '2026-11-15', time: '09:30', priority: 'high', notes: 'Original\nnotes',
    } }, signal());
    const file = state.files.get(created.path)!;
    file.content = file.content.replace('- [ ]', '- [x]').replace('Review launch', 'Review launch 🔁 every week ⛔ dep-123 🏁 keep');
    file.sha = createHash('sha1').update(file.content).digest('hex');
    const current = parseTodosWithContext(file.content, file.path)[0]!;
    const edit = watchTaskEditInput({
      path: current.path, line: current.line, text: current.text, version: current.version,
      timeZone: 'America/New_York',
      fields: { text: 'Review revised launch', due: '2026-11-16', time: '10:15', priority: 'medium', notes: 'Revised\nnotes' },
    });
    const result = await state.writer().edit(edit);
    expect(result).toMatchObject({
      text: 'Review revised launch', done: true, dueDate: '2026-11-16', dueTime: '10:15',
      dueAt: '2026-11-16T15:15:00.000Z', priority: 'medium', notes: 'Revised\nnotes', timeZone: 'America/New_York', remindAtDue: false,
    });
    expect(state.files.get(file.path)!.content).toContain('🔁 every week ⛔ dep-123 🏁 keep');
    expect(state.files.get(file.path)!.content).toContain(`🆔 ${submission.submissionId}`);
    await expect(state.writer().edit(edit)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('preserves the exact default DST instant and notes in a title-only edit; clearing notes changes the version', async () => {
    const state = fixture();
    const created = await state.capture(owner, { ...submission, submittedAt: '2026-10-25T00:30:12.000Z', fields: { notes: 'Keep notes' } }, signal());
    const result = await state.writer().edit(watchTaskEditInput({
      path: created.path, line: created.line, text: created.text, version: created.version,
      fields: { text: 'Changed title', due: created.dueDate, time: created.dueTime },
    }));
    expect(result).toMatchObject({ dueAt: '2026-10-25T01:30:12.000Z', timeZone: 'Europe/Copenhagen', notes: 'Keep notes' });
    const cleared = await state.writer().edit(watchTaskEditInput({
      path: result.path, line: result.line, text: result.text, version: result.version,
      fields: { text: result.text, notes: '' },
    }));
    expect(cleared.notes).toBe('');
    expect(cleared.version).not.toBe(result.version);
    expect(cleared.dueAt).toBe(result.dueAt);
  });

  it('retains existing exact-time reminders unless the owner explicitly changes them', async () => {
    const state = fixture();
    const created = await state.writer().create({
      text: 'Timed reminder', due: '2026-11-15', time: '09:30', priority: 'high', remindAtDue: true,
    });
    const identity = { path: created.path, line: created.line, text: created.text, version: created.version };
    const result = await state.writer().edit(watchTaskEditInput({ ...identity, fields: { text: 'Edited reminder', notes: 'Keep exact time' } }));
    expect(result.remindAtDue).toBe(true);
    expect(state.files.get(result.path)!.content).toContain('[reminder:: at_due_time]');
    await expect(state.writer().edit(watchTaskEditInput({
      path: result.path, line: result.line, text: result.text, version: result.version,
      fields: { text: result.text, priority: 'normal' },
    }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not reinterpret a legacy Copenhagen date when an unrelated edit echoes its unchanged schedule without a zone', async () => {
    const state = fixture();
    const path = 'Personal/Inbox.md';
    const content = '- [ ] Legacy task 📅 2026-10-25 02:30 ⏫ [reminder:: at_due_time]\n';
    state.files.set(path, { path, content, sha: createHash('sha1').update(content).digest('hex') });
    const original = parseTodosWithContext(content, path)[0]!;
    expect(original.timeZone).toBeUndefined();
    const result = await state.writer().edit(watchTaskEditInput({
      path, line: original.line, text: original.text, version: original.version,
      fields: { text: 'Legacy revised', due: original.dueDate, time: original.dueTime, notes: 'Only notes changed' },
    }));
    expect(result).toMatchObject({ dueDate: original.dueDate, dueTime: original.dueTime, dueAt: original.dueAt, remindAtDue: true });
    expect(result.timeZone).toBeUndefined();
    expect(state.files.get(path)!.content).not.toContain('America/');
  });
});
