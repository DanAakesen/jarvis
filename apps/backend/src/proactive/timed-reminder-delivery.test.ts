import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushStore } from '../database/push-store.js';
import type { ApprovalNotificationServices } from '../push/approval-notifications.js';
import { createMemoryAlertLedgerStore } from './alert-ledger.js';
import { createNativeProactiveDelivery } from './native-delivery.js';
import { createMemoryOwnerReminderStore } from './owner-reminder-store.js';
import { createOwnerReminderTool } from './owner-reminder-tools.js';
import { createSystemPushSender } from './push-delivery.js';
import { createMemoryProactiveReminderStore } from './reminder-store.js';
import { createReminderTicker } from './reminder-ticker.js';
import { createTodosSource } from './sources/todos.js';
import { createMemoryProactiveStore } from './store.js';
import { dayKey, localTimeLabel } from './time.js';
import { createVaultPushReminderPass } from './vault-push-reminders.js';

const owner = '11111111-1111-4111-8111-111111111111';
const stops: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(stops.splice(0).map((stop) => stop())); });

// These exercise provider acceptance with synthetic transports, never device display.
describe.each(['owner_schedule', 'vault_at_due'] as const)('%s scheduling to provider acceptance', (path) => {
  describe.each(['native', 'web'] as const)('%s delivery', (channel) => {
    it.each([
      '2026-10-24T20:00:00Z', // 22:00 Copenhagen
      '2026-10-24T22:00:00Z', // midnight
      '2026-10-25T00:30:00Z', // first 02:30 in autumn overlap
      '2026-10-25T01:30:00Z', // second 02:30 in autumn overlap
      '2026-10-25T06:00:00Z', // 07:00 Copenhagen
      '2027-03-28T01:30:00Z', // 03:30 after spring transition
    // Vault tasks store local HH:mm without an offset; the existing resolver uses
    // the second autumn 02:30. Offset-qualified owner schedules cover both instants.
    ].filter((instant) => path === 'owner_schedule' || instant !== '2026-10-25T00:30:00Z'))('plans before the deadline and delivers once at %s', async (instant) => {
      const fireAt = new Date(instant);
      let now = new Date(fireAt.getTime() - 60_000);
      const clock = () => new Date(now);
      const content = path === 'owner_schedule' ? '- [ ] Requested task' :
        `- [ ] Requested task 🔺 📅 ${dayKey(fireAt)} ${localTimeLabel(fireAt)} [reminder:: at_due_time]`;
      const vault = {
        tree: async () => [{ path: 'Personal/Inbox.md', sha: 'a'.repeat(40) }],
        read: async () => ({ path: 'Personal/Inbox.md', sha: 'a'.repeat(40), content }),
      };
      const store = createMemoryProactiveStore(owner);
      const reminders = createMemoryProactiveReminderStore(owner);
      const schedules = createMemoryOwnerReminderStore();
      const webSend = vi.fn(async () => ({ attempted: 1, accepted: true, statusCode: 201, removed: false }));
      const nativeSend = vi.fn(async () => ({ accepted: true, invalidToken: false }));
      const pushStore = {
        listSubscriptions: vi.fn(async () => channel === 'web' ? [{ id: owner,
          endpoint: 'https://push.example.test/synthetic', p256dh: 'synthetic', auth: 'synthetic' }] : []),
        readVapidKey: async () => ({ publicKey: 'synthetic', privateKey: 'synthetic' }),
        recordSubscriptionResult: vi.fn(async () => {}),
        updateItemDelivery: vi.fn(async () => {}),
      };
      const services = {
        store: { list: async () => channel === 'native' ? [{ deviceToken: 'a'.repeat(64) }] : [] },
        sender: { send: nativeSend },
      } as unknown as ApprovalNotificationServices;
      const native = createNativeProactiveDelivery(owner, services, clock);
      const sender = createSystemPushSender({ store: pushStore as unknown as PushStore,
        ownerObjectId: owner, publicOrigin: 'https://jarvis.example.test', now: clock,
        nativeSend: native.send, send: webSend });
      const ticker = createReminderTicker({ store, reminders, ownerReminders: schedules,
        vault, pushStore, hasNativeRecipients: native.hasRecipients,
        ledger: createMemoryAlertLedgerStore(clock), ownerObjectId: owner, now: clock, send: sender });
      stops.push(() => ticker.stop());
      if (path === 'owner_schedule') {
        const tool = createOwnerReminderTool({ ownerObjectId: owner, store: schedules, vault,
          now: clock, onScheduled: ticker.considerFireAt });
        const request = { principal: { objectId: owner },
          jarvisConversationMessage: { id: '42', sessionId: 'session-1', role: 'dan', text: 'Remind me at that time' },
          server: { conversationStore: { getSession: async () => ({ channel: 'chat', endedAt: null }) } },
        } as unknown as FastifyRequest;
        const input = { operation: 'create', task: 'Requested task', fireAt: instant };
        await tool.execute(input, request, new AbortController().signal);
        await tool.execute(input, request, new AbortController().signal);
        expect(schedules.snapshot()).toHaveLength(1);
        expect(schedules.snapshot()[0]?.fireAt).toEqual(fireAt);
      } else {
        const pass = createVaultPushReminderPass({ store, reminders, todos: createTodosSource(vault),
          now: clock, onPlanned: ticker.considerFireAt });
        stops.push(() => pass.stop());
        pass.trigger();
        await vi.waitFor(() => expect(reminders.snapshot()).toHaveLength(1));
        expect(reminders.snapshot()[0]?.fireAt).toEqual(fireAt);
      }
      await ticker.start();
      await ticker.tick();
      expect(nativeSend).not.toHaveBeenCalled();
      expect(webSend).not.toHaveBeenCalled();
      now = fireAt;
      await Promise.all([ticker.tick(), ticker.tick()]);
      await ticker.tick();
      expect(channel === 'native' ? nativeSend : webSend).toHaveBeenCalledOnce();
      expect(channel === 'native' ? webSend : nativeSend).not.toHaveBeenCalled();
      expect(pushStore.updateItemDelivery).toHaveBeenCalledWith(expect.any(String), 'accepted', channel === 'native' ? 200 : 201);
      if (path === 'owner_schedule') {
        expect(schedules.snapshot()[0]).toMatchObject({ state: 'completed', lastDelivery: 'provider_accepted' });
      } else {
        expect(reminders.snapshot()[0]?.state).toBe('sent');
      }
    });
  });
});
