import {
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

export interface VapidKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export interface WebPushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface WebPushResult {
  readonly attempted: number;
  readonly accepted: boolean;
  readonly statusCode: number | null;
  readonly removed: boolean;
}

export type PushSendOrigin = 'user_test' | 'proactive_alert' | 'proactive_reminder';

export interface WebPushTransport {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const vapidLifetimeSeconds = 12 * 60 * 60;
const recordSize = 4096;

function pointFromKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('Invalid P-256 public key');
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}

export function generateVapidKeyPair(): VapidKeyPair {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: pointFromKey(pair.publicKey).toString('base64url'),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function createVapidAuthorization(
  endpoint: string,
  publicOrigin: string,
  keys: VapidKeyPair,
  now = Date.now(),
): string {
  const audience = new URL(endpoint).origin;
  const subject = new URL(publicOrigin);
  if (subject.protocol !== 'https:' || subject.origin !== publicOrigin) {
    throw new Error('Push public origin must be an HTTPS origin');
  }
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + vapidLifetimeSeconds,
    sub: publicOrigin,
  })).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(keys.privateKey),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${signingInput}.${signature}, k=${keys.publicKey}`;
}

export function encryptWebPushPayload(
  subscription: Pick<WebPushSubscription, 'p256dh' | 'auth'>,
  payload: Buffer,
  random: (size: number) => Buffer = randomBytes,
): Buffer {
  const userAgentPublicBytes = Buffer.from(subscription.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.auth, 'base64url');
  if (userAgentPublicBytes.length !== 65 || userAgentPublicBytes[0] !== 4 || authSecret.length !== 16) {
    throw new Error('Invalid Web Push subscription keys');
  }
  const userAgentPublicKey = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: userAgentPublicBytes.subarray(1, 33).toString('base64url'),
      y: userAgentPublicBytes.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  const ephemeral = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ephemeralPublic = pointFromKey(ephemeral.publicKey);
  const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: userAgentPublicKey });
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userAgentPublicBytes,
    ephemeralPublic,
  ]);
  const inputKeyingMaterial = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const salt = random(16);
  if (salt.length !== 16) throw new Error('Invalid Web Push salt');
  const contentKey = Buffer.from(hkdfSync(
    'sha256', inputKeyingMaterial, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16,
  ));
  const nonce = Buffer.from(hkdfSync(
    'sha256', inputKeyingMaterial, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12,
  ));
  const plaintext = Buffer.concat([payload, Buffer.from([2])]);
  if (plaintext.length + 16 > recordSize) throw new Error('Web Push payload exceeds one record');
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header[20] = ephemeralPublic.length;
  return Buffer.concat([header, ephemeralPublic, ciphertext]);
}

function retryAfterMilliseconds(response: Response, now: number): number {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(milliseconds, 5000)) : 0;
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: Buffer,
  keys: VapidKeyPair,
  publicOrigin: string,
  origin: PushSendOrigin,
  transport: WebPushTransport = { fetch, now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  signal?: AbortSignal,
): Promise<WebPushResult> {
  const headers = origin === 'proactive_alert'
    ? { TTL: '3600', Urgency: 'high' }
    : origin === 'proactive_reminder'
      ? { TTL: '1800', Urgency: 'high' }
      : { TTL: '300', Urgency: 'normal' };
  const deadline = transport.now() + 20_000;
  let statusCode: number | null = null;
  let attempted = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - transport.now();
    if (remaining <= 0 || signal?.aborted) break;
    let response: Response;
    try {
      attempted++;
      response = await transport.fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: createVapidAuthorization(subscription.endpoint, publicOrigin, keys, transport.now()),
          ...headers,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
        },
        body: encryptWebPushPayload(subscription, payload),
        credentials: 'omit',
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(Math.min(10_000, remaining))])
          : AbortSignal.timeout(Math.min(10_000, remaining)),
      });
    } catch {
      return { attempted, accepted: false, statusCode: null, removed: false };
    }
    statusCode = response.status;
    if ([200, 201, 202].includes(statusCode)) return { attempted, accepted: true, statusCode, removed: false };
    if (statusCode === 404 || statusCode === 410) return { attempted, accepted: false, statusCode, removed: true };
    if (statusCode !== 429 && (statusCode < 500 || statusCode > 599)) {
      return { attempted, accepted: false, statusCode, removed: false };
    }
    if (attempt === 2) break;
    const delay = retryAfterMilliseconds(response, transport.now());
    if (transport.now() + delay >= deadline) break;
    if (delay > 0) await transport.sleep(delay);
  }
  return { attempted, accepted: false, statusCode, removed: false };
}
