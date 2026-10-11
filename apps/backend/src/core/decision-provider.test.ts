import { describe, expect, it, vi } from 'vitest';
import {
  createCachedDecisionProviderReader,
  createDecisionResolver,
  isDecisionProvider,
  jevDecisionEndpoint,
  jevKeyResolver,
  microsoftDecisionDeployment,
  validDecisionToken,
  type DecisionProviderId,
} from './decision-provider.js';
import { tagJevFailure } from './jev.js';

const aiHost = 'https://account.services.ai.azure.com';
const cognitiveHost = 'https://account.cognitiveservices.azure.com';
const aiUrl = `${aiHost}/providers/microsoft/v1/systemone`;
const cognitiveUrl = `${cognitiveHost}/providers/microsoft/v1/systemone`;

function resolver(options: {
  provider?: DecisionProviderId | (() => Promise<DecisionProviderId>);
  jevKey?: string | undefined;
  microsoft?: false | { token?: string | (() => Promise<string>); hosts?: string[] };
  fetcher?: typeof fetch;
  onUnavailable?: (provider: DecisionProviderId) => void;
} = {}) {
  const provider = options.provider ?? 'jev';
  const microsoft = options.microsoft === false ? undefined : {
    hosts: options.microsoft?.hosts ?? [aiHost, cognitiveHost],
    deployment: microsoftDecisionDeployment,
    getToken: typeof options.microsoft?.token === 'function'
      ? options.microsoft.token
      : async () => options.microsoft?.token ?? 'entra-token',
  };
  return createDecisionResolver({
    getProvider: typeof provider === 'function' ? provider : async () => provider,
    getJevApiKey: async () => ('jevKey' in options ? options.jevKey : 'jev-key'),
    ...(microsoft ? { microsoft } : {}),
    ...(options.onUnavailable ? { onUnavailable: options.onUnavailable } : {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });
}

describe('decision provider targets', () => {
  it('targets Jev with its key and alias by default', async () => {
    expect(await resolver().resolve()).toEqual({
      provider: 'jev', endpoint: jevDecisionEndpoint, model: 'jev-latest', token: 'jev-key',
    });
  });

  it('targets the Foundry deployment with an Entra token when Microsoft is selected', async () => {
    expect(await resolver({ provider: 'microsoft' }).resolve()).toEqual({
      provider: 'microsoft', endpoint: aiUrl, model: 'decision-1', token: 'entra-token',
    });
  });

  it.each([
    ['Microsoft is not configured', { provider: 'microsoft' as const, microsoft: false as const }, 'microsoft'],
    ['the Entra token is invalid', { provider: 'microsoft' as const, microsoft: { token: 'bad\r\ntoken' } }, 'microsoft'],
    ['the Entra token request fails', {
      provider: 'microsoft' as const, microsoft: { token: async () => { throw new Error('private'); } },
    }, 'microsoft'],
    ['the Jev key is missing', { provider: 'jev' as const, jevKey: undefined }, 'jev'],
  ])('reports no target, and never switches provider, when %s', async (_name, options, provider) => {
    const onUnavailable = vi.fn();
    expect(await resolver({ ...options, onUnavailable }).resolve()).toBeUndefined();
    expect(onUnavailable).toHaveBeenCalledWith(provider);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it('does not report unavailability for an aborted request and defaults to Jev when the setting cannot be read', async () => {
    const onUnavailable = vi.fn();
    const aborted = new AbortController();
    aborted.abort();
    const failing = resolver({
      provider: 'microsoft', microsoft: { token: async () => { throw new Error('aborted'); } }, onUnavailable,
    });
    expect(await failing.resolve(aborted.signal)).toBeUndefined();
    expect(onUnavailable).not.toHaveBeenCalled();

    const unreadable = resolver({ provider: async () => { throw new Error('SQL unavailable'); } });
    expect(await unreadable.resolve()).toMatchObject({ provider: 'jev' });
  });

  it('wraps a fixed key as a Jev target', async () => {
    expect(await jevKeyResolver('fixed')()).toMatchObject({ provider: 'jev', token: 'fixed' });
    expect(await jevKeyResolver(undefined)()).toBeUndefined();
  });

  it.each(['jev', 'microsoft'])('accepts the provider %s', (value) => expect(isDecisionProvider(value)).toBe(true));
  it.each(['Jev', 'openai', '', null, 1, undefined])('refuses the provider %j', (value) => {
    expect(isDecisionProvider(value)).toBe(false);
  });

  it.each(['token', 'a'.repeat(10_000)])('accepts a bounded single-line token', (token) => {
    expect(validDecisionToken(token)).toBe(true);
  });
  it.each(['', '   ', 'a\nb', 'a\rb', 'a'.repeat(10_001), undefined, null, 42])('refuses the token %j', (token) => {
    expect(validDecisionToken(token)).toBe(false);
  });

  it('tags only failures with the provider', () => {
    expect(tagJevFailure({ failure: 'timeout' }, 'microsoft')).toEqual({ failure: 'timeout', provider: 'microsoft' });
    expect(tagJevFailure({ operation: 'click', confidence: 0.9 }, 'microsoft')).toEqual({ operation: 'click', confidence: 0.9 });
    expect(tagJevFailure(null, 'jev')).toBeNull();
  });
});

describe('Microsoft host fallback', () => {
  it('retries a 404 on the next Foundry host and remembers the host that answered', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input) === cognitiveUrl ? new Response('{}', { status: 200 }) : new Response(null, { status: 404 }));
    const decisions = resolver({ provider: 'microsoft', fetcher });

    const first = await decisions.fetch(aiUrl, { method: 'POST', body: '{"state":1}' });

    expect(first.status).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([aiUrl, cognitiveUrl]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ body: '{"state":1}' });
    expect((await decisions.resolve())?.endpoint).toBe(cognitiveUrl);
  });

  it('returns the 404 when every host says not found, and keeps the first host', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const decisions = resolver({ provider: 'microsoft', fetcher });

    expect((await decisions.fetch(aiUrl, { method: 'POST' })).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await decisions.resolve())?.endpoint).toBe(aiUrl);
  });

  it.each([200, 401, 429, 503])('does not retry a %i', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    const decisions = resolver({ provider: 'microsoft', fetcher });

    expect((await decisions.fetch(aiUrl, { method: 'POST' })).status).toBe(status);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('passes other URLs, including Jev, straight through', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const decisions = resolver({ fetcher });

    expect((await decisions.fetch(jevDecisionEndpoint, { method: 'POST' })).status).toBe(404);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not retry with a single host', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const decisions = resolver({ provider: 'microsoft', microsoft: { hosts: [aiHost] }, fetcher });

    expect((await decisions.fetch(aiUrl, { method: 'POST' })).status).toBe(404);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('cached provider setting', () => {
  it('reads once per interval, refreshes after it, and keeps the last value on failure or a bad value', async () => {
    let now = 1_000;
    const values: (DecisionProviderId | undefined | Error)[] = ['microsoft', new Error('SQL'), undefined, 'jev'];
    const read = vi.fn(async () => {
      const next = values.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    const get = createCachedDecisionProviderReader(read, 3_000, () => now);

    expect(await get()).toBe('microsoft');
    expect(await get()).toBe('microsoft');
    expect(read).toHaveBeenCalledOnce();

    now += 3_001;
    expect(await get()).toBe('microsoft');
    now += 3_001;
    expect(await get()).toBe('microsoft');
    now += 3_001;
    expect(await get()).toBe('jev');
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('shares one read between concurrent callers and starts on Jev when nothing can be read', async () => {
    const read = vi.fn(async () => 'microsoft' as const);
    const get = createCachedDecisionProviderReader(read, 3_000, () => 0);
    expect(await Promise.all([get(), get(), get()])).toEqual(['microsoft', 'microsoft', 'microsoft']);
    expect(read).toHaveBeenCalledOnce();

    const broken = createCachedDecisionProviderReader(async () => { throw new Error('SQL'); }, 3_000, () => 0);
    expect(await broken()).toBe('jev');
  });
});
