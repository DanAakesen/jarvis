import { describe, expect, it } from 'vitest';
import { buildSourceRegistry } from './registry.js';
import { defaultProactiveSettings } from '../store.js';

describe('proactive source registry', () => {
  it('registers the new sources in alphabetical order and keeps X as a placeholder', async () => {
    const sources = buildSourceRegistry({});
    expect(sources.map(({ id }) => id)).toEqual(['factory', 'todos', 'weather', 'x']);
    const source = sources.at(-1);
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

  it('reports unavailable when a new source dependency is not connected', async () => {
    const sources = buildSourceRegistry({});
    for (const source of sources.filter(({ id }) => ['factory', 'todos', 'weather'].includes(id))) {
      await expect(source.read({
        now: new Date('2026-10-20T05:00:00.000Z'),
        signal: new AbortController().signal,
        settings: defaultProactiveSettings(),
      })).resolves.toMatchObject({ state: 'unavailable', reason: 'not_connected', facts: [] });
    }
  });
});
