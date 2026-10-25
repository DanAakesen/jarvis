import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { ToolRefusal } from '../core/tool-registry.js';
import { PendingAction } from './pending-action.js';
import type {
  ConfirmationDecision,
  ConfirmationStore,
} from '../database/confirmation-store.js';

export const confirmationLifetimeSeconds = 5 * 60;
const maxPendingBrowserConfirmations = 10;
const browserConversationId = 'browser';
const phoneSessionContext = new AsyncLocalStorage<string>();

export function withPhoneConfirmationSession<T>(
  sessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!/^[1-9]\d{0,18}$/u.test(sessionId) || BigInt(sessionId) > 9_223_372_036_854_775_807n) {
    throw new TypeError('Invalid phone session');
  }
  return phoneSessionContext.run(sessionId, action);
}

export const confirmationActionKinds = [
  'merge',
  'delete',
  'send_mail',
  'calendar_change',
  'create_repository',
  'computer_use',
  'spend_money',
  'model_deployment',
  'other',
] as const;

export type ConfirmationActionKind = typeof confirmationActionKinds[number];
export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface BrowserConfirmation {
  readonly id: string;
  readonly actionKind: ConfirmationActionKind;
  readonly summary: string;
  readonly expiresAt: string;
}

export interface BrowserConfirmationDelivery {
  readonly channel: 'browser';
  readonly lifetimeSeconds?: number;
}

export interface OwnerInteractionService {
  notify(kind: NotificationKind, text: string): Promise<void>;
  expirePendingConfirmations(): Promise<void>;
  pendingBrowserConfirmations(): readonly BrowserConfirmation[];
  resolveBrowserConfirmation(id: string, decision: ConfirmationDecision): Promise<boolean>;
  requestConfirmation(
    actionKind: ConfirmationActionKind,
    summary: string,
    signal?: AbortSignal,
    delivery?: BrowserConfirmationDelivery,
  ): Promise<void>;
  runConfirmed<T>(
    actionKind: ConfirmationActionKind,
    summary: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
    delivery?: BrowserConfirmationDelivery,
  ): Promise<T>;
}

const confirmationIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const supportedKinds = new Set<string>(confirmationActionKinds);
const notificationKinds = new Set<NotificationKind>(['info', 'success', 'warning', 'error']);
type WaitResult = ConfirmationDecision | 'expired' | 'cancelled';

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
}

export interface OwnerInteractionOptions {
  readonly ownerObjectId: string;
  readonly store: ConfirmationStore;
  readonly onWebNotification?: (kind: NotificationKind, text: string) => Promise<void>;
  readonly onConfirmationPending?: () => void;
  readonly onConfirmationsChanged?: () => void;
}

export function createOwnerInteractionService({
  ownerObjectId,
  store,
  onWebNotification,
  onConfirmationPending,
  onConfirmationsChanged = () => {},
}: OwnerInteractionOptions): OwnerInteractionService {
  const waiters = new Map<string, (result: WaitResult) => void>();
  const browserConfirmations = new Map<string, {
    readonly view: BrowserConfirmation;
    readonly action: PendingAction;
  }>();

  async function waitForDecision(
    id: string,
    lifetimeSeconds: number,
    action: PendingAction,
    signal?: AbortSignal,
  ): Promise<WaitResult> {
    let finish!: (result: WaitResult) => void;
    let settled = false;
    const result = new Promise<WaitResult>((resolve) => {
      finish = (decision) => {
        if (settled) return;
        settled = true;
        resolve(decision);
      };
    });
    const expire = () => {
      action.cancel();
      void store.expireConfirmation(id, ownerObjectId)
        .catch(() => false)
        .finally(() => finish('expired'));
    };
    const abort = () => {
      action.cancel();
      void store.cancelConfirmation(id, ownerObjectId).catch(() => undefined);
      finish('cancelled');
    };
    const timer = setTimeout(expire, lifetimeSeconds * 1000);
    waiters.set(id, finish);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      return await result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      waiters.delete(id);
      if (browserConfirmations.delete(id)) onConfirmationsChanged();
    }
  }

  async function requestConfirmation(
    actionKind: ConfirmationActionKind,
    summary: string,
    signal?: AbortSignal,
    delivery?: BrowserConfirmationDelivery,
  ): Promise<PendingAction> {
    const lifetimeSeconds = delivery?.lifetimeSeconds ?? confirmationLifetimeSeconds;
    if (!supportedKinds.has(actionKind) || !validText(summary) ||
        delivery !== undefined && (!delivery || typeof delivery !== 'object' || delivery.channel !== 'browser') ||
        !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > confirmationLifetimeSeconds) {
      throw new ToolRefusal('A valid confirmation request is required.');
    }
    signal?.throwIfAborted();
    if (browserConfirmations.size >= maxPendingBrowserConfirmations) {
      throw new ToolRefusal('There are too many pending browser confirmations.');
    }
    const id = randomBytes(32).toString('base64url');
    const action = new PendingAction({
      key: id, summary, createdAt: Date.now(), lifetimeMs: lifetimeSeconds * 1000,
    });
    try {
      const phoneSessionId = phoneSessionContext.getStore();
      if (phoneSessionId === undefined) {
        await store.createConfirmation(
          id,
          ownerObjectId,
          browserConversationId,
          actionKind,
          lifetimeSeconds,
        );
      } else {
        await store.createConfirmation(
          id,
          ownerObjectId,
          browserConversationId,
          actionKind,
          lifetimeSeconds,
          phoneSessionId,
        );
      }
    } catch {
      throw new ToolRefusal('Browser confirmation is unavailable.');
    }
    const waiterController = new AbortController();
    const waitSignal = signal
      ? AbortSignal.any([signal, waiterController.signal])
      : waiterController.signal;
    const decision = waitForDecision(id, Math.max(0, (action.expiresAt - Date.now()) / 1000), action, waitSignal);
    browserConfirmations.set(id, {
      view: { id, actionKind, summary: action.presentation.summary, expiresAt: action.presentation.expiresAt },
      action,
    });
    onConfirmationsChanged();
    onConfirmationPending?.();
    try {
      signal?.throwIfAborted();
      const resolved = await decision;
      if (resolved !== 'approve') {
        action.cancel();
        throw new ToolRefusal(resolved === 'reject'
          ? 'Dan rejected the request.'
          : 'The confirmation was cancelled or expired.');
      }
      signal?.throwIfAborted();
      let consumed: boolean;
      try { consumed = await store.consumeApproval(id, ownerObjectId); }
      catch { consumed = false; }
      if (!consumed) throw new ToolRefusal('The confirmation expired or was already used.');
      action.consume('approve', signal);
      return action;
    } catch (error) {
      action.cancel();
      waiterController.abort();
      await store.cancelConfirmation(id, ownerObjectId).catch(() => undefined);
      if (signal?.aborted) signal.throwIfAborted();
      if (error instanceof ToolRefusal) throw error;
      throw new ToolRefusal('Browser confirmation could not be completed.');
    }
  }

  return {
    async expirePendingConfirmations() {
      for (const [id, { action }] of browserConfirmations) {
        action.cancel();
        waiters.get(id)?.('expired');
      }
      await store.expirePendingConfirmations();
    },
    pendingBrowserConfirmations() {
      return [...browserConfirmations.values()]
        .filter(({ action }) => action.pending)
        .slice(0, maxPendingBrowserConfirmations).map(({ view }) => ({ ...view }));
    },
    async resolveBrowserConfirmation(id, decision) {
      const pending = browserConfirmations.get(id);
      if (!confirmationIdPattern.test(id) || (decision !== 'approve' && decision !== 'reject') ||
        !pending?.action.pending || !waiters.has(id)) return false;
      const status = await store.resolveConfirmation(id, ownerObjectId, browserConversationId, decision);
      if (!pending.action.pending) return false;
      if (status === 'approved' || status === 'rejected') {
        waiters.get(id)?.(status === 'approved' ? 'approve' : 'reject');
        return true;
      }
      if (status === 'expired') waiters.get(id)?.('expired');
      return false;
    },
    async notify(kind, text) {
      if (!notificationKinds.has(kind) || !validText(text)) throw new TypeError('Invalid notification');
      if (!onWebNotification) throw new ToolRefusal('Jarvis notifications are unavailable.');
      await onWebNotification(kind, text);
    },
    async requestConfirmation(actionKind, summary, signal, delivery) {
      await requestConfirmation(actionKind, summary, signal, delivery);
    },
    async runConfirmed(actionKind, summary, action, signal, delivery) {
      if (typeof action !== 'function') throw new ToolRefusal('A confirmed action is required.');
      const confirmation = await requestConfirmation(actionKind, summary, signal, delivery);
      return confirmation.execute(action, signal);
    },
  };
}

export function isConfirmationDecision(value: unknown): value is ConfirmationDecision {
  return value === 'approve' || value === 'reject';
}
