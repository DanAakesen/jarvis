import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendModule } from '../modules.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logging.js';
import { coreModule } from './index.js';
import type { ToolEffect } from './tool-registry.js';

const config = { ...loadConfig({}), logLevel: 'info' as const };
const agentToken = 'header.agent.signature';
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** A service that performs the side effect of every request it receives, then drops the connection without answering. */
async function droppingService(): Promise<{ url: string; sideEffects: () => number }> {
  let sideEffects = 0;
  const server: Server = createServer((request) => { sideEffects += 1; request.socket.destroy(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, sideEffects: () => sideEffects };
}

async function refusedUrl(): Promise<string> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return `http://127.0.0.1:${port}/`;
}

/** A tool that says what each of its operations does, as `effectOf` reads it. */
const classifiedOperations = { field: 'operation', effects: { list: 'read', create: 'action' } } as const;

/** `effect`: the tool's own declared effect (none when absent). `operation`: a tool that classifies its operations, called with that one. */
async function call(spec: { readonly effect?: ToolEffect; readonly operation?: string }, url: string) {
  const records: string[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, done) { records.push(chunk.toString()); done(); } });
  const stored: { outcome: string }[] = [];
  const tools: BackendModule = {
    id: 'tool-failure-test',
    tools: [{
      name: 'send_it',
      description: 'Send a request to a service.',
      inputSchema: { type: 'object', properties: { operation: { type: 'string' } }, additionalProperties: false },
      ...(spec.operation !== undefined ? { execution: { defaultEffect: 'action' as const, operation: classifiedOperations } }
        : spec.effect === undefined ? {} : { execution: { defaultEffect: spec.effect } }),
      execute: async (input) => {
        const reads = spec.effect === 'read' || (input as { operation?: string }).operation === 'list';
        await fetch(url, { method: reads ? 'GET' : 'POST', body: reads ? undefined : 'x' });
        return {};
      },
    }],
    registerRoutes: async () => {},
  };
  const app = buildApp(config, createLogger({ logLevel: 'info' }, undefined, output), {
    modules: [coreModule, tools],
    auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
    toolCallStore: { record: async (record) => { stored.push(record); } },
  });
  cleanups.push(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/tools/send_it',
    headers: { authorization: ['Bearer', agentToken].join(' '), 'x-jarvis-message-id': '101' },
    payload: spec.operation === undefined ? {} : { operation: spec.operation },
  });
  const logged = records.map((record) => JSON.parse(record) as Record<string, unknown>).filter((record) => record.msg === 'tool.execution_failed');
  return { response, body: response.json() as { outcome: string; result: Record<string, unknown>; confirmation: string }, stored, logged, records };
}

describe('a tool whose request was delivered and then dropped', () => {
  it.each(['action', 'unclassified', undefined] as const)('does not say "Not done." for a write with effect %s that ran once', async (effect) => {
    const service = await droppingService();
    const { response, body, stored, logged, records } = await call(effect === undefined ? {} : { effect }, service.url);

    expect(response.statusCode).toBe(200);
    expect(service.sideEffects()).toBe(1);
    expect(body.outcome).toBe('error');
    expect(body.confirmation).toBe('The connection dropped before it finished, so it may or may not have gone through. Check before trying again.');
    expect(body.confirmation).not.toMatch(/Not done|could not reach/u);
    expect(body.result).toEqual({ error: body.confirmation, outcomeUnknown: true });
    expect(stored).toEqual([expect.objectContaining({ outcome: 'error' })]);
    expect(logged).toEqual([expect.objectContaining({
      level: 40, tool: 'send_it', failureClass: 'dropped', effect: effect ?? 'unclassified', errorName: 'TypeError', causeCode: 'UND_ERR_SOCKET',
    })]);
    expect(records.join('')).not.toMatch(/other side closed|fetch failed|127\.0\.0\.1/u);
  });

  it('says plainly that nothing changed for a read-only tool', async () => {
    const service = await droppingService();
    const { body } = await call({ effect: 'read' }, service.url);
    expect(body.confirmation).toBe('Not done. The connection dropped before it finished.');
    expect(body.result).toEqual({ error: 'The connection dropped before it finished.' });
  });

  it('judges a tool that classifies its operations by the operation the call named', async () => {
    const reading = await call({ operation: 'list' }, (await droppingService()).url);
    expect(reading.body.confirmation).toBe('Not done. The connection dropped before it finished.');
    expect(reading.logged).toEqual([expect.objectContaining({ effect: 'read' })]);
    const writing = await call({ operation: 'create' }, (await droppingService()).url);
    expect(writing.body.confirmation).toBe('The connection dropped before it finished, so it may or may not have gone through. Check before trying again.');
    expect(writing.logged).toEqual([expect.objectContaining({ effect: 'action' })]);
    // An operation the tool does not classify is not assumed to be harmless.
    const unnamed = await call({ operation: 'archive' }, (await droppingService()).url);
    expect(unnamed.body.confirmation).toMatch(/may or may not have gone through/u);
    expect(unnamed.logged).toEqual([expect.objectContaining({ effect: 'unclassified' })]);
  });
});

describe('a tool that never reached its service', () => {
  it('says the request was not sent, with no claim about the whole tool', async () => {
    const { body, logged } = await call({ effect: 'action' }, await refusedUrl());
    expect(body.confirmation).toBe('It could not reach the service it needs, so that request was not sent.');
    expect(logged).toEqual([expect.objectContaining({ failureClass: 'not_sent', effect: 'action', causeCode: 'ECONNREFUSED' })]);
  });

  it('says plainly that nothing changed for a read-only tool', async () => {
    const { body } = await call({ effect: 'read' }, await refusedUrl());
    expect(body.confirmation).toBe('Not done. It could not reach the service it needs.');
  });
});
