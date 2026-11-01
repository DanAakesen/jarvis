import { describe, expect, it, vi } from 'vitest';
import { approvalNotPending, approvalUnclear } from '../core/approval.js';
import type { ApprovalDecider, ApprovalVerdict } from '../core/approval-interpreter.js';
import type { ConversationMessage } from '../core/conversation-store.js';
import { PendingGoogleActions } from './pending-actions.js';

function message(id: string, text: string, at: number): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at: new Date(at) };
}

function fixture(scope: 'calendar' | 'mail' = 'calendar') {
  let now = 1000;
  const actions = new PendingGoogleActions(() => now);
  const execute = vi.fn(async () => ({ status: 'completed' }));
  const stage = () => actions.stage({ scope, sourceMessageId: '10', sourceSessionId: '1', summary: 'Change.', execute });
  const pending = stage();
  const signal = new AbortController().signal;
  return { actions, execute, stage, pending, setNow: (value: number) => { now = value; },
    confirm: (text: string, msg = message('11', text, 1001), code = pending.confirmationCode) =>
      actions.confirm(scope, code, msg, signal) };
}

describe('pending Google actions', () => {
  it('refuses an oversized calendar proposal without replacing an existing review', () => {
    const f = fixture();
    expect(() => f.actions.stage({ scope: 'calendar', sourceMessageId: '11', sourceSessionId: '1',
      summary: 'x'.repeat(40_001), execute: f.execute })).toThrow('too large to review');
    expect(f.actions.pendingBrowserConfirmations()).toHaveLength(1);
    expect(f.actions.pendingCalendarChange(message('11', 'yes', 1001)))
      .toHaveProperty('confirmationCode', f.pending.confirmationCode);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each(['yes', 'ja', 'do it', 'gør det'])('resolves %s to the most recent staged proposal', async (reply) => {
    const f = fixture();
    const newest = f.stage();
    await expect(f.confirm(reply)).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm(reply, undefined, newest.confirmationCode)).resolves.toMatchObject({ status: 'completed' });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.actions.pendingBrowserConfirmations()).toEqual([]);
  });

  it('uses the same single-use proposal for a tap and a conversational yes', async () => {
    const f = fixture();
    const card = f.actions.pendingBrowserConfirmations()[0]!;
    expect(card).toMatchObject({ id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      actionKind: 'calendar_change', summary: f.pending.summary });
    await expect(f.actions.resolveBrowserConfirmation(card.id, 'approve', new AbortController().signal))
      .resolves.toMatchObject({ result: { status: 'completed' } });
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.actions.pendingCalendarChange(message('11', 'yes', 1001)))
      .toMatchObject({ status: 'none', lastChange: { status: 'completed' } });
  });

  it('notifies approval delivery only when a calendar confirmation is staged', () => {
    const calendar = fixture();
    const notifyApproval = vi.fn();
    calendar.actions.onConfirmationPending = notifyApproval;
    const staged = calendar.stage();
    expect(notifyApproval).toHaveBeenCalledOnce();
    expect(notifyApproval).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      actionKind: 'calendar_change',
      summary: staged.summary,
    }));

    const mail = fixture('mail');
    mail.actions.onConfirmationPending = notifyApproval;
    mail.stage();
    expect(notifyApproval).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'expire', 'replace', 'abort', 'failure'])('keeps tap approval safe on %s', async (mode) => {
    const f = fixture();
    const card = f.actions.pendingBrowserConfirmations()[0]!;
    const controller = new AbortController();
    if (mode === 'expire') f.setNow(601000);
    if (mode === 'replace') f.stage();
    if (mode === 'abort') controller.abort();
    if (mode === 'failure') f.execute.mockRejectedValueOnce(new Error('Provider unavailable'));
    const result = f.actions.resolveBrowserConfirmation(
      card.id, mode === 'reject' ? 'reject' : 'approve', controller.signal,
    );
    if (mode === 'abort' || mode === 'failure') await expect(result).rejects.toThrow();
    else if (mode === 'reject') await expect(result).resolves.toMatchObject({ result: { status: 'cancelled' } });
    else await expect(result).resolves.toBe(false);
    expect(f.execute).toHaveBeenCalledTimes(mode === 'failure' ? 1 : 0);
    if (mode === 'failure') {
      await expect(f.actions.resolveBrowserConfirmation(card.id, 'approve', new AbortController().signal))
        .resolves.toBe(false);
      expect(f.actions.pendingCalendarChange(message('11', 'yes', 1001)))
        .toMatchObject({ lastChange: { status: 'unverified' } });
    }
  });

  it('recovers only a real calendar stage with its original code until expiry', async () => {
    const f = fixture();
    const reader = message('11', 'what is pending?', 1001);
    expect(f.actions.pendingCalendarChange(reader)).toMatchObject({
      status: 'awaiting_confirmation', confirmationCode: f.pending.confirmationCode,
      summary: 'Change.', expiresAt: new Date(601000).toISOString(),
    });
    await f.confirm('yes');
    expect(f.actions.pendingCalendarChange(reader)).toMatchObject({ status: 'none' });
    expect(f.actions.pendingCalendarChange(reader).detail).not.toContain('Nothing has changed');
    f.stage();
    f.setNow(601000);
    expect(f.actions.pendingCalendarChange(reader)).toMatchObject({ status: 'none' });
    expect(fixture('mail').actions.pendingCalendarChange(reader)).toMatchObject({ status: 'none' });
  });

  it('refuses to stage an action that is not bound to a session', () => {
    const actions = new PendingGoogleActions(() => 1_000);
    for (const sourceSessionId of ['', undefined, 7] as never[]) {
      expect(() => actions.stage({
        scope: 'calendar', sourceMessageId: '10', sourceSessionId, summary: 'Unbound.', execute: vi.fn(),
      })).toThrow(TypeError);
    }
    expect(actions.size).toBe(0);
  });

  it('shows a pending change only to a verified Dan message from the session that staged it', () => {
    const f = fixture();
    expect(f.actions.pendingCalendarChange()).toMatchObject({ status: 'none' });
    expect(f.actions.pendingCalendarChange({ ...message('11', 'yes', 1001), sessionId: '2' })).toMatchObject({ status: 'none' });
    expect(f.actions.pendingCalendarChange({ ...message('11', 'yes', 1001), role: 'jarvis' })).toMatchObject({ status: 'none' });
    expect(f.actions.pendingCalendarChange(message('11', 'yes', 1001))).toMatchObject({ status: 'awaiting_confirmation' });
  });

  it.each(['yes', 'approve', 'go ahead', 'do it', ' YES! ', 'Approve.'])('approves calendar with %s only once', async (reply) => {
    const f = fixture();
    await expect(f.confirm(reply)).resolves.toEqual({
      status: 'completed',
      summary: 'Change.',
      instruction: 'The action is done. Confirm it in one short sentence without reading the details aloud; they are on screen.',
    });
    await expect(f.confirm(reply)).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each(['no', 'cancel', 'No!'])('discards calendar with %s without writing', async (reply) => {
    const f = fixture();
    await expect(f.confirm(reply)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(0);
  });

  it.each(['maybe', 'yes please move it later', 'yes and send mail', 'do it?', 'no, create another', ''])('refuses ambiguous or combined reply %s', async (reply) => {
    const f = fixture();
    await expect(f.confirm(reply)).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(1);
  });

  it.each([
    message('10', 'yes', 1001), message('9', 'yes', 1001),
    message('11', 'yes', 1000), message('11', 'yes', NaN),
    { ...message('11', 'yes', 1001), role: 'jarvis' as const },
  ])('refuses wrong identity or turn', async (msg) => {
    const f = fixture();
    await expect(f.confirm('yes', msg)).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('refuses expiry and missing pending actions', async () => {
    const f = fixture();
    f.setNow(601000);
    await expect(f.confirm('yes', message('11', 'yes', 601001))).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm('yes', undefined, 'missing')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.actions.confirm('calendar', f.pending.confirmationCode, undefined, new AbortController().signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('consumes a real stage before a failed provider call and never retries on another yes', async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(f.confirm('yes')).rejects.toThrow('Provider unavailable');
    expect(f.actions.pendingCalendarChange()).toMatchObject({ status: 'none' });
    await expect(f.confirm('yes', message('12', 'yes', 1002))).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it('supersedes older calendar actions without restoring them after cancellation', async () => {
    const f = fixture();
    const latest = f.stage();
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm('cancel', undefined, latest.confirmationCode)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('approves Gmail with a plain reply and keeps pending mail when staging calendar', async () => {
    const f = fixture('mail');
    f.actions.stage({ scope: 'calendar', sourceMessageId: '10', sourceSessionId: '1', summary: 'Calendar.', execute: vi.fn() });
    await expect(f.confirm('yes, and also delete my inbox')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm('approved')).resolves.toMatchObject({ status: 'completed' });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it('discards Gmail on a plain decline and only the latest mail action can be approved', async () => {
    const f = fixture('mail');
    await expect(f.confirm('nej')).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.execute).not.toHaveBeenCalled();
    const older = fixture('mail');
    const newer = older.actions.stage({ scope: 'mail', sourceMessageId: '10', sourceSessionId: '1', summary: 'Newer mail.', execute: vi.fn() });
    await expect(older.confirm('confirmed')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(older.confirm('confirmed', undefined, newer.confirmationCode)).resolves.toBeUndefined();
  });

  it('binds batch receipts to their exact source session and clears them for a new proposal', async () => {
    let now = 1_000;
    const actions = new PendingGoogleActions(() => now);
    const items = ['First hotel.', 'Second hotel.'];
    const execute = vi.fn(async () => ({
      status: 'partial', detail: 'One event created.',
      items: [{ summary: items[0], status: 'completed' },
        { summary: items[1], status: 'unverified' }],
    }));
    const staged = actions.stage({
      scope: 'calendar', sourceMessageId: '10', sourceSessionId: '1',
      summary: 'Both hotels.', items, execute,
    });
    items[0] = 'Changed outside the proposal.';
    expect(actions.pendingCalendarChange(message('11', 'yes', 1_001)).items)
      .toEqual([{ summary: 'First hotel.' }, { summary: 'Second hotel.' }]);
    expect(actions.pendingCalendarChange(message('11', 'yes', 1_001)))
      .toHaveProperty('sourceMessageId', '10');
    const foreign = { ...message('11', 'yes', 1_001), sessionId: '2' };
    expect(actions.pendingCalendarChange(foreign)).toMatchObject({ status: 'none' });
    await expect(actions.confirm('calendar', staged.confirmationCode, foreign,
      new AbortController().signal)).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).not.toHaveBeenCalled();
    await actions.confirm('calendar', staged.confirmationCode, message('11', 'yes', 1_001),
      new AbortController().signal);
    const receipt = actions.pendingCalendarChange(message('12', 'yes', 1_002));
    expect(receipt).toMatchObject({ status: 'none', lastChange: {
      summary: 'Both hotels.', status: 'partial', sourceMessageId: '10',
    } });
    expect(actions.pendingCalendarChange(foreign)).not.toHaveProperty('lastChange');
    expect(new PendingGoogleActions().pendingCalendarChange()).not.toHaveProperty('lastChange');
    now = 601_000;
    expect(actions.pendingCalendarChange(message('12', 'yes', now))).not.toHaveProperty('lastChange');
    actions.stage({ scope: 'calendar', sourceMessageId: '12', sourceSessionId: '1', summary: 'Different change.', execute });
    expect(actions.pendingCalendarChange(message('13', 'yes', now + 1))).toMatchObject({
      status: 'awaiting_confirmation', summary: 'Different change.',
    });
    expect(actions.pendingCalendarChange(message('13', 'yes', now + 1))).not.toHaveProperty('lastChange');
  });

  it('does not widen an existing single-event approval to a replacement batch', async () => {
    const f = fixture();
    const batch = vi.fn(async () => ({ status: 'completed' }));
    const staged = f.actions.stage({
      scope: 'calendar', sourceMessageId: '10', sourceSessionId: '1',
      summary: 'Two events.', items: ['First.', 'Second.'], execute: batch,
    });
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(batch).not.toHaveBeenCalled();
    await f.confirm('yes', message('11', 'yes', 1_001), staged.confirmationCode);
    expect(batch).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('retains the actual batch source identity when execution yields no receipt details', async () => {
    const actions = new PendingGoogleActions(() => 1_000);
    const execute = vi.fn(async () => { throw new Error('Synthetic interrupted result'); });
    const staged = actions.stage({
      scope: 'calendar', sourceMessageId: '10', sourceSessionId: '1',
      summary: 'Both hotels.', items: ['First.', 'Second.'], execute,
    });
    await expect(actions.confirm('calendar', staged.confirmationCode,
      message('11', 'yes', 1_001), new AbortController().signal))
      .rejects.toThrow('Synthetic interrupted result');
    expect(actions.pendingCalendarChange(message('12', 'yes', 1_002))).toMatchObject({
      status: 'none', lastChange: { sourceMessageId: '10', status: 'unverified' },
    });
    await expect(actions.confirm('calendar', staged.confirmationCode,
      message('12', 'yes', 1_002), new AbortController().signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not restore an older in-flight receipt over a newer proposal', async () => {
    const actions = new PendingGoogleActions(() => 1_000);
    let finish: ((result: { status: string }) => void) | undefined;
    const staged = actions.stage({
      scope: 'calendar', sourceMessageId: '10', sourceSessionId: '1',
      summary: 'Older proposal.', items: ['First.', 'Second.'],
      execute: () => new Promise<{ status: string }>((resolve) => { finish = resolve; }),
    });
    const older = actions.confirm('calendar', staged.confirmationCode,
      message('11', 'yes', 1_001), new AbortController().signal);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const newer = actions.stage({
      scope: 'calendar', sourceMessageId: '12', sourceSessionId: '1',
      summary: 'Newer proposal.', items: ['Third.', 'Fourth.'],
      execute: async () => ({ status: 'completed' }),
    });
    finish!({ status: 'completed' });
    await older;
    expect(actions.pendingCalendarChange(message('13', 'yes', 1_002))).toMatchObject({
      summary: 'Newer proposal.', confirmationCode: newer.confirmationCode,
    });
    await actions.confirm('calendar', newer.confirmationCode,
      message('13', 'no', 1_003), new AbortController().signal);
    expect(actions.pendingCalendarChange(message('14', 'yes', 1_004))).toMatchObject({
      lastChange: { summary: 'Newer proposal.', status: 'cancelled' },
    });
  });
});

describe('pending Google actions: meaning decided by the interpreter, provenance decided here', () => {
  const summary = 'Create "Synthetic Hotel Alpha" on 14 June 2027.';
  const reply = 'perfect, go for it';
  const fresh = () => message('11', reply, 1_001);

  function staged(decide: ApprovalDecider = async () => 'approve') {
    let now = 1_000;
    const actions = new PendingGoogleActions(() => now);
    const execute = vi.fn(async () => ({ status: 'completed' }));
    const pending = actions.stage({ scope: 'calendar', sourceMessageId: '10', sourceSessionId: '1', summary, execute });
    const decider = vi.fn<ApprovalDecider>(decide);
    return {
      actions, execute, pending, decider, setNow: (value: number) => { now = value; },
      confirm: (
        msg: ConversationMessage | undefined,
        code = pending.confirmationCode,
        signal = new AbortController().signal,
      ) => actions.confirm('calendar', code, msg, signal, decider),
    };
  }

  it('asks the interpreter about exactly this reply and proposal, and executes only on approve', async () => {
    const f = staged();
    await expect(f.confirm(fresh())).resolves.toMatchObject({ status: 'completed', summary });
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.decider).toHaveBeenCalledOnce();
    expect(f.decider.mock.calls[0]![0]).toEqual({
      reply, summary, family: 'calendar', messageId: '11', sessionId: '1', actionKey: f.pending.confirmationCode,
    });
  });

  it('discards on decline without writing and leaves nothing pending', async () => {
    const f = staged(async () => 'decline');
    await expect(f.confirm(message('11', 'not those, thanks', 1_001))).resolves.toMatchObject({ status: 'cancelled', summary });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(0);
  });

  it('asks one natural question and keeps the action pending when the reply is neither', async () => {
    const answers: ApprovalVerdict[] = ['neither', 'approve'];
    const f = staged(async () => answers.shift()!);
    const refusal = await f.confirm(message('11', 'hmm, wait', 1_001)).catch((error: Error) => error);
    expect(refusal).toMatchObject({ name: 'ToolRefusal', message: approvalUnclear });
    expect((refusal as Error).message).not.toMatch(/\byes\b|\bapproved\b|\bconfirmed\b|go ahead|exactly one of/iu);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(1);
    await expect(f.confirm(message('12', reply, 1_002))).resolves.toMatchObject({ status: 'completed' });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each([
    ['throws', async () => { throw new Error('model down'); }],
    ['returns garbage', async () => 'APPROVE' as ApprovalVerdict],
    ['returns nothing', async () => undefined as unknown as ApprovalVerdict],
  ])('fails closed when the interpreter %s', async (_name, decide) => {
    const f = staged(decide);
    await expect(f.confirm(fresh())).rejects.toMatchObject({ name: 'ToolRefusal', message: approvalUnclear });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(1);
  });

  it.each([
    ['the staging message itself', () => message('10', reply, 1_001)],
    ['an older message', () => message('9', reply, 1_001)],
    ['a message not later than the stage', () => message('11', reply, 1_000)],
    ['a message without a valid time', () => message('11', reply, NaN)],
    ['a message from another session', () => ({ ...message('11', reply, 1_001), sessionId: '2' })],
    ['a message without a session', () => ({ ...message('11', reply, 1_001), sessionId: '' })],
    ['a message from Jarvis', () => ({ ...message('11', reply, 1_001), role: 'jarvis' as const })],
    ['a message from an unknown role', () => ({ ...message('11', reply, 1_001), role: 'tool' as never })],
    ['a non-numeric id', () => message('abc', reply, 1_001)],
    ['a zero-padded id', () => message('011', reply, 1_001)],
    ['a missing message', () => undefined],
  ])('never consults the interpreter for %s', async (_name, build) => {
    const f = staged();
    await expect(f.confirm(build())).rejects.toMatchObject({ name: 'ToolRefusal', message: approvalNotPending });
    expect(f.decider).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(1);
  });

  it('never consults the interpreter for an unknown code, another scope or an expired action', async () => {
    const f = staged();
    await expect(f.confirm(undefined, '00000000')).rejects.toMatchObject({ message: approvalNotPending });
    await expect(f.confirm(message('11', reply, 1_001), '00000000')).rejects.toMatchObject({ message: approvalNotPending });
    await expect(f.actions.confirm('mail', f.pending.confirmationCode, message('11', reply, 1_001),
      new AbortController().signal, f.decider)).rejects.toMatchObject({ message: approvalNotPending });
    f.setNow(601_000);
    await expect(f.confirm(message('11', reply, 601_001))).rejects.toMatchObject({ message: approvalNotPending });
    expect(f.decider).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('exposes the verdict, or nothing at all when the message may not decide', async () => {
    const f = staged(async () => 'approve');
    const signal = new AbortController().signal;
    const code = f.pending.confirmationCode;
    await expect(f.actions.decision('calendar', code, message('11', reply, 1_001), f.decider, signal)).resolves.toBe('approve');
    await expect(f.actions.decision('calendar', code, message('10', reply, 1_001), f.decider, signal)).resolves.toBeUndefined();
    await expect(f.actions.decision('calendar', code, { ...message('11', reply, 1_001), sessionId: '2' }, f.decider, signal))
      .resolves.toBeUndefined();
    await expect(f.actions.decision('calendar', '00000000', message('11', reply, 1_001), f.decider, signal)).resolves.toBeUndefined();
    expect(f.decider).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.size).toBe(1);
  });

  it('refuses when the action is replaced while the interpreter is deciding', async () => {
    let release: (verdict: ApprovalVerdict) => void = () => undefined;
    const f = staged(() => new Promise<ApprovalVerdict>((resolve) => { release = resolve; }));
    const deciding = f.confirm(fresh());
    await vi.waitFor(() => expect(f.decider).toHaveBeenCalledOnce());
    const newer = f.actions.stage({
      scope: 'calendar', sourceMessageId: '12', sourceSessionId: '1', summary: 'Newer.', execute: vi.fn(),
    });
    release('approve');
    await expect(deciding).rejects.toMatchObject({ message: approvalNotPending });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.actions.pendingCalendarChange(message('13', 'ok', 1_002))).toMatchObject({
      status: 'awaiting_confirmation', confirmationCode: newer.confirmationCode,
    });
  });

  it('refuses when the action expires while the interpreter is deciding', async () => {
    let release: (verdict: ApprovalVerdict) => void = () => undefined;
    const f = staged(() => new Promise<ApprovalVerdict>((resolve) => { release = resolve; }));
    const deciding = f.confirm(fresh());
    await vi.waitFor(() => expect(f.decider).toHaveBeenCalledOnce());
    f.setNow(601_000);
    release('approve');
    await expect(deciding).rejects.toMatchObject({ message: approvalNotPending });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('refuses when the caller aborts while the interpreter is deciding', async () => {
    let release: (verdict: ApprovalVerdict) => void = () => undefined;
    const f = staged(() => new Promise<ApprovalVerdict>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const deciding = f.confirm(message('11', reply, 1_001), f.pending.confirmationCode, controller.signal);
    await vi.waitFor(() => expect(f.decider).toHaveBeenCalledOnce());
    controller.abort();
    release('approve');
    await expect(deciding).rejects.toMatchObject({ message: approvalNotPending });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('executes once when two approvals race', async () => {
    const releases: Array<(verdict: ApprovalVerdict) => void> = [];
    const f = staged(() => new Promise<ApprovalVerdict>((resolve) => { releases.push(resolve); }));
    const first = f.confirm(message('11', reply, 1_001));
    const second = f.confirm(message('12', 'yes please', 1_002));
    await vi.waitFor(() => expect(f.decider).toHaveBeenCalledTimes(2));
    for (const release of releases) release('approve');
    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(f.execute).toHaveBeenCalledOnce();
  });
});
