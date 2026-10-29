import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedTargetReader, ManagedTargetReadError, type ManagedTargetReaderOptions } from './managed-target-reader.js';

const endpoint = 'https://fixture.services.ai.azure.com/api/projects/jarvis';
const fingerprint = 'a'.repeat(64);
// Serialized azure-ai-projects 2.9 AgentVersionDetails/AgentDetails wire fields.
function wire() {
  return {
    version: { object: 'agent.version', id: 'fixture:7', name: 'fixture', version: '7', metadata: {},
      created_at: 1793270000, status: 'active', draft: false, definition: {
        kind: 'prompt', harness: { type: 'microsoft_copilot_preview' }, model: 'gpt-6.1-terra',
        reasoning: { effort: 'high' }, instructions: 'Synthetic Jarvis identity.', tools: [
          { type: 'microsoft_copilot_toolset_preview', default_config: { enabled: false } },
          { type: 'function', name: 'fixture_read', strict: false, description: 'Read a synthetic fixture.',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
        ],
      } },
    agent: { object: 'agent', id: 'fixture', name: 'fixture', state: 'enabled', configuration_state: 'enabled',
      versions: { latest: { version: '7' } }, agent_endpoint: { version_selector: { version_selection_rules: [
        { type: 'FixedRatio', agent_version: '7', traffic_percentage: 100 },
      ] } } },
  };
}
function fixture(metadata: { version: unknown; agent: unknown } = wire(), options: Partial<ManagedTargetReaderOptions> = {}) {
  const fetcher = vi.fn<typeof fetch>(async input => Response.json(String(input).includes('/versions/') ? metadata.version : metadata.agent));
  const getToken = vi.fn(async () => 'synthetic-token');
  const readSelectedSettings = vi.fn(async () => ({ model: 'gpt-6.1-terra', effort: 'high' }));
  const read = createManagedTargetReader({ projectEndpoint: endpoint, agentName: 'fixture', version: '7', fingerprint,
    getToken, readSelectedSettings, fetch: fetcher, ...options });
  return { read, fetcher, getToken, readSelectedSettings };
}
afterEach(() => vi.restoreAllMocks());

describe('managed target metadata reader', () => {
  it('reads exact pinned SDK wire metadata over GET with one scoped token, no redirects/retries, and returns the opaque anchor', async () => {
    const metadata = wire();
    const f = fixture(metadata);
    const result = await f.read();
    expect(result).toEqual({ projectEndpoint: endpoint, target: { agentName: 'fixture', version: '7', fingerprint,
      model: 'gpt-6.1-terra', effort: 'high' }, definition: metadata.version.definition });
    expect(f.getToken).toHaveBeenCalledExactlyOnceWith('https://ai.azure.com/.default', expect.any(AbortSignal));
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      `${endpoint}/agents/fixture/versions/7?api-version=v1`, `${endpoint}/agents/fixture?api-version=v1`,
    ].sort());
    for (const [, init] of f.fetcher.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer synthetic-token');
      expect(headers.get('Foundry-Features')).toBe('MicrosoftCopilot=V1Preview');
    }
    expect(f.readSelectedSettings).toHaveBeenCalledTimes(1);
  });

  it.each(['name', 'version', 'status', 'draft'] as const)('returns unavailable on pinned version %s drift', async field => {
    const metadata = wire();
    Object.assign(metadata.version, { [field]: field === 'draft' ? true : 'unknown-private-value' });
    expect(await fixture(metadata).read()).toBeNull();
  });

  it.each([
    ['model', 'other-model'], ['reasoning', { effort: 'low' }], ['reasoning', { effort: 'high', summary: 'auto' }],
    ['kind', 'hosted'], ['harness', { type: 'github_copilot_preview' }], ['harness', { type: 'microsoft_copilot_preview', extra: true }],
    ['instructions', '   '], ['skills', [{ name: 'extra', version: '1' }]], ['temperature', 1], ['top_p', 1],
    ['tool_choice', 'auto'], ['text', { format: { type: 'json_object' } }], ['text', { verbosity: 'high' }],
    ['verbosity', 'high'], ['text_format', 'json'], ['response_format', {}], ['structured_inputs', {}],
  ])('rejects incompatible definition field %s', async (field, value) => {
    const metadata = wire();
    Object.assign(metadata.version.definition, { [String(field)]: value });
    expect(await fixture(metadata).read()).toBeNull();
  });

  it('uses the effective settings reader afresh, with no lower-effort or alternate-model fallback', async () => {
    const settings = vi.fn().mockResolvedValueOnce({ model: 'gpt-6.1-terra', effort: 'high' })
      .mockResolvedValueOnce({ model: 'gpt-6.1-terra', effort: 'none' })
      .mockResolvedValueOnce({ model: 'other', effort: 'high' });
    const f = fixture(wire(), { readSelectedSettings: settings });
    expect(await f.read()).not.toBeNull(); expect(await f.read()).toBeNull(); expect(await f.read()).toBeNull();
    expect(f.getToken).toHaveBeenCalledTimes(3);
  });

  it.each([
    [], [{ type: 'microsoft_copilot_toolset_preview' }],
    [{ type: 'microsoft_copilot_toolset_preview', default_config: { enabled: true } }],
    [{ type: 'microsoft_copilot_toolset_preview', default_config: { enabled: false }, configs: [{ name: 'shell', enabled: true }] }],
    [{ type: 'microsoft_copilot_toolset_preview', default_config: { enabled: false }, configs: null }],
    [{ type: 'web_search' }],
  ].map(tools => [tools]))('rejects missing/enabled/malformed built-ins and extra tools: %j', async tools => {
    const metadata = wire(); Object.assign(metadata.version.definition, { tools });
    expect(await fixture(metadata).read()).toBeNull();
  });

  it.each(['missing-strict', 'strict', 'reserved', 'duplicate', 'duplicate-toolset', 'missing-schema'] as const)('rejects function/toolset %s', async mutation => {
    const metadata = wire();
    const tools = metadata.version.definition.tools as Record<string, unknown>[];
    const fn = tools[1]!;
    if (mutation === 'missing-strict') delete fn.strict;
    if (mutation === 'strict') fn.strict = true;
    if (mutation === 'reserved') fn.name = 'builtin___shell';
    if (mutation === 'duplicate') tools.push({ ...fn });
    if (mutation === 'duplicate-toolset') tools.push({ ...tools[0] });
    if (mutation === 'missing-schema') delete fn.parameters;
    expect(await fixture(metadata).read()).toBeNull();
  });

  it('accepts only explicitly disabled built-in overrides', async () => {
    const metadata = wire();
    Object.assign(metadata.version.definition.tools[0]!, { configs: [{ name: 'shell', enabled: false }] });
    expect(await fixture(metadata).read()).not.toBeNull();
  });

  it.each(['missing', 'null', 'empty', 'split', 'latest', 'version', 'ratio', 'disabled', 'configuration-disabled', 'unknown-state', 'name'] as const)(
    'rejects endpoint selector/state %s without guessing latest', async mutation => {
      const metadata = wire();
      const agent = metadata.agent as Record<string, unknown>;
      const selector = metadata.agent.agent_endpoint.version_selector;
      const rule = selector.version_selection_rules[0]!;
      if (mutation === 'missing') delete agent.agent_endpoint;
      if (mutation === 'null') agent.agent_endpoint = null;
      if (mutation === 'empty') selector.version_selection_rules = [];
      if (mutation === 'split') selector.version_selection_rules.push({ ...rule });
      if (mutation === 'latest') rule.type = 'Latest';
      if (mutation === 'version') rule.agent_version = '8';
      if (mutation === 'ratio') rule.traffic_percentage = 50;
      if (mutation === 'disabled') agent.state = 'disabled';
      if (mutation === 'configuration-disabled') agent.configuration_state = 'disabled';
      if (mutation === 'unknown-state') agent.state = 'private-unknown-state';
      if (mutation === 'name') agent.name = 'other';
      expect(await fixture(metadata).read()).toBeNull();
    });

  it.each([301, 302, 401, 403, 404, 429, 500, 503])('throws one fixed error for HTTP %i without retaining raw bodies, URLs or credentials', async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('private body synthetic-token https://private.invalid', { status,
      headers: { location: 'https://private.invalid' } }));
    const f = fixture(wire(), { fetch: fetcher });
    await expect(f.read()).rejects.toEqual(new ManagedTargetReadError());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['invalid-json', 'array', 'missing-definition', 'invalid-utf8', 'content-length', 'stream-size', 'redirected'] as const)(
    'bounds and sanitizes %s metadata', async kind => {
      const f = fixture(wire(), { fetch: async () => {
        if (kind === 'invalid-json') return new Response('private-broken-JSON');
        if (kind === 'array') return Response.json([]);
        if (kind === 'missing-definition') return Response.json({ name: 'fixture' });
        if (kind === 'invalid-utf8') return new Response(new Uint8Array([0xff]));
        if (kind === 'content-length') return new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } });
        if (kind === 'stream-size') return new Response('x'.repeat(1024 * 1024 + 1));
        const response = Response.json(wire().version);
        Object.defineProperty(response, 'redirected', { value: true });
        return response;
      } });
      const error = await f.read().catch((value: unknown) => value);
      expect(error).toEqual(new ManagedTargetReadError());
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toMatch(/private|synthetic-token|https:/u);
    });

  it('bounds a stalled response body even when the injected fetcher ignores cancellation', async () => {
    const abort = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    const entered = Promise.withResolvers<void>();
    const f = fixture(wire(), { fetch: async () => new Response(new ReadableStream({ start() { entered.resolve(); } })) });
    const result = f.read().catch((error: unknown) => error);
    await entered.promise; abort.abort();
    expect(await result).toEqual(new ManagedTargetReadError());
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it('bounds authentication and sanitizes unexpected token/settings/fetch failures', async () => {
    const abort = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    const started = Promise.withResolvers<void>();
    const f = fixture(wire(), { getToken: async () => { started.resolve(); return new Promise<string>(() => {}); } });
    const result = f.read().catch((error: unknown) => error);
    await started.promise; abort.abort();
    expect(await result).toEqual(new ManagedTargetReadError()); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(['token', 'settings', 'fetch'] as const)('does not leak %s dependency errors', async dependency => {
    const fail = async () => { throw new Error('private detail synthetic-token https://private.invalid'); };
    const f = fixture(wire(), dependency === 'token' ? { getToken: fail } : dependency === 'settings'
      ? { readSelectedSettings: fail } : { fetch: fail });
    await expect(f.read()).rejects.toEqual(new ManagedTargetReadError());
  });
});
