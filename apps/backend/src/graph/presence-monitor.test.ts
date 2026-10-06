import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseObservedPresence, startGraphPresenceMonitor } from './presence-monitor.js';
import type { GraphClient } from './client.js';
import type { AwayModeStore } from '../core/away-mode.js';
import { createGraphClient } from './client.js';

describe('Teams presence monitoring', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['Away', 'away'],
    ['Offline', 'away'],
    ['Available', 'present'],
    ['Busy', 'present'],
    ['PresenceUnknown', null],
  ] as const)('maps Graph %s to %s', (availability, expected) => {
    expect(parseObservedPresence({ availability })).toBe(expected);
  });

  it.each([null, {}, { availability: 'UnknownStatus' }])('rejects invalid Graph presence %j', (value) => {
    expect(() => parseObservedPresence(value)).toThrow('presence response was invalid');
  });

  it('polls immediately, serializes checks and aborts its active request on stop', async () => {
    vi.useFakeTimers();
    let requestSignal!: AbortSignal;
    let requestPath = '';
    const get = vi.fn((path: string, signal: AbortSignal) => {
      requestPath = path;
      requestSignal = signal;
      return new Promise<unknown>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const graph: GraphClient = { get, post: vi.fn() };
    const store = { observePresence: vi.fn(async () => ({ away: false })) } as unknown as AwayModeStore;
    const stop = startGraphPresenceMonitor(
      true, graph, '11111111-1111-4111-8111-111111111111', store, vi.fn(), vi.fn(), 60_000,
    );
    expect(get).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledOnce();
    await stop();
    expect(requestPath).toBe('users/11111111-1111-4111-8111-111111111111/presence');
    expect(requestSignal.aborted).toBe(true);
    expect(store.observePresence).not.toHaveBeenCalled();
  });

  it('stops polling on 403, reports unavailability once, and retries after a day', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response('private provider body', { status: 403 }));
    const graph = createGraphClient({
      getToken: async () => 'private-token',
      fetcher,
    });
    const store = { observePresence: vi.fn() } as unknown as AwayModeStore;
    const onError = vi.fn();
    const onAvailabilityChange = vi.fn();
    const stop = startGraphPresenceMonitor(
      true, graph, '11111111-1111-4111-8111-111111111111', store, onError, onAvailabilityChange,
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).not.toHaveBeenCalled();
      expect(onAvailabilityChange).toHaveBeenCalledExactlyOnceWith(true, 403);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(onAvailabilityChange).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(onAvailabilityChange).toHaveBeenCalledOnce();
      expect(store.observePresence).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });

  it('does not start when presence monitoring is disabled', async () => {
    const graph: GraphClient = { get: vi.fn(), post: vi.fn() };
    const store = { observePresence: vi.fn() } as unknown as AwayModeStore;
    const stop = startGraphPresenceMonitor(
      false, graph, '11111111-1111-4111-8111-111111111111', store, vi.fn(), vi.fn(),
    );
    await stop();
    expect(graph.get).not.toHaveBeenCalled();
    expect(store.observePresence).not.toHaveBeenCalled();
  });

  it('recovers the status when a daily retry succeeds', async () => {
    vi.useFakeTimers();
    const graph: GraphClient = {
      get: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }))
        .mockResolvedValue({ availability: 'Available' }),
      post: vi.fn(),
    };
    const store = { observePresence: vi.fn(async () => ({ away: false })) } as unknown as AwayModeStore;
    const onAvailabilityChange = vi.fn();
    const stop = startGraphPresenceMonitor(
      true, graph, '11111111-1111-4111-8111-111111111111', store, vi.fn(), onAvailabilityChange,
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(onAvailabilityChange.mock.calls).toEqual([[true, 403], [false]]);
      expect(store.observePresence).toHaveBeenCalledOnce();
    } finally {
      await stop();
    }
  });
});
