import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceCredentialCache } from './credential-cache.js';

function token(expiry: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp: expiry / 1_000 })).toString('base64url')}.signature`;
}

describe('voice credential cache', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shares an in-flight credential fetch and refreshes ahead of expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    let calls = 0;
    const getToken = vi.fn(async () => {
      calls += 1;
      return token(Date.now() + 60 * 60_000);
    });
    const cache = createVoiceCredentialCache(getToken, 'voice', vi.fn());
    const controller = new AbortController();

    const first = cache.get(controller.signal);
    const second = cache.get(controller.signal);
    await expect(Promise.all([first, second])).resolves.toEqual([
      token(Date.now() + 60 * 60_000),
      token(Date.now() + 60 * 60_000),
    ]);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(55 * 60_000);
    expect(calls).toBe(2);
  });

  it('reports a failed warm-up and can recover on the next request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    const failure = new Error('identity unavailable');
    const onRefreshError = vi.fn();
    const getToken = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(token(Date.now() + 60 * 60_000));
    const cache = createVoiceCredentialCache(getToken, 'voice', onRefreshError);
    cache.warm();
    await vi.advanceTimersByTimeAsync(0);

    expect(onRefreshError).toHaveBeenCalledWith(failure);
    await expect(cache.get(new AbortController().signal))
      .resolves.toBe(token(Date.now() + 60 * 60_000));
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
