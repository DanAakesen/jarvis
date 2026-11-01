import { EventEmitter } from 'node:events';
import { connect, type OutgoingHttpHeaders } from 'node:http2';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityPayload, createActivityPushSender, loadActivityKitConfig, type ActivityKitConfig } from './activitykit.js';
import { activityContent } from './activitykit-routes.js';

afterEach(() => vi.useRealTimers());

async function fixture(status = 200, body = '', respond = true) {
  const keys = await generateKeyPair('ES256', { extractable: true });
  const config: ActivityKitConfig = {
    teamId: 'AAAAAAAAAA', keyId: 'BBBBBBBBBB', signingKey: await exportPKCS8(keys.privateKey), environment: 'sandbox',
  };
  const stream = new EventEmitter();
  const session = new EventEmitter();
  let headers: OutgoingHttpHeaders = {};
  const request = vi.fn((input: OutgoingHttpHeaders) => { headers = input; return stream; });
  const destroy = vi.fn();
  Object.assign(session, { request, destroy });
  const end = vi.fn<(payload: Buffer) => void>(() => {
    if (respond) queueMicrotask(() => {
      stream.emit('response', { ':status': status });
      if (body) stream.emit('data', Buffer.from(body));
      stream.emit('end');
    });
  });
  Object.assign(stream, { end });
  const open = vi.fn(() => session) as unknown as typeof connect;
  const at = Date.UTC(2026, 10, 1);
  const sender = await createActivityPushSender(config, () => at, open);
  return { sender, keys, config, request, destroy, end, open, at, headers: () => headers };
}
const token = 'ab'.repeat(32);

describe('ActivityKit configuration and payload', () => {
  it('defaults off and rejects incomplete or ambiguous enabled configuration without exposing the key', () => {
    expect(loadActivityKitConfig({})).toBeUndefined();
    expect(loadActivityKitConfig({ JARVIS_ACTIVITYKIT_ENABLED: 'false' })).toBeUndefined();
    expect(() => loadActivityKitConfig({ JARVIS_ACTIVITYKIT_ENABLED: '1' })).toThrow('must be true or false');
    expect(() => loadActivityKitConfig({ JARVIS_ACTIVITYKIT_ENABLED: 'true' })).toThrow('explicit APNS_ENVIRONMENT');
  });
  it('uses only update/end, bounded fixed localized content and Unix APNs timestamps', () => {
    const content = activityContent('running', 'da');
    const update = JSON.parse(activityPayload(content, 1_800_000_000_000).toString());
    expect(update.aps).toEqual({ timestamp: 1_800_000_000, event: 'update', 'content-state': content, 'stale-date': 1_800_000_300 });
    for (const phase of ['done', 'failed', 'cancelled'] as const) {
      const end = JSON.parse(activityPayload(activityContent(phase, 'en'), 1_800_000_000_000).toString());
      expect(end.aps.event).toBe('end');
      expect(end.aps['dismissal-date']).toBe(1_800_000_300);
      expect(end.aps['stale-date']).toBeUndefined();
      expect(end.aps['content-state'].activity).toBeNull();
      expect(end.aps['attributes-type']).toBeUndefined();
    }
  });
  it('rejects non-P256 signing keys before enabling the sender', async () => {
    const f = await fixture();
    const wrong = await generateKeyPair('ES384', { extractable: true });
    await expect(createActivityPushSender({ ...f.config, signingKey: await exportPKCS8(wrong.privateKey) })).rejects.toThrow('ES256 PKCS8');
  });
});

describe('APNs ActivityKit transport', () => {
  it('sends a verified ES256 provider token to explicit sandbox and fixed liveactivity topic', async () => {
    const f = await fixture();
    await expect(f.sender.send(token, activityContent('running', 'en'), new AbortController().signal)).resolves.toEqual({
      accepted: true, invalidToken: false,
    });
    expect(f.open).toHaveBeenCalledWith('https://api.sandbox.push.apple.com');
    expect(f.headers()).toMatchObject({
      ':path': `/3/device/${token}`, 'apns-push-type': 'liveactivity',
      'apns-topic': 'com.danaakesen.jarvis.push-type.liveactivity', 'apns-expiration': '0',
    });
    const providerToken = String(f.headers().authorization).slice(7);
    const verified = await jwtVerify(providerToken, f.keys.publicKey, { issuer: f.config.teamId, algorithms: ['ES256'] });
    expect(verified.protectedHeader.kid).toBe(f.config.keyId);
    expect(verified.payload.iat).toBe(Math.floor(f.at / 1000));
    expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each([
    [410, '{"reason":"Unregistered"}', true],
    [400, '{"reason":"BadDeviceToken"}', true],
    [400, '{"reason":"DeviceTokenNotForTopic"}', true],
    [403, '{"reason":"ExpiredProviderToken"}', false],
    [429, '{"reason":"TooManyRequests"}', false],
    [500, '{"reason":"InternalServerError"}', false],
  ])('classifies APNs %s without returning raw provider data or retrying', async (status, body, invalidToken) => {
    const f = await fixture(status, body);
    expect(await f.sender.send(token, activityContent('waiting', 'da'), new AbortController().signal)).toEqual({
      accepted: false, invalidToken,
      ...(status === 429 || status >= 500 ? { retryable: true } : {}),
    });
    expect(f.request).toHaveBeenCalledOnce();
  });
  it('bounds response bodies and closes the connection on a deadline or cancellation', async () => {
    const oversized = await fixture(500, 'x'.repeat(4097));
    await expect(oversized.sender.send(token, activityContent('failed', 'en'), new AbortController().signal)).rejects.toThrow('transport unavailable');
    const f = await fixture();
    await f.sender.send(token, activityContent('running', 'en'), new AbortController().signal);
    f.end.mockImplementation(() => {});
    f.destroy.mockClear();
    vi.useFakeTimers();
    const pending = f.sender.send(token, activityContent('running', 'en'), new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow('transport unavailable');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(f.destroy).toHaveBeenCalledOnce();
    const aborted = new AbortController();
    const cancelled = f.sender.send(token, activityContent('running', 'en'), aborted.signal);
    const cancellation = expect(cancelled).rejects.toThrow();
    aborted.abort();
    await cancellation;
  });
  it('does not open a transport for malformed or already-aborted tokens', async () => {
    const f = await fixture();
    await expect(f.sender.send('../token', activityContent('running', 'en'), new AbortController().signal)).rejects.toThrow('Invalid ActivityKit token');
    const controller = new AbortController();
    controller.abort();
    await expect(f.sender.send(token, activityContent('running', 'en'), controller.signal)).rejects.toThrow();
    expect(f.open).not.toHaveBeenCalled();
  });
});
