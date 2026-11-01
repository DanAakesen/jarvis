import { EventEmitter } from 'node:events';
import { connect, type OutgoingHttpHeaders } from 'node:http2';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import type {
  ApprovalNotificationRegistration,
  ApprovalNotificationStore,
} from '../database/approval-notification-store.js';
import {
  approvalNotificationPayload,
  createApprovalNotificationDispatcher,
  createApprovalNotificationSender,
  loadApprovalNotificationConfig,
  type ApprovalNotificationSender,
} from './approval-notifications.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}` };
const deviceToken = 'ab'.repeat(32);
const confirmation = {
  id: 'A'.repeat(43),
  actionKind: 'merge' as const,
  summary: 'Merge the changes into main?',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(options: BuildAppOptions = {}, objectId = config.auth.ownerObjectId) {
  const registrations = new Map<string, ApprovalNotificationRegistration>();
  const store: ApprovalNotificationStore = {
    upsert: vi.fn(async (_owner, registration) => {
      registrations.set(registration.deviceToken, registration);
      return true;
    }),
    list: vi.fn(async () => [...registrations.values()]),
    remove: vi.fn(async (_owner, token) => { registrations.delete(token); }),
  };
  const send = vi.fn<ApprovalNotificationSender['send']>(async () => ({
    accepted: true,
    invalidToken: false,
  }));
  const app = buildApp(config, undefined, {
    auth: async () => ({ objectId, tenantId: config.auth.tenantId, displayName: 'Fixture' }),
    approvalNotifications: { store, sender: { send } },
    ...options,
  });
  apps.push(app);
  return { app, store, send, registrations };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('APNs approval notifications', () => {
  it('defaults off and validates explicit APNs configuration', () => {
    expect(loadApprovalNotificationConfig({})).toBeUndefined();
    expect(loadApprovalNotificationConfig({ JARVIS_APPROVAL_NOTIFICATIONS_ENABLED: 'false' })).toBeUndefined();
    expect(() => loadApprovalNotificationConfig({ JARVIS_APPROVAL_NOTIFICATIONS_ENABLED: '1' }))
      .toThrow('must be true or false');
    expect(() => loadApprovalNotificationConfig({ JARVIS_APPROVAL_NOTIFICATIONS_ENABLED: 'true' }))
      .toThrow('explicit APNS_ENVIRONMENT');
  });

  it('sends one bilingual actionable alert and honors the no-preview category', () => {
    const english = JSON.parse(approvalNotificationPayload({
      ...confirmation,
      language: 'en',
      showActions: true,
    }).toString());
    const danishPrivate = JSON.parse(approvalNotificationPayload({
      ...confirmation,
      language: 'da',
      showActions: false,
    }).toString());
    expect(english.aps).toMatchObject({
      alert: { title: 'Jarvis' },
      category: 'jarvis.approval',
      'thread-id': 'jarvis.approval',
      sound: 'default',
    });
    expect(english.aps.alert.body).toMatch(/^Merge the changes into main\?\nExpires at .+ UTC$/u);
    expect(english.confirmationID).toBe(confirmation.id);
    expect(danishPrivate.aps.category).toBe('jarvis.approval.private');
    expect(danishPrivate.aps.alert.body).toContain('\nUdløber kl. ');
  });

  it('sends a bounded, authenticated APNs alert with the app topic and expires-on header', async () => {
    const keys = await generateKeyPair('ES256', { extractable: true });
    const signingKey = await exportPKCS8(keys.privateKey);
    const apnsConfig = {
      teamId: 'AAAAAAAAAA',
      keyId: 'BBBBBBBBBB',
      signingKey,
      environment: 'sandbox' as const,
    };
    const stream = new EventEmitter();
    const session = new EventEmitter();
    let requestHeaders: OutgoingHttpHeaders = {};
    const request = vi.fn((input: OutgoingHttpHeaders) => {
      requestHeaders = input;
      return stream;
    });
    const destroy = vi.fn();
    Object.assign(session, { request, destroy });
    const end = vi.fn<(payload: Buffer) => void>(() => {
      queueMicrotask(() => {
        stream.emit('response', { ':status': 200 });
        stream.emit('end');
      });
    });
    Object.assign(stream, { end });
    const open = vi.fn(() => session) as unknown as typeof connect;
    const now = Date.now();
    const expiresAt = now + 60_000;
    const sender = await createApprovalNotificationSender(apnsConfig, () => now, open);

    await expect(sender.send(
      deviceToken,
      approvalNotificationPayload({ ...confirmation, language: 'en', showActions: true }),
      expiresAt,
      new AbortController().signal,
    )).resolves.toEqual({ accepted: true, invalidToken: false });

    expect(open).toHaveBeenCalledWith('https://api.sandbox.push.apple.com');
    expect(requestHeaders).toMatchObject({
      ':path': `/3/device/${deviceToken}`,
      'apns-push-type': 'alert',
      'apns-topic': 'com.danaakesen.jarvis',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(expiresAt / 1000)),
    });
    const providerToken = String(requestHeaders.authorization).slice(7);
    const verified = await jwtVerify(providerToken, keys.publicKey, {
      issuer: apnsConfig.teamId,
      algorithms: ['ES256'],
    });
    expect(verified.protectedHeader.kid).toBe(apnsConfig.keyId);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('registers only valid owner device tokens and supports removal', async () => {
    const f = fixture();
    const registration = { deviceToken, language: 'da', showActions: true };
    expect((await f.app.inject({
      method: 'POST',
      url: '/ios/approval-notifications',
      headers,
      payload: registration,
    })).statusCode).toBe(204);
    expect(f.store.upsert).toHaveBeenCalledWith(config.auth.ownerObjectId, registration);
    for (const invalid of [
      null, [], { ...registration, deviceToken: 'invalid' },
      { ...registration, language: 'fr' }, { ...registration, showActions: 'true' },
      { ...registration, unexpected: true },
    ]) {
      expect((await f.app.inject({
        method: 'POST',
        url: '/ios/approval-notifications',
        headers,
        payload: invalid,
      })).statusCode).toBe(400);
    }
    expect((await f.app.inject({
      method: 'DELETE',
      url: '/ios/approval-notifications',
      headers,
      payload: { deviceToken },
    })).statusCode).toBe(204);
    expect(f.store.remove).toHaveBeenCalledWith(config.auth.ownerObjectId, deviceToken);
  });

  it('denies foreign identities and does not send duplicate approval alerts', async () => {
    const foreign = fixture({}, 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff');
    expect((await foreign.app.inject({
      method: 'POST',
      url: '/ios/approval-notifications',
      headers,
      payload: { deviceToken, language: 'en', showActions: true },
    })).statusCode).toBe(403);
    expect(foreign.store.upsert).not.toHaveBeenCalled();

    const f = fixture();
    f.registrations.set(deviceToken, { deviceToken, language: 'en', showActions: true });
    const dispatch = createApprovalNotificationDispatcher(
      config.auth.ownerObjectId,
      { store: f.store, sender: { send: f.send } },
      f.app.log,
    );
    dispatch(confirmation);
    dispatch(confirmation);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    const payload = JSON.parse(f.send.mock.calls[0]![1].toString());
    expect(payload.aps.category).toBe('jarvis.approval');
    expect(payload.confirmationID).toBe(confirmation.id);
  });
});
