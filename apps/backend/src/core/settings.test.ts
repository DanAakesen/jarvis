import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import {
  defaultSettings, flattenSettings, readSettings, settingsStoreKeys, validateSettingsPatch, type SettingsStore,
} from './settings.js';
import type { CredentialStatusStore } from '../credentials/credential-status.js';
import type { AwayModeStore } from './away-mode.js';
import { capabilityInstructions } from './capability-instructions.js';
import { checkAgentContract } from './agent-contract.js';
import { DANISH_REALTIME_VOICE } from '../voice/realtime.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const authorization = { authorization: `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}` };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function createStore(): { store: SettingsStore; values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  const store: SettingsStore = {
    read: async () => ({ ...values }),
    write: async (settings) => {
      for (const { key, value } of flattenSettings(settings)) values[key] = value;
    },
  };
  return { store, values };
}

function fixture(
  settingsStore?: SettingsStore,
  auth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId,
  tenantId: config.auth.tenantId,
  displayName: 'Dan',
  }),
  credentialStatusStore?: CredentialStatusStore,
  awayModeStore?: AwayModeStore,
  onEmbeddingModelChanged?: () => Promise<void>,
) {
  const app = buildApp(config, undefined, {
    auth,
    ...(settingsStore ? { settingsStore } : {}),
    ...(credentialStatusStore ? { credentialStatusStore } : {}),
    ...(awayModeStore ? { awayModeStore } : {}),
    ...(onEmbeddingModelChanged ? { onEmbeddingModelChanged } : {}),
  });
  apps.push(app);
  return app;
}

describe('settings API', () => {
  it('defaults work presentation on and persists either boolean without changing appearance', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    expect(settingsStoreKeys).toContain('presentation.show_work');
    expect((await readSettings(store)).presentation).toEqual({ showWork: true });
    for (const showWork of [false, true]) {
      const settings = { presentation: { showWork } };
      expect(validateSettingsPatch(settings)).toEqual(settings);
      const saved = await app.inject({
        method: 'PATCH', url: '/settings', headers: authorization, payload: { settings },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().settings.presentation).toEqual(settings.presentation);
      expect(saved.json().settings.appearance).toEqual(defaultSettings.appearance);
      expect(values['presentation.show_work']).toBe(JSON.stringify(showWork));
      expect((await app.inject({ url: '/settings', headers: authorization })).json().settings.presentation)
        .toEqual(settings.presentation);
    }
  });

  it.each([
    {}, null, [], true, { showWork: null }, { showWork: 'false' }, { showWork: 'true' },
    { showWork: 0 }, { showWork: 1 }, { showWork: false, unknown: true },
  ])('rejects malformed work presentation patches without coercion: %j', async (presentation) => {
    const { store, values } = createStore();
    const app = fixture(store);
    expect(validateSettingsPatch({ presentation })).toBeNull();
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { presentation } },
    });
    expect(response.statusCode).toBe(400);
    expect(values).toEqual({});
  });

  it.each(['null', '"false"', '0', '{}', 'invalid'])(
    'ignores invalid stored work presentation values: %s', async (stored) => {
      const { store, values } = createStore();
      values['presentation.show_work'] = stored;
      expect((await readSettings(store)).presentation).toEqual({ showWork: true });
    },
  );

  it('defaults the decision provider to Jev and persists either provider with its options', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    expect(settingsStoreKeys).toContain('decisions.provider');
    expect((await readSettings(store)).decisions).toEqual({ provider: 'jev' });
    for (const provider of ['microsoft', 'jev']) {
      const settings = { decisions: { provider } };
      expect(validateSettingsPatch(settings)).toEqual(settings);
      const saved = await app.inject({
        method: 'PATCH', url: '/settings', headers: authorization, payload: { settings },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().settings.decisions).toEqual(settings.decisions);
      expect(values['decisions.provider']).toBe(JSON.stringify(provider));
      const read = (await app.inject({ url: '/settings', headers: authorization })).json();
      expect(read.settings.decisions).toEqual(settings.decisions);
      expect(read.options.decisionProviders).toEqual(['jev', 'microsoft']);
    }
  });

  it.each([
    {}, null, [], 'jev', { provider: 'openai' }, { provider: 'Jev' }, { provider: null }, { provider: 1 },
    { provider: true }, { provider: 'jev', unknown: true },
  ])('rejects malformed decision provider patches without coercion: %j', async (decisions) => {
    const { store, values } = createStore();
    const app = fixture(store);
    expect(validateSettingsPatch({ decisions })).toBeNull();
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: { decisions } },
    });
    expect(response.statusCode).toBe(400);
    expect(values).toEqual({});
  });

  it.each(['null', '"openai"', '1', '{}', 'invalid'])(
    'ignores invalid stored decision providers: %s', async (stored) => {
      const { store, values } = createStore();
      values['decisions.provider'] = stored;
      expect((await readSettings(store)).decisions).toEqual({ provider: 'jev' });
    },
  );

  it('shows the live Danish voice and ignores the retired Harper value', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    expect(defaultSettings.voice.danishVoice).toBe(DANISH_REALTIME_VOICE);
    expect((await readSettings(store)).voice.danishVoice).toBe(DANISH_REALTIME_VOICE);
    expect((await app.inject({ url: '/settings', headers: authorization })).json().options.danishVoices)
      .toEqual([DANISH_REALTIME_VOICE]);
    values['voice.da.voice'] = JSON.stringify('da-DK-Harper:MAI-Voice-2');
    expect((await readSettings(store)).voice.danishVoice).toBe(DANISH_REALTIME_VOICE);
    expect(validateSettingsPatch({ voice: { danishVoice: DANISH_REALTIME_VOICE } }))
      .toEqual({ voice: { danishVoice: DANISH_REALTIME_VOICE } });
    expect(validateSettingsPatch({ voice: { danishVoice: 'da-DK-Harper:MAI-Voice-2' } })).toBeNull();
  });

  it('requires authentication and reports unavailable persistence', async () => {
    const denied = fixture();
    expect((await denied.inject({ url: '/settings' })).statusCode).toBe(401);
    expect((await denied.inject({ url: '/settings', headers: authorization })).statusCode).toBe(503);

    const { store } = createStore();
    const available = fixture(store);
    const response = await available.inject({ url: '/settings', headers: authorization });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        presentation: { showWork: true },
        appearance: { theme: 'light' },
        jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
        personality: { tone: 'british_butler', responseStyle: 'concise', customInstructions: '' },
        voice: {
          defaultLanguage: 'da',
          minimizeWindowsOnVoiceStart: false,
          serverVadThreshold: 0.7,
          prefixPaddingMs: 300,
          silenceDurationMs: 600,
          bargeInEnabled: true,
          maxSpokenReplyTokens: 4_096,
        },
        research: { depth: 'quick', maxSources: 50, timeoutSeconds: 305 },
        timeouts: {
          toolTimeoutSeconds: 30,
          longToolTimeoutSeconds: 320,
          backendHttpTimeoutSeconds: 10,
        },
        memory: {
          similarityThreshold: 0.35,
          searchTopK: 5,
          graphTextSimilarityThreshold: 0.12,
          automaticCapture: true,
        },
        codex: { model: 'default' },
        copilot: { model: 'default' },
        global: {
          maxParallelTasks: 1,
          maxCheckAttempts: 3,
          screenShareDailyFrameCap: 300,
          visionDailyBudgetUsd: 1,
          conversationSummaryDailyLimit: 24,
        },
        newProjects: {
          owner: 'DanAakesen',
          visibility: 'private',
          templatesRepository: 'DanAakesen/templates',
          defaultAgent: 'copilot',
          policy: 'deliver_pr',
          maxParallelTasks: 1,
          defaultBranch: 'main',
        },
      },
    });
    expect(response.json().options.voiceTuning).toEqual({
      serverVadThreshold: { minimum: 0, maximum: 1 },
      prefixPaddingMs: { minimum: 0, maximum: 2_000 },
      silenceDurationMs: { minimum: 100, maximum: 5_000 },
      maxSpokenReplyTokens: { minimum: 1, maximum: 4_096 },
    });
    expect(response.json().options.researchDepths).toEqual(['quick', 'standard', 'deep']);
    expect(response.json().options.researchSettings).toEqual({
      maxSources: { minimum: 1, maximum: 50 },
      timeoutSeconds: { minimum: 1, maximum: 320 },
    });
    expect(response.json().options.timeoutSettings).toEqual({
      toolTimeoutSeconds: { minimum: 1, maximum: 120 },
      longToolTimeoutSeconds: { minimum: 30, maximum: 320 },
      backendHttpTimeoutSeconds: { minimum: 1, maximum: 60 },
    });
    expect(response.json().options.memorySettings).toEqual({
      similarityThreshold: { minimum: 0, maximum: 1 },
      searchTopK: { minimum: 1, maximum: 8 },
      graphTextSimilarityThreshold: { minimum: 0, maximum: 1 },
    });
  });

  it('persists bounded memory retrieval settings and rejects values outside their contract', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const settings = {
      memory: {
        similarityThreshold: 0.6,
        searchTopK: 3,
        graphTextSimilarityThreshold: 0.2,
        automaticCapture: false,
      },
    };

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.memory).toEqual(settings.memory);
    expect(values).toMatchObject({
      'memory.similarity_threshold': '0.6',
      'memory.search_top_k': '3',
      'memory.graph_text_similarity_threshold': '0.2',
      'memory.automatic_capture': 'false',
    });
    for (const memory of [
      { similarityThreshold: -0.1 },
      { similarityThreshold: 1.1 },
      { searchTopK: 0 },
      { searchTopK: 9 },
      { graphTextSimilarityThreshold: 2 },
      { automaticCapture: 'false' },
    ]) {
      const response = await app.inject({
        method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: { memory } },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('persists bounded research depth, source count, and timeout settings', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const settings = { research: { depth: 'standard', maxSources: 18, timeoutSeconds: 320 } };

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.research).toEqual(settings.research);
    expect(values).toMatchObject({
      'research.depth': '"standard"',
      'research.max_sources': '18',
      'research.timeout_seconds': '320',
    });
  });

  it.each([
    { research: { depth: 'extreme' } },
    { research: { maxSources: 0 } },
    { research: { maxSources: 51 } },
    { research: { timeoutSeconds: 0 } },
    { research: { timeoutSeconds: 321 } },
    { research: { timeoutSeconds: '320' } },
  ])('rejects invalid research setting values: %j', async (settings) => {
    const app = fixture(createStore().store);
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings },
    });
    expect(response.statusCode).toBe(400);
  });

  it('persists bounded tool, long-tool, and backend HTTP timeouts', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const timeouts = {
      toolTimeoutSeconds: 60,
      longToolTimeoutSeconds: 300,
      backendHttpTimeoutSeconds: 20,
    };

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: { timeouts } },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.timeouts).toEqual(timeouts);
    expect(values).toMatchObject({
      'timeouts.tool_timeout_seconds': '60',
      'timeouts.long_tool_timeout_seconds': '300',
      'timeouts.backend_http_timeout_seconds': '20',
    });
  });

  it.each([
    { toolTimeoutSeconds: 0 },
    { toolTimeoutSeconds: 121 },
    { longToolTimeoutSeconds: 29 },
    { longToolTimeoutSeconds: 321 },
    { backendHttpTimeoutSeconds: 0 },
    { backendHttpTimeoutSeconds: 61 },
    { toolTimeoutSeconds: true },
  ])('rejects invalid timeout setting values: %j', async (timeouts) => {
    const app = fixture(createStore().store);
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: { timeouts } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('serves a Dan-only model catalogue and applies the selected chat model to agent settings', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const catalogue = await app.inject({ url: '/models', headers: authorization });

    expect(catalogue.statusCode).toBe(200);
    expect(catalogue.headers['cache-control']).toBe('private, max-age=300');
    expect(catalogue.json()).toMatchObject({
      source: 'fallback',
      deployments: expect.arrayContaining([
        expect.objectContaining({ name: 'gpt-6-luna', capabilities: expect.arrayContaining(['chat', 'image']) }),
      ]),
    });

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { roles: { chat: { model: 'gpt-6-luna', reasoningEffort: 'high' } } } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.roles.chat).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'high' });
    expect(saved.json().settings.jarvis).toEqual({ model: 'gpt-6-luna', reasoning: 'high' });
    expect(values).toMatchObject({
      'roles.chat.model': '"gpt-6-luna"',
      'roles.chat.reasoning_effort': '"high"',
    });

    const agent = fixture(store, async () => ({
      kind: 'jarvis-agent',
      objectId: '00000000-0000-0000-0000-000000000001',
      tenantId: config.auth.tenantId,
    }));
    const settings = await agent.inject({ url: '/agent/settings', headers: authorization });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      model: 'gpt-6-luna',
      reasoningEffort: 'high',
      roles: { chat: { model: 'gpt-6-luna', reasoningEffort: 'high' } },
      memory: defaultSettings.memory,
      research: { timeoutSeconds: 305 },
      timeouts: defaultSettings.timeouts,
    });
    await expect(checkAgentContract([], async () => settings.json())).resolves.toEqual({ status: 'ok' });
  });

  it('exposes and saves Codex and Copilot model-specific reasoning choices', async () => {
    const { store } = createStore();
    const app = fixture(store);
    const initial = await app.inject({ url: '/settings', headers: authorization });

    expect(initial.json().options.codexModels).toContain('gpt-6.1-sol');
    expect(initial.json().options.codexModels).not.toContain('gpt-5.3-codex');
    expect(initial.json().options.copilotModels).toContain('claude-sonnet-4.6');
    expect(initial.json().options.roles.codex.reasoningEffortsByModel['gpt-6.1-sol'])
      .toContain('xhigh');
    expect(initial.json().options.roles.copilot.reasoningEffortsByModel['gpt-5.4'])
      .toEqual(['none', 'low', 'medium', 'high']);

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { roles: {
        codex: { model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' },
        copilot: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
      } } },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.roles).toMatchObject({
      codex: { model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' },
      copilot: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
    });
  });

  it('starts re-embedding only when the embedding role model changes', async () => {
    const { store } = createStore();
    const onEmbeddingModelChanged = vi.fn(async () => {});
    const app = fixture(store, undefined, undefined, undefined, onEmbeddingModelChanged);
    const patch = {
      method: 'PATCH' as const,
      url: '/settings',
      headers: authorization,
      payload: { settings: { roles: { embedding: { model: 'text-embedding-3-large' } } } },
    };

    expect((await app.inject(patch)).statusCode).toBe(200);
    expect(onEmbeddingModelChanged).toHaveBeenCalledOnce();
    expect((await app.inject(patch)).statusCode).toBe(200);
    expect(onEmbeddingModelChanged).toHaveBeenCalledOnce();
  });

  it('denies the model catalogue to non-owner principals', async () => {
    const app = fixture(createStore().store, async () => ({
      objectId: '00000000-0000-0000-0000-000000000002',
      tenantId: config.auth.tenantId,
      displayName: 'Other user',
    }));
    expect((await app.inject({ url: '/models', headers: authorization })).statusCode).toBe(403);
  });

  it.each([
    { settings: { roles: { chat: { model: 'text-embedding-3-small' } } } },
    { settings: { roles: { chat: { model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' } } } },
  ])('rejects role models without the capability or supported effort: %j', async (payload) => {
    const app = fixture(createStore().store);
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload,
    });
    expect(response.statusCode).toBe(400);
  });

  it('resolves legacy stored Jarvis model keys into the chat role', async () => {
    const { store, values } = createStore();
    values['jarvis.model'] = '"gpt-6-luna"';
    values['jarvis.reasoning_effort'] = '"high"';

    const settings = await readSettings(store);

    expect(settings.roles.chat).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'high' });
    expect(settings.jarvis).toEqual({ model: 'gpt-6-luna', reasoning: 'high' });
  });

  it('clears custom appearance colours with null so the theme default applies', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const colours = { accent: '#a1b2c3', 'accent-secondary': '#123456', 'surface-tint': '#abcdef' };

    const set = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: { appearance: colours } },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().settings.appearance).toMatchObject(colours);

    const cleared = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { appearance: { accent: null, 'accent-secondary': null, 'surface-tint': null } } },
    });
    expect(cleared.statusCode).toBe(200);
    for (const key of Object.keys(colours)) {
      expect(cleared.json().settings.appearance).not.toHaveProperty(key);
    }
    expect(values['appearance.accent']).toBe('null');

    const read = await app.inject({ method: 'GET', url: '/settings', headers: authorization });
    expect(read.statusCode).toBe(200);
    expect(read.json().settings.appearance).not.toHaveProperty('accent');
    expect(read.json().settings.appearance).not.toHaveProperty('surface-tint');
  });

  it.each([
    { theme: null },
    { accent: '' },
  ])('rejects null or empty values for non-clearable appearance settings: %j', async (appearance) => {
    const app = fixture(createStore().store);
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: { appearance } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('persists allowlisted appearance tokens and the default-off voice window preference', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const patch = {
      appearance: {
        theme: 'system',
        accent: '#a1B2c3',
        'accent-secondary': '#123456',
        'surface-tint': '#abcdef',
        background: 'living-aurora',
        glow: 0.75,
        motion: 'calm',
        radius: 24,
        density: 'comfortable',
      },
      voice: {
        minimizeWindowsOnVoiceStart: true,
        serverVadThreshold: 0.85,
        prefixPaddingMs: 600,
        silenceDurationMs: 900,
        bargeInEnabled: false,
        maxSpokenReplyTokens: 800,
      },
    };

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload: { settings: patch },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject(patch);
    expect(values).toEqual({
      'appearance.theme': '"system"',
      'appearance.accent': '"#a1B2c3"',
      'appearance.accent-secondary': '"#123456"',
      'appearance.surface-tint': '"#abcdef"',
      'appearance.background': '"living-aurora"',
      'appearance.glow': '0.75',
      'appearance.motion': '"calm"',
      'appearance.radius': '24',
      'appearance.density': '"comfortable"',
      'voice.minimize_windows_on_voice_start': 'true',
      'voice.server_vad_threshold': '0.85',
      'voice.prefix_padding_ms': '600',
      'voice.silence_duration_ms': '900',
      'voice.barge_in_enabled': 'false',
      'voice.max_spoken_reply_tokens': '800',
    });
    const reloaded = await app.inject({ url: '/settings', headers: authorization });
    expect(reloaded.json().settings).toMatchObject(patch);
    expect(reloaded.json().settings).not.toHaveProperty('windows');
    expect(reloaded.json().settings).not.toHaveProperty('generatedViews');
  });

  it('saves a validated subset and returns the effective settings', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const response = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: {
        settings: {
          appearance: { theme: 'dark' },
          jarvis: { reasoning: 'high' },
          voice: { defaultLanguage: 'en' },
          global: { maxParallelTasks: 4, maxCheckAttempts: 2, screenShareDailyFrameCap: 270 },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        appearance: { theme: 'dark' },
        jarvis: { model: 'gpt-5.6-luna', reasoning: 'high' },
        voice: { defaultLanguage: 'en' },
        global: { maxParallelTasks: 4, maxCheckAttempts: 2, screenShareDailyFrameCap: 270 },
      },
    });
    expect(values).toEqual({
      'appearance.theme': '"dark"',
      'jarvis.reasoning_effort': '"high"',
      'roles.chat.reasoning_effort': '"high"',
      'voice.default_language': '"en"',
      'global.max_parallel_tasks': '4',
      'global.max_check_attempts': '2',
      'global.screen_share_daily_frame_cap': '270',
    });
    const readBack = await app.inject({ url: '/settings', headers: authorization });
    expect(readBack.json().settings.appearance).toEqual({ theme: 'dark' });
  });

  it.each([0, 0.125, 1, 100])('persists and reloads the daily vision budget of %s USD', async (visionDailyBudgetUsd) => {
    const { store, values } = createStore();
    const app = fixture(store);
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { global: { visionDailyBudgetUsd } } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings.global.visionDailyBudgetUsd).toBe(visionDailyBudgetUsd);
    expect(values['global.vision_daily_budget_usd']).toBe(JSON.stringify(visionDailyBudgetUsd));
    expect(settingsStoreKeys).toContain('global.vision_daily_budget_usd');
    expect((await readSettings(store)).global.visionDailyBudgetUsd).toBe(visionDailyBudgetUsd);
  });

  it.each(['-0.01', '100.01', '"1"', 'null', '1e999', 'NaN', 'Infinity'])(
    'falls back to the default for invalid persisted vision budgets: %s', async (value) => {
      const { store, values } = createStore();
      values['global.vision_daily_budget_usd'] = value;
      expect((await readSettings(store)).global.visionDailyBudgetUsd).toBe(1);
    },
  );

  it.each([0, 1, 24, 48])('persists and reloads the daily conversation summary limit of %s', async (limit) => {
    const { store, values } = createStore();
    const app = fixture(store);
    expect(defaultSettings.global.conversationSummaryDailyLimit).toBe(24);
    expect((await readSettings(store)).global.conversationSummaryDailyLimit).toBe(24);
    expect(validateSettingsPatch({ global: { conversationSummaryDailyLimit: limit } }))
      .toEqual({ global: { conversationSummaryDailyLimit: limit } });
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { global: { conversationSummaryDailyLimit: limit } } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings.global.conversationSummaryDailyLimit).toBe(limit);
    expect(values['global.conversation_summary_daily_limit']).toBe(JSON.stringify(limit));
    expect(settingsStoreKeys).toContain('global.conversation_summary_daily_limit');
    expect((await readSettings(store)).global.conversationSummaryDailyLimit).toBe(limit);
  });

  it.each([-1, 49, 1.5, 'x', null, true])(
    'rejects the invalid daily conversation summary limit %j without persisting it', async (limit) => {
      const { store, values } = createStore();
      const app = fixture(store);
      expect(validateSettingsPatch({ global: { conversationSummaryDailyLimit: limit } })).toBeNull();
      const response = await app.inject({
        method: 'PATCH', url: '/settings', headers: authorization,
        payload: { settings: { global: { conversationSummaryDailyLimit: limit } } },
      });
      expect(response.statusCode).toBe(400);
      expect(values).toEqual({});
    },
  );

  it.each(['-1', '49', '1.5', '"x"', '"5"', 'null', 'true'])(
    'falls back to the default for invalid persisted conversation summary limits: %s', async (value) => {
      const { store, values } = createStore();
      values['global.conversation_summary_daily_limit'] = value;
      expect((await readSettings(store)).global.conversationSummaryDailyLimit).toBe(24);
    },
  );

  it('persists and reloads a validated home location without a migration', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const location = { city: 'Copenhagen', latitude: 55.6761, longitude: 12.5683 };
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { location } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings.location).toEqual(location);
    expect(values).toMatchObject({
      'location.home_city': '"Copenhagen"',
      'location.latitude': '55.6761',
      'location.longitude': '12.5683',
    });
    expect(settingsStoreKeys).toEqual(expect.arrayContaining([
      'location.home_city', 'location.latitude', 'location.longitude',
    ]));
    expect((await readSettings(store)).location).toEqual(location);
  });

  it.each([
    { latitude: 90.1 },
    { longitude: -180.1 },
    { city: 'Invalid\nCity' },
  ])('rejects an invalid home location update: %o', async (location) => {
    const { store } = createStore();
    const app = fixture(store);
    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { location } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('persists bounded personality preferences and supports restoring their defaults', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const customInstructions = 'Use a warmer tone and explain technical terms.';
    const updated = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: {
        settings: {
          personality: {
            tone: 'warm',
            responseStyle: 'detailed',
            customInstructions,
          },
        },
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.personality).toEqual({
      tone: 'warm',
      responseStyle: 'detailed',
      customInstructions,
      modeInstructions: defaultSettings.personality.modeInstructions,
    });
    expect(values).toEqual({
      'personality.tone': '"warm"',
      'personality.response_style': '"detailed"',
      'personality.custom_instructions': JSON.stringify(customInstructions),
    });
    expect((await app.inject({ url: '/settings', headers: authorization })).json().settings.personality)
      .toEqual(updated.json().settings.personality);

    const reset = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: {
        settings: {
          personality: {
            tone: 'british_butler',
            responseStyle: 'concise',
            customInstructions: '',
          },
        },
      },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().settings.personality).toEqual({
      tone: 'british_butler',
      responseStyle: 'concise',
      customInstructions: '',
      modeInstructions: defaultSettings.personality.modeInstructions,
    });
  });

  it('persists owner identity without resetting legacy preferences and isolates it to the owner', async () => {
    const { store, values } = createStore();
    values['personality.tone'] = '"direct"';
    values['personality.response_style'] = '"balanced"';
    values['personality.custom_instructions'] = JSON.stringify('Existing style preference.');
    values['personality.modeInstructions.away'] = JSON.stringify('Use Teams.');
    const owner = fixture(store);
    const agent = fixture(store, async () => ({
      kind: 'jarvis-agent',
      objectId: '00000000-0000-0000-0000-000000000001',
      tenantId: config.auth.tenantId,
    }));
    const initialSettings = await owner.inject({ url: '/settings', headers: authorization });
    const initialAgentSettings = await agent.inject({ url: '/agent/settings', headers: authorization });
    expect(initialSettings.json().settings.identity).toEqual({ description: '' });
    expect(initialAgentSettings.json()).toMatchObject({
      identity: { description: '' },
      identityContractVersion: 1,
      compositionRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      personality: {
        tone: 'direct',
        responseStyle: 'balanced',
        customInstructions: 'Existing style preference.',
        modeInstructions: { away: 'Use Teams.' },
      },
    });

    const changes: { type: string }[] = [];
    owner.nowEventHub.subscribe((event) => changes.push(event));
    const saved = await owner.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { identity: { description: 'Synthetic owner identity.' } } },
    });
    const updatedAgentSettings = await agent.inject({ url: '/agent/settings', headers: authorization });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.identity).toEqual({ description: 'Synthetic owner identity.' });
    expect(values).toMatchObject({
      'identity.description': '"Synthetic owner identity."',
      'personality.tone': '"direct"',
      'personality.response_style': '"balanced"',
      'personality.custom_instructions': '"Existing style preference."',
      'personality.modeInstructions.away': '"Use Teams."',
    });
    expect(changes).toContainEqual({ type: 'settings_changed' });
    expect(updatedAgentSettings.json()).toMatchObject({
      identity: { description: 'Synthetic owner identity.' },
      identityContractVersion: 1,
      compositionRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(updatedAgentSettings.json().compositionRevision).not.toBe(initialAgentSettings.json().compositionRevision);

    const otherUser = fixture(store, async () => ({
      objectId: '00000000-0000-0000-0000-000000000002',
      tenantId: config.auth.tenantId,
      displayName: 'Other user',
    }));
    const deniedRead = await otherUser.inject({ url: '/settings', headers: authorization });
    const deniedWrite = await otherUser.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { identity: { description: 'Must not be stored.' } } },
    });
    expect(deniedRead.statusCode).toBe(403);
    expect(deniedWrite.statusCode).toBe(403);
    expect(values['identity.description']).toBe('"Synthetic owner identity."');
  });

  it('accepts custom instructions at the configured limit', async () => {
    const app = fixture(createStore().store);
    const response = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: { settings: { personality: { customInstructions: 'x'.repeat(2_000) } } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().settings.personality.customInstructions).toHaveLength(2_000);
  });

  it('persists bounded per-mode instructions as distinct settings', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const modeInstructions = { present: 'Stay concise.', away: 'Use Teams.', on_the_move: 'Keep me safe.' };
    const response = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: { settings: { personality: { modeInstructions } } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().settings.personality.modeInstructions).toEqual(modeInstructions);
    expect(values).toMatchObject({
      'personality.modeInstructions.present': '"Stay concise."',
      'personality.modeInstructions.away': '"Use Teams."',
      'personality.modeInstructions.on_the_move': '"Keep me safe."',
    });
    expect((await app.inject({ url: '/settings', headers: authorization })).json().settings.personality.modeInstructions)
      .toEqual(modeInstructions);
  });

  it('uses built-in instructions for stored empty modes without rewriting them', async () => {
    const { store, values } = createStore();
    const write = vi.spyOn(store, 'write');
    values['personality.modeInstructions.present'] = '""';
    values['personality.modeInstructions.away'] = '"   "';
    values['personality.modeInstructions.on_the_move'] = JSON.stringify('Keep directions short.');
    const before = { ...values };

    const settings = await readSettings(store);
    expect(settings.personality.modeInstructions).toEqual({
      ...defaultSettings.personality.modeInstructions,
      on_the_move: 'Keep directions short.',
    });
    expect(values).toEqual(before);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    { modeInstructions: { away: 'x'.repeat(2_001) } },
    { modeInstructions: { present: '\u0000' } },
    { modeInstructions: { unknown: 'not allowed' } },
  ])('rejects invalid per-mode instructions: %j', async (personality) => {
    const { store } = createStore();
    const write = vi.spyOn(store, 'write');
    const app = fixture(store);
    const response = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: { settings: { personality } },
    });
    expect(response.statusCode).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('saves and reads New projects defaults', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const response = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: {
        settings: {
          newProjects: {
            owner: 'jarvis-org',
            visibility: 'public',
            templatesRepository: 'jarvis-org/templates',
            defaultAgent: 'codex',
            policy: 'complete_without_deployment',
            maxParallelTasks: 3,
            defaultBranch: 'develop',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().settings.newProjects).toEqual({
      owner: 'jarvis-org',
      visibility: 'public',
      templatesRepository: 'jarvis-org/templates',
      defaultAgent: 'codex',
      policy: 'complete_without_deployment',
      maxParallelTasks: 3,
      defaultBranch: 'develop',
    });
    expect(values).toEqual({
      'new_projects.owner': '"jarvis-org"',
      'new_projects.visibility': '"public"',
      'new_projects.templates_repository': '"jarvis-org/templates"',
      'new_projects.default_agent': '"codex"',
      'new_projects.policy': '"complete_without_deployment"',
      'new_projects.max_parallel_tasks': '3',
      'new_projects.default_branch': '"develop"',
    });
    const readBack = await app.inject({ url: '/settings', headers: authorization });
    expect(readBack.json().settings.newProjects).toEqual(response.json().settings.newProjects);
  });

  it('returns only non-secret credential status dates', async () => {
    const { store } = createStore();
    const credentials: CredentialStatusStore = {
      list: async () => [
        {
          name: 'codex-login', status: 'renew_soon',
          expiresAt: '2026-10-05T12:00:00.000Z', lastRenewedAt: '2026-09-25T12:00:00.000Z',
        },
        { name: 'copilot-token', status: 'unknown', expiresAt: null, lastRenewedAt: null },
      ],
      acquireCodexRenewalLease: async () => false,
      refreshCodexRenewalLease: async () => false,
      updateCopilotStatus: async () => {},
      updateGitHubAppStatus: async () => {},
      completeCodexRenewal: async () => {},
    };
    const app = fixture(store, undefined, credentials);
    const response = await app.inject({ url: '/settings', headers: authorization });

    expect(response.statusCode).toBe(200);
    expect(response.json().credentials).toEqual([
      {
        name: 'codex-login', status: 'renew_soon',
        expiresAt: '2026-10-05T12:00:00.000Z', lastRenewedAt: '2026-09-25T12:00:00.000Z',
      },
      { name: 'copilot-token', status: 'unknown', expiresAt: null, lastRenewedAt: null },
    ]);
    expect(response.body).not.toContain('secret');
  });

  it.each([true, false])('returns effective settings to the agent identity with automatic capture %s', async (automaticCapture) => {
    const { store } = createStore();
    await store.write({
      jarvis: { model: 'gpt-5.6-luna', reasoning: 'high' },
      memory: { automaticCapture },
      research: { timeoutSeconds: 280 },
      timeouts: {
        toolTimeoutSeconds: 45,
        longToolTimeoutSeconds: 300,
        backendHttpTimeoutSeconds: 20,
      },
      personality: {
        tone: 'direct',
        responseStyle: 'balanced',
        customInstructions: 'Prefer plain language.',
        modeInstructions: { on_the_move: 'Keep directions short.' },
      },
    });
    const awayModeStore = {
      read: vi.fn(async () => ({ mode: 'on_the_move', source: 'manual', changedAt: '2026-10-06T12:30:00.000Z' })),
      set: vi.fn(),
      markPresent: vi.fn(),
    } as unknown as AwayModeStore;
    const app = fixture(store, async () => ({
      kind: 'jarvis-agent',
      objectId: '00000000-0000-0000-0000-000000000001',
      tenantId: config.auth.tenantId,
    }), undefined, awayModeStore);

    const response = await app.inject({ url: '/agent/settings', headers: authorization });

    expect(response.statusCode).toBe(200);
    expect(response.json().capabilityInstructions).toBe(
      capabilityInstructions({ ...defaultSettings.memory, automaticCapture }),
    );
    expect(response.json().capabilityInstructions).toContain(
      'Status uses workspace_command (operation "navigate", page "status")',
    );
    expect(response.json().capabilityInstructions).not.toContain('The UI still refuses Status until its page exists');
    expect(response.json().capabilityInstructions).toContain('Only report it applied after the tool succeeds');
    expect(response.json().capabilityInstructions).toContain('relay refusal reasons');
    expect(response.json()).toEqual({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
      roles: {
        chat: { model: 'gpt-5.6-luna', reasoningEffort: 'high' },
        vision: { model: 'gpt-6-luna', reasoningEffort: 'none' },
        research: { model: 'gpt-5.6-luna', reasoningEffort: 'none' },
        voice: { model: 'gpt-realtime-2.1', reasoningEffort: 'none' },
        transcription: { model: 'mai-transcribe', reasoningEffort: 'none' },
        embedding: { model: 'text-embedding-3-small', reasoningEffort: 'none' },
        codex: { model: 'default', reasoningEffort: 'none' },
        copilot: { model: 'default', reasoningEffort: 'none' },
      },
      identity: { description: '' },
      identityContractVersion: 1,
      compositionRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      memory: {
        similarityThreshold: 0.35,
        searchTopK: 5,
        graphTextSimilarityThreshold: 0.12,
        automaticCapture,
      },
      research: { timeoutSeconds: 280 },
      capabilityInstructions: expect.stringContaining(automaticCapture
        ? 'Automatically save clearly stated, durable facts without inferring them.'
        : 'Do not proactively save memories; save only when Dan directly asks you to write to the vault.'),
      timeouts: {
        toolTimeoutSeconds: 45,
        longToolTimeoutSeconds: 300,
        backendHttpTimeoutSeconds: 20,
      },
      personality: {
        tone: 'direct',
        responseStyle: 'balanced',
        customInstructions: 'Prefer plain language.',
        modeInstructions: { ...defaultSettings.personality.modeInstructions, on_the_move: 'Keep directions short.' },
      },
      awayMode: true,
      mode: 'on_the_move',
      changedAt: '2026-10-06T12:30:00.000Z',
      jarvisRepository: 'DanAakesen/jarvis',
      projects: [],
    });
  });

  it('does not expose agent settings to Dan or when persistence is unavailable', async () => {
    const dan = fixture(createStore().store);
    const noStore = fixture(undefined, async () => ({
      kind: 'jarvis-agent',
      objectId: '00000000-0000-0000-0000-000000000001',
      tenantId: config.auth.tenantId,
    }));

    const denied = await dan.inject({ url: '/agent/settings', headers: authorization });
    const unavailable = await noStore.inject({ url: '/agent/settings', headers: authorization });

    expect(denied.statusCode).toBe(403);
    expect(unavailable.statusCode).toBe(503);
  });

  it.each([
    { settings: { appearance: { theme: 'solarized' } } },
    { settings: { appearance: { accent: 'rgb(1, 2, 3)' } } },
    { settings: { appearance: { 'accent-secondary': '#12345' } } },
    { settings: { appearance: { 'surface-tint': '#12345678' } } },
    { settings: { appearance: { background: 'unregistered-preset' } } },
    { settings: { appearance: { glow: 1.01 } } },
    { settings: { appearance: { glow: -0.01 } } },
    { settings: { appearance: { motion: 'none' } } },
    { settings: { appearance: { radius: 24.01 } } },
    { settings: { appearance: { radius: -0.01 } } },
    { settings: { appearance: { density: 'spacious' } } },
    { settings: { appearance: { customToken: '#123456' } } },
    { settings: { voice: { minimizeWindowsOnVoiceStart: 'yes' } } },
    { settings: { voice: { serverVadThreshold: -0.01 } } },
    { settings: { voice: { serverVadThreshold: 1.01 } } },
    { settings: { voice: { serverVadThreshold: '0.7' } } },
    { settings: { voice: { prefixPaddingMs: -1 } } },
    { settings: { voice: { prefixPaddingMs: 2_001 } } },
    { settings: { voice: { prefixPaddingMs: 1.5 } } },
    { settings: { voice: { silenceDurationMs: 99 } } },
    { settings: { voice: { silenceDurationMs: 5_001 } } },
    { settings: { voice: { silenceDurationMs: 1.5 } } },
    { settings: { voice: { bargeInEnabled: 'yes' } } },
    { settings: { voice: { maxSpokenReplyTokens: 0 } } },
    { settings: { voice: { maxSpokenReplyTokens: 4_097 } } },
    { settings: { voice: { maxSpokenReplyTokens: 1.5 } } },
    { settings: { jarvis: { model: 'not-available' } } },
    { settings: { jarvis: { reasoning: 'unsupported' } } },
    { settings: { personality: { tone: 'unbounded' } } },
    { settings: { personality: { responseStyle: 'unbounded' } } },
    { settings: { personality: { customInstructions: 'x'.repeat(2_001) } } },
    { settings: { personality: { customInstructions: '\u0000' } } },
    { settings: { identity: { description: 'x'.repeat(2_001) } } },
    { settings: { identity: { description: '\u0000' } } },
    { settings: { global: { maxParallelTasks: 101 } } },
    { settings: { global: { maxCheckAttempts: 11 } } },
    { settings: { global: { maxCheckAttempts: -1 } } },
    { settings: { global: { screenShareDailyFrameCap: 0 } } },
    { settings: { global: { screenShareDailyFrameCap: 301 } } },
    { settings: { global: { visionDailyBudgetUsd: -0.01 } } },
    { settings: { global: { visionDailyBudgetUsd: 100.01 } } },
    { settings: { global: { visionDailyBudgetUsd: '1' } } },
    { settings: { global: { visionDailyBudgetUsd: null } } },
    { settings: { global: { conversationSummaryDailyLimit: -1 } } },
    { settings: { global: { conversationSummaryDailyLimit: 49 } } },
    { settings: { global: { conversationSummaryDailyLimit: 1.5 } } },
    { settings: { global: { conversationSummaryDailyLimit: 'x' } } },
    { settings: { global: { conversationSummaryDailyLimit: null } } },
    { settings: { voice: { unknown: 'value' } } },
    { settings: { newProjects: { owner: '-invalid' } } },
    { settings: { newProjects: { visibility: 'internal' } } },
    { settings: { newProjects: { templatesRepository: 'not/a/valid/repository/extra' } } },
    { settings: { newProjects: { defaultAgent: 'unknown' } } },
    { settings: { newProjects: { policy: 'unknown' } } },
    { settings: { newProjects: { maxParallelTasks: 0 } } },
    { settings: { newProjects: { defaultBranch: 'invalid branch' } } },
    { settings: {} },
  ])('rejects invalid settings without persisting them: %j', async (payload) => {
    const { store } = createStore();
    const write = vi.spyOn(store, 'write');
    const app = fixture(store);

    const response = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization, payload,
    });

    expect(response.statusCode).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a mixed valid and invalid update without overwriting existing settings', async () => {
    const { store, values } = createStore();
    await store.write({ jarvis: { reasoning: 'high' } });
    const before = { ...values };
    const app = fixture(store);

    const response = await app.inject({
      method: 'PATCH',
      url: '/settings',
      headers: authorization,
      payload: { settings: { jarvis: { reasoning: 'low' }, appearance: { glow: 2 } } },
    });

    expect(response.statusCode).toBe(400);
    expect(values).toEqual(before);
    expect((await app.inject({ url: '/settings', headers: authorization })).json().settings.jarvis.reasoning).toBe('high');
  });

  it('preserves the accepted theme when a later theme update is rejected', async () => {
    const { store, values } = createStore();
    const app = fixture(store);
    const accepted = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { appearance: { theme: 'dark' } } },
    });
    expect(accepted.statusCode).toBe(200);

    const rejected = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { appearance: { theme: 'solarized' } } },
    });

    expect(rejected.statusCode).toBe(400);
    expect(values['appearance.theme']).toBe('"dark"');
    const readBack = await app.inject({ url: '/settings', headers: authorization });
    expect(readBack.json().settings.appearance).toEqual({ theme: 'dark' });
  });

  it('ignores persisted keys and values outside the current catalog', async () => {
    const store: SettingsStore = {
      read: async () => ({
        'jarvis.model': '"unsupported-model"',
        'global.max_parallel_tasks': '1000',
        'new_projects.visibility': '"internal"',
        'new_projects.default_branch': '"invalid branch"',
        'personality.tone': '"unbounded"',
        'personality.custom_instructions': JSON.stringify('x'.repeat(2_001)),
        'internal.secret': '"never-return-this"',
      }),
      write: async () => {},
    };
    const app = fixture(store);
    const response = await app.inject({ url: '/settings', headers: authorization });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        jarvis: { model: 'gpt-5.6-luna' },
        personality: { tone: 'british_butler', customInstructions: '' },
        global: { maxParallelTasks: 1 },
        newProjects: { visibility: 'private', defaultBranch: 'main' },
      },
    });
    expect(response.body).not.toContain('never-return-this');
  });
});
