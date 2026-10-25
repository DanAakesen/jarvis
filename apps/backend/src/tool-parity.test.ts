import { EventEmitter } from 'node:events';
import type { FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { capabilityInstructions } from './core/capability-instructions.js';
import { coreModule } from './core/index.js';
import { conversationModule } from './core/conversation.js';
import { createBrowserAgentModule, type BrowserAgent } from './core/browser-agent.js';
import { createHtmlResearchModule } from './core/research.js';
import { defaultSettings } from './core/settings.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { factoryModule } from './factory/index.js';
import { createVaultModule } from './vault/index.js';
import type { BackendModule } from './modules.js';
import { createVoiceRelayModule } from './voice/relay.js';
import { VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL } from './voice/realtime.js';
import { createGoogleModule } from './google/tools.js';
import type sql from 'mssql';
import { composeDaily } from './daily/composition.js';
import type { ConversationStore } from './core/conversation-store.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', 'a.b.c'].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];
const parityExecute = vi.fn(async () => ({ status: 'synthetic-ok' }));

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function projectSelectorDescription(schema: unknown): string {
  const properties = (schema as { properties?: Record<string, { description?: string }> }).properties;
  return properties?.project?.description ?? '';
}

const browserAgent = {
  runClause: async () => ({}),
  runTask: async () => ({}),
  runSharedTask: async () => ({}),
} as BrowserAgent;

const additionalTools: BackendModule = {
  id: 'tool-parity-fixtures',
  tools: [
    ...createPcBridgeModule({ pcActPlanner: { decide: async () => null } }).tools,
    ...createBrowserAgentModule(browserAgent).tools,
    ...createVaultModule({} as never).tools,
    ...createHtmlResearchModule(() => ({} as never), 'gpt-5.5', {} as never).tools,
    ...createGoogleModule({
      request: async () => { throw new Error('Parity fixtures must not call Google'); },
    }, { timeZone: 'Europe/Copenhagen' }).tools,
    {
      name: 'parity_probe', description: 'A synthetic capability used to verify shared voice dispatch.',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
      execute: parityExecute,
    },
  ],
  registerRoutes: async () => {},
};

class FakeSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING;
  sent: string[] = [];
  close = vi.fn((code = 1000, reason = '') => {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  });
  terminate = vi.fn(() => this.close(1006, ''));
  send(data: string, options?: unknown, callback?: (error?: Error) => void) {
    this.sent.push(data);
    const done = typeof options === 'function' ? options as typeof callback : callback;
    done?.();
  }
  open() { this.readyState = WebSocket.OPEN; this.emit('open'); }
  event(type: string, extra: Record<string, unknown> = {}) {
    this.emit('message', Buffer.from(JSON.stringify({ type, ...extra })), false);
  }
}

function fixture() {
  const daily = composeDaily({
    enabled: true, pool: {} as sql.ConnectionPool, ownerObjectId: config.auth.ownerObjectId,
  });
  if (!daily) throw new Error('Daily fixture did not compose');
  const app = buildApp(config, undefined, {
    modules: [coreModule, conversationModule, factoryModule, daily, additionalTools],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  return app;
}

async function voiceFixture() {
  const daily = composeDaily({
    enabled: true, pool: {} as sql.ConnectionPool, ownerObjectId: config.auth.ownerObjectId,
  });
  if (!daily) throw new Error('Daily fixture did not compose');
  const routes = new Map<string, (browser: WebSocket, request: FastifyRequest) => void>();
  const sockets: FakeSocket[] = [];
  const conversationStore = {
    createSession: vi.fn(async ({ language }: { language: 'da' | 'en' }) => ({
      id: 'parity-session', channel: 'voice' as const, language, startedAt: new Date(), endedAt: null,
    })),
    endSession: vi.fn(async () => true),
  } as unknown as ConversationStore;
  const relay = createVoiceRelayModule({
    getToken: async () => 'synthetic-token',
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const captureRoutes: BackendModule = {
    id: 'parity-voice-relay',
    tools: [],
    registerRoutes: async (instance) => {
      const get = vi.spyOn(instance, 'get').mockImplementation(((path: string, _options: unknown, handler: (
        browser: WebSocket, request: FastifyRequest,
      ) => void) => {
        routes.set(path, handler);
        return instance;
      }) as typeof instance.get);
      await relay.registerRoutes(instance);
      get.mockRestore();
    },
  };
  const app = buildApp(config, undefined, {
    modules: [coreModule, conversationModule, factoryModule, daily, additionalTools, captureRoutes],
    conversationStore,
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  await app.ready();
  return {
    app,
    sockets,
    start: async (language: 'da' | 'en') => {
      const browser = new FakeSocket();
      browser.readyState = WebSocket.OPEN;
      const route = routes.get(language === 'da' ? '/voice/da' : '/voice');
      if (!route) throw new Error('Voice route was not registered');
      route(browser as unknown as WebSocket, {
        log: app.log, requestStartedAt: performance.now(),
        principal: { objectId: config.auth.ownerObjectId },
        server: app, validateInput: () => true, getValidationFunction: () => undefined,
      } as unknown as FastifyRequest);
      await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
      const socket = sockets.at(-1)!;
      socket.open();
      return { browser, socket };
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function missingInstructionTools(
  instructions: string,
  catalogue: readonly { name: string; inputSchema: unknown }[],
): string[] {
  const toolNames = new Set(catalogue.map(({ name }) => name));
  const mentionedNames = new Set(
    instructions.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [],
  );
  // These are a presence mode and a result status, not callable tool identifiers.
  for (const value of ['on_the_move', 'awaiting_confirmation']) mentionedNames.delete(value);
  for (const tool of catalogue.filter(({ name }) => name === 'github_read' || name === 'github_write')) {
    const operations = (tool.inputSchema as { properties: { operation: { enum: string[] } } }).properties.operation.enum;
    for (const operation of operations) mentionedNames.delete(operation);
  }
  return [...mentionedNames].filter((name) => !toolNames.has(name)).sort();
}

describe('voice and chat tool parity', () => {
  it.each([
    ['Danish chat', 'chat', 'da'],
    ['English chat', 'chat', 'en'],
    ['Danish browser voice', 'voice', 'da'],
    ['English browser voice', 'voice', 'en'],
  ] as const)('uses the shared capability catalogue for %s', async (_path, channel, language) => {
    const voice = channel === 'voice' ? await voiceFixture() : undefined;
    const app = voice?.app ?? fixture();
    const response = await app.inject({ url: '/tools', headers });
    expect(response.statusCode).toBe(200);
    const catalogue = response.json() as { name: string; inputSchema: unknown }[];
    const createIssue = catalogue.find(({ name }) => name === 'create_issue');
    expect(createIssue).toBeDefined();
    expect(projectSelectorDescription(createIssue?.inputSchema)).toContain('Natural references');

    if (voice) {
      const { socket } = await voice.start(language);
      const initial = JSON.parse(socket.sent[0]!) as { session: { tools: { name: string }[] } };
      expect(initial.session.tools.map(({ name }) => name)).toEqual(catalogue.map(({ name }) => name));
      socket.event('session.updated');
    }

    expect(catalogue.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'mail_search', 'calendar_create_event', 'calendar_create_events',
      'calendar_get_pending_change', 'calendar_confirm_change', 'vault_search', 'get_system_health',
      'daily_query', 'daily_food', 'daily_food_review',
    ]));
    expect(missingInstructionTools(capabilityInstructions(defaultSettings.memory), catalogue)).toEqual([]);
  });

  it('still rejects unregistered tools without mistaking result statuses for tools', () => {
    expect(missingInstructionTools(
      'calendar_missing_tool returned awaiting_confirmation in on_the_move mode.', [],
    )).toEqual(['calendar_missing_tool']);
  });

  it.each(['da', 'en'] as const)('keeps every canonical capability discoverable and dispatchable on constrained %s voice', async (language) => {
    parityExecute.mockClear();
    const f = await voiceFixture();
    const { browser, socket: initial } = await f.start(language);
    initial.event('error', { error: { code: 'schema_constraint' } });
    await vi.waitFor(() => expect(f.sockets).toHaveLength(2));
    const fallback = f.sockets[1]!;
    fallback.open();
    fallback.event('session.updated');
    const compact = JSON.parse(fallback.sent[0]!) as { session: { tools: { name: string }[] } };
    expect(compact.session.tools.map(({ name }) => name).sort()).toEqual([
      VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL,
    ].sort());

    const toolOutput = (callId: string) => fallback.sent.map((data) => JSON.parse(data))
      .find((message) => message.item?.call_id === callId)?.item.output;
    fallback.event('response.function_call_arguments.done', {
      name: 'parity_probe', call_id: 'unadvertised', arguments: '{"value":"synthetic"}',
    });
    await vi.waitFor(() => expect(toolOutput('unadvertised')).toBeDefined());
    expect(JSON.parse(toolOutput('unadvertised') as string)).toMatchObject({ outcome: 'refused' });
    expect(parityExecute).not.toHaveBeenCalled();

    const discovered: string[] = [];
    let discoveredIssueParameters: unknown;
    let offset: number | null = 0;
    let page = 0;
    do {
      const callId = `page_${page++}`;
      fallback.event('response.function_call_arguments.done', {
        name: VOICE_CAPABILITY_DISCOVERY_TOOL,
        call_id: callId,
        arguments: JSON.stringify({ offset }),
      });
      await vi.waitFor(() => expect(toolOutput(callId)).toBeDefined());
      const output = JSON.parse(toolOutput(callId) as string) as {
        outcome: string;         result: { capabilities: { name: string; parameters: unknown }[]; nextOffset: number | null };
      };
      expect(output.outcome).toBe('ok');
      discovered.push(...output.result.capabilities.map(({ name }) => name));
      discoveredIssueParameters ??= output.result.capabilities.find(({ name }) => name === 'create_issue')?.parameters;
      offset = output.result.nextOffset;
    } while (offset !== null);
    expect(discovered.sort()).toEqual(f.app.jarvisTools.list().map(({ name }) => name).sort());
    expect(projectSelectorDescription(discoveredIssueParameters)).toContain('Natural references');

    fallback.event('response.function_call_arguments.done', {
      name: VOICE_CAPABILITY_EXECUTION_TOOL,
      call_id: 'advertised',
      arguments: JSON.stringify({ capability: 'parity_probe', arguments: { value: 'synthetic' } }),
    });
    await vi.waitFor(() => expect(toolOutput('advertised')).toBeDefined());
    expect(JSON.parse(toolOutput('advertised') as string)).toMatchObject({
      tool: 'parity_probe', outcome: 'ok', result: { status: 'synthetic-ok' },
    });
    expect(parityExecute).toHaveBeenCalledOnce();

    fallback.event('response.function_call_arguments.done', {
      name: VOICE_CAPABILITY_EXECUTION_TOOL,
      call_id: 'system_health',
      arguments: JSON.stringify({ capability: 'get_system_health', arguments: {} }),
    });
    await vi.waitFor(() => expect(toolOutput('system_health')).toBeDefined());
    expect(JSON.parse(toolOutput('system_health') as string)).toMatchObject({
      tool: 'get_system_health', outcome: 'ok', result: { components: expect.any(Array) },
    });
    browser.close(1000, '');
  });

  it('keeps every registered model-facing schema rooted at a plain object', async () => {
    const app = fixture();
    const response = await app.inject({ url: '/tools', headers });
    expect(response.statusCode).toBe(200);
    const catalogue = response.json() as { inputSchema: unknown }[];
    for (const { inputSchema } of catalogue) {
      expect(isPlainObject(inputSchema)).toBe(true);
      expect(inputSchema).toMatchObject({ type: 'object' });
    }
    const voice = await voiceFixture();
    const { socket } = await voice.start('en');
    const update = JSON.parse(socket.sent[0]!) as {
      session: { tools: { parameters: unknown }[] };
    };
    for (const { parameters } of update.session.tools) {
      expect(isPlainObject(parameters)).toBe(true);
      expect(parameters).toMatchObject({ type: 'object' });
    }
  });
});
