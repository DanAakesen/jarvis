import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from './conversation-store.js';
import { PendingAction } from './pending-action.js';

const start = Date.parse('2026-10-25T12:00:00Z');
function fixture() {
  let clock = start;
  const action = new PendingAction({
    key: 'exact-action', summary: 'Send the reviewed message to the reviewed recipient.',
    family: 'mail', sourceMessageId: '10', sourceSessionId: '7',
    createdAt: start, lifetimeMs: 60_000, now: () => clock,
  });
  const reply = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
    id: '11', sessionId: '7', role: 'dan', text: 'yes', model: null,
    at: new Date(start + 1), ...overrides,
  });
  return { action, reply, advance: (ms: number) => { clock += ms; } };
}

describe('shared pending-action lifecycle', () => {
  it('presents the immutable exact proposal, not a receipt acknowledgment', () => {
    const options = { key: 'action', summary: 'Delete this one item.', createdAt: start, lifetimeMs: 1000 };
    const action = new PendingAction(options);
    options.summary = 'Delete every item.';
    expect(action.presentation).toMatchObject({
      status: 'awaiting_confirmation', summary: 'Delete this one item.',
      expiresAt: new Date(start + 1000).toISOString(),
    });
  });

  it.each([
    { id: '10' }, { id: '9' }, { id: 'not-a-message' }, { id: '9223372036854775808' },
    { role: 'jarvis' as const }, { sessionId: '8' }, { sessionId: '' },
    { at: new Date(start) }, { at: new Date(NaN) },
  ])('refuses ineligible provenance before interpreting: %j', async (overrides) => {
    const { action, reply } = fixture();
    const decide = vi.fn(async () => 'approve' as const);
    expect(await action.decision(reply(overrides), decide, new AbortController().signal)).toBeUndefined();
    expect(decide).not.toHaveBeenCalled();
  });

  it('passes the exact proposal and action identity to the interpreter', async () => {
    const { action, reply } = fixture();
    const decide = vi.fn(async () => 'approve' as const);
    expect(await action.decision(reply(), decide, new AbortController().signal)).toBe('approve');
    expect(decide).toHaveBeenCalledWith({
      reply: 'yes', summary: action.presentation.summary, family: 'mail',
      messageId: '11', sessionId: '7', actionKey: 'exact-action',
    }, expect.any(AbortSignal));
    expect(action.consume('approve')).toBe('approve');
    expect(() => action.consume('approve')).toThrow('pending change');
  });

  it.each(['cancel', 'expire', 'abort'] as const)('rechecks %s after interpretation awaits', async (event) => {
    const { action, reply, advance } = fixture();
    const controller = new AbortController();
    let resolve!: (value: 'approve') => void;
    const verdict = action.decision(reply(), () => new Promise((done) => { resolve = done; }), controller.signal);
    if (event === 'cancel') action.cancel();
    if (event === 'expire') advance(60_000);
    if (event === 'abort') controller.abort();
    resolve('approve');
    expect(await verdict).toBeUndefined();
    expect(() => action.consume('approve', controller.signal)).toThrow();
  });

  it('keeps unclear replies pending and makes cancellation terminal', () => {
    const { action } = fixture();
    expect(() => action.consume('neither')).toThrow('clearly approve');
    expect(action.pending).toBe(true);
    expect(action.consume('decline')).toBe('decline');
    expect(() => action.consume('approve')).toThrow();
  });

  it('executes the approved action once, including when execution fails', async () => {
    const { action } = fixture();
    const write = vi.fn(async () => { throw new Error('Unverified provider outcome'); });
    await expect(action.execute(write)).rejects.toThrow('pending change');
    expect(write).not.toHaveBeenCalled();
    action.consume('approve');
    await expect(action.execute(write)).rejects.toThrow('Unverified provider outcome');
    await expect(action.execute(write)).rejects.toThrow('pending change');
    expect(write).toHaveBeenCalledOnce();
  });

  it.each(['expire', 'abort'] as const)('does not execute if %s occurs after consumption', async (event) => {
    const { action, advance } = fixture();
    const controller = new AbortController();
    const write = vi.fn();
    action.consume('approve');
    if (event === 'expire') advance(60_000);
    else controller.abort();
    await expect(action.execute(write, controller.signal)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not treat an unbound browser proposal as eligible for spoken or text agreement', async () => {
    const { reply } = fixture();
    const action = new PendingAction({ key: 'browser', summary: 'Review food.', createdAt: start, lifetimeMs: 1000 });
    const decide = vi.fn(async () => 'approve' as const);
    expect(await action.decision(reply(), decide, new AbortController().signal)).toBeUndefined();
    expect(decide).not.toHaveBeenCalled();
  });

  it('expires at the boundary and never revives after the clock moves backwards', () => {
    const { action, advance } = fixture();
    advance(60_000);
    expect(action.pending).toBe(false);
    advance(-60_000);
    expect(action.pending).toBe(false);
    expect(() => action.consume('approve')).toThrow();
  });

  it('rejects partial source bindings', () => {
    expect(() => new PendingAction({
      key: 'bad', summary: 'Do this.', sourceMessageId: '10', createdAt: start, lifetimeMs: 1000,
    })).toThrow('bound');
  });
});
