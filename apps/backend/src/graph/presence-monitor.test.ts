import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseObservedPresence, startGraphPresenceMonitor } from './presence-monitor.js';
import type { GraphClient } from './client.js';
import type { AwayModeStore } from '../core/away-mode.js';

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
    let finish!: (value: unknown) => void;
    const get = vi.fn((_path: string, _signal: AbortSignal) => new Promise<unknown>((resolve) => { finish = resolve; }));
    const graph: GraphClient = { get, post: vi.fn() };
    const store = { observePresence: vi.fn(async () => ({ away: false })) } as unknown as AwayModeStore;
    const stop = startGraphPresenceMonitor(
      graph, '11111111-1111-4111-8111-111111111111', store, vi.fn(), 60_000,
    );
    expect(get).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledOnce();
    finish({ availability: 'Away' });
    await vi.waitFor(() => expect(store.observePresence).toHaveBeenCalledWith(true));
    await stop();
  });
});
