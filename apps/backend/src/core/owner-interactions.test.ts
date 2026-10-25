import { describe, expect, it, vi } from 'vitest';
import {
  createOwnerInteractionService,
  withPhoneConfirmationSession,
  type OwnerInteractionService,
} from './owner-interactions.js';
import type { ConfirmationStatus, ConfirmationStore } from '../database/confirmation-store.js';
import { createApprovalInterpreter, type ApprovalDecider } from './approval-interpreter.js';

const ownerObjectId = '00000000-0000-4000-8000-000000000001';

interface PendingRow {
  readonly ownerObjectId: string;
  readonly conversationId: string;
  readonly expiresAt: number;
  status: ConfirmationStatus | 'pending';
}

function fixture() {
  const rows = new Map<string, PendingRow>();
  const store: ConfirmationStore = {
    createConfirmation: vi.fn(async (id, owner, conversationId, _kind, lifetimeSeconds) => {
      rows.set(id, {
        ownerObjectId: owner,
        conversationId,
        expiresAt: Date.now() + lifetimeSeconds * 1000,
        status: 'pending',
      });
    }),
    resolveConfirmation: vi.fn(async (id, owner, conversationId, decision) => {
      const row = rows.get(id);
      if (!row || row.ownerObjectId !== owner || row.conversationId !== conversationId || row.status !== 'pending') {
        return null;
      }
      if (row.expiresAt <= Date.now()) {
        row.status = 'expired';
        return 'expired';
      }
      row.status = decision === 'approve' ? 'approved' : 'rejected';
      return row.status;
    }),
    expireConfirmation: vi.fn(async (id, owner) => {
      const row = rows.get(id);
      if (!row || row.ownerObjectId !== owner || row.status !== 'pending' || row.expiresAt > Date.now()) return false;
      row.status = 'expired';
      return true;
    }),
    expirePendingConfirmations: vi.fn(async () => {
      for (const row of rows.values()) if (row.status === 'pending') row.status = 'expired';
    }),
    cancelConfirmation: vi.fn(async (id, owner) => {
      const row = rows.get(id);
      if (row?.ownerObjectId === owner && row.status === 'pending') row.status = 'cancelled';
    }),
    consumeApproval: vi.fn(async (id, owner) => {
      const row = rows.get(id);
      if (!row || row.ownerObjectId !== owner || row.status !== 'approved' || row.expiresAt <= Date.now()) return false;
      row.status = 'executing';
      return true;
    }),
  };
  const onWebNotification = vi.fn(async () => {});
  const onConfirmationsChanged = vi.fn();
  const conversationStore = { getDanMessagesAfter: vi.fn(async () => [{ id: '43', text: 'yes, log that', language: 'en' as const }]) };
  const service: OwnerInteractionService = createOwnerInteractionService({
    ownerObjectId,
    store,
    conversationStore,
    onWebNotification,
    onConfirmationsChanged,
  });
  return { service, store, rows, onWebNotification, onConfirmationsChanged, conversationStore };
}

describe('owner interactions', () => {
  const delivery = { channel: 'browser' as const, lifetimeSeconds: 120,
    foodEstimate: { sessionId: '41', sourceMessageId: '42' } };
  const reply = (text = 'yes, log that') => ({
    id: '43', sessionId: '41', role: 'dan' as const, text, model: null, at: new Date(),
  });
  const interpreter = createApprovalInterpreter();
  const decide: ApprovalDecider = async (question, signal) => (await interpreter(question, signal)).verdict;

  it.each(['yes, log that', 'ja tak, log det', 'yes', 'no', 'cancel'])('resolves only the food estimate for %s', async text => {
    const { service, store } = fixture();
    const action = vi.fn(async () => 'committed');
    const operation = service.runConfirmed('other', 'Log synthetic portion: 200 kcal.', action, undefined, delivery);
    const rejected = ['no', 'cancel'].includes(text);
    const checked = rejected ? expect(operation).rejects.toThrow('rejected') : expect(operation).resolves.toBe('committed');
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    expect(await service.resolveFoodEstimateReply!(reply(text), decide, new AbortController().signal)).toBe(true);
    await checked;
    expect(action).toHaveBeenCalledTimes(rejected ? 0 : 1);
    expect(store.consumeApproval).toHaveBeenCalledTimes(rejected ? 0 : 1);
    expect(await service.resolveFoodEstimateReply!(reply(text), decide, new AbortController().signal)).toBe(false);
  });

  it('does not grant later conversational authority after an unrelated or conditional reply', async () => {
    for (const text of ['yes, but make it 300 kcal', 'yes, the weather is nice', 'How much protein?']) {
      const { service } = fixture();
      const action = vi.fn();
      const controller = new AbortController();
      const operation = service.runConfirmed('other', 'Log synthetic portion.', action, controller.signal, delivery);
      const checked = expect(operation).rejects.toThrow();
      await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
      expect(await service.resolveFoodEstimateReply!(reply(text), decide, controller.signal)).toBe(false);
      expect(await service.resolveFoodEstimateReply!({ ...reply(), id: '44' }, decide, controller.signal)).toBe(false);
      expect(action).not.toHaveBeenCalled();
      controller.abort();
      await checked;
    }
  });

  it('fails closed for wrong-session, earlier and non-owner messages without interpreting them', async () => {
    const { service } = fixture();
    const controller = new AbortController();
    const operation = service.requestConfirmation('other', 'Log synthetic portion.', controller.signal, delivery);
    const checked = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const decider = vi.fn(decide);
    for (const message of [{ ...reply(), sessionId: '99' }, { ...reply(), id: '42' },
      { ...reply(), role: 'jarvis' as const }, { ...reply(), at: new Date(0) }]) {
      expect(await service.resolveFoodEstimateReply!(message, decider, controller.signal)).toBe(false);
    }
    expect(decider).not.toHaveBeenCalled();
    controller.abort();
    await checked;
  });

  it('keeps unrelated confirmations button-only and refuses ambiguous food proposals', async () => {
    const { service } = fixture();
    const controller = new AbortController();
    const pending = [
      service.requestConfirmation('delete', 'Unrelated deletion.', controller.signal),
      service.requestConfirmation('other', 'First portion.', controller.signal, delivery),
      service.requestConfirmation('other', 'Second portion.', controller.signal, delivery),
    ];
    const checked = pending.map(operation => expect(operation).rejects.toThrow());
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(3));
    const decider = vi.fn(decide);
    expect(await service.resolveFoodEstimateReply!(reply(), decider, controller.signal)).toBe(false);
    expect(decider).not.toHaveBeenCalled();
    controller.abort();
    await Promise.all(checked);
  });

  it.each(['cancel', 'expire'])('cannot approve food after %s', async end => {
    vi.useFakeTimers();
    try {
      const { service } = fixture();
      const controller = new AbortController();
      const action = vi.fn();
      const operation = service.runConfirmed('other', 'Synthetic portion.', action, controller.signal, delivery);
      const checked = expect(operation).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      if (end === 'cancel') controller.abort();
      else await vi.advanceTimersByTimeAsync(120_000);
      await checked;
      expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(false);
      expect(action).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('does not consume an approval if another reply supersedes interpretation', async () => {
    const { service } = fixture();
    const controller = new AbortController();
    const operation = service.requestConfirmation('other', 'Synthetic portion.', controller.signal, delivery);
    const checked = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const decision = Promise.withResolvers<'approve'>();
    const first = service.resolveFoodEstimateReply!(reply(), async () => decision.promise, controller.signal);
    expect(await service.resolveFoodEstimateReply!({ ...reply('cancel'), id: '44' }, decide, controller.signal)).toBe(true);
    decision.resolve('approve');
    expect(await first).toBe(false);
    await checked;
  });

  it('refuses a superseded source even when the pending card was created after an intervening reply', async () => {
    const { service, conversationStore, store } = fixture();
    const controller = new AbortController();
    const operation = service.requestConfirmation('other', 'Old synthetic portion.', controller.signal, delivery);
    const checked = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    conversationStore.getDanMessagesAfter.mockResolvedValue([
      { id: '43', text: 'Cancel that.', language: 'en' }, { id: '44', text: 'yes', language: 'en' },
    ]);
    const decider = vi.fn(decide);
    expect(await service.resolveFoodEstimateReply!({ ...reply(), id: '44' }, decider, controller.signal)).toBe(false);
    expect(decider).not.toHaveBeenCalled();
    expect(store.consumeApproval).not.toHaveBeenCalled();
    controller.abort();
    await checked;
  });

  it('keeps Away confirmations in the browser until the owner approves them', async () => {
    const { service, store, onConfirmationsChanged } = fixture();
    const action = vi.fn(async () => 'done');
    const operation = service.runConfirmed('delete', 'Remove the staged item.', action);

    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const confirmation = service.pendingBrowserConfirmations()[0]!;
    expect(confirmation).toMatchObject({ actionKind: 'delete', summary: 'Remove the staged item.' });
    expect(store.createConfirmation).toHaveBeenCalledWith(
      confirmation.id, ownerObjectId, 'browser', 'delete', 300,
    );
    expect(action).not.toHaveBeenCalled();
    expect(onConfirmationsChanged).toHaveBeenCalledOnce();

    await expect(service.resolveBrowserConfirmation(confirmation.id, 'approve')).resolves.toBe(true);
    await expect(operation).resolves.toBe('done');
    expect(action).toHaveBeenCalledOnce();
    expect(service.pendingBrowserConfirmations()).toEqual([]);
  });

  it('rejects browser confirmations without running the action', async () => {
    const { service, store } = fixture();
    const action = vi.fn();
    const operation = service.runConfirmed('other', 'Review this change.', action);
    const rejected = expect(operation).rejects.toThrow('rejected');
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const confirmation = service.pendingBrowserConfirmations()[0]!;

    await expect(service.resolveBrowserConfirmation(confirmation.id, 'reject')).resolves.toBe(true);
    await rejected;
    expect(action).not.toHaveBeenCalled();
    expect(store.consumeApproval).not.toHaveBeenCalled();
  });

  it('does not run an action after its browser confirmation expires', async () => {
    vi.useFakeTimers();
    try {
      const { service, store } = fixture();
      const action = vi.fn(async () => 'done');
      const operation = service.runConfirmed('other', 'Review this food correction.', action, undefined,
        { channel: 'browser', lifetimeSeconds: 1 });
      const expired = expect(operation).rejects.toThrow('expired');
      await vi.advanceTimersByTimeAsync(0);
      expect(service.pendingBrowserConfirmations()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1000);
      await expired;
      expect(store.expireConfirmation).toHaveBeenCalledOnce();
      expect(action).not.toHaveBeenCalled();
      expect(service.pendingBrowserConfirmations()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves phone-session approval association while waiting in the browser', async () => {
    const { service, store } = fixture();
    const operation = withPhoneConfirmationSession('42', () =>
      service.requestConfirmation('other', 'Allow this phone action.'));

    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const confirmation = service.pendingBrowserConfirmations()[0]!;
    expect(store.createConfirmation).toHaveBeenCalledWith(
      confirmation.id, ownerObjectId, 'browser', 'other', 300, '42',
    );
    await expect(service.resolveBrowserConfirmation(confirmation.id, 'approve')).resolves.toBe(true);
    await expect(operation).resolves.toBeUndefined();
  });

  it('sends notifications only to the authenticated web feed', async () => {
    const { service, onWebNotification } = fixture();
    await service.notify('warning', 'A task needs attention.');
    expect(onWebNotification).toHaveBeenCalledExactlyOnceWith('warning', 'A task needs attention.');
  });
});
