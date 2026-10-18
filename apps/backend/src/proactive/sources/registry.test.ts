import { describe, expect, it } from 'vitest';
import { buildSourceRegistry } from './registry.js';
import { defaultProactiveSettings } from '../store.js';

describe('proactive source registry', () => {
  it('registers the news source alphabetically and keeps X as a non-throwing placeholder', async () => {
    const sources = buildSourceRegistry({});
    expect(sources.map(({ id }) => id)).toEqual(['news', 'x']);
    const source = sources.find(({ id }) => id === 'x')!;
    const result = await source.read({
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
