import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendModule } from '../modules.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { coreModule } from './index.js';
import { ToolFailure } from './tool-registry.js';

const config = { ...loadConfig({}), logLevel: 'info' as const };
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

interface Reply { readonly outcome: string; readonly result: Record<string, unknown>; readonly confirmation: string }

/** One write tool that runs `work`, behind the real tool route, with an audit store that can be told to fail. */
async function callWrite(work: () => unknown, audit: 'ok' | 'down' = 'ok') {
  const logs: Record<string, unknown>[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { logs.push(JSON.parse(chunk.toString()) as Record<string, unknown>); done(); } });
  const runs = { count: 0 };
  const probe: BackendModule = {
    id: 'write-outcome-test',
    tools: [{
      name: 'probe_write',
      description: 'Write something somewhere.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execution: { defaultEffect: 'action' },
      execute: async () => { runs.count += 1; return work(); },
    }],
    registerRoutes: async () => {},
  };
  const app = buildApp(config, createLogger({ logLevel: 'info' }, undefined, output), {
    modules: [coreModule, probe],
    auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
    toolCallStore: { record: async () => { if (audit === 'down') throw new Error('database password rejected'); } },
  });
  cleanups.push(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/tools/probe_write', payload: {},
    headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' },
  });
  return { response, body: response.json() as Reply, runs, logs };
}

describe('a tool that says its outcome is not known', () => {
  it('reaches the caller marked, and a failure that claims nothing happened is not marked', async () => {
    const unknown = await callWrite(() => { throw new ToolFailure('The PC did not answer in time; the action may not have happened.', { outcomeUnknown: true }); });
    expect(unknown.body).toMatchObject({ outcome: 'error', result: { error: 'The PC did not answer in time; the action may not have happened.', outcomeUnknown: true } });
    const nothing = await callWrite(() => { throw new ToolFailure('I couldn’t start that issue. Nothing was started.'); });
    expect(nothing.body.result).toEqual({ error: 'I couldn’t start that issue. Nothing was started.' });
  });
});

describe('a write whose audit row cannot be stored', () => {
  it('still answers with what the write did, once, and logs the lost row without its error text', async () => {
    const { response, body, runs, logs } = await callWrite(() => ({ status: 'commented' }), 'down');
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ outcome: 'ok', result: { status: 'commented' } });
    expect(runs.count).toBe(1);
    const lost = logs.filter((line) => line.msg === 'tool.audit_failed');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ tool: 'probe_write', outcome: 'ok', kind: 'internal' });
    expect(JSON.stringify(logs)).not.toContain('database password rejected');
  });

  it('also keeps a failure as the failure it was', async () => {
    const { response, body } = await callWrite(() => { throw new ToolFailure('Could not confirm whether it was saved.', { outcomeUnknown: true }); }, 'down');
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
  });
});
