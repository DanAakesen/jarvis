import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SystemHealth, SystemStatus, WorkStatus } from '@jarvis/contracts';
import { systemSmokeCheckIds } from '@jarvis/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createSystemStatusReader } from '../system-status.js';
import type { CredentialStatus, CredentialStatusStore } from '../credentials/credential-status.js';
import type { ProjectStore } from '../factory/projects.js';
import type { ReleaseViewRecords } from '../factory/release-view.js';
import { coreModule } from './index.js';
import { getSystemHealth, SystemHealthDiagnostics } from './system-health.js';

const at = '2026-10-10T12:00:00.000Z';
const now = Date.parse(at);
const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}`,
  'x-jarvis-message-id': '42' };
const ids = ['database', 'foundry.chat', 'foundry.voice', 'foundry.embeddings', 'vault_index',
  'github_app', 'google', 'pc_bridge', 'runner', 'deployed_commit', 'last_error'] as const;
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(extraTools = false) {
  const snapshot: SystemStatus = { checkedAt: at,
    entries: ids.map((id) => ({ id, status: 'ok', checkedAt: at, details: { private: 'private-text' } })),
    smoke: { checkedAt: at, entries: systemSmokeCheckIds.map((id) => ({ id, status: 'ok', checkedAt: at })) } };
  const credentials: CredentialStatus[] = ['codex-login', 'copilot-token', 'github-app', 'github-app-key']
    .map((name) => ({ name: name as CredentialStatus['name'], expiresAt: null, lastCheckedAt: at,
      lastRenewedAt: at, status: 'ok' }));
  const records: ReleaseViewRecords = { releases: [], pullRequests: [], workflowRuns: [],
    deployments: [{ id: '1', releaseId: '1', environment: 'production', status: 'success', at }] };
  const reader = { read: vi.fn(async () => snapshot), peek: vi.fn(() => snapshot),
    refresh: vi.fn(async () => snapshot), recordError: vi.fn(), recordSmoke: vi.fn() };
  const record = vi.fn(async () => {});
  const listCredentials = vi.fn(async () => credentials);
  const app = buildApp(config, undefined, {
    modules: [coreModule, ...(extraTools ? [{ id: 'recovery', registerRoutes: async () => {}, tools: ['retry_job', 'get_work_status', 'get_deployment_status']
      .map((name) => ({ name, description: 'Existing recovery', inputSchema: { type: 'object' },
        execute: vi.fn(async () => ({})) })) }] : [])],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    systemStatusReader: reader, toolCallStore: { record },
    credentialStatusStore: { list: listCredentials } as unknown as CredentialStatusStore,
    projectStore: { list: async () => [{ id: '7', repo: 'DanAakesen/jarvis', active: true }] } as unknown as ProjectStore,
    releaseViewStore: { read: async () => records, projectForRelease: async () => null },
  });
  apps.push(app);
  app.systemHealthDiagnostics.recordWork({ partial: false, verdict: 'delivered' } as WorkStatus);
  return { app, snapshot, credentials, records, reader, record, listCredentials };
}

afterEach(async () => { vi.useRealTimers(); await Promise.all(apps.splice(0).map((app) => app.close())); });
const component = (health: SystemHealth, id: string) => health.components.find((item) => item.id === id)!;
const health = (app: ReturnType<typeof buildApp>) => getSystemHealth(app, new AbortController().signal, now);

describe('structured system health', () => {
  it('returns all-ok components in fixed order without probing or exposing private text', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const f = fixture();
    const result = await health(f.app);
    expect(result.components).toHaveLength(26);
    expect(result.components.every((item) => item.status === 'ok' && item.recovery.length === 0)).toBe(true);
    expect(result.components.map(({ id }) => id)).toEqual([...ids, ...systemSmokeCheckIds.map((id) => `smoke.${id}`),
      ...f.credentials.map(({ name }) => `credential.${name}`), 'background_jobs', 'deployment', 'work',
      'tool.invalid_arguments', 'tool.failures']);
    f.snapshot.entries = [...f.snapshot.entries].reverse();
    expect(await health(f.app)).toEqual(result);
    expect(f.reader.read).not.toHaveBeenCalled();
    expect(f.reader.refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-text');
    expect(JSON.stringify(result).length).toBeLessThan(8_000);
  });

  it.each(['degraded', 'down'] as const)('reports one %s component and a fixed failure reason', async (status) => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const f = fixture();
    f.snapshot.entries = f.snapshot.entries.map((item) => item.id === 'google'
      ? { ...item, status, details: { reason: 'check_failed', stack: 'private-stack' } } : item);
    const result = await health(f.app);
    expect(component(result, 'google')).toMatchObject({ status, detail: 'Component check failed.', checkedAt: at });
    expect(result.components.filter((item) => item.status !== 'ok')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('private-stack');
  });

  it('reports expired and expiring credentials and offers renewal only for Codex', async () => {
    const f = fixture();
    f.credentials[0]!.expiresAt = at;
    f.credentials[1]!.expiresAt = new Date(now + 60_000).toISOString();
    const result = await health(f.app);
    expect(component(result, 'credential.codex-login')).toMatchObject({ status: 'down',
      detail: 'Credential has expired.', recovery: [{ tool: 'renew_credential' }] });
    expect(component(result, 'credential.copilot-token')).toMatchObject({ status: 'degraded', recovery: [] });
  });

  it('reports absent, failed and stale sources as unknown rather than inventing health', async () => {
    const f = fixture();
    f.reader.peek.mockReturnValue(undefined as unknown as SystemStatus);
    f.listCredentials.mockRejectedValue(new Error('private credential error'));
    vi.spyOn(f.app.backgroundJobs, 'list').mockRejectedValue(new Error('private job error'));
    f.app.releaseViewStore = null;
    const result = await health(f.app);
    for (const id of ['database', 'smoke.research', 'credential.codex-login', 'background_jobs', 'deployment']) {
      expect(component(result, id).status).toBe('unknown');
    }
    expect(JSON.stringify(result)).not.toContain('private');
    f.reader.peek.mockReturnValue(f.snapshot);
    f.snapshot.entries = [{ id: 'google', status: 'ok', checkedAt: '2026-10-10T10:00:00.000Z' }];
    expect(component(await health(f.app), 'google')).toMatchObject({ status: 'unknown', checkedAt: '2026-10-10T10:00:00.000Z' });
  });

  it('never starts probes even when the status cache expires or an error invalidates it', async () => {
    const f = fixture();
    let clock = now;
    const probe = vi.fn(async () => ({ status: 'ok' as const }));
    const reader = createSystemStatusReader({ google: probe }, undefined, () => clock, 1);
    f.app.systemStatusReader = reader;
    expect(component(await health(f.app), 'google').status).toBe('unknown');
    await reader.read();
    clock += 2;
    expect(component(await health(f.app), 'google').status).toBe('ok');
    reader.recordError('/private', 500);
    expect(component(await getSystemHealth(f.app, new AbortController().signal, clock), 'last_error').status).toBe('degraded');
    expect(probe).toHaveBeenCalledOnce();
  });

  it('uses retained deployment evidence and never suggests unregistered recovery tools', async () => {
    const f = fixture();
    f.records.deployments = [{ ...f.records.deployments[0]!, status: 'failure' }];
    expect(component(await health(f.app), 'deployment')).toMatchObject({ status: 'down', recovery: [] });
    const g = fixture(true);
    g.records.deployments = [{ ...g.records.deployments[0]!, status: 'failure' }];
    expect(component(await health(g.app), 'deployment')).toMatchObject({ status: 'down',
      recovery: [{ tool: 'get_deployment_status' }] });
    g.records.workflowRuns = [{ id: '2', workflow: 'Deploy', trigger: 'push', headSha: 'a'.repeat(40),
      status: 'in_progress', conclusion: null, startedAt: at, completedAt: null, releaseId: null,
      pullRequestNumber: null, taskId: null }];
    expect(component(await health(g.app), 'deployment').status).toBe('degraded');
  });

  it('counts recent failed jobs and offers retry only for an eligible job', async () => {
    const f = fixture(true);
    const job = await f.app.backgroundJobs.start('research', 'private topic', 2, undefined, undefined,
      { retryInput: { topic: 'private topic', depth: 'quick' } });
    await job.fail('private-stack');
    const result = await getSystemHealth(f.app, new AbortController().signal);
    expect(component(result, 'background_jobs')).toMatchObject({ status: 'degraded', recovery: [{ tool: 'retry_job' }] });
    expect(JSON.stringify(result)).not.toMatch(/private topic|private-stack/u);
    expect(component(await getSystemHealth(f.app, new AbortController().signal, Date.now() + 2 * 60 * 60_000),
      'background_jobs')).toMatchObject({ status: 'ok', recovery: [] });
  });

  it('records bounded rolling tool counts and stores only safe work verdicts', () => {
    let clock = now;
    const diagnostics = new SystemHealthDiagnostics(() => clock);
    for (let i = 0; i < 1_100; i++) diagnostics.record('invalid');
    diagnostics.record('failed');
    expect(diagnostics.counts()).toEqual({ invalid: 1_000, failed: 1 });
    diagnostics.recordWork({ partial: true, verdict: 'delivered', warnings: ['private-text'] } as WorkStatus);
    expect(diagnostics.peekWork()).toMatchObject({ status: 'unknown', detail: 'Latest work lookup was incomplete.' });
    expect(JSON.stringify(diagnostics.peekWork())).not.toContain('private-text');
    clock += 61 * 60_000;
    expect(diagnostics.counts()).toEqual({ invalid: 0, failed: 0 });
  });

  it('exposes an authenticated flat-schema HTTP tool and counts invalid arguments', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/tools/get_system_health', headers, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { components: expect.any(Array) } });
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ tool: 'get_system_health', arguments: {} }));
    const invalid = await f.app.inject({ method: 'POST', url: '/tools/get_system_health', headers, payload: { extra: 'private-text' } });
    expect(invalid.json().outcome).toBe('refused');
    expect(f.app.systemHealthDiagnostics.counts().invalid).toBe(1);
    expect((await f.app.inject({ method: 'POST', url: '/tools/get_system_health', payload: {} })).statusCode).toBe(401);
    expect(f.app.jarvisTools.get('get_system_health')!.inputSchema).toEqual({
      type: 'object', properties: {}, additionalProperties: false });
  });
});
