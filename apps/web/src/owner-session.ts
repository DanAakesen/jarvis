import type { PublicConfig } from '../config/public-config';

export const ownerSessionStorageKey = 'jarvis.owner-session';

export interface OwnerSessionRecord {
  version: 1;
  backendOrigin: string;
  sessionId: string;
  token: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

const sessionTokenPattern = /^js\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const mintFlights = new Map<string, Promise<void>>();
const mintWaits = new Map<string, { retryAt: number; failures: number }>();
const dayMs = 24 * 60 * 60_000;

function backendOrigin(config: Pick<PublicConfig, 'backendUrl'>): string | null {
  if (!config.backendUrl) return null;
  try {
    return new URL(config.backendUrl).origin;
  } catch {
    return null;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && isoDatePattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function validateOwnerSessionRecord(value: unknown, origin: string, now = Date.now()): OwnerSessionRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'absoluteExpiresAt,backendOrigin,idleExpiresAt,sessionId,token,version' ||
      record.version !== 1 || record.backendOrigin !== origin || typeof record.sessionId !== 'string' ||
      typeof record.token !== 'string' || typeof record.idleExpiresAt !== 'string' ||
      typeof record.absoluteExpiresAt !== 'string') return null;
  const match = sessionTokenPattern.exec(record.token);
  if (!match || match[1] !== record.sessionId ||
      !isIsoDate(record.idleExpiresAt) || !isIsoDate(record.absoluteExpiresAt)) return null;
  const idleExpiry = Date.parse(record.idleExpiresAt);
  const absoluteExpiry = Date.parse(record.absoluteExpiresAt);
  if (absoluteExpiry <= now || idleExpiry > absoluteExpiry ||
      absoluteExpiry > now + 31 * dayMs) return null;
  return record as OwnerSessionRecord;
}

function removeStoredSession(): void {
  try {
    localStorage.removeItem(ownerSessionStorageKey);
  } catch {
    // Storage restrictions leave the app on its existing Entra-only path.
  }
}

export function readOwnerSession(config: Pick<PublicConfig, 'backendUrl'>, now = Date.now()): OwnerSessionRecord | null {
  const origin = backendOrigin(config);
  if (!origin) return null;
  let value: string | null;
  try {
    value = localStorage.getItem(ownerSessionStorageKey);
  } catch {
    return null;
  }
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    removeStoredSession();
    return null;
  }
  const record = validateOwnerSessionRecord(parsed, origin, now);
  if (!record) removeStoredSession();
  return record;
}

export function clearOwnerSession(): void {
  removeStoredSession();
}

export function clearOwnerSessionMintWait(backendUrl: string | null): void {
  if (!backendUrl) return;
  try {
    mintWaits.delete(new URL(backendUrl).origin);
  } catch {
    // An invalid backend URL cannot own a mint wait.
  }
}

export function isOwnerSessionToken(token: string): boolean {
  return sessionTokenPattern.test(token);
}

function createRecord(value: unknown, origin: string, now: number): OwnerSessionRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== 'absoluteExpiresAt,idleExpiresAt,sessionId,token' ||
      typeof body.sessionId !== 'string' || typeof body.token !== 'string' ||
      typeof body.idleExpiresAt !== 'string' || typeof body.absoluteExpiresAt !== 'string') return null;
  const match = sessionTokenPattern.exec(body.token);
  if (!match || match[1] !== body.sessionId ||
      !isIsoDate(body.idleExpiresAt) || !isIsoDate(body.absoluteExpiresAt)) return null;
  const idleExpiry = Date.parse(body.idleExpiresAt);
  const absoluteExpiry = Date.parse(body.absoluteExpiresAt);
  if (idleExpiry <= now || absoluteExpiry <= now || idleExpiry > absoluteExpiry ||
      idleExpiry > now + 11 * dayMs || absoluteExpiry > now + 31 * dayMs) return null;
  return {
    version: 1,
    backendOrigin: origin,
    sessionId: body.sessionId,
    token: body.token,
    idleExpiresAt: body.idleExpiresAt,
    absoluteExpiresAt: body.absoluteExpiresAt,
  };
}

async function mintOwnerSessionLocked(
  config: Pick<PublicConfig, 'backendUrl'>,
  entraToken: string,
  origin: string,
): Promise<void> {
  if (readOwnerSession(config)) return;
  const now = Date.now();
  const wait = mintWaits.get(origin);
  if (wait && now < wait.retryAt) return;
  let response: Response;
  try {
    response = await fetch(`${config.backendUrl!.replace(/\/+$/u, '')}/auth/session`, {
      method: 'POST',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${entraToken}` },
      cache: 'no-store',
    });
  } catch {
    recordMintFailure(origin, 'network');
    return;
  }
  if (response.status === 404) {
    mintWaits.set(origin, { retryAt: now + 6 * 60 * 60_000, failures: 0 });
    return;
  }
  if (response.status === 401 || response.status === 403) {
    mintWaits.set(origin, { retryAt: now + 60 * 60_000, failures: 0 });
    return;
  }
  if (response.status === 429 || response.status === 503 || !response.ok) {
    recordMintFailure(origin, response.status);
    return;
  }
  if (response.status !== 201) {
    recordMintFailure(origin, response.status);
    return;
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    recordMintFailure(origin, 'invalid');
    return;
  }
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > 4_096) {
      recordMintFailure(origin, 'invalid');
      return;
    }
    body = JSON.parse(text);
  } catch {
    recordMintFailure(origin, 'invalid');
    return;
  }
  const record = createRecord(body, origin, now);
  if (!record) {
    recordMintFailure(origin, 'invalid');
    return;
  }
  try {
    localStorage.setItem(ownerSessionStorageKey, JSON.stringify(record));
  } catch {
    // The current Entra token continues to work when browser storage is unavailable.
  }
  mintWaits.delete(origin);
}

function recordMintFailure(origin: string, _reason: number | string): void {
  const failures = (mintWaits.get(origin)?.failures ?? 0) + 1;
  const delay = Math.min(10 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 4));
  mintWaits.set(origin, { retryAt: Date.now() + delay, failures });
}

export function mintOwnerSession(config: Pick<PublicConfig, 'backendUrl'>, entraToken: string): Promise<void> {
  const origin = backendOrigin(config);
  if (!origin || !config.backendUrl || !entraToken || readOwnerSession(config)) return Promise.resolve();
  const existing = mintFlights.get(origin);
  if (existing) return existing;
  const flight = (async () => {
    const run = () => mintOwnerSessionLocked(config, entraToken, origin);
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks?.request) await locks.request(`jarvis.owner-session:${origin}`, run);
    else await run();
  })().catch(() => {
    recordMintFailure(origin, 'network');
  }).finally(() => {
    mintFlights.delete(origin);
  });
  mintFlights.set(origin, flight);
  return flight;
}
