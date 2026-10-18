import { describe, expect, it } from 'vitest';
import { buildSourceRegistry } from './registry.js';
import { defaultProactiveSettings } from '../store.js';

describe('proactive source registry', () => {
  it('keeps X as a non-throwing provider placeholder', async () => {
    const [source] = buildSourceRegistry({});
    expect(source?.id).toBe('x');
    const result = await source!.read({
      now: new Date('2026-10-20T05:00:00.000Z'),
      signal: new AbortController().signal,
      settings: defaultProactiveSettings(),
    });
    expect(result).toEqual({
      source: 'x',
      state: 'unavailable',
      reason: 'no_provider',
      facts: [],
      observedAt: '2026-10-20T05:00:00.000Z',
    });
  });
});
