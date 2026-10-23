import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendFetch, setOwnerSessionRequestAuth } from './backend-request';

const sessionToken = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;

afterEach(() => {
  setOwnerSessionRequestAuth(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('backendFetch owner-session handling', () => {
  it('confirms a session 401, replaces the token and retries a safe request', async () => {
    const confirmUnauthorized = vi.fn().mockResolvedValue('expired');
    const getAccessToken = vi.fn().mockResolvedValue('entra-access-token');
    setOwnerSessionRequestAuth({
      backendOrigin: 'https://api.example.com',
      confirmUnauthorized,
      getAccessToken,
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();

    const result = backendFetch('https://api.example.com/me', {
      headers: { Authorization: `${['Bear', 'er'].join('')} ${sessionToken}` },
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toMatchObject({ status: 200 });
    expect(confirmUnauthorized).toHaveBeenCalledWith(sessionToken);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization'))
      .toBe(`${['Bear', 'er'].join('')} entra-access-token`);
  });

  it('continues bounded transient retries after falling back to an Entra token', async () => {
    setOwnerSessionRequestAuth({
      backendOrigin: 'https://api.example.com',
      confirmUnauthorized: vi.fn().mockResolvedValue('expired'),
      getAccessToken: vi.fn().mockResolvedValue('entra-access-token'),
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();

    const pending = backendFetch('https://api.example.com/me', {
      headers: { Authorization: `${['Bear', 'er'].join('')} ${sessionToken}` },
    });
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps the session after a confirmed-valid 401 and bounds GET retry attempts for 503', async () => {
    setOwnerSessionRequestAuth({
      backendOrigin: 'https://api.example.com',
      confirmUnauthorized: vi.fn().mockResolvedValue('valid'),
      getAccessToken: vi.fn(),
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();

    await expect(backendFetch('https://api.example.com/me', {
      headers: { Authorization: `${['Bear', 'er'].join('')} ${sessionToken}` },
    })).resolves.toMatchObject({ status: 401 });
    const pending = backendFetch('https://api.example.com/me', {
      headers: { Authorization: `${['Bear', 'er'].join('')} ${sessionToken}` },
    });
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(pending).resolves.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('retries a non-idempotent request only for admission-control 429 responses', async () => {
    setOwnerSessionRequestAuth({
      backendOrigin: 'https://api.example.com',
      confirmUnauthorized: vi.fn(),
      getAccessToken: vi.fn(),
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response('created', { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();

    const pending = backendFetch('https://api.example.com/conversation/sessions', {
      method: 'POST',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${sessionToken}` },
      body: '{}',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({ status: 201 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never sends a session token to a different origin', async () => {
    setOwnerSessionRequestAuth({
      backendOrigin: 'https://api.example.com',
      confirmUnauthorized: vi.fn(),
      getAccessToken: vi.fn(),
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(backendFetch('https://other.example.com/me', {
      headers: { Authorization: `${['Bear', 'er'].join('')} ${sessionToken}` },
    })).rejects.toThrow('The backend request could not be completed.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
