import type { ActivityLike, ConversationReference } from '@microsoft/teams.api';
import { describe, expect, it, vi } from 'vitest';
import {
  createTeamsNotificationService,
  withPhoneConfirmationSession,
  type TeamsNotificationService,
} from './service.js';
import type {
  ConfirmationStatus,
  TeamsNotificationStore,
} from '../database/teams-notification-store.js';
import { createEphemeralAudioStore } from './audio-store.js';

const ownerObjectId = '12bcfab7-49ba-4cf7-8be7-780a13911f93';
const tenantId = '802efa29-17f2-4a79-8f5f-38f087aed96a';
const reference = {
  channelId: 'msteams',
  serviceUrl: 'https://smba.trafficmanager.net/teams/',
  conversation: { id: 'conversation-1', conversationType: 'personal', tenantId },
  user: { id: 'user-1', aadObjectId: ownerObjectId, tenantId, role: 'user' },
  bot: { id: 'bot-1', role: 'bot' },
} as unknown as ConversationReference;

interface PendingRow {
  readonly ownerObjectId: string;
  readonly conversationId: string;
  readonly expiresAt: number;
  status: ConfirmationStatus | 'pending';
}

function harness(
  speech?: { synthesize: ReturnType<typeof vi.fn> },
  isAway: () => Promise<boolean> = async () => true,
) {
  const rows = new Map<string, PendingRow>();
  const sent: Array<{ reference: ConversationReference; activity: ActivityLike }> = [];
  const store: TeamsNotificationStore = {
    getConversation: vi.fn(async () => reference),
    saveConversation: vi.fn(async () => {}),
    createConfirmation: vi.fn(async (id, owner, conversationId, _kind, lifetimeSeconds) => {
      rows.set(id, { ownerObjectId: owner, conversationId, expiresAt: Date.now() + lifetimeSeconds * 1000, status: 'pending' });
    }),
    resolveConfirmation: vi.fn(async (id, owner, conversationId, decision) => {
      const row = rows.get(id);
      if (!row || row.ownerObjectId !== owner || row.conversationId !== conversationId || row.status !== 'pending') return null;
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
  const connector = {
    send: vi.fn(async (conversation: ConversationReference, activity: ActivityLike) => {
      sent.push({ reference: conversation, activity });
    }),
  };
  const onConfirmationsChanged = vi.fn();
  const service: TeamsNotificationService = createTeamsNotificationService({
    ownerObjectId,
    tenantId,
    publicOrigin: 'https://jarvis.example',
    store,
    connector,
    audioStore: createEphemeralAudioStore(),
    isAway,
    onConfirmationsChanged,
    ...(speech ? { speech } : {}),
  });
  return { service, store, connector, sent, rows, onConfirmationsChanged };
}

function firstConfirmationData(activity: ActivityLike): Record<string, unknown> {
  const message = activity as unknown as {
    attachments?: Array<{ content?: { actions?: Array<{ data?: Record<string, unknown> }> } }>;
  };
  return message.attachments?.[0]?.content?.actions?.[0]?.data ?? {};
}

function cardAction(data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    type: 'invoke',
    name: 'adaptiveCard/action',
    channelId: 'msteams',
    from: { id: 'user-1', aadObjectId: ownerObjectId, tenantId },
    conversation: { id: 'conversation-1', conversationType: 'personal', tenantId },
    channelData: { tenant: { id: tenantId } },
    value: { action: { data } },
    ...overrides,
  };
}

async function settleMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Teams notification service', () => {
  it('resumes a confirmed operation once, only after an approve card response', async () => {
    const { service, connector, sent } = harness();
    const action = vi.fn(async () => 'merged');
    const operation = service.runConfirmed('merge', 'Squash merge DanAakesen/jarvis#42.', action);
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledTimes(1));
    const card = sent[0]!.activity as unknown as { attachments: Array<{ content: { actions: Array<{ title: string }> } }> };
    expect(card.attachments[0]?.content.actions.map(({ title }) => title)).toEqual(['Approve', 'Reject']);
    expect(action).not.toHaveBeenCalled();

    const data = firstConfirmationData(sent[0]!.activity);
    expect(data).toMatchObject({ action: 'confirmation', decision: 'approve' });
    await expect(service.receiveConfirmation(cardAction(data), reference)).resolves.toBe(true);
    await expect(operation).resolves.toBe('merged');
    await expect(service.receiveConfirmation(cardAction(data), reference)).resolves.toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('offers present-mode confirmations in the browser without sending a Teams card', async () => {
    const { service, store, connector, onConfirmationsChanged } = harness(undefined, async () => false);
    const operation = service.requestConfirmation('merge', 'Merge the reviewed change.');

    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const [confirmation] = service.pendingBrowserConfirmations();
    expect(confirmation).toMatchObject({
      actionKind: 'merge',
      summary: 'Merge the reviewed change.',
    });
    expect(Date.parse(confirmation!.expiresAt)).toBeGreaterThan(Date.now());
    expect(store.createConfirmation).toHaveBeenCalledWith(
      confirmation!.id, ownerObjectId, 'browser', 'merge', 300,
    );
    expect(connector.send).not.toHaveBeenCalled();

    await expect(service.resolveBrowserConfirmation(confirmation!.id, 'approve')).resolves.toBe(true);
    await expect(operation).resolves.toBeUndefined();
    await expect(service.resolveBrowserConfirmation(confirmation!.id, 'approve')).resolves.toBe(false);
    expect(store.consumeApproval).toHaveBeenCalledOnce();
    expect(service.pendingBrowserConfirmations()).toEqual([]);
    expect(onConfirmationsChanged).toHaveBeenCalledTimes(2);
  });

  it('links phone-session approvals to their originating call', async () => {
    const { service, store } = harness(undefined, async () => false);
    const operation = withPhoneConfirmationSession('42', () =>
      service.requestConfirmation('other', 'Allow the phone call to read tasks.'));

    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    const confirmation = service.pendingBrowserConfirmations()[0]!;
    expect(store.createConfirmation).toHaveBeenCalledWith(
      confirmation.id,
      ownerObjectId,
      'browser',
      'other',
      300,
      '42',
    );
    await expect(service.resolveBrowserConfirmation(confirmation.id, 'approve')).resolves.toBe(true);
    await expect(operation).resolves.toBeUndefined();
  });

  it('does not run the action after rejection or an identity mismatch', async () => {
    const { service, connector, sent } = harness();
    const action = vi.fn(async () => 'deleted');
    const operation = service.runConfirmed('delete', 'Delete an item.', action);
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledTimes(1));
    const data = firstConfirmationData(sent[0]!.activity);
    await expect(service.receiveConfirmation(
      cardAction(data, { from: { id: 'other', aadObjectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tenantId } }),
      reference,
    )).resolves.toBe(false);
    await expect(service.receiveConfirmation(
      cardAction({ ...data, decision: 'reject' }),
      reference,
    )).resolves.toBe(true);
    await expect(operation).rejects.toThrow('Dan rejected the request.');
    expect(action).not.toHaveBeenCalled();
  });

  it('fails closed for unknown confirmation IDs and expires pending requests', async () => {
    vi.useFakeTimers();
    try {
      const { service, connector, sent, rows } = harness();
      const action = vi.fn(async () => 'sent');
      const operation = service.runConfirmed('send_mail', 'Send an email.', action);
      const rejected = expect(operation).rejects.toThrow('cancelled or expired');
      await settleMicrotasks();
      expect(connector.send).toHaveBeenCalledTimes(1);
      const data = firstConfirmationData(sent[0]!.activity);
      await expect(service.receiveConfirmation(
        cardAction({ ...data, confirmationId: 'A'.repeat(43) }),
        reference,
      )).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(confirmationLifetime());
      await rejected;
      expect([...rows.values()][0]?.status).toBe('expired');
      await expect(service.receiveConfirmation(cardAction(data), reference)).resolves.toBe(false);
      expect(action).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends notifications and uses text-only delivery when Speech F0 is unavailable', async () => {
    const speech = { synthesize: vi.fn(async () => { throw new Error('quota exhausted'); }) };
    const { service, connector, sent } = harness(speech);
    await service.notify('warning', 'A bounded update.', [{
      title: 'Open status',
      url: 'https://jarvis.example/status',
    }]);
    expect(connector.send).toHaveBeenCalledTimes(1);
    const message = sent[0]!.activity as unknown as {
      attachments: Array<{ content: { actions: Array<{ type: string; title: string }> } }>;
    };
    expect(message.attachments[0]?.content.actions).toMatchObject([
      { type: 'Action.OpenUrl', title: 'Open status' },
    ]);
  });

  it('rejects unsafe notification links and stores audio only in an ephemeral card URL', async () => {
    const speech = { synthesize: vi.fn(async () => Buffer.from('mp3')) };
    const { service, connector, sent } = harness(speech);
    await expect(service.notify('info', 'Update', [{ title: 'Unsafe', url: 'https://example.com/?token=secret' }]))
      .rejects.toThrow('Invalid notification actions');
    await service.notify('info', 'A voice update.');
    expect(connector.send).toHaveBeenCalledTimes(2);
    const voice = sent[1]!.activity as unknown as {
      attachments: Array<{ content: { media: Array<{ url: string }> } }>;
    };
    expect(voice.attachments[0]?.content.media[0]?.url).toMatch(/^https:\/\/jarvis\.example\/teams\/audio\/[A-Za-z0-9_-]{43}$/u);
  });
});

function confirmationLifetime(): number {
  return 5 * 60_000;
}
