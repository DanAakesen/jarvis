import { describe, expect, it, vi } from 'vitest';
import {
  createOwnerInteractionService,
  withPhoneConfirmationSession,
  type OwnerInteractionService,
} from './owner-interactions.js';
import type { ConfirmationStatus, ConfirmationStore } from '../database/confirmation-store.js';
import type { ApprovalDecider, ApprovalVerdict } from './approval-interpreter.js';
import type { ConversationMessage } from './conversation-store.js';

const ownerObjectId = '00000000-0000-4000-8000-000000000001';

interface PendingRow {
  readonly ownerObjectId: string;
  readonly conversationId: string;
  readonly expiresAt: number;
  status: ConfirmationStatus | 'pending';
}

function fixture(withConversationStore = true) {
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
  const conversationStore = {
    getDanMessagesAfter: vi.fn(async () => [{ id: '43', text: 'yes', language: 'en' as const }]),
  };
  const service: OwnerInteractionService = createOwnerInteractionService({
    ownerObjectId,
    store,
    ...(withConversationStore && { conversationStore }),
    onWebNotification,
    onConfirmationsChanged,
  });
  return { service, store, rows, onWebNotification, onConfirmationsChanged, conversationStore };
}

describe('owner interactions', () => {
  const delivery = {
    channel: 'browser' as const, lifetimeSeconds: 120,
    foodEstimate: { sessionId: '41', sourceMessageId: '42' },
  };
  const reply = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
    id: '43', sessionId: '41', role: 'dan', text: 'yes', model: null, at: new Date(), ...overrides,
  });
  const approve: ApprovalDecider = async () => 'approve';

  it('binds food replies at persistence completion, including the same millisecond', async () => {
    vi.useFakeTimers();
    try {
      const { service, store } = fixture();
      const persisted = Promise.withResolvers<void>();
      const create = vi.mocked(store.createConfirmation).getMockImplementation()!;
      vi.mocked(store.createConfirmation).mockImplementationOnce(async (...args) => {
        await create(...args);
        await persisted.promise;
      });
      const beforePersistence = new Date();
      const operation = service.requestConfirmation('other', 'Log synthetic portion.', undefined, delivery);
      await vi.advanceTimersByTimeAsync(1000);
      persisted.resolve();
      await vi.advanceTimersByTimeAsync(0);
      const decide = vi.fn(approve);
      expect(await service.resolveFoodEstimateReply!(
        reply({ at: beforePersistence }), decide, new AbortController().signal,
      )).toBe(false);
      expect(decide).not.toHaveBeenCalled();
      expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(true);
      await operation;
    } finally { vi.useRealTimers(); }
  });

  it.each(['approve', 'decline'] as const)('resolves a bound food %s through the browser SQL boundary once', async verdict => {
    const { service, store, conversationStore } = fixture();
    const action = vi.fn(async () => 'committed');
    const operation = service.runConfirmed('other', 'Log synthetic portion: 200 kcal.', action, undefined, delivery);
    const checked = verdict === 'approve'
      ? expect(operation).resolves.toBe('committed') : expect(operation).rejects.toThrow('rejected');
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const { id } = service.pendingBrowserConfirmations()[0]!;
    const decide = vi.fn(async () => verdict);
    expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(true);
    await checked;
    expect(decide).toHaveBeenCalledWith({
      reply: 'yes', summary: 'Log synthetic portion: 200 kcal.', family: 'food',
      messageId: '43', sessionId: '41', actionKey: id,
    }, expect.any(AbortSignal));
    expect(conversationStore.getDanMessagesAfter).toHaveBeenCalledWith({ sessionId: '41', after: '42', limit: 2 });
    expect(store.resolveConfirmation).toHaveBeenCalledExactlyOnceWith(
      id, ownerObjectId, 'browser', verdict === 'approve' ? 'approve' : 'reject',
    );
    expect(action).toHaveBeenCalledTimes(verdict === 'approve' ? 1 : 0);
    expect(store.consumeApproval).toHaveBeenCalledTimes(verdict === 'approve' ? 1 : 0);
    expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(false);
  });

  it.each(['neither', 'throws', 'invalid'] as const)('revokes natural authority after an unclear/failed %s decision but keeps the browser card', async outcome => {
    const { service } = fixture();
    const action = vi.fn(async () => 'committed');
    const operation = service.runConfirmed('other', 'Log synthetic portion.', action, undefined, delivery);
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const decide = vi.fn(async () => {
      if (outcome === 'throws') throw new Error('Interpreter unavailable');
      return (outcome === 'invalid' ? 'invalid' : 'neither') as ApprovalVerdict;
    });
    expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(false);
    expect(await service.resolveFoodEstimateReply!(reply({ id: '44' }), approve, new AbortController().signal)).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(await service.resolveBrowserConfirmation(service.pendingBrowserConfirmations()[0]!.id, 'approve')).toBe(true);
    await expect(operation).resolves.toBe('committed');
  });

  it('refuses ineligible food provenance without interpreting or revoking the valid next reply', async () => {
    const { service } = fixture();
    const operation = service.requestConfirmation('other', 'Log synthetic portion.', undefined, delivery);
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const decide = vi.fn(approve);
    const expiresAt = new Date(service.pendingBrowserConfirmations()[0]!.expiresAt);
    for (const overrides of [
      { sessionId: '99' }, { id: '42' }, { id: 'invalid' }, { id: '9223372036854775808' },
      { role: 'jarvis' as const }, { at: new Date(0) }, { at: new Date(NaN) },
      { at: expiresAt }, { at: 'invalid' as unknown as Date },
    ]) {
      expect(await service.resolveFoodEstimateReply!(reply(overrides), decide, new AbortController().signal)).toBe(false);
    }
    expect(decide).not.toHaveBeenCalled();
    expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(true);
    await operation;
  });

  it('keeps default confirmations browser-only and ambiguous food cards browser-resolvable', async () => {
    const { service } = fixture();
    const operations = [service.requestConfirmation('delete', 'Unrelated deletion.')];
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const decide = vi.fn(approve);
    expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(false);
    operations.push(
      service.requestConfirmation('other', 'First portion.', undefined, delivery),
      service.requestConfirmation('other', 'Second portion.', undefined, delivery),
    );
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(3));
    expect(await service.resolveFoodEstimateReply!(reply(), decide, new AbortController().signal)).toBe(false);
    expect(decide).not.toHaveBeenCalled();
    for (const { id } of service.pendingBrowserConfirmations()) {
      expect(await service.resolveBrowserConfirmation(id, 'approve')).toBe(true);
    }
    await Promise.all(operations);
  });

  it.each(['missing', 'throws', 'superseded', 'not-persisted', 'changed-during-decision'] as const)(
    'fails closed when persisted next-reply evidence is %s', async evidence => {
      const { service, store, conversationStore } = fixture(evidence !== 'missing');
      const operation = service.requestConfirmation('other', 'Log synthetic portion.', undefined, delivery);
      await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
      if (evidence === 'throws') conversationStore.getDanMessagesAfter.mockRejectedValue(new Error('Unavailable'));
      if (evidence === 'not-persisted') conversationStore.getDanMessagesAfter.mockResolvedValue([]);
      const superseded = [
        { id: '43', text: 'Cancel that.', language: 'en' as const },
        { id: '44', text: 'yes', language: 'en' as const },
      ];
      if (evidence === 'superseded') conversationStore.getDanMessagesAfter.mockResolvedValue(superseded);
      const decide = vi.fn(async () => {
        if (evidence === 'changed-during-decision') conversationStore.getDanMessagesAfter.mockResolvedValue(superseded);
        return 'approve' as const;
      });
      expect(await service.resolveFoodEstimateReply!(
        reply(evidence === 'superseded' ? { id: '44' } : {}), decide, new AbortController().signal,
      )).toBe(false);
      expect(decide).toHaveBeenCalledTimes(evidence === 'changed-during-decision' ? 1 : 0);
      expect(store.consumeApproval).not.toHaveBeenCalled();
      const { id } = service.pendingBrowserConfirmations()[0]!;
      await service.resolveBrowserConfirmation(id, 'approve');
      await operation;
    },
  );

  it.each(['approve', 'decline'] as const)('supersedes an in-flight first reply with a second %s without approving it', async verdict => {
    const { service, store } = fixture();
    const controller = new AbortController();
    const operation = service.requestConfirmation('other', 'Log synthetic portion.', controller.signal, delivery);
    const checked = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const decision = Promise.withResolvers<ApprovalVerdict>();
    const decide = vi.fn(() => decision.promise);
    const first = service.resolveFoodEstimateReply!(reply(), decide, controller.signal);
    await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
    expect(await service.resolveFoodEstimateReply!(
      reply({ id: '44' }), async () => verdict, controller.signal,
    )).toBe(verdict === 'decline');
    decision.resolve('approve');
    expect(await first).toBe(false);
    expect(store.consumeApproval).not.toHaveBeenCalled();
    controller.abort();
    await checked;
  });

  it.each(['cancel', 'expire', 'reply-abort'] as const)('rechecks food %s during interpretation', async event => {
    vi.useFakeTimers();
    try {
      const { service, store } = fixture();
      const controller = new AbortController();
      const replyController = new AbortController();
      const action = vi.fn();
      const operation = service.runConfirmed('other', 'Log synthetic portion.', action, controller.signal, delivery);
      const checked = expect(operation).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      const decision = Promise.withResolvers<ApprovalVerdict>();
      const decide = vi.fn(() => decision.promise);
      const resolving = service.resolveFoodEstimateReply!(reply(), decide, replyController.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(decide).toHaveBeenCalledOnce();
      if (event === 'cancel') controller.abort();
      else if (event === 'expire') await vi.advanceTimersByTimeAsync(120_000);
      else replyController.abort();
      decision.resolve('approve');
      expect(await resolving).toBe(false);
      expect(await service.resolveFoodEstimateReply!(reply(), approve, new AbortController().signal)).toBe(false);
      expect(action).not.toHaveBeenCalled();
      expect(store.consumeApproval).not.toHaveBeenCalled();
      controller.abort();
      await checked;
    } finally { vi.useRealTimers(); }
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

  it('cancels the shared lifecycle even while a browser decision is in flight', async () => {
    const { service, store } = fixture();
    const action = vi.fn();
    const controller = new AbortController();
    const operation = service.runConfirmed('other', 'Review this exact change.', action, controller.signal);
    const cancelled = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const { id } = service.pendingBrowserConfirmations()[0]!;
    let finish!: (status: 'approved') => void;
    vi.mocked(store.resolveConfirmation).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const decision = service.resolveBrowserConfirmation(id, 'approve');
    controller.abort();
    finish('approved');
    await expect(decision).resolves.toBe(false);
    await cancelled;
    expect(action).not.toHaveBeenCalled();
    expect(store.consumeApproval).not.toHaveBeenCalled();
  });

  it('expires active waiters as well as durable pending confirmations', async () => {
    const { service } = fixture();
    const action = vi.fn();
    const operation = service.runConfirmed('other', 'Review this exact change.', action);
    const expired = expect(operation).rejects.toThrow('expired');
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const { id } = service.pendingBrowserConfirmations()[0]!;
    await service.expirePendingConfirmations();
    await expired;
    await expect(service.resolveBrowserConfirmation(id, 'approve')).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('executes only once when the same browser approval is submitted twice', async () => {
    const { service } = fixture();
    const action = vi.fn(async () => 'done');
    const operation = service.runConfirmed('other', 'Review this exact change.', action);
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const { id } = service.pendingBrowserConfirmations()[0]!;
    expect(await Promise.all([
      service.resolveBrowserConfirmation(id, 'approve'), service.resolveBrowserConfirmation(id, 'approve'),
    ])).toEqual([true, false]);
    await expect(operation).resolves.toBe('done');
    expect(action).toHaveBeenCalledOnce();
  });

  it('sends notifications only to the authenticated web feed', async () => {
    const { service, onWebNotification } = fixture();
    await service.notify('warning', 'A task needs attention.');
    expect(onWebNotification).toHaveBeenCalledExactlyOnceWith('warning', 'A task needs attention.');
  });
});
