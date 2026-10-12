import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspacePinsClient } from './workspace-pins';

const view = {
  version: 1 as const,
  title: 'Pinned report',
  renderer: 'text' as const,
  source: { id: 'research' as const, status: 'complete' as const },
  data: { format: 'plain' as const, content: 'Saved result' },
};
const pin = { viewId: 'saved-report', view, pinnedAt: '2026-10-10T08:00:00.000Z' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('workspace pins client', () => {
  it.each([408, 502, 503, 504])('recovers a temporary %i pin-read failure before exposing an error', async status => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, status)).mockResolvedValueOnce(json({ pins: [pin] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = createWorkspacePinsClient('https://api.example.com', async () => 'token').load();
    const assertion = expect(result).resolves.toEqual([pin]);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds network retries and leaves persistent failures visible', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(createWorkspacePinsClient('https://api.example.com', async () => 'token').load())
      .rejects.toThrow('Pinned windows could not be loaded');
    await vi.advanceTimersByTimeAsync(1_500);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not hide silent-token failures behind a generic storage error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createWorkspacePinsClient('https://api.example.com', async () => { throw new Error('Token renewal failed'); });
    await expect(client.load()).rejects.toThrow('Microsoft sign-in needs attention');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])('never retries an HTTP %i permission refusal', async status => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, status));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createWorkspacePinsClient('https://api.example.com', async () => 'token').load())
      .rejects.toThrow('Microsoft sign-in needs attention');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cancels a pending recovery instead of making another request after unmount', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(json({}, 503));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const result = createWorkspacePinsClient('https://api.example.com', async () => 'token').load(controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('loads, saves and removes pins through authenticated owner routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ pins: [pin] }))
      .mockResolvedValueOnce(json({ pin }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createWorkspacePinsClient('https://api.example.com/', async () => 'token');

    await expect(client.load()).resolves.toEqual([pin]);
    await expect(client.pin('saved-report', view)).resolves.toEqual(pin);
    await expect(client.unpin('saved-report')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('Authorization'),
    }))).toEqual([
      { url: 'https://api.example.com/workspace/pins', method: 'GET', authorization: 'Bearer token' },
      { url: 'https://api.example.com/workspace/pins/saved-report', method: 'PUT', authorization: 'Bearer token' },
      { url: 'https://api.example.com/workspace/pins/saved-report', method: 'DELETE', authorization: 'Bearer token' },
    ]);
  });

  it('explains the pin limit and rejects malformed responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 'full' }, 409))
      .mockResolvedValueOnce(json({ pins: [{ ...pin, viewId: '1-invalid' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createWorkspacePinsClient('https://api.example.com', async () => 'token');

    await expect(client.pin('saved-report', view)).rejects.toThrow('20 pinned windows');
    await expect(client.load()).rejects.toThrow('could not be shown safely');
  });

  it('treats an already-removed pin as converged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'missing' }, 404)));
    const client = createWorkspacePinsClient('https://api.example.com', async () => 'token');
    await expect(client.unpin('saved-report')).resolves.toBeUndefined();
  });

  it('retains the validated private-image host so restored views can render safely', async () => {
    const imagePin = { ...pin, view: {
      ...view, renderer: 'image', data: { images: [{ url: 'https://jarvisimages.blob.core.windows.net/images/result.png?sv=test', alt: 'Saved image' }] },
    } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pins: [imagePin] })));
    const client = createWorkspacePinsClient('https://api.example.com', async () => 'token');
    await expect(client.load()).resolves.toEqual([{ ...imagePin, trustedBlobHost: 'jarvisimages.blob.core.windows.net' }]);
  });

  it('refuses unsafe images and a pin response for another view', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ pins: [{ ...pin, view: {
        ...view, renderer: 'image', data: { images: [{ url: 'https://untrusted.example.com/result.png', alt: 'Unsafe image' }] },
      } }] }))
      .mockResolvedValueOnce(json({ pin: { ...pin, viewId: 'different-report' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createWorkspacePinsClient('https://api.example.com', async () => 'token');
    await expect(client.load()).rejects.toThrow('could not be shown safely');
    await expect(client.pin(pin.viewId, view)).rejects.toThrow('could not be shown safely');
  });

  it('cancels token acquisition without sending a write after the owner has gone', async () => {
    let releaseToken!: (token: string) => void;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const token = new Promise<string>((resolve) => { releaseToken = resolve; });
    const client = createWorkspacePinsClient('https://api.example.com', () => token);
    const controller = new AbortController();
    const result = client.pin(pin.viewId, view, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow('could not be pinned');
    releaseToken('token');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
