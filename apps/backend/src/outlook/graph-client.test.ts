import { describe, expect, it, vi } from 'vitest';
import { createGraphClient, GraphClientError } from './graph-client.js';

const active = () => new AbortController().signal;

describe('Microsoft Graph client', () => {
  it('uses a backend token and pins requests to the Graph API host', async () => {
    const getToken = vi.fn(async (scope: string) => {
      expect(scope).toBe('https://graph.microsoft.com/.default');
      return 'fixture-token';
    });
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new URL(input.toString()).origin).toBe('https://graph.microsoft.com');
      expect(new Headers(init?.headers).get('authorization')).toBe(['Bea', 'rer ', 'fixture-token'].join(''));
      expect(init?.redirect).toBe('error');
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const graph = createGraphClient({ getToken, fetch: fetcher });

    await expect(graph.request('/v1.0/users/owner/messages', { signal: active() }))
      .resolves.toEqual({ value: [] });
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(graph.request('https://example.com/v1.0/users/owner', { signal: active() }))
      .rejects.toBeInstanceOf(GraphClientError);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retries only safe reads when Graph supplies a short Retry-After', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }));
    const graph = createGraphClient({ getToken: async () => 'fixture-token', fetch: fetcher });

    await expect(graph.request('/v1.0/users/owner/events', { signal: active() })).resolves.toEqual({ value: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }));
    await expect(graph.request('/v1.0/users/owner/sendMail', {
      method: 'POST',
      body: { message: {} },
      signal: active(),
    })).rejects.toMatchObject({ kind: 'throttled' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns sanitized errors and rejects oversized provider responses', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('private error details', { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 'x'.repeat(1_100_000) }), { status: 200 }));
    const graph = createGraphClient({ getToken: async () => 'fixture-token', fetch: fetcher });

    await expect(graph.request('/v1.0/users/owner/messages', { signal: active() }))
      .rejects.toMatchObject({ kind: 'forbidden', message: 'Microsoft Graph request failed' });
    await expect(graph.request('/v1.0/users/owner/messages', { signal: active() }))
      .rejects.toMatchObject({ kind: 'unavailable', message: 'Microsoft Graph request failed' });
  });
});
