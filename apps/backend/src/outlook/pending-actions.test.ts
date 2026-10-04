import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '../core/conversation-store.js';
import { PendingOutlookActions } from './pending-actions.js';

function message(id: string, text: string, at: number): ConversationMessage {
  return {
    id,
    sessionId: '1',
    role: 'dan',
    text,
    model: null,
    at: new Date(at),
  };
}

describe('pending Outlook actions', () => {
  it('requires an exact confirmation in a later Dan message and consumes it once', async () => {
    let now = 1_000;
    const actions = new PendingOutlookActions(() => now);
    const execute = vi.fn(async () => ({ status: 'completed' }));
    const pending = actions.stage({
      scope: 'calendar',
      sourceMessageId: '10',
      summary: 'Move the test meeting.',
      execute,
    });
    const signal = new AbortController().signal;

    await expect(actions.confirm('calendar', pending.confirmationCode, message('10', 'move it', now), signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    await expect(actions.confirm(
      'calendar', pending.confirmationCode, message('11', 'yes', now + 1), signal,
    )).rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(execute).not.toHaveBeenCalled();

    now += 1;
    await expect(actions.confirm(
      'calendar', pending.confirmationCode, message('11', `confirm ${pending.confirmationCode}`, now), signal,
    )).resolves.toEqual({ status: 'completed' });
    expect(execute).toHaveBeenCalledOnce();
    await expect(actions.confirm(
      'calendar', pending.confirmationCode, message('12', `confirm ${pending.confirmationCode}`, now + 1), signal,
    )).rejects.toMatchObject({ name: 'ToolRefusal' });
  });

  it('does not allow a confirmation to execute the other action category or an expired action', async () => {
    let now = 2_000;
    const actions = new PendingOutlookActions(() => now);
    const execute = vi.fn(async () => ({ status: 'completed' }));
    const pending = actions.stage({
      scope: 'mail',
      sourceMessageId: '10',
      summary: 'Send a test message.',
      execute,
    });
    const signal = new AbortController().signal;
    const confirmation = message('11', `confirm ${pending.confirmationCode}`, now + 1);

    await expect(actions.confirm('calendar', pending.confirmationCode, confirmation, signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    now += 10 * 60_000 + 1;
    await expect(actions.confirm('mail', pending.confirmationCode, confirmation, signal))
      .rejects.toMatchObject({ name: 'ToolRefusal' });
    expect(actions.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
