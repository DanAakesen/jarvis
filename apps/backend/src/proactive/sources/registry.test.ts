import { describe, expect, it } from 'vitest';
import { buildSourceRegistry } from './registry.js';
import { defaultProactiveSettings } from '../store.js';

describe('proactive source registry', () => {
  it('registers the sources alphabetically and keeps X as a non-throwing placeholder', async () => {
    const sources = buildSourceRegistry({});
    expect(sources.map(({ id }) => id)).toEqual(['calendar', 'factory', 'mail', 'news', 'todos', 'travel', 'weather', 'x']);
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

  it('reports unavailable when a source dependency is not connected', async () => {
    const sources = buildSourceRegistry({});
    const context = {
      now: new Date('2026-10-20T05:00:00.000Z'),
      signal: new AbortController().signal,
      settings: defaultProactiveSettings(),
    };
    for (const id of ['calendar', 'factory', 'mail', 'todos', 'travel', 'weather'] as const) {
      await expect(sources.find((source) => source.id === id)!.read(context)).resolves.toMatchObject({
        source: id,
        state: 'unavailable',
        reason: 'not_connected',
        facts: [],
      });
    }
  });
});
