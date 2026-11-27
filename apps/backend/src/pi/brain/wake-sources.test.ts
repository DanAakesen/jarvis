import { describe, expect, it, vi } from 'vitest';
import { readWakeSources } from './wake-sources.js';
import { createXSource } from '../../proactive/sources/x.js';
import { defaultProactiveSettings } from '../../proactive/store.js';
import { contextOnlyReason } from '../../proactive/events/types.js';
import { createTodosSource } from '../../proactive/sources/todos.js';
import type { SourceContext } from '../../proactive/types.js';

function context(): SourceContext {
  const settings = defaultProactiveSettings();
  settings.sources.x = true;
  return { now: new Date('2026-11-27T09:00Z'), settings, signal: AbortSignal.timeout(5_000), admittedWake: true };
}
function file(path: string, content: string) { return { path, sha: 'a'.repeat(40), content }; }

describe('sources on an admitted review', () => {
  it('includes active-vault tasks and current priorities only when their switches allow it', async () => {
    const ctx = context();
    const path = 'General/Workshop.md';
    const vault = { tree: async () => [{ path, sha: 'a'.repeat(40), size: 90 }],
      read: vi.fn(async (name: string) => name === 'p0.md' ? file(name, 'Workshop on Tuesday') : file(path, '- [ ] Print slides')) };
    const tasks = createTodosSource(vault, true);
    const result = (await readWakeSources([tasks], ctx, vault)).join(' ');
    expect(result).toContain('Workshop on Tuesday');
    expect(result).toContain('Print slides');
    ctx.settings.sources.notes = false;
    expect((await readWakeSources([tasks], ctx, vault)).join(' ')).not.toContain('Workshop on Tuesday');
    ctx.settings.sources.todos = false;
    expect(await readWakeSources([tasks], ctx, vault)).toEqual([]);
    for (const source of ['notes', 'todos', 'x']) expect(contextOnlyReason({ source, kind: 'observation.changed' })).toBeTruthy();
    expect(contextOnlyReason({ source: 'reminder', kind: 'reminder.delivery_failed' })).toBeUndefined();
  });

  it('sends only the explicit search, shares concurrent reads and never searches on polling or when disabled', async () => {
    const query = '(from:Example OR "product news") -is:retweet';
    const vault = { read: async (path: string) => file(path, 'Private unrelated text\nquery: ' + query) };
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain('https://api.x.com/2/tweets/search/recent?');
      return Response.json({
        meta: { result_count: 1 }, data: [{ id: '123', text: 'A release', created_at: '2026-11-26T10:00Z' }],
      });
    });
    const source = createXSource('test-token', vault, fetcher);
    const ctx = context();
    expect((await source.read({ ...ctx, admittedWake: false })).facts).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const [one, two] = await Promise.all([source.read(ctx), source.read(ctx)]);
    expect(one.facts[0]?.ref).toBe('x:post:123');
    expect(two).toEqual(one);
    expect((await source.read({ ...ctx, admittedWake: false })).facts).toEqual(one.facts);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0]![0] as URL).searchParams.get('query')).toBe(query);
    ctx.settings.sources.x = false;
    expect((await source.read(ctx)).facts).toEqual([]);
    expect(await readWakeSources([source], { ...ctx, admittedWake: false })).toEqual([]);
  });

  it('returns the provider failure and reuses it during the cooldown', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    const source = createXSource('test-token', { read: async path => file(path, 'query: football') }, fetcher);
    const ctx = context();
    for (let i = 0; i < 2; i++) expect((await source.read(ctx)).reason).toBe('rate_limited');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
