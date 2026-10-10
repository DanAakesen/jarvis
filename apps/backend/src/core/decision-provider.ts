/**
 * One place that decides where "decisions" (reflex classification, browser steps, recipes and PC
 * actions) are scored. Jev (Typesafe) and Microsoft-Decision-1 (Foundry) accept the same request
 * (`model`, `state`, typed `questions`) and return `answers`, so a call site only needs a target:
 * an endpoint, the `model` value and a bearer token.
 */

export const decisionProviders = ['jev', 'microsoft'] as const;
export type DecisionProviderId = typeof decisionProviders[number];

export const defaultDecisionProvider: DecisionProviderId = 'jev';
export const jevDecisionEndpoint = 'https://api.typesafe.ai/v1/systemone';
export const jevDecisionModel = 'jev-latest';
export const microsoftDecisionDeployment = 'decision-1';
export const microsoftDecisionPath = '/providers/microsoft/v1/systemone';
export const microsoftDecisionScope = 'https://cognitiveservices.azure.com/.default';

export interface DecisionTarget {
  readonly provider: DecisionProviderId;
  readonly endpoint: string;
  /** Jev's model alias, or the Foundry deployment name. */
  readonly model: string;
  /** Bearer token: the Jev API key or a Microsoft Entra access token. */
  readonly token: string;
}

export type DecisionTargetResolver = (signal?: AbortSignal) => Promise<DecisionTarget | undefined>;

export function isDecisionProvider(value: unknown): value is DecisionProviderId {
  return typeof value === 'string' && (decisionProviders as readonly string[]).includes(value);
}

/** A bearer token is a single bounded header value. */
export function validDecisionToken(token: unknown): token is string {
  return typeof token === 'string' && token.trim().length > 0 && token.length <= 10_000 && !/[\r\n]/u.test(token);
}

/** A resolver for a fixed Jev key; used by tests and anywhere a key is already in hand. */
export function jevKeyResolver(key: string | undefined): DecisionTargetResolver {
  return async () => validDecisionToken(key)
    ? { provider: 'jev', endpoint: jevDecisionEndpoint, model: jevDecisionModel, token: key }
    : undefined;
}

/** Reads the provider setting at most once per `ttlMs`; any failure keeps the last value (default Jev). */
export function createCachedDecisionProviderReader(
  read: () => Promise<DecisionProviderId | undefined>,
  ttlMs = 3_000,
  now: () => number = Date.now,
): () => Promise<DecisionProviderId> {
  let value: DecisionProviderId = defaultDecisionProvider;
  let readAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | undefined;
  return async () => {
    if (now() - readAt < ttlMs) return value;
    pending ??= read()
      .then((next) => { if (isDecisionProvider(next)) value = next; })
      .catch(() => {})
      .finally(() => { readAt = now(); pending = undefined; });
    await pending;
    return value;
  };
}

export interface DecisionResolverOptions {
  readonly getProvider: () => Promise<DecisionProviderId>;
  readonly getJevApiKey: () => Promise<string | undefined>;
  /** Foundry resource origins to try, in order; the first that does not answer 404 is remembered. */
  readonly microsoft?: {
    readonly hosts: readonly string[];
    readonly deployment: string;
    readonly getToken: (signal?: AbortSignal) => Promise<string>;
  };
  /** Called when the selected provider cannot produce a target (callers then act as if no decision was made). */
  readonly onUnavailable?: (provider: DecisionProviderId) => void;
  readonly fetcher?: typeof fetch;
}

export interface DecisionResolver {
  readonly resolve: DecisionTargetResolver;
  /** Use for decision requests: retries a Microsoft 404 on the next candidate host. */
  readonly fetch: typeof fetch;
}

export function createDecisionResolver(options: DecisionResolverOptions): DecisionResolver {
  const base = options.fetcher ?? fetch;
  const microsoft = options.microsoft;
  const urls = (microsoft?.hosts ?? []).map((host) => new URL(microsoftDecisionPath, host).toString());
  let active = 0;

  const resolve: DecisionTargetResolver = async (signal) => {
    let provider: DecisionProviderId;
    try { provider = await options.getProvider(); } catch { provider = defaultDecisionProvider; }
    try {
      if (provider === 'microsoft') {
        if (!microsoft || urls.length === 0) throw new Error('Microsoft decisions are not configured');
        const token = await microsoft.getToken(signal);
        if (!validDecisionToken(token)) throw new Error('Microsoft decision token unavailable');
        return { provider, endpoint: urls[active]!, model: microsoft.deployment, token };
      }
      const key = await options.getJevApiKey();
      if (!validDecisionToken(key)) throw new Error('Jev API key unavailable');
      return { provider, endpoint: jevDecisionEndpoint, model: jevDecisionModel, token: key };
    } catch {
      if (!signal?.aborted) options.onUnavailable?.(provider);
      return undefined;
    }
  };

  const decisionFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const index = urls.indexOf(url);
    let response = await base(input, init);
    if (index === -1 || response.status !== 404 || urls.length < 2) return response;
    for (let step = 1; step < urls.length; step += 1) {
      const next = (index + step) % urls.length;
      await response.body?.cancel().catch(() => {});
      response = await base(urls[next]!, init);
      if (response.status !== 404) { active = next; return response; }
    }
    return response;
  }) as typeof fetch;

  return { resolve, fetch: decisionFetch };
}
