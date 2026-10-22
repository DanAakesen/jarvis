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
import { createRealtimeSessionUpdate, toModelToolSchema } from './voice/realtime.js';
import { createToolBudgetRungs, TOOL_BUDGET_ALWAYS_KEPT_TOOLS } from './voice/tool-budget.js';

const limits = JSON.parse(readFileSync(
  new URL('../../../agents/jarvis/limits.json', import.meta.url), 'utf8',
)) as { maxToolDescriptionCharacters: number; maxCatalogueBytes: number };

const dailyToolNames = [
  'daily_query', 'daily_show', 'daily_food', 'daily_food_review', 'daily_saved_food', 'daily_nutrition_targets', 'daily_nutrition_suggest',
  'daily_health_summary', 'daily_nutrition_history', 'daily_coach_status',
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
  it('builds every production module with all optional features enabled', () => {
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

  it('sends every configured production tool to Voice Live as a plain object schema (L121)', () => {
    const tools = buildCatalogue(modulesWithEveryFeature()).list();
    const assertTypedCombinators = (schema: unknown, name: string, path = ''): void => {
      if (Array.isArray(schema)) {
        schema.forEach((branch, index) => assertTypedCombinators(branch, name, `${path}[${index}]`));
        return;
      }
      if (schema === null || typeof schema !== 'object') return;
      const object = schema as Record<string, unknown>;
      expect(object, `${name}${path}`).not.toHaveProperty('const');
      for (const key of ['oneOf', 'anyOf', 'allOf']) {
        if (key in object) {
          expect(Array.isArray(object[key]), `${name}${path}.${key}`).toBe(true);
          for (const [index, branch] of (object[key] as unknown[]).entries()) {
            expect(branch !== null && typeof branch === 'object' && !Array.isArray(branch) && 'type' in branch,
              `${name}${path}.${key}[${index}]`).toBe(true);
          }
        }
      }
      for (const [key, value] of Object.entries(object)) {
        assertTypedCombinators(value, name, `${path}.${key}`);
      }
    };

    expect(tools.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'daily_health_summary', 'daily_nutrition_history', 'daily_coach_status',
    ]));
    for (const tool of tools) {
      const schema = toModelToolSchema(tool.inputSchema) as Record<string, unknown>;
      expect(schema.type, tool.name).toBe('object');
      expect(schema.properties, tool.name).toEqual(expect.any(Object));
      for (const key of ['oneOf', 'anyOf', 'allOf', 'not', 'enum']) {
        expect(schema, tool.name).not.toHaveProperty(key);
      }
      assertTypedCombinators(schema, tool.name);
    }
  });

  it('keeps every always-kept voice tool-budget tool in the catalogue and builds the English fallback ladder from it', () => {
    const registry = buildCatalogue(modulesWithEveryFeature());
    for (const name of TOOL_BUDGET_ALWAYS_KEPT_TOOLS) {
      expect(registry.get(name), `${name} is listed in TOOL_BUDGET_ALWAYS_KEPT_TOOLS but not in the catalogue`).toBeDefined();
    }
    const bytes = (tools: readonly { name: string; description: string; inputSchema: unknown }[]) =>
      Buffer.byteLength(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({
        type: 'function', name, description, parameters: toModelToolSchema(inputSchema),
      }))));
    const rungs = createToolBudgetRungs(registry);
    expect(rungs.map(({ name }) => name)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
    expect(rungs.map(({ deadlineMs }) => deadlineMs)).toEqual([8_000, 6_000, 6_000, 6_000, 6_000, 6_000]);
    expect(rungs.map(({ instructions }) => instructions))
      .toEqual(['full', 'notice', 'notice', 'notice', 'notice', 'compact']);
    const [r0, r1, r2, r3, r4, r5] = rungs.map(({ tools }) => tools.list());
    expect(r0).toEqual(registry.list());
    expect(r1!.map(({ name }) => name)).toEqual(registry.list().map(({ name }) => name)
      .filter((name) => name !== 'proactive_recent_items'));
    expect(r1!.some(({ name }) => name.startsWith('daily_'))).toBe(true);
    expect(r2!.map(({ name }) => name)).toEqual(registry.list().map(({ name }) => name)
      .filter((name) => !name.startsWith('daily_') && name !== 'proactive_recent_items'));
    expect(r3!.map(({ name }) => name)).toEqual(expect.arrayContaining([...TOOL_BUDGET_ALWAYS_KEPT_TOOLS]));
    expect(bytes(r3!)).toBeLessThanOrEqual(bytes(r0!) / 2);
    expect(bytes(r3!)).toBeGreaterThan(bytes(r0!) * 0.45);
    // Everything kept is smaller than everything dropped, apart from the always-kept tools.
    const kept = new Set(r3!.map(({ name }) => name));
    const largestKept = Math.max(...r3!.filter(({ name }) => !(TOOL_BUDGET_ALWAYS_KEPT_TOOLS as readonly string[]).includes(name))
      .map((tool) => bytes([tool])));
    for (const tool of r0!.filter(({ name }) => !kept.has(name))) expect(bytes([tool])).toBeGreaterThanOrEqual(largestKept);
    expect(r4).toEqual([]);
    expect(r5).toEqual([]);
  });

  it('keeps the catalogue unchanged with proactive off and adds exactly one tool when enabled', () => {
    const on = modulesWithEveryFeature();
    const off = modulesWithEveryFeature({ proactive: false });
    const onNames = createToolRegistry(on).list().map(({ name }) => name);
    const offNames = createToolRegistry(off).list().map(({ name }) => name);

    expect(offNames).toHaveLength(119);
    expect(onNames).toHaveLength(120);
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

  it('retains every tool when the production catalogue grows beyond the former global cap', () => {
    const modules = modulesWithEveryFeature();
    const existingCount = modules.reduce((count, module) => count + module.tools.length, 0);
    const additions = Array.from({ length: Math.max(1, 129 - existingCount) }, (_, index) => ({
      name: `catalogue_probe_${index}`,
      description: 'Limit probe tool.',
      inputSchema: { type: 'object' },
      execute: async () => ({}),
    }));
    const registry = buildCatalogue([...modules, {
      id: 'headroom-probe',
      tools: additions,
      registerRoutes: async () => {},
    }]);
    const expectedNames = [
      ...modules.flatMap(({ tools }) => tools.map(({ name }) => name)),
      ...additions.map(({ name }) => name),
    ];

    expect(registry.list().length).toBeGreaterThan(128);
    expect(registry.list().map(({ name }) => name)).toEqual(expectedNames);
    expect(createRealtimeSessionUpdate(registry).session.tools.map(({ name }) => name)).toEqual(expectedNames);
  });
});
