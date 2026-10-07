import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { flattenSettings, readSettings, settingsStoreKeys, type SettingsStore } from './settings.js';
import type { CredentialStatusStore } from '../credentials/credential-status.js';
import type { AwayModeStore } from './away-mode.js';

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

function fixture(settingsStore?: SettingsStore, auth: TokenVerifier = async () => ({
  objectId: config.auth.ownerObjectId,
  tenantId: config.auth.tenantId,
  displayName: 'Dan',
}), credentialStatusStore?: CredentialStatusStore, awayModeStore?: AwayModeStore) {
  const app = buildApp(config, undefined, {
    auth,
    ...(settingsStore ? { settingsStore } : {}),
    ...(credentialStatusStore ? { credentialStatusStore } : {}),
    ...(awayModeStore ? { awayModeStore } : {}),
  });
  apps.push(app);
  return app;
}

describe('settings API', () => {
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
        appearance: { theme: 'light' },
        jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
        personality: { tone: 'british_butler', responseStyle: 'concise', customInstructions: '' },
        voice: { defaultLanguage: 'da', minimizeWindowsOnVoiceStart: false },
        codex: { model: 'default' },
        copilot: { model: 'default' },
        global: { maxParallelTasks: 1, maxCheckAttempts: 3, screenShareDailyFrameCap: 300, visionDailyBudgetUsd: 1 },
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
    });
  });

  it('exposes and saves Codex and Copilot model-specific reasoning choices', async () => {
    const { store } = createStore();
    const app = fixture(store);
    const initial = await app.inject({ url: '/settings', headers: authorization });

    expect(initial.json().options.codexModels).toContain('gpt-5.3-codex');
    expect(initial.json().options.copilotModels).toContain('claude-sonnet-4.6');
    expect(initial.json().options.roles.codex.reasoningEffortsByModel['gpt-5.5'])
      .toContain('xhigh');
    expect(initial.json().options.roles.copilot.reasoningEffortsByModel['gpt-5.4'])
      .toEqual(['none', 'low', 'medium', 'high']);

    const saved = await app.inject({
      method: 'PATCH', url: '/settings', headers: authorization,
      payload: { settings: { roles: {
        codex: { model: 'gpt-5.5', reasoningEffort: 'xhigh' },
        copilot: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
      } } },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.roles).toMatchObject({
      codex: { model: 'gpt-5.5', reasoningEffort: 'xhigh' },
      copilot: { model: 'claude-sonnet-4.6', reasoningEffort: 'high' },
    });
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
      voice: { minimizeWindowsOnVoiceStart: true },
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
      modeInstructions: { present: '', away: '', on_the_move: '' },
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
      modeInstructions: { present: '', away: '', on_the_move: '' },
    });
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

  it('returns only effective Jarvis model settings to the agent identity', async () => {
    const { store } = createStore();
    await store.write({
      jarvis: { model: 'gpt-5.6-luna', reasoning: 'high' },
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
      personality: {
        tone: 'direct',
        responseStyle: 'balanced',
        customInstructions: 'Prefer plain language.',
        modeInstructions: { present: '', away: '', on_the_move: 'Keep directions short.' },
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
    { settings: { jarvis: { model: 'not-available' } } },
    { settings: { jarvis: { reasoning: 'unsupported' } } },
    { settings: { personality: { tone: 'unbounded' } } },
    { settings: { personality: { responseStyle: 'unbounded' } } },
    { settings: { personality: { customInstructions: 'x'.repeat(2_001) } } },
    { settings: { personality: { customInstructions: '\u0000' } } },
    { settings: { global: { maxParallelTasks: 101 } } },
    { settings: { global: { maxCheckAttempts: 11 } } },
    { settings: { global: { maxCheckAttempts: -1 } } },
    { settings: { global: { screenShareDailyFrameCap: 0 } } },
    { settings: { global: { screenShareDailyFrameCap: 301 } } },
    { settings: { global: { visionDailyBudgetUsd: -0.01 } } },
    { settings: { global: { visionDailyBudgetUsd: 100.01 } } },
    { settings: { global: { visionDailyBudgetUsd: '1' } } },
    { settings: { global: { visionDailyBudgetUsd: null } } },
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
