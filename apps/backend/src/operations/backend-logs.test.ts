import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createBackendLogsModule } from './backend-logs.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const app = buildApp(config, undefined, {
  modules: [coreModule, createBackendLogsModule()],
  auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
  toolCallStore: { record: async () => {} },
});

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

/** One read_backend_logs call through the real dispatcher, as Jarvis makes it. */
async function callTool(payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST', url: '/tools/read_backend_logs', payload,
    headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' },
  });
  return response.json() as { outcome: string; result: { refused?: string } };
}

describe('read_backend_logs limit', () => {
  it('names the maximum when the limit is too large', async () => {
    const answer = await callTool({ limit: 500 });
    expect(answer.outcome).toBe('refused');
    expect(answer.result.refused).toContain('limit must be a whole number from 1 to 100');
  });

  it('accepts the maximum itself', async () => {
    expect((await callTool({ limit: 100 })).outcome).toBe('ok');
  });
});
