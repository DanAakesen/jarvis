import { describe, expect, it, vi } from 'vitest';
import {
  createOwnerInteractionService,
  withPhoneConfirmationSession,
  type OwnerInteractionService,
} from './owner-interactions.js';
import type { ConfirmationStatus, ConfirmationStore } from '../database/confirmation-store.js';

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
  const service: OwnerInteractionService = createOwnerInteractionService({
    ownerObjectId,
    store,
    onWebNotification,
    onConfirmationsChanged,
  });
  return { service, store, rows, onWebNotification, onConfirmationsChanged };
}

describe('owner interactions', () => {
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
