import { randomBytes } from 'node:crypto';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const maxAudioBytes = 1_500_000;
const maxStoredBytes = 8_000_000;
const maxEntries = 32;
const lifetimeMs = 5 * 60_000;

interface AudioEntry {
  readonly bytes: Buffer;
  readonly expiresAt: number;
}

export interface EphemeralAudioStore {
  put(bytes: Uint8Array): string | null;
  get(token: string): Buffer | null;
  clear(): void;
}

export function createEphemeralAudioStore(now: () => number = Date.now): EphemeralAudioStore {
  const entries = new Map<string, AudioEntry>();
  let storedBytes = 0;

  function prune() {
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= now()) {
        entries.delete(token);
        storedBytes -= entry.bytes.length;
      }
    }
  }

  return {
    put(bytes) {
      prune();
      if (bytes.byteLength === 0 || bytes.byteLength > maxAudioBytes ||
        entries.size >= maxEntries || storedBytes + bytes.byteLength > maxStoredBytes) return null;
      const token = randomBytes(32).toString('base64url');
      const copy = Buffer.from(bytes);
      entries.set(token, { bytes: copy, expiresAt: now() + lifetimeMs });
      storedBytes += copy.length;
      return token;
    },
    get(token) {
      prune();
      if (!tokenPattern.test(token)) return null;
      return entries.get(token)?.bytes ?? null;
    },
    clear() {
      entries.clear();
      storedBytes = 0;
    },
  };
}
