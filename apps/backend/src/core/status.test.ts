import { Writable } from 'node:stream';
import type { Contracts } from 'applicationinsights';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AwayModeStore } from './away-mode.js';
import type { NowFeedSnapshot, NowFeedStore } from './now.js';
import { coreModule } from './index.js';
import { summarizeNowFeed } from './status.js';
import { createSystemStatusReader } from '../system-status.js';
import { isSystemSmokeStatus, systemSmokeCheckIds } from '@jarvis/contracts';
import { createLogger } from '../logging.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}`,
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

const feed: NowFeedSnapshot = {
  updatedAt: '2026-10-04T12:00:00.000Z',
  running: [{
    id: '1',
    title: 'Secret task title',
    project: 'Private project',
    agent: 'codex',
    activity: 'Full private log',
    startedAt: '2026-10-04T11:00:00.000Z',
  }],
  items: [
    { id: '2', category: 'attention', title: 'Private question', link: null, at: '2026-10-04T11:30:00.000Z' },
    { id: '3', category: 'release', title: 'Private release log', link: null, at: '2026-10-04T11:31:00.000Z' },
    { id: '4', category: 'credential', title: 'Private credential', link: null, at: '2026-10-04T11:32:00.000Z' },
    { id: '5', category: 'alert', title: 'Private alert', link: null, at: '2026-10-04T11:33:00.000Z' },
  ],
};

function fixture(
  store: NowFeedStore | null,
  awayModeStore?: AwayModeStore,
  systemStatusReader = createSystemStatusReader({}, undefined),
) {
  const record = vi.fn(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    nowFeedStore: store,
    awayModeStore,
    systemStatusReader,
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('get_status_summary', () => {
  it('summarizes only bounded Now-feed counts without exposing feed contents', async () => {
    const read = vi.fn(async () => feed);
    const { app, record } = fixture({ read, dismiss: vi.fn(async () => true) });
    const response = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      tool: 'get_status_summary',
      outcome: 'ok',
      result: {
        summary: 'System status: 0 ok, 0 degraded, 0 down, 10 unknown. The Now feed shows 1 running task, 1 task needing attention, 1 release or deployment update, 1 credential warning, 1 alert.',
      },
      confirmation: 'Done: get_status_summary succeeded.',
    });
    expect(JSON.stringify(response.json())).not.toMatch(/Secret task title|Private project|Full private log|Private question|Private release log|Private credential|Private alert/u);
    expect(read).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '42',
      tool: 'get_status_summary',
      arguments: {},
      outcome: 'ok',
    }));
    expect(summarizeNowFeed(feed)).toContain('1 running task');
  });

  it('refuses to invent a summary when the feed is unavailable and rejects extra input', async () => {
    const { app } = fixture(null);
    const unavailable = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: {},
    });
    const invalid = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: [],
    });

    expect(unavailable.json()).toMatchObject({ outcome: 'refused', result: { refused: 'The Now feed is unavailable.' } });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') } });
  });

  it('summarizes the full feed while away', async () => {
    const awayModeStore: AwayModeStore = {
      read: async () => ({ mode: 'away', source: 'manual', changedAt: null }),
      markPresent: async () => ({ mode: 'present', source: 'browser', changedAt: null }),
      set: async () => ({ mode: 'away', source: 'manual', changedAt: null }),
    };
    const { app } = fixture({ read: async () => feed, dismiss: vi.fn(async () => true) }, awayModeStore);
    const response = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: {},
    });

    expect(response.json()).toMatchObject({
      result: {
        summary: 'System status: 0 ok, 0 degraded, 0 down, 10 unknown. The Now feed shows 1 running task, 1 task needing attention, 1 release or deployment update, 1 credential warning, 1 alert.',
      },
    });
  });

  it('serves a cached owner-only status snapshot without exposing integration secrets', async () => {
    const database = vi.fn(async () => ({ status: 'ok' as const, details: { configured: true } }));
    const reader = createSystemStatusReader({ database }, undefined);
    const { app } = fixture(null, undefined, reader);
    const first = await app.inject({ url: '/status', headers });
    const second = await app.inject({ url: '/status', headers });

    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('private, max-age=30');
    expect(first.json().entries).toHaveLength(11);
    expect(first.json().entries[0]).toMatchObject({ id: 'database', status: 'ok' });
    expect(second.json()).toEqual(first.json());
    expect(database).toHaveBeenCalledOnce();
    expect(JSON.stringify(first.json())).not.toMatch(/token|secret|private/iu);
  });

  it('runs fresh read-only smoke probes and includes their sanitized results in GET /status', async () => {
    const google = vi.fn(async () => ({ status: 'ok' as const, details: { configured: true } }));
    const vault = vi.fn(async () => ({ status: 'ok' as const }));
    const embeddings = vi.fn(async () => ({ status: 'ok' as const }));
    const research = vi.fn(async () => ({ status: 'ok' as const }));
    const agentContract = vi.fn(async () => ({ status: 'ok' as const }));
    const reader = createSystemStatusReader({ google }, undefined);
    const app = buildApp(config, undefined, {
      modules: [coreModule],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      systemStatusReader: reader,
      systemSmokeProbes: {
        vault, 'foundry.embeddings': embeddings, research, agent_contract: agentContract,
        chat_canary: async () => ({ status: 'ok' as const }),
      },
    });
    apps.push(app);
    await reader.read();

    const smoke = await app.inject({ url: '/status/smoke', headers });
    const status = await app.inject({ url: '/status', headers });

    expect(smoke.statusCode).toBe(200);
    expect(smoke.headers['cache-control']).toBe('no-store');
    expect(smoke.json().entries).toHaveLength(systemSmokeCheckIds.length);
    expect(smoke.json().entries.map(({ id }: { id: string }) => id)).toEqual(systemSmokeCheckIds);
    expect(smoke.json().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'google', status: 'ok' }),
      expect.objectContaining({ id: 'vault', status: 'ok' }),
      expect.objectContaining({ id: 'foundry.embeddings', status: 'ok' }),
      expect.objectContaining({ id: 'research', status: 'ok' }),
      expect.objectContaining({ id: 'agent_contract', status: 'ok' }),
      expect.objectContaining({ id: 'chat_canary', status: 'ok' }),
    ]));
    expect(status.json().smoke).toEqual(smoke.json());
    expect(google).toHaveBeenCalledTimes(2);
    expect(vault).toHaveBeenCalledOnce();
    expect(embeddings).toHaveBeenCalledOnce();
    expect(research).toHaveBeenCalledOnce();
    expect(agentContract).toHaveBeenCalledOnce();
    expect(JSON.stringify(smoke.json())).not.toMatch(/token|secret|private|configured/iu);
  });

  it('requires Dan or the deployment principal for GET /status/smoke', async () => {
    const app = buildApp(config, undefined, { modules: [coreModule] });
    apps.push(app);
    const unauthenticated = await app.inject({ url: '/status/smoke' });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toEqual({ error: 'Unauthorized' });
  });

  it('keeps both HTTP responses legacy-compatible while exporting safe internal reasons once', async () => {
    const records: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
    const sink = {
      trackTrace: vi.fn<(trace: Contracts.TraceTelemetry) => void>(),
      flush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}),
    };
    const reader = createSystemStatusReader({}, undefined);
    const capabilities = vi.fn(async () => ({
      status: 'down' as const, reason: 'capabilities_discovery_missing',
    }));
    const app = buildApp(config, createLogger({ logLevel: 'info' }, sink, output), {
      modules: [coreModule],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      systemStatusReader: reader,
      systemSmokeProbes: {
        chat_identity: async () => ({ status: 'degraded', reason: 'identity_reply' }),
        chat_no_timestamp: async () => ({ status: 'degraded', reason: 'capture_time_invented' }),
        chat_capabilities: capabilities,
        chat_github_read: async () => ({ status: 'down', reason: 'private provider response' }),
      },
    });
    apps.push(app);
    const smoke = await app.inject({ url: '/status/smoke', headers });
    const retained = structuredClone(reader.peek()?.smoke);
    const status = await app.inject({ url: '/status', headers });
    const repeatedRead = await app.inject({ url: '/status', headers });
    const report = smoke.json();

    expect(smoke.statusCode).toBe(200);
    expect(status.statusCode).toBe(200);
    expect(status.json().smoke).toEqual(report);
    expect(repeatedRead.json()).toEqual(status.json());
    expect(isSystemSmokeStatus(report)).toBe(true);
    expect(report.entries.every((entry: { reason?: string; status: string }) =>
      entry.reason === undefined || entry.status === 'down')).toBe(true);
    expect(report.entries.find((entry: { id: string }) => entry.id === 'chat_capabilities'))
      .toMatchObject({ status: 'down', reason: 'capabilities_discovery_missing' });
    expect(retained?.entries.find((entry) => entry.id === 'chat_identity'))
      .toMatchObject({ status: 'degraded', reason: 'identity_reply' });
    expect(reader.peek()?.smoke).toEqual(retained);
    expect(capabilities).toHaveBeenCalledOnce();
    const traces = sink.trackTrace.mock.calls.map(([trace]) => trace)
      .filter((trace) => trace.message === 'system.smoke_check');
    expect(traces).toHaveLength(systemSmokeCheckIds.length);
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: {
        service: 'jarvis-backend', checkId: 'chat_identity', status: 'degraded', reason: 'identity_reply',
      } }),
      expect.objectContaining({ properties: {
        service: 'jarvis-backend', checkId: 'chat_no_timestamp', status: 'degraded', reason: 'capture_time_invented',
      } }),
      expect.objectContaining({ properties: {
        service: 'jarvis-backend', checkId: 'chat_capabilities', status: 'down', reason: 'capabilities_discovery_missing',
      } }),
    ]));
    expect(smoke.body + status.body + records.join('') + JSON.stringify(traces)).not.toContain('private provider');
  });

  it('limits smoke tool calls to safe checks and gates the no-op action on approval', async () => {
    const record = vi.fn(async () => {});
    const catalogueTools = ['vault_read', 'calendar_today_agenda', 'github_read'].map((name) => ({
      name,
      description: `Read-only ${name}.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({}),
    }));
    const app = buildApp(config, undefined, {
      modules: [
        coreModule,
        { id: 'smoke-catalogue', registerRoutes: async () => {}, tools: catalogueTools },
      ],
      auth: async () => ({ kind: 'jarvis-agent', objectId: 'agent', tenantId: config.auth.tenantId }),
      toolCallStore: { record },
    });
    apps.push(app);
    const smokeHeaders = {
      authorization: headers.authorization,
      'x-jarvis-smoke': 'true',
    };

    const catalogue = await app.inject({ url: '/tools', headers: smokeHeaders });
    const notApproved = await app.inject({
      method: 'POST', url: '/tools/get_system_health', headers: smokeHeaders,
      payload: { operation: 'confirmation_test' },
    });
    const capabilities = await app.inject({
      method: 'POST', url: '/tools/get_system_health', headers: smokeHeaders,
      payload: { operation: 'list_capabilities' },
    });
    const approved = await app.inject({
      method: 'POST', url: '/tools/get_system_health',
      headers: { ...smokeHeaders, 'x-jarvis-smoke-approval': 'true' },
      payload: { operation: 'confirmation_test' },
    });
    const navigation = await app.inject({
      method: 'POST', url: '/tools/workspace_command', headers: smokeHeaders,
      payload: { commandId: 'smoke-settings', operation: 'navigate', page: 'settings' },
    });

    expect(catalogue.statusCode).toBe(200);
    expect(catalogue.json().map(({ name }: { name: string }) => name)).toEqual([
      'get_system_health', 'workspace_command', 'list_jobs', 'github_read',
    ]);
    expect(notApproved.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('Confirmation required') },
    });
    expect(capabilities.json()).toMatchObject({
      outcome: 'ok',
      result: { capabilities: [
        'Notes: vault_read', 'Calendar: calendar_today_agenda', 'GitHub tools: github_read',
      ] },
    });
    expect(approved.json()).toMatchObject({
      outcome: 'ok', result: { executed: true },
    });
    expect(navigation.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('No tab connected') },
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('records a failed research dry run without returning provider error text', async () => {
    const app = buildApp(config, undefined, {
      modules: [coreModule],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      systemSmokeProbes: {
        research: async () => { throw new Error('provider response contains private data'); },
        agent_contract: async () => ({ status: 'down', reason: 'A tool schema is not an object.' }),
        chat_canary: async () => ({ status: 'down', reason: 'agent_error' }),
      },
    });
    apps.push(app);

    const response = await app.inject({ url: '/status/smoke', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'research', status: 'down' }),
    ]));
    expect(response.body).not.toContain('provider response contains private data');
    expect(response.json().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent_contract', status: 'down', reason: 'A tool schema is not an object.' }),
    ]));
    expect(response.json().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chat_canary', status: 'down', reason: expect.any(String) }),
    ]));
    expect((await app.inject({ url: '/status', headers })).json().smoke).toEqual(response.json());
  });

  it('keeps GET /status unavailable to unauthenticated and agent-only identities', async () => {
    const noAuth = buildApp(config, undefined, { modules: [coreModule] });
    apps.push(noAuth);
    expect((await noAuth.inject({ url: '/status' })).statusCode).toBe(401);

    const agent = buildApp(config, undefined, {
      modules: [coreModule],
      auth: async () => ({ kind: 'jarvis-agent', objectId: 'agent', tenantId: config.auth.tenantId }),
    });
    apps.push(agent);
    const response = await agent.inject({ url: '/status', headers });
    expect(response.statusCode).toBe(403);
    expect((await agent.inject({ url: '/status/smoke', headers })).statusCode).toBe(403);
  });
});
