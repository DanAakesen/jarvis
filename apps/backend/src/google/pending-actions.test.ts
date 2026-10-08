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
  it.each(['yes', 'approve', 'go ahead', 'do it', ' YES! ', 'Approve.'])('approves calendar with %s only once', async (reply) => {
    const f = fixture();
    await expect(f.confirm(reply)).resolves.toEqual({ status: 'completed' });
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

  it('supersedes older calendar actions without restoring them after cancellation', async () => {
    const f = fixture();
    const latest = f.stage();
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm('cancel', undefined, latest.confirmationCode)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('preserves Gmail exact-code confirmation and pending mail when staging calendar', async () => {
    const f = fixture('mail');
    f.actions.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Calendar.', execute: vi.fn() });
    await expect(f.confirm('yes')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm('cancel')).rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(f.confirm(`confirm ${f.pending.confirmationCode}`)).resolves.toMatchObject({ status: 'completed' });
    expect(f.execute).toHaveBeenCalledOnce();
  });
});
