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
import type { PcActOptions, PcActPlanner, PcActVisionModel } from './pc-act.js';

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
  pcActVisionModel?: PcActVisionModel;
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
  tool: 'pc_open' | 'pc_close' | 'pc_media' | 'pc_active_window' | 'pc_browser_tabs' | 'pc_browser_snapshot' | 'pc_browser_act' | 'pc_act',
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

  it('opens a named installed app and refuses ambiguous or unknown names clearly', async () => {
    const { app, record } = fixture();
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      const appName = (command.arguments as Record<string, unknown>).app;
      const response = appName === 'does-not-exist'
        ? { id: command.id, type: 'error', error: 'not_found' }
        : {
          id: command.id,
          type: 'result',
          result: appName === 'Spotify'
            ? { opened: true, app: 'Spotify' }
            : { opened: false, candidates: ['Visual Studio Code', 'Visual Studio Code Insiders'] },
        };
      bridge.send(JSON.stringify(response));
    });

    const opened = await callTool(app, 'pc_open', { target: 'app', value: 'Spotify' });
    expect(opened.json()).toMatchObject({ outcome: 'ok', result: { opened: true, app: 'Spotify' } });

    const ambiguous = await callTool(app, 'pc_open', { target: 'app', value: 'Visual Studio' });
    expect(ambiguous.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'More than one installed app matches. Choose one: "Visual Studio Code", "Visual Studio Code Insiders".' },
    });

    const missing = await callTool(app, 'pc_open', { target: 'app', value: 'does-not-exist' });
    expect(missing.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'No installed app matched that name; nothing was launched.' },
    });
    const edge = await callTool(app, 'pc_open', { target: 'app', value: 'Microsoft Edge' });
    expect(edge.json()).toMatchObject({ outcome: 'refused' });
    expect(commands).toHaveLength(3);
    expect(record.mock.calls.map(([call]) => call.outcome)).toEqual(['ok', 'refused', 'refused', 'refused']);
  });

  it.each(['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute'] as const)(
    'routes pc_media %s through the authenticated bridge without confirmation',
    async (action) => {
      const runConfirmed = vi.fn(async (_summary: string, operation: () => Promise<unknown>) => operation());
      const { app, record } = fixture({ runConfirmed });
      const url = await listen(app);
      const bridge = await connectBridge(url);
      const commands: Array<Record<string, unknown>> = [];
      bridge.on('message', (data) => {
        const command = JSON.parse(data.toString()) as Record<string, unknown>;
        commands.push(command);
        bridge.send(JSON.stringify({
          id: command.id,
          type: 'result',
          result: { controlled: true, action },
        }));
      });

      const response = await callTool(app, 'pc_media', { action });

      expect(response.json()).toMatchObject({ outcome: 'ok', result: { controlled: true, action } });
      expect(commands).toMatchObject([{ command: 'media', arguments: { action } }]);
      expect(runConfirmed).not.toHaveBeenCalled();
      expect(record.mock.calls[0]?.[0]).toMatchObject({ tool: 'pc_media', outcome: 'ok' });
    },
  );

  it('closes an app by name through the bridge and refuses when no window matches', async () => {
    const runConfirmed = vi.fn(async (_summary: string, operation: () => Promise<unknown>) => operation());
    const { app, record } = fixture({ runConfirmed });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      const name = (command.arguments as Record<string, unknown>).app;
      bridge.send(JSON.stringify(name === 'Notepad'
        ? { id: command.id, type: 'error', error: 'not_found' }
        : { id: command.id, type: 'result', result: { closing: true, windows: 1 } }));
    });

    const closed = await callTool(app, 'pc_close', { app: 'Visual Studio Code - Insiders' });
    expect(closed.json()).toMatchObject({ outcome: 'ok', result: { closing: true, windows: 1 } });
    const missing = await callTool(app, 'pc_close', { app: 'Notepad' });
    expect(missing.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'No open window of that app was found; nothing was closed.' },
    });
    expect(commands).toMatchObject([
      { command: 'close_app', arguments: { app: 'Visual Studio Code - Insiders' } },
      { command: 'close_app', arguments: { app: 'Notepad' } },
    ]);
    expect(runConfirmed).not.toHaveBeenCalled();
    expect(record.mock.calls.map(([call]) => call.outcome)).toEqual(['ok', 'refused']);
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
          application: 'spotify',
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

    it('routes browser tabs, atomic snapshots and actions through the bridge and confirms irreversible clicks', async () => {
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

    it('routes keyboard and focused-text actions through the bridge with confirmation only when irreversible', async () => {
      const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
      const { app, record } = fixture({ runConfirmed });
      const url = await listen(app);
      const bridge = await connectBridge(url);
      const commands: Array<Record<string, unknown>> = [];
      bridge.on('message', (data) => {
        const command = JSON.parse(data.toString()) as Record<string, unknown>;
        commands.push(command);
        const action = (command.arguments as Record<string, unknown>).action;
        bridge.send(JSON.stringify({
          id: command.id,
          type: 'result',
          result: { acted: true, action },
        }));
      });

      const keys = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        action: 'keys',
        keys: ['Ctrl+Enter'],
        closeIntent: false,
        requiresConfirmation: true,
      });
      const typed = await callTool(app, 'pc_browser_act', {
        tabId: 'tab_1',
        snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
        action: 'type_focused',
        text: 'Daft Punk',
      });

      expect(keys.json()).toMatchObject({ outcome: 'ok', result: { acted: true, action: 'keys' } });
      expect(typed.json()).toMatchObject({ outcome: 'ok', result: { acted: true, action: 'type_focused' } });
      expect(runConfirmed).toHaveBeenCalledWith(
        'Send an irreversible keyboard action in Chrome.',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      expect(commands.map(({ arguments: arguments_ }) => arguments_)).toEqual([
        {
          tabId: 'tab_1',
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          action: 'keys',
          keys: ['Ctrl+Enter'],
          closeIntent: false,
          confirmed: true,
        },
        {
          tabId: 'tab_1',
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          action: 'type_focused',
          text: 'Daft Punk',
        },
      ]);
      expect(record.mock.calls.map(([call]) => call.arguments)).toEqual([
        { redacted: true },
        { redacted: true },
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

  it('reports offline and refuses invalid URLs, app names, and folder paths', async () => {
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
    const invalidApp = await callTool(app, 'pc_open', { target: 'app', value: 'x'.repeat(129) });
    expect(invalidApp.statusCode).toBe(400);
    expect(invalidApp.json()).toMatchObject({ error: 'Invalid request' });
    const invalidMedia = await callTool(app, 'pc_media', { action: 'execute' });
    expect(invalidMedia.statusCode).toBe(400);
    expect(invalidMedia.json()).toMatchObject({ error: 'Invalid request' });
  });

  it('transfers a transient capture above the command limit and returns only redacted pc_act activity', async () => {
    const planner: PcActPlanner = {
      decide: vi.fn()
        .mockResolvedValueOnce({ operation: 'click', confidence: 0.99, targetIndex: 0 })
        .mockResolvedValueOnce({ operation: 'done', confidence: 0.99 }),
    };
    const locateElements = vi.fn(async () => [{
      index: 0,
      role: 'button',
      name: 'Play',
      bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    }]);
    const steps: Parameters<NonNullable<PcActOptions['onStep']>>[0][] = [];
    const { app, record } = fixture({
      pcActPlanner: planner,
      pcActVisionModel: { locateElements },
      onPcActStep: (activity) => { steps.push(activity); },
    });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    let observations = 0;
    const image = Buffer.alloc(100_000);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      let result: Record<string, unknown>;
      if (command.command === 'uia_snapshot') {
        observations += 1;
        result = {
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          application: 'spotify',
          elements: observations === 1 ? [] : [
            { index: 0, role: 'button', name: 'Play' },
            { index: 1, role: 'button', name: 'Pause' },
            { index: 2, role: 'button', name: 'Next' },
          ],
        };
      } else if (command.command === 'window_capture') {
        result = {
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          application: 'spotify',
          width: 1280,
          height: 720,
          png: image.toString('base64'),
        };
      } else {
        result = { acted: true, action: 'click' };
      }
      bridge.send(JSON.stringify({ id: command.id, type: 'result', result }));
    });

    const response = await callTool(app, 'pc_act', { goal: 'Start playing' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'completed', steps: 2 } });
    expect(commands.map(({ command }) => command)).toEqual([
      'uia_snapshot', 'window_capture', 'click_point', 'uia_snapshot',
    ]);
    expect(JSON.stringify(commands)).not.toContain('image');
    expect(locateElements).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { redacted: true },
      result: { redacted: true },
    }));
    expect(JSON.stringify(steps)).not.toContain('Play');
    expect(JSON.stringify(response.json())).not.toContain(image.toString('base64'));
  });

  it('reports paused control state and refuses PC actions until resumed', async () => {
    const statuses: Array<[boolean, boolean | undefined]> = [];
    let resolvePaused!: () => void;
    let resolveResumed!: () => void;
    const paused = new Promise<void>((resolve) => { resolvePaused = resolve; });
    const resumed = new Promise<void>((resolve) => { resolveResumed = resolve; });
    const planner: PcActPlanner = {
      decide: vi.fn().mockResolvedValue({ operation: 'click', confidence: 0.99, targetIndex: 0 }),
    };
    const { app } = fixture({
      pcActPlanner: planner,
      pcActVisionModel: { locateElements: vi.fn(async () => []) },
      onStatusChange: (online, controlPaused) => {
        statuses.push([online, controlPaused]);
        if (online && controlPaused) resolvePaused();
        if (online && !controlPaused && statuses.length > 2) resolveResumed();
      },
    });
    const url = await listen(app);
    const bridge = await connectBridge(url);
    const commands: Array<Record<string, unknown>> = [];
    bridge.on('message', (data) => {
      const command = JSON.parse(data.toString()) as Record<string, unknown>;
      commands.push(command);
      const result = command.command === 'uia_snapshot'
        ? {
          snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
          application: 'spotify',
          elements: [{ index: 0, role: 'button', name: 'Search' }],
        }
        : { opened: true };
      bridge.send(JSON.stringify({ id: command.id, type: 'result', result }));
    });

    bridge.send(JSON.stringify({ type: 'status', controlPaused: true }));
    await paused;
    const blocked = await callTool(app, 'pc_open', { target: 'app', value: 'vscode' });
    expect(blocked.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Jarvis control is paused in the PC bridge. Resume it from the tray menu to act on the PC.' },
    });
    expect(commands).toHaveLength(0);
    const blockedUiAutomation = await callTool(app, 'pc_act', { goal: 'Click Search in Spotify' });
    expect(blockedUiAutomation.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Jarvis control is paused in the PC bridge. Resume it from the tray menu to act on the PC.' },
    });
    expect(commands.map(({ command }) => command)).toEqual(['uia_snapshot']);

    bridge.send(JSON.stringify({ type: 'status', controlPaused: false }));
    await resumed;
    const resumedAction = await callTool(app, 'pc_open', { target: 'app', value: 'vscode' });
    expect(resumedAction.json()).toMatchObject({ outcome: 'ok', result: { opened: true } });
    expect(commands.map(({ command }) => command)).toEqual(['uia_snapshot', 'open_app']);
    expect(statuses).toEqual([[false, false], [true, false], [true, true], [true, false]]);
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
