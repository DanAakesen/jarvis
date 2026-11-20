import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createPiAuth } from '../../auth/pi-credential.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import { factoryTools } from '../../factory/tools.js';
import { createPiRoutes } from '../routes.js';
import { createPiTurnRegistry } from '../turns.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const secret = 'A'.repeat(43);
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const live = () => new AbortController().signal;

function setup() {
  const archived: string[] = [];
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const project = { id: '5', name: 'Garden', repo: 'DanAakesen/garden', default_branch: 'main', default_agent: 'codex', policy: 'standard', sandbox_size: 'small', tech: [], max_parallel_tasks: 1, description: '', active: true };
  const app = buildApp(config, undefined, {
    modules: [coreModule, { id: 'factory', tools: factoryTools.filter(({ name }) => name === 'archive_project'),
      registerRoutes: createPiRoutes({ gateway: { stream: async function* () {} } as never, registry, auth, monthlyCapDkk: 250 }) }],
    auth: async () => { throw new Error('rejected'); },
    toolCallStore: { record: async () => {} },
    projectStore: { list: async () => [project], archive: async (id: string) => { archived.push(id); return true; } } as never,
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  async function tool(name: string, args: Record<string, unknown>) {
    id += 1;
    const response = await app.inject({
      method: 'POST', url: '/pi/mcp', remoteAddress: '10.0.0.9',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: bearer(`jp.${secret}`) },
      payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    });
    const line = response.body.split('\n').find((candidate) => candidate.startsWith('data:'))!;
    return JSON.parse(JSON.parse(line.slice(5)).result.content[0].text) as { outcome: string; result: Record<string, unknown> };
  }
  const wake = () => registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', brain: { runId: 'run-1', sent: [], wrote: [], looked: [] }, signal: live() });
  return { tool, wake, archived };
}

describe('a wake acts without an owner message', () => {
  it('runs a tool that normally proves a Dan message, as the PI agent', async () => {
    const { tool, wake, archived } = setup();
    const grant = wake();
    await tool('find_tools', { turn: grant.turn, query: 'archive project' });
    const done = await tool('call_tool', { turn: grant.turn, name: 'archive_project', arguments: { projectId: '5' } });
    expect(done).toMatchObject({ outcome: 'ok', result: { status: 'archived', projectId: '5' } });
    expect(archived).toEqual(['5']);
    expect(grant.evidence).toMatchObject([{
      tool: 'archive_project',
      kind: 'committed',
      operation: 'delete',
    }]);
    expect(grant.unverified.count).toBe(0);
  });
});
