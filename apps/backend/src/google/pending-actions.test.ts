import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '../core/conversation-store.js';
import { PendingGoogleActions } from './pending-actions.js';

function message(id: string, text: string, at: number): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at: new Date(at) };
}

describe('pending Google actions', () => {
  it('accepts code selection from a later Dan message and consumes it once', async () => {
    let now = 1000;
    const actions = new PendingGoogleActions(() => now);
    const execute = vi.fn(async () => ({ status: 'completed' }));
    const pending = actions.stage({
      scope: 'calendar',
      sourceMessageId: '10',
      summary: 'Create a meeting.',
      execute,
    });
    const signal = new AbortController().signal;

    await expect(actions.confirm('calendar', pending.confirmationCode, message('10', 'confirm', now + 1), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    now += 1;
    await expect(actions.confirm(
      'calendar', pending.confirmationCode, message('11', `confirm ${pending.confirmationCode}`, now), signal,
    )).resolves.toEqual({ status: 'completed' });
    await expect(actions.confirm(
      'calendar', pending.confirmationCode, message('12', `confirm ${pending.confirmationCode}`, now + 1), signal,
    )).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).toHaveBeenCalledOnce();
  });
});


describe('short calendar approval', () => {
  const signal = new AbortController().signal;
  function setup() {
    const execute = vi.fn(async () => ({ status: 'completed' }));
    const actions = new PendingGoogleActions(() => 1000);
    const pending = actions.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Delete meeting.', execute });
    return { actions, pending, execute };
  }

  it('accepts a later approve reply once', async () => {
    const { actions, pending, execute } = setup();
    expect(pending.instruction).toContain('reply "approve"');
    await actions.confirm('calendar', pending.confirmationCode, message('11', ' APPROVE ', 1001), signal);
    await expect(actions.confirm('calendar', pending.confirmationCode, message('12', 'approve', 1002), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    message('11', 'yes', 1001),
    message('11', 'please approve', 1001),
    message('11', 'do not approve', 1001),
    message('10', 'approve', 1001),
    message('9', 'approve', 1001),
    message('11', 'approve', 1000),
    message('invalid', 'approve', 1001),
    message('11', 'approve', NaN),
    { ...message('11', 'approve', 1001), role: 'jarvis' as const },
  ])('refuses missing or invalid approval %# without executing', async (approval) => {
    const { actions, pending, execute } = setup();
    await expect(actions.confirm('calendar', pending.confirmationCode, approval, signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires a code for ambiguity and prevents reusing approval for another change', async () => {
    const { actions, pending, execute } = setup();
    const second = actions.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Move meeting.', execute });
    await expect(actions.confirm('calendar', pending.confirmationCode, message('11', 'approve', 1001), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    await actions.confirm('calendar', pending.confirmationCode, message('11', `confirm ${pending.confirmationCode}`, 1001), signal);
    await expect(actions.confirm('calendar', second.confirmationCode, message('11', 'approve', 1001), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    await actions.confirm('calendar', second.confirmationCode, message('12', 'approve', 1002), signal);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('refuses unknown codes, wrong scopes, cancellation and expiry', async () => {
    const { actions, pending, execute } = setup();
    const approval = message('11', 'approve', 1001);
    for (const [scope, code, abortSignal] of [
      ['calendar', 'invalid', signal],
      ['mail', pending.confirmationCode, signal],
      ['calendar', pending.confirmationCode, AbortSignal.abort()],
    ] as const) {
      await expect(actions.confirm(scope, code, approval, abortSignal)).rejects.toMatchObject({ name: 'ToolRefusal' });
    }
    let now = 1000;
    const expiring = new PendingGoogleActions(() => now);
    const expired = expiring.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Change', execute });
    now += 600_000;
    await expect(expiring.confirm('calendar', expired.confirmationCode, message('11', 'approve', now), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps exact mail approval even with a pending calendar change', async () => {
    const { actions } = setup();
    const execute = vi.fn(async () => ({}));
    const mail = actions.stage({ scope: 'mail', sourceMessageId: '10', summary: 'Send mail', execute });
    await expect(actions.confirm('mail', mail.confirmationCode, message('11', 'approve', 1001), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    await actions.confirm('mail', mail.confirmationCode, message('11', `confirm ${mail.confirmationCode}`, 1001), signal);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('consumes approval before execution settles, refusing concurrent replay for another action', async () => {
    const { actions, pending } = setup();
    let finish!: () => void;
    const execute = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const second = actions.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Move meeting.', execute });
    const approval = message('11', `confirm ${second.confirmationCode}`, 1001);
    const running = actions.confirm('calendar', second.confirmationCode, approval, signal);
    expect(execute).toHaveBeenCalledOnce();
    await expect(actions.confirm('calendar', second.confirmationCode, approval, signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(actions.confirm('calendar', pending.confirmationCode, message('11', 'approve', 1001), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(actions.size).toBe(1);
    finish();
    await running;
  });

  it('reports execution failure and prevents retrying a potentially completed external write', async () => {
    const actions = new PendingGoogleActions(() => 1000);
    const execute = vi.fn(async () => { throw new Error('Provider unavailable'); });
    const pending = actions.stage({ scope: 'calendar', sourceMessageId: '10', summary: 'Create meeting.', execute });
    await expect(actions.confirm('calendar', pending.confirmationCode, message('11', 'approve', 1001), signal))
      .rejects.toThrow('Provider unavailable');
    await expect(actions.confirm('calendar', pending.confirmationCode, message('12', 'approve', 1002), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(actions.size).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
  });
});
