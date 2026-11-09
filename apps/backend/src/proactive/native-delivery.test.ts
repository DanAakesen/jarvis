import { describe, expect, it, vi } from 'vitest';
import { createNativeProactiveDelivery } from './native-delivery.js';
import { createSystemPushSender } from './push-delivery.js';
import type { ApprovalNotificationServices } from '../push/approval-notifications.js';
const now = () => new Date('2026-11-09T11:00:00Z');
const request = { kind: 'insight' as const, count: 1, language: 'en' as const, itemId: '11111111-1111-4111-8111-111111111111', origin: 'proactive_alert' as const,
  details: [{ title: 'One session remaining', body: '2 of your saved 3 sessions are recorded.', dueAt: null }] };
function fixture(registered = true) {
  const services: ApprovalNotificationServices = { store: { list: vi.fn(async () => registered ? [{ deviceToken: 'a'.repeat(64), language: 'en', showActions: true, timeZone: 'Europe/Copenhagen' }] : []), upsert: vi.fn(), remove: vi.fn() }, sender: { send: vi.fn(async () => ({ accepted: true, invalidToken: false })) } };
  return { services, native: createNativeProactiveDelivery('owner', services, now) };
}
describe('native proactive delivery', () => {
  it('sends the generated title and complete body with an actionable finding identity', async () => {
    const { services, native } = fixture();
    expect(await native.hasRecipients()).toBe(true);
    expect(await native.send(request, new AbortController().signal)).toMatchObject({ status: 'sent', accepted: 1 });
    const args = vi.mocked(services.sender.send).mock.calls[0]!;
    expect(JSON.parse(args[1].toString())).toEqual({ aps: { alert: { title: request.details[0]!.title, body: request.details[0]!.body }, sound: 'default', category: 'jarvis.proactive', 'thread-id': 'jarvis.proactive' }, proactiveItemID: request.itemId, kind: 'insight' });
    expect(args[2]).toBe(now().getTime() + 3600000);
  });
  it('uses Web Push fallback only when no native recipient exists', async () => {
    const { native } = fixture(false);
    expect(await native.send(request, new AbortController().signal)).toBeUndefined();
    expect(await native.hasRecipients()).toBe(false);
  });
  it('removes rejected tokens and reports failure without claiming display or success', async () => {
    const { services, native } = fixture();
    vi.mocked(services.sender.send).mockResolvedValue({ accepted: false, invalidToken: true });
    expect(await native.send(request, new AbortController().signal)).toMatchObject({ status: 'failed', accepted: 0 });
    expect(services.store.remove).toHaveBeenCalledWith('owner', 'a'.repeat(64));
  });
  it('does not send or fall back to duplicate browser delivery after a native outcome', async () => {
    const listSubscriptions = vi.fn();
    const { native } = fixture();
    const send = createSystemPushSender({ ownerObjectId: 'owner', publicOrigin: 'https://example.test',
      store: { listSubscriptions } as never, nativeSend: native.send, now });
    expect(await send(request, new AbortController().signal)).toMatchObject({ status: 'sent' });
    expect(listSubscriptions).not.toHaveBeenCalled();
  });
  it('keeps existing quiet hours before any native send', async () => {
    const nativeSend = vi.fn();
    const send = createSystemPushSender({ ownerObjectId: 'owner', publicOrigin: 'https://example.test',
      store: {} as never, nativeSend, now: () => new Date('2026-11-09T22:00:00Z') });
    expect(await send(request, new AbortController().signal)).toMatchObject({ status: 'skipped', reason: 'quiet_hours' });
    expect(nativeSend).not.toHaveBeenCalled();
  });
});
