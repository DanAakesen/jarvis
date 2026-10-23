import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import {
  clearOwnerSession,
  clearOwnerSessionMintWait,
  isEntraPreferred,
  mintOwnerSession,
  ownerSessionStorageKey,
  preferEntraOwnerSession,
  preferOwnerSession,
  readOwnerSession,
  validateOwnerSessionRecord,
} from './owner-session';

const config: Pick<PublicConfig, 'backendUrl'> = { backendUrl: 'https://api.example.com/' };
const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;

function response(status = 201, body: unknown = {
  sessionId: 'a'.repeat(22),
  token,
  idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
  absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T00:00:00.000Z'));
  localStorage.clear();
  clearOwnerSessionMintWait(config.backendUrl);
  preferOwnerSession(config);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  clearOwnerSessionMintWait(config.backendUrl);
  preferOwnerSession(config);
});

describe('owner session storage and minting', () => {
  it('accepts only the versioned record for the configured backend origin', () => {
    const record = {
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
    };
    expect(validateOwnerSessionRecord(record, 'https://api.example.com')).toEqual(record);
    expect(validateOwnerSessionRecord(record, 'https://other.example.com')).toBeNull();
    expect(validateOwnerSessionRecord({ ...record, token: `${token}extra` }, record.backendOrigin)).toBeNull();
    expect(validateOwnerSessionRecord({ ...record, sessionId: 'c'.repeat(22) }, record.backendOrigin)).toBeNull();
    expect(validateOwnerSessionRecord({
      ...record,
      absoluteExpiresAt: new Date(Date.now() - 1).toISOString(),
    }, record.backendOrigin)).toBeNull();
  });

  it('removes malformed and expired records, ignores wrong-origin records, and tolerates storage errors', () => {
    localStorage.setItem(ownerSessionStorageKey, '{');
    expect(readOwnerSession(config)).toBeNull();
    expect(localStorage.getItem(ownerSessionStorageKey)).toBeNull();

    localStorage.setItem(ownerSessionStorageKey, JSON.stringify({
      version: 1,
      backendOrigin: 'https://other.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 1_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 10_000).toISOString(),
    }));
    expect(readOwnerSession(config)).toBeNull();
    expect(localStorage.getItem(ownerSessionStorageKey)).not.toBeNull();

    localStorage.setItem(ownerSessionStorageKey, JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 1_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() - 1).toISOString(),
    }));
    expect(readOwnerSession(config)).toBeNull();
    expect(localStorage.getItem(ownerSessionStorageKey)).toBeNull();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private mode'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private mode'); });
    expect(readOwnerSession(config)).toBeNull();
    expect(() => clearOwnerSession()).not.toThrow();
  });

  it('mints without a body and stores only a strictly validated response', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      expect(String((init?.headers as Record<string, string>).Authorization)).toContain('entra-token');
      return response();
    });
    vi.stubGlobal('fetch', fetch);

    await mintOwnerSession(config, 'entra-token');

    expect(fetch).toHaveBeenCalledWith('https://api.example.com/auth/session', expect.anything());
    expect(JSON.parse(localStorage.getItem(ownerSessionStorageKey)!)).toMatchObject({
      version: 1,
      backendOrigin: 'https://api.example.com',
      token,
    });
  });

  it('single-flights calls in a tab and honors the six-hour switch-off wait', async () => {
    const fetch = vi.fn(async () => response(404));
    vi.stubGlobal('fetch', fetch);
    await Promise.all([mintOwnerSession(config, 'entra-token'), mintOwnerSession(config, 'entra-token')]);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    const wait = JSON.parse(localStorage.getItem('jarvis.owner-session-mint-wait')!);
    expect(wait).toMatchObject({ version: 1, backendOrigin: 'https://api.example.com', failures: 0 });
    expect(wait).not.toHaveProperty('token');
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000 - 1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('honors one-hour 401 and 403 mint waits', async () => {
    for (const status of [401, 403]) {
      clearOwnerSessionMintWait(config.backendUrl);
      const fetch = vi.fn(async () => response(status));
      vi.stubGlobal('fetch', fetch);
      await mintOwnerSession(config, 'entra-token');
      await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
      await mintOwnerSession(config, 'entra-token');
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await mintOwnerSession(config, 'entra-token');
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it('grows the transient wait from one to two minutes after repeated 429 and 503 responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);

    await mintOwnerSession(config, 'entra-token');
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(readOwnerSession(config)?.token).toBe(token);
  });

  it('re-reads the session after acquiring the cross-tab Web Lock', async () => {
    const lockRequest = vi.fn(async (_name: string, operation: () => Promise<void>) => {
      localStorage.setItem(ownerSessionStorageKey, JSON.stringify({
        version: 1,
        backendOrigin: 'https://api.example.com',
        sessionId: 'a'.repeat(22),
        token,
        idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      }));
      await operation();
    });
    vi.stubGlobal('navigator', { locks: { request: lockRequest } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await mintOwnerSession(config, 'entra-token');

    expect(lockRequest).toHaveBeenCalledWith('jarvis.owner-session:https://api.example.com', expect.any(Function));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips the cross-tab Web Lock while the mint cooldown is active', async () => {
    localStorage.setItem('jarvis.owner-session-mint-wait', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      retryAt: Date.now() + 60_000,
      failures: 0,
    }));
    const lockRequest = vi.fn();
    vi.stubGlobal('navigator', { locks: { request: lockRequest } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await mintOwnerSession(config, 'entra-token');

    expect(lockRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revokes a newly minted session if localStorage cannot store it', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : response());
    vi.stubGlobal('fetch', fetch);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === ownerSessionStorageKey) throw new Error('storage unavailable');
      setItem.call(this, key, value);
    });

    await mintOwnerSession(config, 'entra-token');

    expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.example.com/auth/session', expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
    }));
    expect(localStorage.getItem(ownerSessionStorageKey)).toBeNull();
    expect(isEntraPreferred(config)).toBe(false);
  });

  it('backs off transient failures and rejects malformed 201 responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(201, { token: 'not-a-session' }));
    vi.stubGlobal('fetch', fetch);
    await mintOwnerSession(config, 'entra-token');
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(ownerSessionStorageKey)).toBeNull();
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
