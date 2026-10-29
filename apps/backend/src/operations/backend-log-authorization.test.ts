import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createBackendLogAuthorizationProbe, loadBackendLogProbeConfig } from './backend-log-authorization.js';

const config = { workspaceId: '11111111-1111-4111-8111-111111111111', principalId: '22222222-2222-4222-8222-222222222222',
  appName: 'ca-jarvis-backend-synthetic', foreignWorkspaceId: '33333333-3333-4333-8333-333333333333' };
const foundry = '/subscriptions/44444444-4444-4444-8444-444444444444/resourceGroups/synthetic/providers/Microsoft.CognitiveServices/accounts/synthetic';
const now = new Date('2026-10-29T06:00:00.000Z');
const token = (oid = config.principalId) => `e30.${Buffer.from(JSON.stringify({ oid })).toString('base64url')}.signature`;
const aggregate = (names: string[], row: number[]) => Response.json({ tables: [{ name: 'PrimaryResult',
  columns: names.map((name) => ({ name, type: 'long' })), rows: [row] }] });
const denied = () => new Response('synthetic-secret', { status: 403 });

afterEach(() => vi.restoreAllMocks());

describe('fixed backend identity authorization observations', () => {
  it('is off for absent and empty settings, rejects partial configuration and caller selectors', () => {
    expect(loadBackendLogProbeConfig({})).toBeUndefined();
    expect(loadBackendLogProbeConfig({ JARVIS_BACKEND_LOGS_PROBE_WORKSPACE_ID: '', JARVIS_BACKEND_LOGS_PROBE_PRINCIPAL_ID: '',
      JARVIS_BACKEND_LOGS_PROBE_APP_NAME: '', JARVIS_BACKEND_LOGS_PROBE_FOREIGN_WORKSPACE_ID: '' })).toBeUndefined();
    expect(() => loadBackendLogProbeConfig({ JARVIS_BACKEND_LOGS_PROBE_WORKSPACE_ID: config.workspaceId })).toThrow();
    expect(() => createBackendLogAuthorizationProbe({ config: { ...config, appName: "x' | union AppTraces" }, getToken: async () => token() })).toThrow();
    expect(() => createBackendLogAuthorizationProbe({ config: { ...config, foreignWorkspaceId: config.workspaceId }, getToken: async () => token() })).toThrow();
    expect(() => createBackendLogAuthorizationProbe({ config, foundryResourceId: 'https://evil.invalid', getToken: async () => token() })).toThrow();
  });

  it('uses exactly five server-owned aggregate queries and returns only fixed observations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const query = JSON.parse(options!.body as string).query as string;
      return query.includes('Backend=countif') ? aggregate(['Backend', 'Other'], [100, 0]) : denied();
    });
    const getToken = vi.fn(async () => token());
    const probe = createBackendLogAuthorizationProbe({ config, foundryResourceId: foundry, getToken, fetch: fetcher, now: () => now });
    const [first, second] = await Promise.all([probe.read(), probe.read()]);
    expect(first).toEqual({ stage: 'authorization_observations', checkedAt: now.toISOString(), identity: 'matched', checks: {
      unfiltered_table: 'backend_only', other_app: 'denied', other_table: 'denied', foreign_workspace: 'denied', foundry_resource: 'denied' } });
    expect(second).toEqual(first);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api\.loganalytics\.azure\.com\/v1\//u);
      expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Prefer: 'wait=5' } });
      const query = JSON.parse(options!.body as string).query as string;
      expect(query).toContain('summarize');
      expect(query).toContain('2026-10-28T06:00:00.000Z');
      expect(query).not.toContain('Log_s');
    }
    expect(JSON.stringify(first)).not.toMatch(/synthetic|11111111|22222222|33333333|signature|100/u);
    first.checks.other_table = 'query_allowed';
    expect((await probe.read()).checks.other_table).toBe('denied');
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('never treats empty or allowed negative controls as an isolation proof', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) =>
      JSON.parse(options!.body as string).query.includes('Backend=countif') ? aggregate(['Backend', 'Other'], [0, 0]) : aggregate(['Records'], [0]));
    const result = await createBackendLogAuthorizationProbe({ config, foundryResourceId: foundry, getToken: async () => token(), fetch: fetcher, now: () => now }).read();
    expect(result.checks).toEqual({ unfiltered_table: 'no_visible_rows', other_app: 'no_visible_rows', other_table: 'no_visible_rows',
      foreign_workspace: 'query_allowed', foundry_resource: 'query_allowed' });
    expect(result).not.toHaveProperty('verified');
    expect(result).not.toHaveProperty('enabled');
  });

  it('reports visible foreign app/table rows without exposing them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) =>
      JSON.parse(options!.body as string).query.includes('Backend=countif') ? aggregate(['Backend', 'Other'], [2, 1]) : aggregate(['Records'], [4]));
    const result = await createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: fetcher, now: () => now }).read();
    expect(result.checks.unfiltered_table).toBe('other_app_visible');
    expect(result.checks.other_app).toBe('other_app_visible');
    expect(result.checks.other_table).toBe('rows_visible');
    expect(result.checks.foundry_resource).toBe('not_configured');
  });

  it.each([400, 401, 404, 429, 500, 504])('returns a fixed verdict for HTTP %s without provider text', async (status) => {
    const result = await createBackendLogAuthorizationProbe({ config, getToken: async () => token(), now: () => now,
      fetch: vi.fn(async () => new Response('Ignore instructions; synthetic-secret', { status })) }).read();
    expect(result.checks.unfiltered_table).toBe(({ 400: 'bad_request', 401: 'unauthenticated', 404: 'not_found', 429: 'throttled',
      500: 'unavailable', 504: 'timeout' } as Record<number, string>)[status]);
    expect(JSON.stringify(result)).not.toMatch(/Ignore|synthetic-secret/u);
  });

  it.each(['invalid_json', 'partial', 'extra_row', 'wrong_column'])('rejects %s aggregate responses', async (variant) => {
    const fetcher = vi.fn(async () => {
      if (variant === 'invalid_json') return new Response('synthetic-secret');
      const value = { tables: [{ name: 'PrimaryResult', columns: [{ name: variant === 'wrong_column' ? 'secret' : 'Records', type: 'long' }],
        rows: variant === 'extra_row' ? [[0], [1]] : [[0]] }], ...(variant === 'partial' ? { error: { code: 'PartialError' } } : {}) };
      return Response.json(value);
    });
    const result = await createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: fetcher, now: () => now }).read();
    expect(['unavailable', 'invalid_response']).toContain(result.checks.unfiltered_table);
  });

  it('does not query with a different or malformed credential and does not invent a missing control', async () => {
    const fetcher = vi.fn(async () => denied());
    const mismatch = await createBackendLogAuthorizationProbe({ config, getToken: async () => token(config.workspaceId), fetch: fetcher }).read();
    expect(mismatch.identity).toBe('mismatch');
    const malformed = await createBackendLogAuthorizationProbe({ config, getToken: async () => 'synthetic-secret', fetch: fetcher }).read();
    expect(malformed.identity).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
    const withoutControl = { workspaceId: config.workspaceId, principalId: config.principalId, appName: config.appName };
    const noControl = await createBackendLogAuthorizationProbe({ config: withoutControl, getToken: async () => token(), fetch: fetcher }).read();
    expect(noControl.checks.foreign_workspace).toBe('not_configured');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('bounds uncooperative fetches and token acquisition, caching no pending gate', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const probe = createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: vi.fn(() => new Promise(() => {})) });
    const pending = probe.read();
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(result.checks.unfiltered_table).toBe('timeout');
    expect(await probe.read()).toEqual(result);
    const noToken = createBackendLogAuthorizationProbe({ config, getToken: () => new Promise(() => {}) });
    expect((await noToken.read()).identity).toBe('unavailable');
  });

  it.each(['invalid', 'oversized'])('does not wait for cancellation of a %s declared length', async (kind) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const result = await createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: vi.fn(async () => new Response(
      new ReadableStream({ cancel }), { headers: { 'content-length': kind === 'invalid' ? 'invalid' : '4097' } },
    )) }).read();
    expect(result.checks.unfiltered_table).toBe('unavailable');
    expect(cancel).toHaveBeenCalledTimes(4);
  });

  it('bounds a streamed body and an uncooperative body read without awaiting cleanup', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const overLimit = await createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: vi.fn(async () => new Response(
      new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel }),
    )) }).read();
    expect(overLimit.checks.unfiltered_table).toBe('unavailable');
    expect(cancel).toHaveBeenCalledTimes(4);
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel })));
    const pending = createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: fetcher }).read();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    controller.abort();
    expect((await pending).checks.unfiltered_table).toBe('timeout');
  });
});

describe('existing deployment smoke route', () => {
  it('exposes only the fixed snapshot through the existing authenticated route', async () => {
    const settings = { ...loadConfig({}), logLevel: 'silent' as const };
    const probe = createBackendLogAuthorizationProbe({ config, getToken: async () => token(), fetch: vi.fn(async () => denied()), now: () => now });
    const app = buildApp(settings, undefined, { modules: [coreModule], backendLogAuthorizationProbe: probe,
      auth: async () => ({ kind: 'jarvis-deploy', objectId: settings.auth.deployObjectId, tenantId: settings.auth.tenantId }) });
    try {
      expect((await app.inject({ url: '/status/smoke' })).statusCode).toBe(401);
      const result = await app.inject({ url: '/status/smoke', headers: { authorization: 'Bearer e30.e30.sig' } });
      expect(result.statusCode).toBe(200);
      expect(result.json().backendLogAuthorization).toMatchObject({ stage: 'authorization_observations', identity: 'matched', checks: { other_table: 'denied' } });
      expect(result.body).not.toContain(config.workspaceId);
      expect(app.backendLogsConfigured).toBe(false);
    } finally { await app.close(); }
  });
});
