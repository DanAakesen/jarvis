import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Marks a Jarvis session token. An Entra access token always starts with `eyJ`, so the prefix is an unambiguous dispatch. */
export const ownerSessionTokenPrefix = 'js.';

const SESSION_ID_BYTES = 16;
const SECRET_BYTES = 32;
// Three dot-separated URL-safe segments keep the token acceptable to the voice WebSocket subprotocol parser.
const tokenPattern = /^js\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u;

export interface OwnerSessionCredential {
  /** 128-bit random lookup key, base64url encoded. Not a secret on its own. */
  readonly sessionId: string;
  /** 256-bit random secret, base64url encoded. Shown once and never stored. */
  readonly secret: string;
}

export interface NewOwnerSessionCredential extends OwnerSessionCredential {
  readonly token: string;
  /** SHA-256 of the decoded secret; the only form that is stored. */
  readonly secretHash: Buffer;
}

const sha256 = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();

// A trailing base64url character carries spare bits; requiring the canonical form means one string per value.
function decodeCanonical(value: string, bytes: number): Buffer | null {
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === bytes && decoded.toString('base64url') === value ? decoded : null;
}

export function generateOwnerSessionCredential(random: (size: number) => Buffer = randomBytes): NewOwnerSessionCredential {
  const sessionId = random(SESSION_ID_BYTES).toString('base64url');
  const secretBytes = random(SECRET_BYTES);
  const secret = secretBytes.toString('base64url');
  return { sessionId, secret, token: `${ownerSessionTokenPrefix}${sessionId}.${secret}`, secretHash: sha256(secretBytes) };
}

export function parseOwnerSessionToken(token: string): OwnerSessionCredential | null {
  const match = tokenPattern.exec(token);
  const sessionId = match?.[1];
  const secret = match?.[2];
  if (sessionId === undefined || secret === undefined) return null;
  return decodeCanonical(sessionId, SESSION_ID_BYTES) && decodeCanonical(secret, SECRET_BYTES) ? { sessionId, secret } : null;
}

export function hashOwnerSessionSecret(secret: string): Buffer {
  return sha256(Buffer.from(secret, 'base64url'));
}

/** Constant-time comparison of a stored hash with the hash of a presented secret. */
export function ownerSessionSecretMatches(storedHash: Uint8Array, secret: string): boolean {
  const presented = hashOwnerSessionSecret(secret);
  return storedHash.length === presented.length && timingSafeEqual(storedHash, presented);
}

const absentSessionHash = sha256(Buffer.alloc(SECRET_BYTES));

/** Runs the same comparison for an unknown session id so that outcome does not skip the work. */
export function spendOwnerSessionComparison(secret: string): void {
  ownerSessionSecretMatches(absentSessionHash, secret);
}

/** The only form of a session id that may appear in logs. */
export const ownerSessionPrefix = (sessionId: string): string => sessionId.slice(0, 8);

export const ownerSessionIdToBytes = (sessionId: string): Buffer => Buffer.from(sessionId, 'base64url');
export const ownerSessionIdFromBytes = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
