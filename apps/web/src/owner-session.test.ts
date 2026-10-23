import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import {
  clearOwnerSession,
  clearOwnerSessionMintWait,
  mintOwnerSession,
  ownerSessionStorageKey,
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  clearOwnerSessionMintWait(config.backendUrl);
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

  it('removes malformed, expired, and wrong-origin records, but falls back if storage throws', () => {
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
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000 - 1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await mintOwnerSession(config, 'entra-token');
    expect(fetch).toHaveBeenCalledTimes(2);
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
