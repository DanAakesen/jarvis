import { ECDH } from 'node:crypto';

export const pushEndpointHostSuffixes = [
  '.push.apple.com',
  'fcm.googleapis.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
] as const;

export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

function decodeBase64url(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : undefined;
}

export function validatePushEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  const host = url.hostname.toLowerCase();
  const allowed = pushEndpointHostSuffixes.some((suffix) =>
    suffix === 'fcm.googleapis.com'
      ? host === suffix || host.endsWith(`.${suffix}`)
      : host.endsWith(suffix));
  if (url.protocol !== 'https:' || url.username || url.password || !allowed || url.hash) return undefined;
  return url.href;
}

export function validatePushSubscription(value: unknown): PushSubscriptionInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  if (typeof request.keys !== 'object' || request.keys === null || Array.isArray(request.keys)) return undefined;
  const keys = request.keys as Record<string, unknown>;
  const endpoint = validatePushEndpoint(request.endpoint);
  const p256dh = decodeBase64url(keys.p256dh);
  const auth = decodeBase64url(keys.auth);
  if (!endpoint || !p256dh || p256dh.length !== 65 || p256dh[0] !== 4 ||
      !auth || auth.length !== 16) return undefined;
  try {
    ECDH.convertKey(p256dh, 'prime256v1', undefined, undefined, 'uncompressed');
  } catch {
    return undefined;
  }
  return { endpoint, p256dh: p256dh.toString('base64url'), auth: auth.toString('base64url') };
}
