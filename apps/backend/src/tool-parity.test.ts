import { afterEach, describe, expect, it } from 'vitest';
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
import { createRealtimeSessionUpdate } from './voice/realtime.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', 'a.b.c'].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

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
  ],
  registerRoutes: async () => {},
};

function fixture() {
  const app = buildApp(config, undefined, {
    modules: [coreModule, conversationModule, factoryModule, additionalTools],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  return app;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

describe('voice and chat tool parity', () => {
  it('matches the voice tool names to /tools and checks shared instruction references', async () => {
    const app = fixture();
    const response = await app.inject({ url: '/tools', headers });
    expect(response.statusCode).toBe(200);
    const catalogue = response.json() as { name: string; inputSchema: unknown }[];
    const voice = createRealtimeSessionUpdate(app.jarvisTools).session;

    expect(voice.tools.map(({ name }) => name)).toEqual(catalogue.map(({ name }) => name));

    const toolNames = new Set(catalogue.map(({ name }) => name));
    const mentionedNames = new Set(
      capabilityInstructions(defaultSettings.memory).match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [],
    );
    mentionedNames.delete('on_the_move');
    expect([...mentionedNames].filter((name) => !toolNames.has(name)).sort()).toEqual([]);
  });

  it('keeps every registered model-facing schema rooted at a plain object', async () => {
    const app = fixture();
    const response = await app.inject({ url: '/tools', headers });
    expect(response.statusCode).toBe(200);
    const catalogue = response.json() as { inputSchema: unknown }[];
    const voice = createRealtimeSessionUpdate(app.jarvisTools).session;

    for (const { inputSchema } of catalogue) {
      expect(isPlainObject(inputSchema)).toBe(true);
      expect(inputSchema).toMatchObject({ type: 'object' });
    }
    for (const { parameters } of voice.tools) {
      expect(isPlainObject(parameters)).toBe(true);
      expect(parameters).toMatchObject({ type: 'object' });
    }
  });
});
