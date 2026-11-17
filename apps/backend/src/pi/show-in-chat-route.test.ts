import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createConversationModule } from '../core/conversation.js';
import type { ConversationStore } from '../core/conversation-store.js';
import { createPiRoutes } from './routes.js';
import { createPiTurnRegistry } from './turns.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const secret = 'A'.repeat(43);
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function setup(channel: 'chat' | 'voice' = 'chat') {
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const store = { getMessageSessionId: async () => '7', getSession: async () => ({ channel }) } as unknown as ConversationStore;
  const app = buildApp(config, undefined, {
    modules: [coreModule, createConversationModule(),
      { id: 'pi', tools: [], registerRoutes: createPiRoutes({ gateway: { stream: async function* () {} } as never, registry, auth, monthlyCapDkk: 250 }) }],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
    conversationStore: store,
    toolCallStore: { record: async () => {} },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  const tool = async (name: string, args: Record<string, unknown>) => {
    id += 1;
    const response = await app.inject({
      method: 'POST', url: '/pi/mcp', remoteAddress: '10.0.0.9',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        authorization: `Bearer jp.${secret}`,
      },
      payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    });
    const body = response.body.includes('data:')
      ? response.body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : response.body;
    const json = JSON.parse(body) as Json;
    const text = json.result?.content?.[0]?.text as string | undefined;
    return text?.startsWith('{') ? JSON.parse(text) as Json : json;
  };
  return { app, registry, tool };
}

const forecast = {
  version: 1, type: 'forecast', title: 'Copenhagen · Fri 20 Nov', source: { label: 'Open-Meteo' },
  summary: 'Friday 20 November in Copenhagen: mostly cloudy, high 9 °C, low 5 °C.',
  data: { place: 'Copenhagen', date: '2026-11-20', conditions: 'Mostly cloudy', symbol: 'cloudy', highC: 9, lowC: 5 },
};

const chart = {
  version: 1, type: 'chart', title: 'Copenhagen through Friday', source: { label: 'Open-Meteo', url: 'https://open-meteo.com/', issuedAt: '2026-11-17T08:00:00Z', status: 'complete' },
  summary: 'Temperature 5 to 9 °C; rain chance 10 to 60 %.',
  data: { xLabel: 'Hour', panels: [
    { title: 'Temperature', unit: '°C', kind: 'line', series: [{ name: 'Temperature', points: [{ x: '08:00', y: 5 }, { x: '09:00', y: 6.5 }, { x: '10:00', y: null }] }] },
    { title: 'Rain probability', unit: '%', kind: 'bar', series: [{ name: 'Rain', points: [{ x: '08:00', y: 10 }, { x: '09:00', y: 60 }] }] },
  ] },
};
const view = {
  version: 1, type: 'view', title: 'Next steps', source: { label: 'Jarvis tasks' }, summary: 'Two open tasks.',
  data: { view: { version: 1, title: 'Next steps', renderer: 'list', source: { id: 'now', status: 'complete' },
    data: { items: [{ title: 'Book transport', description: 'Due Friday' }, { title: 'Update address' }] } } },
};
const table = {
  version: 1, type: 'view', title: 'Lifts', source: { label: 'Gym log' }, summary: 'Three lifts.',
  data: { view: { version: 1, title: 'Lifts', renderer: 'table', source: { id: 'now', status: 'complete' },
    data: { columns: ['Lift', 'kg'], rows: [['Squat', 100], ['Bench', 80]] } } },
};

describe('show_in_chat through the PI door', () => {
  it.each([['chart', chart], ['list', view], ['table', table]])('accepts a %s block', async (_name, block) => {
    const { app, registry, tool } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: new AbortController().signal });
    await tool('find_tools', { turn: grant.turn, query: 'show in chat' });
    const called = await tool('call_tool', { turn: grant.turn, name: 'show_in_chat', arguments: block });
    expect(called).toMatchObject({ tool: 'show_in_chat', outcome: 'ok' });
    expect(app.chatBlocks.take('7')).toHaveLength(1);
  });

  it('finds the tool, accepts a forecast, and queues it for the turn', async () => {
    const { app, registry, tool } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: new AbortController().signal });
    const found = await tool('find_tools', { turn: grant.turn, query: 'show in chat' });
    expect(found.result.tools.map((entry: { name: string }) => entry.name)).toContain('show_in_chat');
    const called = await tool('call_tool', { turn: grant.turn, name: 'show_in_chat', arguments: forecast });
    expect(called).toMatchObject({ tool: 'show_in_chat', outcome: 'ok' });
    expect(app.chatBlocks.take('7')).toHaveLength(1);
  });

  it('refuses in a voice conversation and says to use the screen', async () => {
    const { app, registry, tool } = setup('voice');
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: new AbortController().signal });
    await tool('find_tools', { turn: grant.turn, query: 'show in chat' });
    const called = await tool('call_tool', { turn: grant.turn, name: 'show_in_chat', arguments: forecast });
    expect(called).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('workspace_command') } });
    expect(app.chatBlocks.take('7')).toEqual([]);
  });
});
