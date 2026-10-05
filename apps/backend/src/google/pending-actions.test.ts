import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '../core/conversation-store.js';
import { PendingGoogleActions } from './pending-actions.js';

function message(id: string, text: string, at: number): ConversationMessage {
  return { id, sessionId: '1', role: 'dan', text, model: null, at: new Date(at) };
}

describe('pending Google actions', () => {
  it('requires exact confirmation from a later Dan message and consumes it once', async () => {
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
