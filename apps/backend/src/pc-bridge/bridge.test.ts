import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { AuthenticationDenied, type TokenVerifier } from '../auth/verify.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createLogger } from '../logging.js';
import type { BackendModule } from '../modules.js';
import { createPcBridgeModule, PC_BRIDGE_SUBPROTOCOL } from './bridge.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];
const clients: WebSocket[] = [];
const agentObjectId = '3a1f0c2e-7b4d-4e8a-9c6f-1d2e3f405162';
const bridgeToken = 'bridge.payload.signature';
const agentToken = 'agent.payload.signature';
const danToken = 'dan.payload.signature';

afterEach(async () => {
  const remainingClients = clients.splice(0);
  const closing = remainingClients.map((client) => new Promise<void>((resolve) => {
    if (client.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    client.once('close', () => resolve());
    client.close();
  }));
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(closing);
});

function fixture(options: { timeoutMs?: number; onStatusChange?: (online: boolean) => void } = {}) {
  const output = new Writable({ write(_chunk: Buffer, _encoding, done) { done(); } });
  const record = vi.fn(async () => {});
  const module: BackendModule = createPcBridgeModule(options);
  const auth: TokenVerifier = async (token) => {
    if (token === bridgeToken) {
      return { kind: 'jarvis-pc-bridge', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId };
    }
    if (token === agentToken) {
      return { kind: 'jarvis-agent', objectId: agentObjectId, tenantId: config.auth.tenantId };
    }
    if (token === danToken) {
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' };
    }
    throw new AuthenticationDenied(401);
  };
  const app = buildApp(config, createLogger(config, undefined, output), {
    auth,
    modules: [coreModule, module],
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, record };
}

async function listen(app: ReturnType<typeof buildApp>): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  return `ws://127.0.0.1:${address.port}/pc-bridge/connect`;
}

async function connectBridge(url: string, token = bridgeToken): Promise<WebSocket> {
  const client = new WebSocket(url, [PC_BRIDGE_SUBPROTOCOL], {
    headers: { authorization: ['Bearer', token].join(' ') },
  });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  return client;
}

async function callTool(
  app: ReturnType<typeof buildApp>,
  tool: 'pc_open' | 'pc_active_window',
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/tools/${tool}`,
    headers: { authorization: ['Bearer', agentToken].join(' '), 'x-jarvis-message-id': '42' },
    payload,
  });
}

describe('authenticated PC bridge protocol', () => {
  it('routes allow-listed open and active-window tools through a fake bridge', async () => {
    const statuses: boolean[] = [];
    const { app, record } = fixture({ onStatusChange: (online) => statuses.push(online) });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      bridge.send(JSON.stringify({
        id: command.id,
        type: 'result',
        result: command.command === 'active_window' ? { title: 'Jarvis - Visual Studio Code' } : { opened: true },
      }));
    });

    const opened = await callTool(app, 'pc_open', { target: 'app', value: 'vscode' });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ outcome: 'ok', result: { opened: true } });
    const active = await callTool(app, 'pc_active_window', {});
    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({
      outcome: 'ok',
      result: { title: 'Jarvis - Visual Studio Code' },
    });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      type: 'command',
      command: 'open_app',
      arguments: { app: 'vscode' },
    });
    expect(commands[1]).toMatchObject({ command: 'active_window', arguments: {} });
    expect(new Set(commands.map(({ id }) => id)).size).toBe(2);
    expect(record).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual([false, true]);
  });

  it('reports offline and refuses inputs outside the backend allow-list', async () => {
    const { app } = fixture();
    await app.ready();

    const offline = await callTool(app, 'pc_open', { target: 'app', value: 'vscode' });
    expect(offline.statusCode).toBe(200);
    expect(offline.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'The local PC bridge is offline.' },
    });
    const invalidUrl = await callTool(app, 'pc_open', { target: 'url', value: 'javascript:alert(1)' });
    expect(invalidUrl.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Only valid HTTP or HTTPS URLs can be opened.' },
    });
    const traversal = await callTool(app, 'pc_open', { target: 'folder', value: '..\\secrets' });
    expect(traversal.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Choose a folder under C:\\Repo using a relative path.' },
    });
  });

  it('waits for the final status write before backend shutdown completes', async () => {
    let finishStatusWrite!: () => void;
    const statusWrite = new Promise<void>((resolve) => { finishStatusWrite = resolve; });
    const statuses: boolean[] = [];
    const { app } = fixture({
      onStatusChange: (online) => {
        statuses.push(online);
        if (!online) return statusWrite;
      },
    });
    await app.ready();

    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finishStatusWrite();
    await closing;

    expect(statuses).toEqual([false]);
    expect(closed).toBe(true);
  });

  it('refuses Dan and the hosted agent as bridge clients', async () => {
    const { app } = fixture();
    await app.ready();

    for (const token of [danToken, agentToken]) {
      const response = await app.inject({
        url: '/pc-bridge/connect',
        headers: { authorization: ['Bearer', token].join(' ') },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('sanitizes bridge timeouts and ignores responses with unknown command IDs', async () => {
    const { app } = fixture({ timeoutMs: 30 });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    bridge.on('message', () => {
      bridge.send(JSON.stringify({
        id: '00000000-0000-4000-8000-000000000000',
        type: 'result',
        result: { title: 'not this command' },
      }));
    });

    const response = await callTool(app, 'pc_active_window', {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'Tool execution failed' },
    });
    expect(response.body).not.toContain('not this command');
  });
});
