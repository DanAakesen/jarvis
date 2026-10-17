import { createECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pushEndpointHostSuffixes, validatePushEndpoint, validatePushSubscription } from './validation.js';

function validSubscription(endpoint = 'https://web.push.apple.com/device/test') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url'),
      auth: Buffer.alloc(16, 7).toString('base64url'),
    },
  };
}

describe('push subscription validation', () => {
  it('exports the one allowed-host suffix list and accepts the supported provider hosts', () => {
    expect(pushEndpointHostSuffixes).toEqual([
      '.push.apple.com',
      'fcm.googleapis.com',
      '.push.services.mozilla.com',
      '.notify.windows.com',
    ]);
    for (const host of [
      'https://web.push.apple.com/device/id',
      'https://fcm.googleapis.com/fcm/send/token',
      'https://updates.push.services.mozilla.com/wpush/v2/token',
      'https://push.notify.windows.com/?token=fixture',
    ]) {
      expect(validatePushEndpoint(host)).toBe(new URL(host).href);
    }
  });

  it.each([
    'http://web.push.apple.com/device/id',
    'https://push.apple.com.evil.example/device/id',
    'https://evilfcm.googleapis.com/send',
    '******web.push.apple.com/device/id',
    `https://web.push.apple.com/${'a'.repeat(2048)}`,
    'https://web.push.apple.com/device/id#fragment',
    ' https://web.push.apple.com/device/id',
    'not a URL',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(validatePushEndpoint(endpoint)).toBeUndefined();
  });

  it('accepts valid P-256 and auth material while ignoring unrelated browser fields', () => {
    const subscription = validSubscription();
    expect(validatePushSubscription({ ...subscription, expirationTime: 123, extra: true })).toEqual({
      endpoint: 'https://web.push.apple.com/device/test',
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
  });

  it('rejects missing keys, malformed encodings, wrong lengths and points off P-256', () => {
    const valid = validSubscription();
    const invalid = [
      null,
      [],
      { endpoint: valid.endpoint },
      { ...valid, keys: null },
      { ...valid, keys: { ...valid.keys, p256dh: '***' } },
      { ...valid, keys: { ...valid.keys, p256dh: Buffer.alloc(64, 4).toString('base64url') } },
      { ...valid, keys: { ...valid.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url') } },
      { ...valid, keys: { ...valid.keys, auth: Buffer.alloc(15).toString('base64url') } },
      { ...valid, keys: { ...valid.keys, auth: Buffer.alloc(17).toString('base64url') } },
    ];
    for (const subscription of invalid) expect(validatePushSubscription(subscription)).toBeUndefined();
  });
});
