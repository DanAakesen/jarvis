import { describe, expect, it, vi } from 'vitest';
import { createGraphClient } from './client.js';

const authorizationScheme = 'Bearer';

describe('Microsoft Graph client', () => {
  it('uses a backend token, limits response size, and parses JSON', async () => {
    const signal = new AbortController().signal;
    const getToken = vi.fn(async () => 'private-token');
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.href).toBe('https://graph.microsoft.com/v1.0/users/owner/drive');
      expect(init.signal).toBe(signal);
      expect(new Headers(init.headers).get('authorization')).toBe(`${authorizationScheme} private-token`);
      return new Response('{"id":"drive"}', { headers: { 'content-type': 'application/json' } });
    });
    const client = createGraphClient({ getToken, fetcher });

    await expect(client.get('users/owner/drive', signal)).resolves.toEqual({ id: 'drive' });
    expect(getToken).toHaveBeenCalledWith(signal);
  });

  it('does not expose Graph responses or credential errors', async () => {
    const signal = new AbortController().signal;
    const client = createGraphClient({
      getToken: async () => { throw new Error('token secret'); },
      fetcher: vi.fn(),
    });

    await expect(client.get('users/owner/drive', signal))
      .rejects.toThrow('Microsoft Graph credentials are unavailable');
    await expect(client.get('users/owner/drive', signal)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('rejects non-Graph destinations and failed requests without provider details', async () => {
    const signal = new AbortController().signal;
    const client = createGraphClient({
      getToken: async () => 'private-token',
      fetcher: vi.fn(async () => new Response('private provider error', { status: 403 })),
    });

    await expect(client.get('https://example.com/private', signal)).rejects.toThrow('Invalid Microsoft Graph request path');
    await expect(client.get('users/owner/drive', signal)).rejects.toThrow('Microsoft Graph request failed');
    await expect(client.get('users/owner/drive', signal)).rejects.toMatchObject({ kind: 'http', statusCode: 403 });
  });

  it.each([
    { reason: undefined, kind: 'transport' },
    { reason: new DOMException('private error', 'AbortError'), kind: 'aborted' },
    { reason: new DOMException('private error', 'TimeoutError'), kind: 'timeout' },
  ])('preserves the safe $kind diagnostic when fetching fails', async ({ reason, kind }) => {
    const controller = new AbortController();
    if (reason) controller.abort(reason);
    const client = createGraphClient({
      getToken: async () => 'private-token',
      fetcher: vi.fn(async () => { throw new Error('private provider error'); }),
    });
    const error = await client.get('users/owner/drive', controller.signal).catch((error: unknown) => error);
    expect(error).toMatchObject({ message: 'Microsoft Graph request failed', kind });
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('rejects oversized responses', async () => {
    const signal = new AbortController().signal;
    const client = createGraphClient({
      getToken: async () => 'private-token',
      fetcher: vi.fn(async () => new Response('x'.repeat(513 * 1024))),
    });

    await expect(client.get('users/owner/drive', signal)).rejects.toThrow('Microsoft Graph response exceeded the size limit');
  });
});
