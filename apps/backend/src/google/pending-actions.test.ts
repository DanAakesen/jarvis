import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '../core/conversation-store.js';
import { PendingGoogleActions } from './pending-actions.js';

function message(id: string, text: string, at: number): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at: new Date(at) };
}

function fixture(scope: 'calendar' | 'mail' = 'calendar') {
  let now = 1000;
  const actions = new PendingGoogleActions(() => now);
  const execute = vi.fn(async () => ({ status: 'completed' }));
  const stage = () => actions.stage({ scope, sourceMessageId: '10', summary: 'Change.', execute });
  const pending = stage();
  const signal = new AbortController().signal;
  return { actions, execute, stage, pending, setNow: (value: number) => { now = value; },
    confirm: (text: string, msg = message('11', text, 1001), code = pending.confirmationCode) =>
      actions.confirm(scope, code, msg, signal) };
}

describe('pending Google actions', () => {
  it('recovers only a real calendar stage with its original code until expiry', async () => {
    const f = fixture();
    expect(f.actions.pendingCalendarChange()).toMatchObject({
      status: 'awaiting_confirmation', confirmationCode: f.pending.confirmationCode,
      summary: 'Change.', expiresAt: new Date(601000).toISOString(),
    });
    await f.confirm('yes');
    expect(f.actions.pendingCalendarChange()).toMatchObject({ status: 'none' });
    expect(f.actions.pendingCalendarChange().detail).not.toContain('Nothing has changed');
    f.stage();
    f.setNow(601000);
    expect(f.actions.pendingCalendarChange()).toMatchObject({ status: 'none' });
    expect(fixture('mail').actions.pendingCalendarChange()).toMatchObject({ status: 'none' });
  });

  it.each(['yes', 'approve', 'go ahead', 'do it', ' YES! ', 'Approve.'])('approves calendar with %s only once', async (reply) => {
    const f = fixture();
    await expect(f.confirm(reply)).resolves.toEqual({ status: 'completed', summary: 'Change.' });
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
    f.actions.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Calendar.', execute: vi.fn() });
    await expect(f.confirm('yes, and also delete my inbox')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm('approved')).resolves.toMatchObject({ status: 'completed' });
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it('discards Gmail on a plain decline and only the latest mail action can be approved', async () => {
    const f = fixture('mail');
    await expect(f.confirm('nej')).resolves.toMatchObject({ status: 'cancelled' });
    expect(f.execute).not.toHaveBeenCalled();
    const older = fixture('mail');
    const newer = older.actions.stage({ scope: 'mail', sourceMessageId: '10', summary: 'Newer mail.', execute: vi.fn() });
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
    actions.stage({ scope: 'calendar', sourceMessageId: '12', summary: 'Different change.', execute });
    expect(actions.pendingCalendarChange()).not.toHaveProperty('lastChange');
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
