import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CredentialStatusStore } from './credential-status.js';
import { checkCopilotStatus, startDailyCopilotStatusJob } from './copilot-status.js';

function fixture(status = 200, expiresAt: string | null = null) {
  const updateCopilotStatus = vi.fn<CredentialStatusStore['updateCopilotStatus']>();
  const store = { updateCopilotStatus } as unknown as CredentialStatusStore;
  const options = {
    getSecret: vi.fn(async () => ({
      value: 'test-seat-credential', expiresAt, lastRenewedAt: '2026-10-01T00:00:00.000Z',
    })),
    fetch: vi.fn<typeof fetch>(async () => new Response('', { status })),
    now: () => Date.parse('2026-10-06T00:00:00.000Z'),
  };
  return { store, options, updateCopilotStatus };
}

afterEach(() => { vi.useRealTimers(); });

describe('Copilot credential health', () => {
  it.each([
    [200, null, 'ok'],
    [200, '2026-11-01T00:00:00.000Z', 'ok'],
    [200, '2026-10-09T00:00:00.000Z', 'renew_soon'],
    [200, '2026-10-06T00:00:00.000Z', 'failed'],
    [401, null, 'failed'],
    [403, null, 'failed'],
  ] as const)('records health for HTTP %s with expiry %s', async (httpStatus, expiry, status) => {
    const { store, options, updateCopilotStatus } = fixture(httpStatus, expiry);
    await checkCopilotStatus(store, options);
    expect(updateCopilotStatus).toHaveBeenCalledWith(status, expiry, '2026-10-01T00:00:00.000Z');
    expect(options.fetch).toHaveBeenCalledWith('https://api.github.com/user', expect.objectContaining({
      redirect: 'error', signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(updateCopilotStatus.mock.calls)).not.toContain('test-seat-credential');
  });

  it.each([429, 500])('preserves known health on transient HTTP %s', async (status) => {
    const { store, options, updateCopilotStatus } = fixture(status);
    await expect(checkCopilotStatus(store, options)).rejects.toThrow('check unavailable');
    expect(updateCopilotStatus).not.toHaveBeenCalled();
  });

  it.each([{ 'x-ratelimit-remaining': '0' }, { 'retry-after': '60' }])(
    'does not mistake a GitHub 403 rate limit for invalid credentials', async (headers) => {
      const { store, options, updateCopilotStatus } = fixture();
      options.fetch.mockResolvedValue(new Response('', { status: 403, headers }));
      await expect(checkCopilotStatus(store, options)).rejects.toThrow('check unavailable');
      expect(updateCopilotStatus).not.toHaveBeenCalled();
    },
  );

  it('preserves state on transport errors and reports no provider details', async () => {
    const { store, options, updateCopilotStatus } = fixture();
    options.fetch.mockRejectedValue(new Error('private-provider-detail'));
    const onError = vi.fn();
    const stop = startDailyCopilotStatusJob(store, options, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith());
    stop();
    expect(updateCopilotStatus).not.toHaveBeenCalled();
  });

  it('checks on readiness and daily without overlapping runs, and stops on close', async () => {
    vi.useFakeTimers();
    const { store, options } = fixture();
    const stop = startDailyCopilotStatusJob(store, options, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(options.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(options.fetch).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(options.fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
