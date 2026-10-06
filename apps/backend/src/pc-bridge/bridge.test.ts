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
import type { PcActOptions, PcActPlanner } from './pc-act.js';

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

function fixture(options: {
  timeoutMs?: number;
  onStatusChange?: (online: boolean) => void;
  pcActPlanner?: PcActPlanner;
  onPcActStep?: PcActOptions['onStep'];
  runConfirmed?: <T>(summary: string, action: () => Promise<T>, signal: AbortSignal) => Promise<T>;
} = {}) {
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
  tool: 'pc_open' | 'codex_prompt' | 'pc_active_window' | 'pc_browser_tabs' | 'pc_browser_snapshot' | 'pc_browser_act' | 'pc_act',
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

  it('opens repo files and folders through VS Code and refuses paths outside the repo root', async () => {
    const { app } = fixture();
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      bridge.send(JSON.stringify({ id: command.id, type: 'result', result: { opened: true } }));
    });

    const folder = await callTool(app, 'pc_open', { target: 'folder', value: 'jarvis\\apps\\backend' });
    const file = await callTool(app, 'pc_open', { target: 'file', value: 'jarvis\\apps\\backend\\src\\index.ts' });
    const outside = await callTool(app, 'pc_open', { target: 'file', value: '..\\secrets.txt' });

    expect(folder.json()).toMatchObject({ outcome: 'ok', result: { opened: true } });
    expect(file.json()).toMatchObject({ outcome: 'ok', result: { opened: true } });
    expect(outside.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Choose a file under C:\\Repo using a relative path.' },
    });
    expect(commands.map(command => command.command)).toEqual(['open_folder', 'open_file']);
    expect(commands[1]!.arguments).toEqual({ relativePath: 'jarvis\\apps\\backend\\src\\index.ts' });
  });

  it('types a Codex prompt without confirmation and confirms its submission', async () => {
    const prompt = 'Delete the generated file only after reviewing the diff.';
    const planner: PcActPlanner = {
      decide: vi.fn()
        .mockResolvedValueOnce({ operation: 'type', confidence: 0.99, targetIndex: 0, text: prompt })
        .mockResolvedValueOnce({ operation: 'click', confidence: 0.99, targetIndex: 1 })
        .mockResolvedValueOnce({ operation: 'done', confidence: 0.99 }),
    };
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
    const { app, record } = fixture({ pcActPlanner: planner, runConfirmed });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      const arguments_ = command.arguments as Record<string, unknown>;
      const result = command.command === 'open_app'
        ? { opened: true }
        : command.command === 'uia_snapshot'
          ? {
            snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
            application: 'codex',
            elements: [
              { index: 0, role: 'edit', name: 'Prompt' },
              { index: 1, role: 'button', name: 'Send' },
            ],
          }
          : { acted: true, action: arguments_.action };
      bridge.send(JSON.stringify({ id: command.id, type: 'result', result }));
    });

    const response = await callTool(app, 'codex_prompt', { prompt });

    expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed' } });
    expect(commands.map(command => command.command)).toEqual([
      'open_app', 'uia_snapshot', 'uia_act', 'uia_snapshot', 'uia_act', 'uia_snapshot',
    ]);
    expect(commands[0]!.arguments).toEqual({ app: 'codex' });
    expect(commands[2]!.arguments).toMatchObject({ action: 'type', text: prompt, confirmed: false });
    expect(commands[4]!.arguments).toMatchObject({ action: 'click', confirmed: true });
    expect(runConfirmed).toHaveBeenCalledWith(
      'Click the button "Send" in Codex.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(record.mock.calls.map(([call]) => call.arguments)).toEqual([{ redacted: true }]);
    expect(record.mock.calls.map(([call]) => call.result)).toEqual([{ redacted: true }]);
  });

  it('clearly refuses a Codex prompt when the desktop app is not installed', async () => {
    const planner: PcActPlanner = { decide: vi.fn() };
    const { app } = fixture({ pcActPlanner: planner });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      bridge.send(JSON.stringify({ id: command.id, type: 'error', error: 'not_installed' }));
    });

    const response = await callTool(app, 'codex_prompt', { prompt: 'Review the current task.' });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Codex desktop app is not installed on Dan’s PC.' },
    });
    expect(planner.decide).not.toHaveBeenCalled();
  });

  it('runs pc_act through the authenticated bridge and redacts its audit and step activity', async () => {
    const onPcActStep = vi.fn();
    const planner: PcActPlanner = {
      decide: vi.fn()
        .mockResolvedValueOnce({ operation: 'click', confidence: 0.99, targetIndex: 0 })
        .mockResolvedValueOnce({ operation: 'done', confidence: 0.99 }),
    };
    const { app, record } = fixture({ pcActPlanner: planner, onPcActStep });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      const result = command.command === 'uia_snapshot'
        ? {
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          application: 'vscode',
          elements: [{ index: 0, role: 'button', name: 'Open project' }],
        }
        : { acted: true, action: 'click' };
      bridge.send(JSON.stringify({ id: command.id, type: 'result', result }));
    });

    const response = await callTool(app, 'pc_act', { goal: 'Open the project' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { status: 'completed', steps: 2 },
    });
    expect(commands.map(command => command.command)).toEqual([
      'uia_snapshot', 'uia_act', 'uia_snapshot',
    ]);
    expect(commands[1]!.arguments).toMatchObject({ action: 'click', confirmed: false });
    expect(planner.decide).toHaveBeenCalledTimes(2);
    expect(onPcActStep.mock.calls.map(([event]) => event)).toEqual([
      { step: 1, action: 'click', outcome: 'completed' },
      { step: 2, action: 'done', outcome: 'completed' },
    ]);
    expect(record.mock.calls.map(([call]) => call.arguments)).toEqual([{ redacted: true }]);
    expect(record.mock.calls.map(([call]) => call.result)).toEqual([{ redacted: true }]);
    expect(JSON.stringify({ response: response.json(), activity: onPcActStep.mock.calls, commands }))
      .not.toMatch(/Open project|Open the project|secret|screenshot/iu);
  });

  it('routes URL targets through the bridge and preserves its disconnected-extension fallback note', async () => {
    const { app } = fixture();
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const fallbackNote = "Opened in Chrome directly because the Jarvis Chrome extension isn't connected.";
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      bridge.send(JSON.stringify({
        id: command.id,
        type: 'result',
        result: { opened: true, note: fallbackNote },
      }));
    });

    const opened = await callTool(app, 'pc_open', { target: 'url', value: 'https://google.com' });

    expect(opened.json()).toMatchObject({
      outcome: 'ok',
      result: { opened: true, note: fallbackNote },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      command: 'open_url',
      arguments: { url: 'https://google.com/' },
    });
  });

    it('routes browser tabs, atomic snapshots and actions through the bridge and confirms risky clicks', async () => {
      const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
      const { app, record } = fixture({ runConfirmed });
      const url = await listen(app);
      const bridge = await connectBridge(url);
      const commands: Array<Record<string, unknown>> = [];
      bridge.on('message', (data) => {
        const command = JSON.parse(data.toString()) as Record<string, unknown>;
        commands.push(command);
        const name = command.command;
        const result = name === 'browser_tabs'
          ? { tabs: [{ id: 'tab_1', title: 'Search', url: 'https://example.test/', focused: true }], nextOffset: null }
          : name === 'browser_snapshot'
            ? {
              tabId: 'tab_1',
              snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
              title: 'Search',
              url: 'https://example.test/',
              elements: [{ index: 0, role: 'button', name: 'Send message', value: '' }],
            }
              : (command.arguments as Record<string, unknown>).action !== 'click'
                ? { acted: true, action: (command.arguments as Record<string, unknown>).action }
                : (command.arguments as Record<string, unknown>).confirmed === true
                  ? { acted: true, action: 'click' }
                  : { confirmationRequired: true, actionKind: 'computer_use', summary: 'Click "Send message" in Chrome.' };
        bridge.send(JSON.stringify({ id: command.id, type: 'result', result }));
      });

      const tabs = await callTool(app, 'pc_browser_tabs', {});
      expect(tabs.json()).toMatchObject({
        outcome: 'ok',
        result: { tabs: [{ id: 'tab_1', title: 'Search', focused: true }], nextOffset: null },
      });
      const snapshot = await callTool(app, 'pc_browser_snapshot', { tabId: 'tab_1' });
      expect(snapshot.json()).toMatchObject({
        outcome: 'ok',
        result: { elements: [{ index: 0, role: 'button', name: 'Send message' }] },
      });
      const typed = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        elementIndex: 0,
        action: 'type',
        text: 'sample text',
      });
      expect(typed.json()).toMatchObject({ outcome: 'ok', result: { acted: true, action: 'type' } });
      const action = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        elementIndex: 0,
        action: 'click',
      });
      expect(action.json()).toMatchObject({ outcome: 'ok', result: { acted: true, action: 'click' } });
      expect(runConfirmed).toHaveBeenCalledWith(
        'Click "Send message" in Chrome.',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      expect(commands.map(command => command.command)).toEqual([
        'browser_tabs', 'browser_snapshot', 'browser_act', 'browser_act', 'browser_act',
      ]);
      expect(commands[2]!.arguments).toMatchObject({ action: 'type', text: 'sample text' });
      expect((commands[2]!.arguments as Record<string, unknown>).confirmed).toBeUndefined();
      expect((commands[3]!.arguments as Record<string, unknown>).confirmed).toBe(false);
      expect((commands[4]!.arguments as Record<string, unknown>).confirmed).toBe(true);
      expect(record.mock.calls.map(([call]) => call.arguments)).toEqual([
        { redacted: true }, { redacted: true }, { redacted: true }, { redacted: true },
      ]);
      expect(record.mock.calls.map(([call]) => call.result)).toEqual([
        { redacted: true }, { redacted: true }, { redacted: true }, { redacted: true },
      ]);
    });

    it.each(['Submit order', 'Purchase now', 'Send message'])(
      'uses P7-03 confirmation before clicking %s',
      async (label) => {
        const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
        const { app } = fixture({ runConfirmed });
        const url = await listen(app);
        const bridge = await connectBridge(url);
        const commands: Array<Record<string, unknown>> = [];
        bridge.on('message', (data) => {
          const command = JSON.parse(data.toString()) as Record<string, unknown>;
          commands.push(command);
          const arguments_ = command.arguments as Record<string, unknown>;
          const result = command.command === 'browser_snapshot'
            ? {
              tabId: 'tab_1',
              snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
              title: 'Checkout',
              url: 'https://example.test/',
              elements: [{ index: 0, role: 'button', name: label, value: '' }],
            }
            : arguments_.confirmed === true
              ? { acted: true, action: 'click' }
              : { confirmationRequired: true, actionKind: 'computer_use', summary: `Click "${label}" in Chrome.` };
          bridge.send(JSON.stringify({ id: command.id, type: 'result', result }));
        });

        await callTool(app, 'pc_browser_snapshot', { tabId: 'tab_1' });
        const response = await callTool(app, 'pc_browser_act', {
          tabId: 'tab_1',
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          elementIndex: 0,
          action: 'click',
        });

        expect(response.json()).toMatchObject({ outcome: 'ok', result: { acted: true, action: 'click' } });
        expect(runConfirmed).toHaveBeenCalledWith(`Click "${label}" in Chrome.`, expect.any(Function), expect.any(AbortSignal));
        expect(commands.map(({ command }) => command)).toEqual(['browser_snapshot', 'browser_act', 'browser_act']);
        expect(commands.map(({ arguments: arguments_ }) => (arguments_ as Record<string, unknown>).confirmed))
          .toEqual([undefined, false, true]);
      },
    );

    it('does not forward model selectors and refuses high-impact actions without confirmation', async () => {
      const { app } = fixture();
      const url = await listen(app);
      const bridge = await connectBridge(url);
      const commands: Array<Record<string, unknown>> = [];
      bridge.on('message', (data) => {
        const command = JSON.parse(data.toString()) as Record<string, unknown>;
        commands.push(command);
        bridge.send(JSON.stringify({
          id: command.id,
          type: 'result',
          result: { confirmationRequired: true, actionKind: 'computer_use', summary: 'Delete this item in Chrome.' },
        }));
      });

      const malformed = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        elementIndex: 0,
        action: 'click',
        selector: '#delete',
      });
      expect(malformed.json()).toMatchObject({ outcome: 'refused' });
      expect(commands).toHaveLength(1);
      expect(commands[0]!.arguments).toEqual({
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        elementIndex: 0,
        action: 'click',
        confirmed: false,
      });
      expect(JSON.stringify(commands[0])).not.toContain('#delete');

      const refused = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        elementIndex: 0,
        action: 'click',
      });
      expect(refused.json()).toMatchObject({
        outcome: 'refused',
        result: { refused: 'Dan’s confirmation service is unavailable; the browser action was not performed.' },
      });
      expect(commands).toHaveLength(2);
      expect((commands[1]!.arguments as Record<string, unknown>).confirmed).toBe(false);
    });

    it('returns safe refusals for stale or covered browser targets', async () => {
      const { app } = fixture();
      const url = await listen(app);
      const bridge = await connectBridge(url);
      bridge.on('message', (data) => {
        const command = JSON.parse(data.toString()) as Record<string, unknown>;
        bridge.send(JSON.stringify({ id: command.id, type: 'error', error: 'covered' }));
      });
      const response = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        elementIndex: 0,
        action: 'click',
      });
      expect(response.json()).toMatchObject({
        outcome: 'refused',
        result: { refused: 'That browser element is covered by another page element; it was not activated.' },
      });
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
