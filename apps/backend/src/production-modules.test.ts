import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modelRoles, systemSmokeCheckIds } from '@jarvis/contracts';
import { FrameStore } from './vision/frame-store.js';
import { createConversationModule } from './core/conversation.js';
import { coreModule } from './core/index.js';
import { createBrowserAgentModule } from './core/browser-agent.js';
import { createFolioModule } from './core/folio.js';
import { createHtmlResearchModule } from './core/research.js';
import { createHtmlViewModule } from './core/html-view.js';
import { createImageGenerationModule } from './core/image-generation.js';
import { createRecipeModule } from './core/recipe-management.js';
import { createWebResearchModule } from './core/web-research.js';
import { createWeatherModule } from './core/weather.js';
import { createWorkspacePinsModule } from './core/workspace-pins.js';
import { createVaultModule } from './vault/index.js';
import { createGoogleModule } from './google/tools.js';
import { createGithubWebhookModule } from './github/webhook.js';
import { factoryModule } from './factory/index.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { createPhoneCallModule } from './phone/calls.js';
import { createPhoneStatusModule } from './phone/status.js';
import { createSleepModule } from './operations/sleep.js';
import { createScreenVisionModule } from './vision/screen.js';
import { createVisionWatchModule } from './vision/watch.js';
import { createVoiceRelayModule } from './voice/relay.js';
import { createProductionModules } from './production-modules.js';
import { createToolRegistry } from './core/tool-registry.js';
import { checkAgentContract } from './core/agent-contract.js';
import { composeDaily } from './daily/composition.js';
import { createMemoryProactiveStore } from './proactive/store.js';
import { createProactiveToolsModule } from './proactive/tools.js';

const limits = JSON.parse(readFileSync(
  new URL('../../../agents/jarvis/limits.json', import.meta.url), 'utf8',
)) as { maxTools: number; maxToolDescriptionCharacters: number; maxCatalogueBytes: number };

const dailyToolNames = [
  'daily_query', 'daily_food', 'daily_food_review', 'daily_saved_food', 'daily_nutrition_targets', 'daily_nutrition_suggest',
];
const proactiveToolNames = ['proactive_recent_items'];
const proactiveOwner = '11111111-1111-4111-8111-111111111111';

// Daily is composed by default here so the size gates below always cover the largest catalogue the server can run.
function modulesWithEveryFeature(options: { daily?: boolean; proactive?: boolean } = {}) {
  const frameStore = new FrameStore();
  return createProductionModules({
    core: coreModule,
    conversation: createConversationModule(frameStore),
    factory: factoryModule,
    sleep: createSleepModule(null),
    recipes: createRecipeModule(undefined),
    vault: createVaultModule({} as never),
    webResearch: createWebResearchModule(() => ({} as never), 'test-model'),
    htmlResearch: createHtmlResearchModule(() => ({} as never), 'test-model', {} as never),
    google: createGoogleModule({} as never, { timeZone: 'UTC' }),
    githubWebhook: createGithubWebhookModule({} as never),
    pcBridge: createPcBridgeModule(),
    phoneCall: createPhoneCallModule({} as never),
    phoneStatus: createPhoneStatusModule({ configured: true, store: null }),
    browserAgent: createBrowserAgentModule({} as never),
    imageGeneration: createImageGenerationModule({} as never),
    htmlView: createHtmlViewModule({} as never),
    weather: createWeatherModule({} as never),
    folio: createFolioModule({} as never, {} as never),
    workspacePins: createWorkspacePinsModule({} as never),
    screenVision: createScreenVisionModule({} as never, frameStore),
    visionWatch: createVisionWatchModule({} as never),
    voiceRelay: createVoiceRelayModule({} as never),
    daily: composeDaily({
      enabled: options.daily !== false,
      pool: {} as never,
      ownerObjectId: proactiveOwner,
    }),
    proactive: createProactiveToolsModule({
      enabled: options.proactive !== false,
      ownerObjectId: proactiveOwner,
      ...(options.proactive === false ? {} : { store: createMemoryProactiveStore(proactiveOwner) }),
    }),
  });
}

function toolCounts(modules: ReturnType<typeof modulesWithEveryFeature>): string {
  return modules.map(({ id, tools }) => `${id}: ${tools.length}`).join(', ');
}

function buildCatalogue(modules: ReturnType<typeof modulesWithEveryFeature>) {
  const diagnostic = `Tool count per module: ${toolCounts(modules)}`;
  try {
    const registry = createToolRegistry(modules);
    const tools = registry.list();
    const catalogueBytes = Buffer.byteLength(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({
      name, description, inputSchema,
    }))));
    expect(tools.length, diagnostic).toBeLessThanOrEqual(limits.maxTools);
    expect(limits.maxTools - tools.length, `At least eight tools of headroom required. ${diagnostic}`)
      .toBeGreaterThanOrEqual(8);
    for (const tool of tools) {
      expect(tool.description.length, `${diagnostic}; overlong description: ${tool.name}`)
        .toBeLessThanOrEqual(limits.maxToolDescriptionCharacters);
    }
    expect(catalogueBytes, diagnostic).toBeLessThanOrEqual(limits.maxCatalogueBytes);
    return registry;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Tool count per module:')) {
      throw new Error(`${error.message}\n${diagnostic}`, { cause: error });
    }
    throw error;
  }
}

describe('production tool catalogue', () => {
  it('builds every production module with all optional features enabled within the agent limits', () => {
    const modules = modulesWithEveryFeature();
    const registry = buildCatalogue(modules);
    expect(registry.list().length).toBeGreaterThan(0);
    expect(modules.map(({ id }) => id)).toEqual([
      'core', 'conversation', 'factory', 'operations', 'task-recipes', 'vault', 'web-research',
      'html-research', 'google', 'github-webhook', 'pc-bridge', 'phone', 'phone-status',
      'browser-agent', 'image-generation', 'html-view', 'weather', 'folio', 'workspace-pins',
      'screen-vision', 'vision-watch', 'voice', 'daily', 'proactive',
    ]);
  });

  it('keeps the catalogue unchanged with proactive off and adds exactly one tool when enabled', () => {
    const on = modulesWithEveryFeature();
    const off = modulesWithEveryFeature({ proactive: false });
    const onNames = createToolRegistry(on).list().map(({ name }) => name);
    const offNames = createToolRegistry(off).list().map(({ name }) => name);

    expect(offNames).toHaveLength(115);
    expect(onNames).toHaveLength(116);
    expect(onNames.filter((name) => !proactiveToolNames.includes(name))).toEqual(offNames);
    expect(on.find(({ id }) => id === 'proactive')!.tools.map(({ name }) => name)).toEqual(proactiveToolNames);
    expect(off.some(({ id }) => id === 'proactive')).toBe(false);
  });

  it('leaves the production module list and tool catalogue unchanged when Daily is off', () => {
    const on = modulesWithEveryFeature();
    const off = modulesWithEveryFeature({ daily: false });
    expect(off.map(({ id }) => id)).toEqual(on.map(({ id }) => id).filter((id) => id !== 'daily'));
    const offNames = createToolRegistry(off).list().map(({ name }) => name);
    expect(offNames.filter((name) => name.startsWith('daily_'))).toEqual([]);
    expect(createToolRegistry(on).list().map(({ name }) => name).filter((name) => !dailyToolNames.includes(name)))
      .toEqual(offNames);
    expect(on.find(({ id }) => id === 'daily')!.tools.map(({ name }) => name)).toEqual(dailyToolNames);
  });

  it('passes the smoke contract with the real all-features composed registry', async () => {
    expect(systemSmokeCheckIds).toContain('chat_canary');
    const registry = buildCatalogue(modulesWithEveryFeature());
    const roles = Object.fromEntries(modelRoles.map((role) => [role, {
      model: 'gpt-6-luna',
      reasoningEffort: 'none',
    }]));
    const result = await checkAgentContract(registry.list(), async () => ({
      model: 'gpt-6-luna',
      reasoningEffort: 'none',
      roles,
      mode: 'present',
      awayMode: false,
      changedAt: null,
      personality: {
        tone: 'british_butler',
        responseStyle: 'concise',
        customInstructions: '',
        modeInstructions: { present: '', away: '', on_the_move: '' },
      },
      timeouts: { toolTimeoutSeconds: 30, longToolTimeoutSeconds: 320, backendHttpTimeoutSeconds: 10 },
      research: { timeoutSeconds: 305 },
      capabilityInstructions: 'Safe shared instructions.',
    }));
    expect(result).toEqual({ status: 'ok' });
  });

  it('reports each module tool count when the catalogue exceeds the agent limit', () => {
    const modules = modulesWithEveryFeature();
    const additions = Array.from({ length: limits.maxTools + 1 }, (_, index) => ({
      name: `limit_probe_${index}`,
      description: 'Limit probe tool.',
      inputSchema: { type: 'object' },
      execute: async () => ({}),
    }));
    const overLimit = modules.map((module) => module.id === 'factory'
      ? { ...module, tools: [...module.tools, ...additions] }
      : module);
    expect(() => buildCatalogue(overLimit)).toThrow(/Tool count per module:.*factory: \d+/u);
  });

  it('fails the headroom check when only seven catalogue slots remain', () => {
    const modules = modulesWithEveryFeature();
    const existingCount = modules.reduce((count, module) => count + module.tools.length, 0);
    const additions = Array.from({ length: limits.maxTools - 7 - existingCount }, (_, index) => ({
      name: `headroom_probe_${index}`,
      description: 'Headroom probe tool.',
      inputSchema: { type: 'object' },
      execute: async () => ({}),
    }));
    expect(() => buildCatalogue([...modules, {
      id: 'headroom-probe',
      tools: additions,
      registerRoutes: async () => {},
    }])).toThrow(/At least eight tools of headroom required/u);
  });
});
