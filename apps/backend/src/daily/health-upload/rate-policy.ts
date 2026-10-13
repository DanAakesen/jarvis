import { isIP } from 'node:net';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

export interface HealthRatePolicy { perClient: number; perInstance: number; windowMs: number }
export function validateHealthRatePolicy(policy: HealthRatePolicy = { perClient: 60,perInstance: 120,windowMs: 60000 }): HealthRatePolicy {
  if (!Number.isSafeInteger(policy.perClient) || policy.perClient < 1 || policy.perClient > 1000 || !Number.isSafeInteger(policy.perInstance) ||
      policy.perInstance < policy.perClient || policy.perInstance > 1000 || !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1000 || policy.windowMs > 300000) throw new TypeError('Invalid health rate policy');
  return { ...policy };
}
export function validateHealthTrustedProxies(values: string[] = []): string[] {
  if (!Array.isArray(values) || values.length > 8) throw new TypeError('Invalid trusted health proxy');
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 64 || value.includes('%')) throw new TypeError('Invalid trusted health proxy');
    const [address,prefix,...extra] = value.split('/');
    const family = isIP(address ?? ''); const bits = Number(prefix);
    if (extra.length || !family || prefix === undefined || !/^\d+$/u.test(prefix) || !Number.isInteger(bits) ||
        bits < (family === 4 ? 16 : 64) || bits > (family === 4 ? 32 : 128)) throw new TypeError('Invalid trusted health proxy');
    if (family === 6 && isIP(normalizeIP(address!,128)) === 4 && bits < 112) throw new TypeError('Invalid trusted health proxy');
  }
  return [...values];
}
/** Fastify resolves only explicitly trusted proxy hops. Invalid forwarded identities
 * fall back to the real socket, never arbitrary header/token strings. IPv6 /64 is grouped. */
export function healthClientRateKey(request: FastifyRequest): string {
  const resolved = request.ip; const socket = request.raw.socket.remoteAddress;
  const address = isIP(resolved) ? resolved : socket && isIP(socket) ? socket : null;
  return address ? normalizeIP(address,64) : 'unidentified-client';
}
