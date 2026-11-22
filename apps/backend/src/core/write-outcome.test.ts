import { Writable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendModule } from '../modules.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { coreModule } from './index.js';
import { executeReflexAction } from './reflex.js';
import { ToolFailure, type RegisteredTool } from './tool-registry.js';

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

  it('is confirmed as written, and only a failure that claims nothing happened is "Not done"', async () => {
    const unknown = await callWrite(() => { throw new ToolFailure('The PC did not answer in time; the action may not have happened.', { outcomeUnknown: true }); });
    expect(unknown.body.confirmation).toBe('The PC did not answer in time; the action may not have happened.');
    const partial = await callWrite(() => {
      throw new ToolFailure('Issue https://github.com/DanAakesen/jarvis/issues/42 was created as P11-42, but its jarvis handoff could not be confirmed. Check the issue before retrying.', { outcomeUnknown: true });
    });
    expect(partial.body.confirmation).toMatch(/^Issue \S+ was created as P11-42, but its jarvis handoff could not be confirmed\./u);
    const nothing = await callWrite(() => { throw new ToolFailure('I couldn’t start that issue. Nothing was started.'); });
    expect(nothing.body.confirmation).toBe('Not done. I couldn’t start that issue. Nothing was started.');
  });
});

describe('the reflex executor, which runs a tool without the route', () => {
  /** A reflex-safe write that fails the way `fail` says, run for a chat message as the reflex would. */
  async function reflex(fail: () => never) {
    const probe = {
      name: 'probe_write', description: 'Write something somewhere.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execution: { defaultEffect: 'action' }, reflexSafe: true, moduleId: 'probe', execute: async () => fail(),
    } as unknown as RegisteredTool;
    const request = {
      principal: { objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef' },
      log: { warn: () => undefined, info: () => undefined, error: () => undefined },
      routeOptions: { url: '/chat' },
      compileValidationSchema: () => () => true,
      server: {
        toolCallStore: { record: async () => undefined },
        jarvisActivityHub: { publish: () => undefined },
        systemHealthDiagnostics: { record: () => undefined },
      },
    } as unknown as FastifyRequest;
    return executeReflexAction(
      { addressed: true, intent: 'action', confidence: 1, needsConfirmation: false, target: { choice: 'probe', tool: probe, arguments: {} } },
      request, '101', new AbortController().signal,
    );
  }

  it('passes the flag on and relays the failure as written', async () => {
    const text = 'The PC did not answer in time; the action may not have happened.';
    const done = await reflex(() => { throw new ToolFailure(text, { outcomeUnknown: true }); });
    expect(done).toMatchObject({ outcome: 'error', result: { failure: text, outcomeUnknown: true } });
    expect(done!.note).toBe(`Reflex already did probe_write (error): ${text}`);
  });

  it('keeps "Not done." for a failure that claims nothing happened', async () => {
    const done = await reflex(() => { throw new ToolFailure('Nothing was saved.'); });
    expect(done!.result).toEqual({ failure: 'Nothing was saved.' });
    expect(done!.note).toBe('Reflex already did probe_write (error): Not done. Nothing was saved.');
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
