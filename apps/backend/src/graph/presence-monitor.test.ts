import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseObservedPresence, startGraphPresenceMonitor } from './presence-monitor.js';
import type { GraphClient } from './client.js';
import type { AwayModeStore } from '../core/away-mode.js';
import { createGraphClient } from './client.js';
import { safeErrorFields } from '../logging.js';

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
      graph, '11111111-1111-4111-8111-111111111111', store, vi.fn(), 60_000,
    );
    expect(get).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledOnce();
    await stop();
    expect(requestPath).toBe('users/11111111-1111-4111-8111-111111111111/presence');
    expect(requestSignal.aborted).toBe(true);
    expect(store.observePresence).not.toHaveBeenCalled();
  });

  it('passes safe Graph failure diagnostics through each presence poll', async () => {
    vi.useFakeTimers();
    const graph = createGraphClient({
      getToken: async () => 'private-token',
      fetcher: vi.fn(async () => new Response('private provider body', { status: 403 })),
    });
    const store = { observePresence: vi.fn() } as unknown as AwayModeStore;
    const onError = vi.fn();
    const stop = startGraphPresenceMonitor(graph, '11111111-1111-4111-8111-111111111111', store, onError);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledOnce();
      expect(safeErrorFields(onError.mock.calls[0]![0])).toEqual({ kind: 'http', statusCode: 403 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(store.observePresence).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });
});
