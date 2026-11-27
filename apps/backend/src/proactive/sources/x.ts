import type { createGitHubVaultClient } from '../../vault/github-client.js';
import { hasCredentialMarker } from '../../core/memory-policy.js';
import type { ProactiveSource, SourceContext, SourceFact, SourceResult } from '../types.js';
import { readBoundedJson } from './bounded-json.js';
import { cleanSourceText } from './shared.js';

type Reader = Pick<ReturnType<typeof createGitHubVaultClient>, 'read'>;
const reuseMs = 60 * 60_000;

export function createXSource(token?: string, vault?: Reader, fetcher: typeof fetch = fetch): ProactiveSource {
  let cache: { query: string; at: number; result: Promise<SourceResult> } | undefined;

  const unavailable = (now: Date, reason: string): SourceResult => ({
    source: 'x', state: 'unavailable', observedAt: now.toISOString(), reason, facts: [],
  });

  async function search(query: string, { now, signal }: SourceContext): Promise<SourceResult> {
    const url = new URL('https://api.x.com/2/tweets/search/recent');
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', '10');
    url.searchParams.set('tweet.fields', 'created_at');
    try {
      const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
        headers: { authorization: `Bearer ${token}` }, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        const reason = response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) ? 'not_authorised' : 'read_failed';
        return unavailable(now, reason);
      }
      const body = await readBoundedJson(response);
      if (!body || typeof body !== 'object' || !('meta' in body) || !body.meta || typeof body.meta !== 'object' ||
          !('result_count' in body.meta) || typeof body.meta.result_count !== 'number' || 'errors' in body) return unavailable(now, 'read_failed');
      const rows = 'data' in body ? body.data : body.meta.result_count === 0 ? [] : null;
      if (!Array.isArray(rows)) return unavailable(now, 'read_failed');
      const facts: SourceFact[] = [];
      for (const row of rows.slice(0, 10)) {
        if (typeof row?.id !== 'string' || !/^\d{1,20}$/u.test(row.id) || typeof row.text !== 'string' ||
            hasCredentialMarker(row.text) || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) continue;
        facts.push({ ref: `x:post:${row.id}`, kind: 'news', label: `X post ${row.id}`,
          text: cleanSourceText(row.text, 350), observedAt: new Date(row.created_at).toISOString() });
      }
      return { source: 'x', state: 'ok', reason: null, observedAt: now.toISOString(), facts };
    } catch { return unavailable(now, signal.aborted ? 'timeout' : 'read_failed'); }
  }

  return { id: 'x', label: 'X', async read(context) {
    const { now, signal, settings } = context;
    if (!token || !vault) return unavailable(now, 'no_provider');
    if (!settings.sources.x || settings.paused) return unavailable(now, 'disabled');
    if (!cache && !context.admittedWake) return unavailable(now, 'awaiting_review');
    try {
      // Only this explicitly marked public search is sent to X. Other vault text stays local.
      const note = await vault.read('X watchlist.md', signal);
      const query = note?.content.match(/^query:[ \t]*(.+)$/imu)?.[1]?.trim();
      if (!query || query.length > 512 || hasCredentialMarker(query)) return unavailable(now, 'no_search_query');
      if (cache?.query === query && now.getTime() - cache.at < reuseMs) return cache.result;
      if (!context.admittedWake) return unavailable(now, 'awaiting_review');
      cache = { query, at: now.getTime(), result: search(query, context) };
      return cache.result;
    } catch { return unavailable(now, 'read_failed'); }
  } };
}
