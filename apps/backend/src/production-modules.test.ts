import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
import { createAskDanToConfirmTool } from './teams/service.js';
import { createProductionModules } from './production-modules.js';
import { createToolRegistry } from './core/tool-registry.js';

const limits = JSON.parse(readFileSync(
  new URL('../../../agents/jarvis/limits.json', import.meta.url), 'utf8',
)) as { maxTools: number; maxToolDescriptionCharacters: number; maxCatalogueBytes: number };

function modulesWithEveryFeature() {
  const frameStore = new FrameStore();
  const teamsModule = {
    id: 'teams',
    tools: [createAskDanToConfirmTool({} as never)],
    registerRoutes: async () => {},
  };
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
    teamsBot: teamsModule,
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
      'screen-vision', 'vision-watch', 'voice', 'teams',
    ]);
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
