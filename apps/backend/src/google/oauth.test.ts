import { describe, expect, it, vi } from 'vitest';
import { createGoogleTokenProvider, GoogleOAuthError } from './oauth.js';

describe('Google OAuth token provider', () => {
  it('refreshes once, caches the short-lived access token, then refreshes it when expired', async () => {
    let now = 1_000;
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: 3600 }));
    });
    const provider = createGoogleTokenProvider({
      getCredentials: async () => ({
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        refreshToken: 'fixture-refresh',
      }),
      onInvalidGrant: async () => {},
      fetch: fetcher,
      now: () => now,
    });
    const signal = new AbortController().signal;

    await expect(provider.getToken(signal)).resolves.toBe('token-1');
    await expect(provider.getToken(signal)).resolves.toBe('token-1');
    expect(fetcher).toHaveBeenCalledOnce();
    now += 3_600_000;
    await expect(provider.getToken(signal)).resolves.toBe('token-2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).get('grant_type')).toBe('refresh_token');
  });

  it('raises a visible invalid-grant error and calls the expiry alert callback', async () => {
    const alert = vi.fn(async () => {});
    const provider = createGoogleTokenProvider({
      getCredentials: async () => ({
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        refreshToken: 'fixture-refresh',
      }),
      onInvalidGrant: alert,
      fetch: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    });

    await expect(provider.getToken(new AbortController().signal))
      .rejects.toBeInstanceOf(GoogleOAuthError);
    expect(alert).toHaveBeenCalledOnce();
  });

  it('does not let one cancelled caller cancel another caller’s shared refresh', async () => {
    let completeRefresh: (response: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { completeRefresh = resolve; }));
    const provider = createGoogleTokenProvider({
      getCredentials: async () => ({
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        refreshToken: 'fixture-refresh',
      }),
      onInvalidGrant: async () => {},
      fetch: fetcher,
    });
    const cancelled = new AbortController();
    const active = new AbortController();
    const cancelledRequest = provider.getToken(cancelled.signal);
    const activeRequest = provider.getToken(active.signal);
    cancelled.abort();

    await expect(cancelledRequest).rejects.toHaveProperty('name', 'AbortError');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    completeRefresh(new Response(JSON.stringify({ access_token: 'shared-token', expires_in: 3600 })));
    await expect(activeRequest).resolves.toBe('shared-token');
  });
});
