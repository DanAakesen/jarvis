import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { ActivityLike, ConversationReference } from '@microsoft/teams.api';
import { AdaptiveCard, OpenUrlAction, SubmitAction, TextBlock } from '@microsoft/teams.cards';
import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import type {
  ConfirmationDecision,
  ConfirmationStatus,
  TeamsNotificationStore,
} from '../database/teams-notification-store.js';
import type { EphemeralAudioStore } from './audio-store.js';
import type { SpeechSynthesizer } from './speech.js';

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
  'other',
] as const;

export type ConfirmationActionKind = typeof confirmationActionKinds[number];
export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
  readonly title: string;
  readonly url: string;
}

export interface BrowserConfirmation {
  readonly id: string;
  readonly actionKind: ConfirmationActionKind;
  readonly summary: string;
  readonly expiresAt: string;
}

export interface TeamsConnector {
  send(reference: ConversationReference, activity: ActivityLike): Promise<void>;
}

export interface TeamsNotificationService {
  notify(kind: NotificationKind, text: string, actions?: readonly NotificationAction[]): Promise<void>;
  expirePendingConfirmations(): Promise<void>;
  pendingBrowserConfirmations(): readonly BrowserConfirmation[];
  resolveBrowserConfirmation(id: string, decision: ConfirmationDecision): Promise<boolean>;
  requestConfirmation(
    actionKind: ConfirmationActionKind,
    summary: string,
    signal?: AbortSignal,
  ): Promise<void>;
  runConfirmed<T>(
    actionKind: ConfirmationActionKind,
    summary: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
  rememberMessage(activity: unknown, reference: ConversationReference): Promise<void>;
  receiveConfirmation(activity: unknown, reference: ConversationReference): Promise<boolean>;
}

const confirmationIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const supportedKinds = new Set<string>(confirmationActionKinds);
const notificationKinds = new Set<NotificationKind>(['info', 'success', 'warning', 'error']);

type WaitResult = ConfirmationDecision | 'expired' | 'cancelled';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
}

function confirmationCard(id: string, actionKind: ConfirmationActionKind, summary: string): AdaptiveCard {
  return new AdaptiveCard(
    new TextBlock(`Confirm ${actionKind.replaceAll('_', ' ')}`),
    new TextBlock(summary, { wrap: true }),
    new TextBlock('This request expires in five minutes.', { isSubtle: true }),
  )
    .withVersion('1.2')
    .withActions(
      new SubmitAction({
        title: 'Approve',
        style: 'positive',
        data: { action: 'confirmation', confirmationId: id, decision: 'approve' },
      }),
      new SubmitAction({
        title: 'Reject',
        style: 'destructive',
        data: { action: 'confirmation', confirmationId: id, decision: 'reject' },
      }),
    );
}

function adaptiveAttachment(card: AdaptiveCard) {
  return { contentType: 'application/vnd.microsoft.card.adaptive', content: card };
}

function validateActions(actions: readonly NotificationAction[] | undefined): OpenUrlAction[] {
  if (actions === undefined) return [];
  if (!Array.isArray(actions) || actions.length > 3) throw new TypeError('Invalid notification actions');
  return actions.map((action) => {
    const value = record(action);
    const title = value?.title;
    const url = value?.url;
    if (typeof title !== 'string' || !title.trim() || title.length > 64 ||
      typeof url !== 'string' || url.length > 2048) throw new TypeError('Invalid notification actions');
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new TypeError('Invalid notification actions'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new TypeError('Invalid notification actions');
    }
    return new OpenUrlAction(parsed.toString(), { title });
  });
}

function allowedOwnerActivity(
  activity: unknown,
  reference: ConversationReference,
  ownerObjectId: string,
  tenantId: string,
): boolean {
  const value = record(activity);
  const sender = record(value?.from);
  const senderObjectId = sender?.aadObjectId;
  const conversation = record(value?.conversation);
  const channelData = record(value?.channelData);
  const tenantData = record(channelData?.tenant);
  const tenantIds = [sender?.tenantId, conversation?.tenantId, tenantData?.id]
    .filter((candidate): candidate is string => typeof candidate === 'string');
  return value?.channelId === 'msteams' &&
    typeof senderObjectId === 'string' && senderObjectId.toLowerCase() === ownerObjectId.toLowerCase() &&
    tenantIds.length > 0 && tenantIds.every((candidate) => candidate.toLowerCase() === tenantId.toLowerCase()) &&
    conversation?.conversationType === 'personal' &&
    reference.channelId === 'msteams' &&
    reference.conversation.conversationType === 'personal' &&
    reference.user?.aadObjectId?.toLowerCase() === ownerObjectId.toLowerCase() &&
    reference.user?.tenantId?.toLowerCase() === tenantId.toLowerCase() &&
    reference.conversation.id === conversation.id;
}

export interface TeamsNotificationOptions {
  readonly ownerObjectId: string;
  readonly tenantId: string;
  readonly publicOrigin: string;
  readonly store: TeamsNotificationStore;
  readonly connector: TeamsConnector;
  readonly audioStore: EphemeralAudioStore;
  readonly isAway?: () => Promise<boolean>;
  readonly onConfirmationsChanged?: () => void;
  readonly speech?: SpeechSynthesizer;
}

export function createTeamsNotificationService({
  ownerObjectId,
  tenantId,
  publicOrigin,
  store,
  connector,
  audioStore,
  isAway = async () => true,
  onConfirmationsChanged = () => {},
  speech,
}: TeamsNotificationOptions): TeamsNotificationService {
  const waiters = new Map<string, (result: WaitResult) => void>();
  const browserConfirmations = new Map<string, BrowserConfirmation>();

  async function send(reference: ConversationReference, activity: ActivityLike): Promise<void> {
    try {
      await connector.send(reference, activity);
    } catch {
      throw new Error('Teams notification delivery failed');
    }
  }

  async function sendVoiceNote(reference: ConversationReference, text: string): Promise<void> {
    if (!speech) return;
    let bytes: Uint8Array | null;
    try { bytes = await speech.synthesize(text, AbortSignal.timeout(12_000)); }
    catch { return; }
    if (!bytes) return;
    const token = audioStore.put(bytes);
    if (!token) return;
    const contentUrl = new URL(`/teams/audio/${token}`, publicOrigin).toString();
    await send(reference, {
      type: 'message',
      text: 'Jarvis voice note',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.audio',
        content: {
          title: 'Jarvis voice note',
          text,
          media: [{ url: contentUrl }],
          autostart: false,
          shareable: false,
        },
      }],
    });
  }

  async function getConversation(): Promise<ConversationReference> {
    let reference: ConversationReference | null;
    try { reference = await store.getConversation(ownerObjectId); }
    catch { throw new ToolRefusal('Teams notifications are unavailable.'); }
    if (!reference) throw new ToolRefusal('Dan has not started a personal Teams chat with Jarvis.');
    return reference;
  }

  async function waitForDecision(
    id: string,
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
      void store.expireConfirmation(id, ownerObjectId)
        .catch(() => false)
        .finally(() => finish('expired'));
    };
    const abort = () => {
      void store.cancelConfirmation(id, ownerObjectId).catch(() => undefined);
      finish('cancelled');
    };
    const timer = setTimeout(expire, confirmationLifetimeSeconds * 1000);
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
  ): Promise<void> {
    if (!supportedKinds.has(actionKind) || !validText(summary)) {
      throw new ToolRefusal('A valid confirmation request is required.');
    }
    signal?.throwIfAborted();
    let away: boolean;
    try { away = await isAway(); }
    catch { throw new ToolRefusal('Confirmation routing is unavailable.'); }
    if (!away && browserConfirmations.size >= maxPendingBrowserConfirmations) {
      throw new ToolRefusal('There are too many pending browser confirmations.');
    }
    const reference = away ? await getConversation() : null;
    const id = randomBytes(32).toString('base64url');
    const conversationId = reference?.conversation.id ?? browserConversationId;
    try {
      const phoneSessionId = phoneSessionContext.getStore();
      if (phoneSessionId === undefined) {
        await store.createConfirmation(
          id,
          ownerObjectId,
          conversationId,
          actionKind,
          confirmationLifetimeSeconds,
        );
      } else {
        await store.createConfirmation(
          id,
          ownerObjectId,
          conversationId,
          actionKind,
          confirmationLifetimeSeconds,
          phoneSessionId,
        );
      }
    } catch {
      throw new ToolRefusal(reference
        ? 'Teams confirmation is unavailable.'
        : 'Browser confirmation is unavailable.');
    }
    const waiterController = new AbortController();
    const waitSignal = signal
      ? AbortSignal.any([signal, waiterController.signal])
      : waiterController.signal;
    const decision = waitForDecision(id, waitSignal);
    if (!reference) {
      browserConfirmations.set(id, {
        id,
        actionKind,
        summary,
        expiresAt: new Date(Date.now() + confirmationLifetimeSeconds * 1000).toISOString(),
      });
      onConfirmationsChanged();
    }
    try {
      signal?.throwIfAborted();
      if (reference) {
        await send(reference, {
          type: 'message',
          attachments: [adaptiveAttachment(confirmationCard(id, actionKind, summary))],
        });
        void sendVoiceNote(reference, summary).catch(() => undefined);
      }
      const resolved = await decision;
      if (resolved !== 'approve') {
        throw new ToolRefusal(resolved === 'reject'
          ? 'Dan rejected the request.'
          : 'The confirmation was cancelled or expired.');
      }
      signal?.throwIfAborted();
      let consumed: boolean;
      try { consumed = await store.consumeApproval(id, ownerObjectId); }
      catch { consumed = false; }
      if (!consumed) throw new ToolRefusal('The confirmation expired or was already used.');
    } catch (error) {
      waiterController.abort();
      await store.cancelConfirmation(id, ownerObjectId).catch(() => undefined);
      if (signal?.aborted) signal.throwIfAborted();
      if (error instanceof ToolRefusal) throw error;
      throw new ToolRefusal(reference
        ? 'Teams confirmation could not be delivered.'
        : 'Browser confirmation could not be delivered.');
    }
  }

  return {
    async expirePendingConfirmations() {
      await store.expirePendingConfirmations();
    },
    pendingBrowserConfirmations() {
      return [...browserConfirmations.values()].slice(0, maxPendingBrowserConfirmations);
    },
    async resolveBrowserConfirmation(id, decision) {
      if (!confirmationIdPattern.test(id) || (decision !== 'approve' && decision !== 'reject') ||
        !browserConfirmations.has(id) || !waiters.has(id)) return false;
      const status = await store.resolveConfirmation(id, ownerObjectId, browserConversationId, decision);
      if (status === 'approved' || status === 'rejected') {
        waiters.get(id)?.(status === 'approved' ? 'approve' : 'reject');
        return true;
      }
      if (status === 'expired') waiters.get(id)?.('expired');
      return false;
    },
    async notify(kind, text, actions) {
      if (!notificationKinds.has(kind) || !validText(text)) throw new TypeError('Invalid notification');
      const cardActions = validateActions(actions);
      const reference = await getConversation();
      if (cardActions.length) {
        const card = new AdaptiveCard(
          new TextBlock(kind.toUpperCase()),
          new TextBlock(text, { wrap: true }),
        ).withVersion('1.2').withActions(...cardActions);
        await send(reference, { type: 'message', attachments: [adaptiveAttachment(card)] });
      } else {
        await send(reference, { type: 'message', text: `${kind.toUpperCase()}: ${text}` });
      }
      await sendVoiceNote(reference, text).catch(() => undefined);
    },
    requestConfirmation,
    async runConfirmed(actionKind, summary, action, signal) {
      if (typeof action !== 'function') throw new ToolRefusal('A confirmed action is required.');
      await requestConfirmation(actionKind, summary, signal);
      signal?.throwIfAborted();
      return action();
    },
    async rememberMessage(activity, reference) {
      if (!allowedOwnerActivity(activity, reference, ownerObjectId, tenantId)) return;
      await store.saveConversation(ownerObjectId, reference);
    },
    async receiveConfirmation(activity, reference) {
      if (!allowedOwnerActivity(activity, reference, ownerObjectId, tenantId)) return false;
      const value = record(record(activity)?.value);
      const action = record(value?.action);
      const data = record(action?.data);
      const id = data?.confirmationId;
      const decision = data?.decision;
      if (data?.action !== 'confirmation' || typeof id !== 'string' || !confirmationIdPattern.test(id) ||
        (decision !== 'approve' && decision !== 'reject')) return false;
      if (!waiters.has(id)) return false;
      const status: ConfirmationStatus | null = await store.resolveConfirmation(
        id,
        ownerObjectId,
        reference.conversation.id,
        decision,
      );
      if (status === 'approved' || status === 'rejected') {
        waiters.get(id)?.(status === 'approved' ? 'approve' : 'reject');
        return true;
      }
      if (status === 'expired') waiters.get(id)?.('expired');
      return false;
    },
  };
}

export function createAskDanToConfirmTool(service: TeamsNotificationService): JarvisTool {
  return {
    name: 'ask_dan_to_confirm',
    description: 'Request Dan’s one-time approval through his current channel and wait for his response.',
    inputSchema: {
      type: 'object',
      properties: {
        actionKind: { type: 'string', enum: confirmationActionKinds },
        summary: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
      },
      required: ['actionKind', 'summary'],
      additionalProperties: false,
    },
    async execute(input, _request, signal) {
      const { actionKind, summary } = input as {
        actionKind: ConfirmationActionKind;
        summary: string;
      };
      await service.requestConfirmation(actionKind, summary, signal);
      return { approved: true };
    },
  };
}

export function isConfirmationDecision(value: unknown): value is ConfirmationDecision {
  return value === 'approve' || value === 'reject';
}
