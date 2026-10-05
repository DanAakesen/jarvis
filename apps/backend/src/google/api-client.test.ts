import { describe, expect, it, vi } from 'vitest';
import { createGoogleApiClient, GoogleApiError } from './api-client.js';
import { GoogleOAuthError } from './oauth.js';

describe('Google API client', () => {
  it('uses a backend access token and pins calls to the selected Google API host', async () => {
    const getToken = vi.fn(async () => 'fixture-token');
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new URL(input.toString()).origin).toBe('https://www.googleapis.com');
      expect(new URL(input.toString()).pathname).toBe('/calendar/v3/calendars/primary/events');
      expect(new Headers(init?.headers).get('authorization')).toBe(['Bea', 'rer ', 'fixture-token'].join(''));
      expect(init?.redirect).toBe('error');
      return new Response(JSON.stringify({ items: [] }));
    });
    const google = createGoogleApiClient({ tokens: { getToken }, fetch: fetcher });

    await expect(google.request('calendar', '/calendars/primary/events', {
      signal: new AbortController().signal,
    })).resolves.toEqual({ items: [] });
    expect(getToken).toHaveBeenCalledOnce();
    await expect(google.request('calendar', 'https://example.com/events', {
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(GoogleApiError);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('classifies uncertain writes and sanitizes provider errors', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('private provider detail', { status: 403 }))
      .mockRejectedValueOnce(new Error('network unavailable'));
    const google = createGoogleApiClient({
      tokens: { getToken: async () => 'fixture-token' },
      fetch: fetcher,
    });
    const options = { signal: new AbortController().signal };

    await expect(google.request('gmail', '/users/me/messages', options))
      .rejects.toMatchObject({ kind: 'forbidden', message: 'Google API request failed' });
    await expect(google.request('gmail', '/users/me/messages/send', { ...options, method: 'POST', body: {} }))
      .rejects.toMatchObject({ kind: 'uncertain' });
  });

  it('turns a rejected refresh token into a credential-expiry result', async () => {
    const google = createGoogleApiClient({
      tokens: {
        getToken: async () => { throw new GoogleOAuthError('invalid-grant'); },
      },
    });
    await expect(google.request('gmail', '/users/me/messages', {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ kind: 'credentials-expired' });
  });
});
