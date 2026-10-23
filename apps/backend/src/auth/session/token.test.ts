import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

const {
  generateOwnerSessionCredential, hashOwnerSessionSecret, ownerSessionIdFromBytes, ownerSessionIdToBytes,
  ownerSessionPrefix, ownerSessionSecretMatches, ownerSessionTokenPrefix, parseOwnerSessionToken,
  spendOwnerSessionComparison,
} = await import('./token.js');

const sessionId = 'A'.repeat(22);
const secret = 'B'.repeat(7) + 'A'.repeat(36);
const token = `js.${sessionId}.${secret}`;

describe('owner session token', () => {
  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  });

  it('issues a 128-bit id and a 256-bit secret as three URL-safe segments', () => {
    const credential = generateOwnerSessionCredential();
    expect(credential.token).toMatch(/^js\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u);
    expect(credential.token).toBe(`${ownerSessionTokenPrefix}${credential.sessionId}.${credential.secret}`);
    expect(Buffer.from(credential.sessionId, 'base64url')).toHaveLength(16);
    expect(Buffer.from(credential.secret, 'base64url')).toHaveLength(32);
    expect(parseOwnerSessionToken(credential.token)).toEqual({ sessionId: credential.sessionId, secret: credential.secret });
  });

  it('never repeats a credential', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateOwnerSessionCredential().token));
    expect(tokens.size).toBe(50);
  });

  it('stores only the SHA-256 of the secret bytes', () => {
    const credential = generateOwnerSessionCredential((size) => Buffer.alloc(size, 7));
    const expected = createHash('sha256').update(Buffer.alloc(32, 7)).digest();
    expect(credential.secretHash).toEqual(expected);
    expect(credential.secretHash).toHaveLength(32);
    expect(hashOwnerSessionSecret(credential.secret)).toEqual(expected);
    expect(Buffer.from(credential.secretHash).toString('base64url')).not.toBe(credential.secret);
  });

  it('accepts only the exact token shape', () => {
    expect(parseOwnerSessionToken(token)).toEqual({ sessionId, secret });
    for (const rejected of [
      '',
      'js.',
      `js.${sessionId}`,
      `js.${sessionId}.`,
      `js..${secret}`,
      `JS.${sessionId}.${secret}`,
      `js${sessionId}.${secret}`,
      `jx.${sessionId}.${secret}`,
      `js.${sessionId}.${secret}.extra`,
      `js.${sessionId}.${secret}A`,
      `js.${sessionId.slice(1)}.${secret}`,
      `js.${sessionId}.${secret.slice(1)}`,
      ` ${token}`,
      `${token} `,
      `${token}\n`,
      `js.${sessionId}.${'+'.repeat(43)}`,
      `js.${'/'.repeat(22)}.${secret}`,
      `js.${sessionId}.${secret.slice(0, 42)}=`,
      `eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl`,
    ]) {
      expect(parseOwnerSessionToken(rejected), rejected).toBeNull();
    }
  });

  it('rejects a second spelling of the same bytes', () => {
    // The last character of an id carries four unused bits and the last of a secret carries two; they must be zero.
    expect(parseOwnerSessionToken(`js.${'A'.repeat(21)}B.${secret}`)).toBeNull();
    expect(parseOwnerSessionToken(`js.${sessionId}.${'A'.repeat(42)}B`)).toBeNull();
    expect(parseOwnerSessionToken(`js.${'A'.repeat(21)}Q.${'A'.repeat(42)}E`)).not.toBeNull();
  });

  it('matches only the secret that produced the stored hash', () => {
    const credential = generateOwnerSessionCredential();
    const other = generateOwnerSessionCredential();
    expect(ownerSessionSecretMatches(credential.secretHash, credential.secret)).toBe(true);
    expect(ownerSessionSecretMatches(credential.secretHash, other.secret)).toBe(false);
    expect(ownerSessionSecretMatches(credential.secretHash, credential.sessionId)).toBe(false);
    expect(ownerSessionSecretMatches(Buffer.alloc(31), credential.secret)).toBe(false);
  });

  it('compares the hashes in constant time, also when they differ', () => {
    const credential = generateOwnerSessionCredential();
    const other = generateOwnerSessionCredential();
    expect(ownerSessionSecretMatches(credential.secretHash, other.secret)).toBe(false);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    const [stored, presented] = crypto.timingSafeEqual.mock.calls[0] as [Buffer, Buffer];
    expect(stored).toEqual(credential.secretHash);
    expect(presented).toEqual(hashOwnerSessionSecret(other.secret));
  });

  it('spends the same comparison when the session id is unknown', () => {
    spendOwnerSessionComparison(secret);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    const [stored, presented] = crypto.timingSafeEqual.mock.calls[0] as [Buffer, Buffer];
    expect(stored).toHaveLength(32);
    expect(presented).toEqual(hashOwnerSessionSecret(secret));
  });

  it('exposes only the first eight characters of an id for logs', () => {
    const credential = generateOwnerSessionCredential();
    expect(ownerSessionPrefix(credential.sessionId)).toBe(credential.sessionId.slice(0, 8));
    expect(ownerSessionPrefix(credential.sessionId)).toHaveLength(8);
  });

  it('round-trips an id through its 16 raw bytes', () => {
    const credential = generateOwnerSessionCredential();
    const bytes = ownerSessionIdToBytes(credential.sessionId);
    expect(bytes).toHaveLength(16);
    expect(ownerSessionIdFromBytes(bytes)).toBe(credential.sessionId);
  });
});
