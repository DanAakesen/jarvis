import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { WebResearchUsageStore } from '../database/web-research-usage-store.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { ToolFailure } from '../core/tool-registry.js';
import { createWebResearchModule, WEB_RESEARCH_SCOPE } from './tools.js';

const retrievedAt = new Date('2026-10-05T07:00:00.000Z');
const userRequest = {
  headers: { 'x-jarvis-message-id': '42' },
} as unknown as FastifyRequest;

afterEach(() => vi.useRealTimers());
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function providerResponse(
  text: string,
  citations: Array<{ url: string; title: string; start: number; end: number }>,
): Response {
  return new Response(JSON.stringify({
    output: [{
      type: 'message',
      content: [{
        type: 'output_text',
        text,
        annotations: citations.map(({ url, title, start, end }) => ({
          type: 'url_citation',
          url,
          title,
          start_index: start,
          end_index: end,
        })),
      }],
    }],
  }), { headers: { 'content-type': 'application/json' } });
}

function moduleFor(fetcher: typeof fetch, overrides: {
  readonly monthlyCap?: number;
  readonly reserve?: WebResearchUsageStore['reserveMonthlyTransaction'];
  readonly timeoutMs?: number;
} = {}) {
  const reserve = overrides.reserve ?? vi.fn(async () => 'reserved' as const);
  const usageStore: WebResearchUsageStore = { reserveMonthlyTransaction: reserve };
  const getToken = vi.fn(async (scope: string) => {
    expect(scope).toBe(WEB_RESEARCH_SCOPE);
    return 'test-token';
  });
  const module = createWebResearchModule({
    projectEndpoint: 'https://resource.services.ai.azure.com/api/projects/jarvis',
    deploymentName: 'gpt-4.1-mini',
    connectionId: 'GroundingWithBingSearch',
    monthlyCap: overrides.monthlyCap ?? 350,
    usageStore,
    getToken,
    fetcher,
    now: () => retrievedAt,
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
  });
  return { module, reserve, getToken };
}

describe('web research tools', () => {
  it('returns bounded source-linked results and sends an authenticated grounded request', async () => {
    const text = 'The source supports this finding.';
    const citations = Array.from({ length: 6 }, (_, index) => ({
      url: `https://source-${index}.example.org/article`,
      title: `Source ${index}`,
      start: 0,
      end: text.length,
    }));
    const fetcher = vi.fn(async () => providerResponse(text, citations));
    const { module, reserve, getToken } = moduleFor(fetcher);
    const search = module.tools.find(({ name }) => name === 'web_research_search')!;

    const result = await search.execute({ query: 'research question' }, userRequest, new AbortController().signal) as {
      status: string;
      sources: Array<{ url: string; publicationDate: string | null; freshness: string }>;
      view: { source: { id: string } };
    };
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

    expect(result.status).toBe('partial');
    expect(result.sources).toHaveLength(5);
    expect(result.sources[0]).toMatchObject({
      url: 'https://source-0.example.org/article',
      retrievedAt: retrievedAt.toISOString(),
      publicationDate: null,
      freshness: 'unknown',
    });
    expect(result.view.source.id).toBe('web.research');
    expect(reserve).toHaveBeenCalledWith({ at: retrievedAt, monthlyCap: 350 });
    expect(getToken).toHaveBeenCalledWith(WEB_RESEARCH_SCOPE, expect.any(AbortSignal));
    const [endpoint, init] = fetcher.mock.calls[0]!;
    expect(endpoint).toBeInstanceOf(URL);
    expect((endpoint as URL).href).toBe('https://resource.services.ai.azure.com/api/projects/jarvis/openai/v1/responses');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: ['Bearer', 'test-token'].join(' '),
        'Content-Type': 'application/json',
      },
    });
    expect(request).toMatchObject({
      model: 'gpt-4.1-mini',
      tool_choice: 'required',
      tools: [{
        type: 'bing_grounding',
        bing_grounding: { project_connection_id: 'GroundingWithBingSearch' },
      }],
    });
  });

  it('identifies unsupported claims and refuses to treat insecure citations as sources', async () => {
    const text = 'The source supports this finding. Another claim has no citation.';
    const end = 'The source supports this finding.'.length;
    const fetcher = vi.fn(async () => providerResponse(text, [
      { url: 'https://source.example.org/article', title: 'Source', start: 0, end },
      { url: 'http://unsafe.example.org/article', title: 'Unsafe', start: end, end: text.length },
    ]));
    const { module } = moduleFor(fetcher);
    const search = module.tools.find(({ name }) => name === 'web_research_search')!;

    const result = await search.execute({ query: 'question' }, userRequest, new AbortController().signal) as {
      status: string;
      sources: Array<{ url: string }>;
      unsupportedClaims: string[];
    };

    expect(result.status).toBe('partial');
    expect(result.sources.map(({ url }) => url)).toEqual(['https://source.example.org/article']);
    expect(result.unsupportedClaims).toContain('Another claim has no citation.');
  });

  it('returns an explicit unavailable source when retrieval cannot cite the exact cached URL', async () => {
    const requestedUrl = 'https://source.example.org/article';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(providerResponse('A supported finding.', [
        { url: requestedUrl, title: 'Original title', start: 0, end: 20 },
      ]))
      .mockResolvedValueOnce(providerResponse('The page could not be found.', [
        { url: 'https://different.example.org/article', title: 'Different page', start: 0, end: 28 },
      ]));
    const { module } = moduleFor(fetcher);
    const search = module.tools.find(({ name }) => name === 'web_research_search')!;
    const retrieve = module.tools.find(({ name }) => name === 'web_research_retrieve')!;

    await search.execute({ query: 'question' }, userRequest, new AbortController().signal);
    const result = await retrieve.execute({ url: requestedUrl }, userRequest, new AbortController().signal) as {
      status: string;
      sources: unknown[];
      unavailableSources: Array<{ url: string; title: string; reason: string }>;
    };

    expect(result.status).toBe('unavailable');
    expect(result.sources).toEqual([]);
    expect(result.unavailableSources).toEqual([{
      url: requestedUrl,
      title: 'Original title',
      reason: 'The requested page was not returned as a citation.',
    }]);
  });

  it('reports provider timeouts without exposing provider diagnostics', async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('provider internals')), { once: true });
    }));
    const { module } = moduleFor(fetcher, { timeoutMs: 100 });
    const search = module.tools.find(({ name }) => name === 'web_research_search')!;
    const pending = search.execute({ query: 'question' }, userRequest, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).rejects.toMatchObject({
      name: 'ToolFailure',
      message: 'The web research provider timed out. Please try again.',
    } satisfies Partial<ToolFailure>);
  });

  it('propagates caller cancellation to the provider and counts the reserved transaction', async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const fetcher: typeof fetch = vi.fn((_input, init) => {
      providerSignal = init?.signal ?? undefined;
      controller.abort(new Error('request cancelled'));
      return Promise.reject(providerSignal?.reason);
    });
    const { module, reserve } = moduleFor(fetcher);
    const search = module.tools.find(({ name }) => name === 'web_research_search')!;

    await expect(search.execute({ query: 'question' }, userRequest, controller.signal))
      .rejects.toThrow('request cancelled');
    expect(providerSignal?.aborted).toBe(true);
    expect(reserve).toHaveBeenCalledOnce();
  });

  it('refuses calls at the monthly limit without invoking the provider', async () => {
    const fetcher = vi.fn();
    const { module, reserve } = moduleFor(fetcher, {
      reserve: vi.fn(async () => 'limit' as const),
    });
    const search = module.tools.find(({ name }) => name === 'web_research_search')!;

    await expect(search.execute({ query: 'question' }, userRequest, new AbortController().signal))
      .rejects.toMatchObject({
        name: 'ToolRefusal',
        message: 'The monthly web research limit has been reached. No search was sent; try again next month.',
      });
    expect(fetcher).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledOnce();
  });

  it('shows a visible refusal through the authenticated tool endpoint at the monthly cap', async () => {
    const fetcher = vi.fn();
    const { module } = moduleFor(fetcher, {
      reserve: vi.fn(async () => 'limit' as const),
    });
    const config = loadConfig({});
    const app = buildApp(config, undefined, {
      modules: [coreModule, module],
      auth: async () => ({
        objectId: config.auth.ownerObjectId,
        tenantId: config.auth.tenantId,
        displayName: 'Dan',
      }),
      toolCallStore: { record: vi.fn(async () => {}) },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/tools/web_research_search',
      headers: {
        authorization: ['Bearer', 'test.test.test'].join(' '),
        'x-jarvis-message-id': '42',
      },
      payload: { query: 'question' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'The monthly web research limit has been reached. No search was sent; try again next month.' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
