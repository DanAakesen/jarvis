import {
  createECDH,
  createDecipheriv,
  createHmac,
  createPublicKey,
  verify,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createVapidAuthorization, encryptWebPushPayload, generateVapidKeyPair, sendWebPush } from './webpush.js';

function expand(prk: Buffer, info: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let counter = 1; Buffer.concat(blocks).length < length; counter++) {
    previous = createHmac('sha256', prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function decryptForTest(encoded: Buffer, userAgent: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = encoded.subarray(0, 16);
  const size = encoded.readUInt32BE(16);
  const keyIdLength = encoded[20]!;
  const serverPublic = encoded.subarray(21, 21 + keyIdLength);
  const ciphertext = encoded.subarray(21 + keyIdLength);
  const userAgentPublic = userAgent.getPublicKey(undefined, 'uncompressed');
  const sharedSecret = userAgent.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    userAgentPublic,
    serverPublic,
  ]);
  const authPrk = createHmac('sha256', auth).update(sharedSecret).digest();
  const inputKeyingMaterial = expand(authPrk, keyInfo, 32);
  const prk = createHmac('sha256', salt).update(inputKeyingMaterial).digest();
  const contentKey = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return { plaintext, size, keyIdLength, serverPublic };
}

describe('Web Push cryptography', () => {
  it('generates an ES256 VAPID JWT with endpoint audience and HTTPS public origin subject', () => {
    const keys = generateVapidKeyPair();
    const authorization = createVapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/fixture',
      'https://jarvis.example',
      keys,
      Date.UTC(2026, 9, 17),
    );
    const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/u.exec(authorization)!;
    expect(publicKey).toBe(keys.publicKey);
    const [headerPart, claimsPart, signaturePart] = token!.split('.');
    const signingInput = `${headerPart}.${claimsPart}`;
    const header = JSON.parse(Buffer.from(headerPart!, 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(claimsPart!, 'base64url').toString('utf8'));
    const point = Buffer.from(keys.publicKey, 'base64url');
    const verificationKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(Date.UTC(2026, 9, 17) / 1000) + 12 * 60 * 60,
      sub: 'https://jarvis.example',
    });
    expect(verify('sha256', Buffer.from(signingInput), {
      key: verificationKey,
      dsaEncoding: 'ieee-p1363',
    }, Buffer.from(signaturePart!, 'base64url'))).toBe(true);
    expect(authorization).not.toContain(keys.privateKey);
  });

  it('encrypts one RFC 8188 aes128gcm record that decrypts to the exact payload', () => {
    const userAgent = createECDH('prime256v1');
    userAgent.generateKeys();
    const auth = Buffer.alloc(16, 0x0b);
    const message = Buffer.from('{"v":1,"title":"Jarvis","body":"New item","itemId":"fixture"}');
    const encoded = encryptWebPushPayload({
      p256dh: userAgent.getPublicKey(undefined, 'uncompressed').toString('base64url'),
      auth: auth.toString('base64url'),
    }, message, () => Buffer.alloc(16, 0x0a));
    const { plaintext, size, keyIdLength, serverPublic } = decryptForTest(encoded, userAgent, auth);
    expect(encoded.subarray(0, 16)).toEqual(Buffer.alloc(16, 0x0a));
    expect(size).toBe(4096);
    expect(keyIdLength).toBe(65);
    expect(serverPublic[0]).toBe(4);
    expect(plaintext).toEqual(Buffer.concat([message, Buffer.from([2])]));
  });
});

const subscription = {
  endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/fixture',
  p256dh: (() => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url');
  })(),
  auth: Buffer.alloc(16, 0x44).toString('base64url'),
};

function response(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers });
}

describe('Web Push send outcomes', () => {
  it.each([
    { origin: 'user_test' as const, ttl: '300', urgency: 'normal' },
    { origin: 'proactive_alert' as const, ttl: '3600', urgency: 'high' },
    { origin: 'proactive_reminder' as const, ttl: '1800', urgency: 'high' },
  ])('uses $origin headers for accepted responses', async ({ origin, ttl, urgency }) => {
    const keys = generateVapidKeyPair();
    const fetchMock = vi.fn<typeof fetch>(async () => response(202));
    const transport = { fetch: fetchMock, now: () => 1_000, sleep: async () => {} };
    const result = await sendWebPush(subscription, Buffer.from('payload'), keys, 'https://jarvis.example', origin, transport);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(subscription.endpoint);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        TTL: ttl,
        Urgency: urgency,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
    });
    expect((init?.headers as Record<string, string>).Authorization).toMatch(/^vapid t=.+, k=.+$/u);
    expect(Buffer.isBuffer(init?.body)).toBe(true);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ attempted: 1, accepted: true, statusCode: 202, removed: false });
  });

  it.each([404, 410])('removes a subscription after HTTP %i', async (status) => {
    const fetchMock = vi.fn<typeof fetch>(async () => response(status));
    const result = await sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: fetchMock, now: () => 0, sleep: async () => {} });
    expect(result).toEqual({ attempted: 1, accepted: false, statusCode: status, removed: true });
  });

  it('honours bounded Retry-After and retries 429 before acceptance', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(response(201));
    let clock = 0;
    const sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const result = await sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: fetchMock, now: () => clock, sleep });
    expect(result).toEqual({ attempted: 2, accepted: true, statusCode: 201, removed: false });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(clock).toBe(2000);
  });

  it('stops after three transient failures and fails 400/401/403 or network errors without retry', async () => {
    const exhausted = vi.fn<typeof fetch>(async () => response(503));
    await expect(sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: exhausted, now: () => 0, sleep: async () => {} }))
      .resolves.toEqual({ attempted: 3, accepted: false, statusCode: 503, removed: false });
    expect(exhausted).toHaveBeenCalledTimes(3);

    for (const status of [400, 401, 403]) {
      const forbidden = vi.fn<typeof fetch>(async () => response(status));
      await expect(sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
        'https://jarvis.example', 'user_test', { fetch: forbidden, now: () => 0, sleep: async () => {} }))
        .resolves.toEqual({ attempted: 1, accepted: false, statusCode: status, removed: false });
      expect(forbidden).toHaveBeenCalledTimes(1);
    }

    const timeout = vi.fn<typeof fetch>(async () => { throw new Error('network timeout'); });
    await expect(sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: timeout, now: () => 0, sleep: async () => {} }))
      .resolves.toEqual({ attempted: 1, accepted: false, statusCode: null, removed: false });
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('caps Retry-After at five seconds', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(429, { 'Retry-After': '60' }))
      .mockResolvedValueOnce(response(201));
    let clock = 0;
    const sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    await sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: fetchMock, now: () => clock, sleep });
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('accepts an HTTP-date Retry-After and stops at the overall deadline', async () => {
    const dateFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(429, { 'Retry-After': new Date(3000).toUTCString() }))
      .mockResolvedValueOnce(response(201));
    let clock = 0;
    const sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    await sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: dateFetch, now: () => clock, sleep });
    expect(sleep).toHaveBeenCalledWith(3000);

    clock = 0;
    const slowFetch = vi.fn<typeof fetch>(async () => {
      clock += 10_000;
      return response(503);
    });
    await expect(sendWebPush(subscription, Buffer.from('payload'), generateVapidKeyPair(),
      'https://jarvis.example', 'user_test', { fetch: slowFetch, now: () => clock, sleep: async () => {} }))
      .resolves.toEqual({ attempted: 2, accepted: false, statusCode: 503, removed: false });
    expect(slowFetch).toHaveBeenCalledTimes(2);
  });
});
