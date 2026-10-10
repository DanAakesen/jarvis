import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TeamsNotificationService } from '../teams/service.js';
import type { ToolCallRecord } from './tool-calls.js';
import { flattenSettings, type SettingsStore } from './settings.js';
import { ToolRefusal } from './tool-registry.js';
import { coreModule } from './index.js';
import { fallbackModelCatalogue } from './model-catalog.js';
import type { ModelCatalogue } from '@jarvis/contracts';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(options: { teamsNotifications?: TeamsNotificationService; catalogue?: ModelCatalogue } = {}) {
  const values: Record<string, unknown> = {};
  const settingsStore: SettingsStore = {
    read: vi.fn(async () => ({ ...values })),
    write: vi.fn(async (settings) => {
      for (const { key, value } of flattenSettings(settings)) values[key] = value;
    }),
  };
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    settingsStore,
    ...(options.catalogue ? { modelCatalogue: { read: async () => options.catalogue! } } : {}),
    toolCallStore: { record },
    conversationStore: {
      getDanMessageIdBySourceItemId: vi.fn(async () => '43'),
    } as never,
    ...(options.teamsNotifications ? { teamsNotifications: options.teamsNotifications } : {}),
  });
  apps.push(app);
  return { app, settingsStore, values, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Jarvis settings tools', () => {
  it('registers shared settings tools and returns settings without credential data', async () => {
    const { app, settingsStore } = fixture();
    vi.mocked(settingsStore.read).mockResolvedValue({ 'credentials.codex': 'not-a-setting' });
    const tools = await app.inject({ url: '/tools', headers });

    expect(tools.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'get_settings' }),
      expect.objectContaining({ name: 'update_settings' }),
      expect.objectContaining({ name: 'set_jarvis_model' }),
    ]));
    const response = await app.inject({ method: 'POST', url: '/tools/get_settings', headers, payload: {} });

    expect(response.json()).toMatchObject({
      tool: 'get_settings',
      outcome: 'ok',
      result: { settings: { voice: { maxSpokenReplyTokens: 4_096 } } },
    });
    expect(response.json().result).not.toHaveProperty('credentials');
    expect(JSON.stringify(response.json())).not.toContain('not-a-setting');
    expect(settingsStore.write).not.toHaveBeenCalled();

    const voiceResponse = await app.inject({
      method: 'POST',
      url: '/tools/get_settings',
      headers: { authorization: headers.authorization, 'x-jarvis-voice-item-id': 'voice-item-1' },
      payload: {},
    });
    expect(voiceResponse.json()).toMatchObject({ tool: 'get_settings', outcome: 'ok' });
  });

  it('updates valid non-role settings without confirmation and redacts the tool audit', async () => {
    const { app, values, record } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/tools/update_settings',
      headers,
      payload: { settings: { voice: { maxSpokenReplyTokens: 512 } } },
    });

    expect(response.json()).toMatchObject({
      tool: 'update_settings',
      outcome: 'ok',
      result: { settings: { voice: { maxSpokenReplyTokens: 512 } } },
    });
    expect(values['voice.max_spoken_reply_tokens']).toBe('512');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'update_settings',
      arguments: { redacted: true },
      result: { redacted: true },
    }));
  });

    it('matches HTTP options for a fake catalogue and guides every supported field', async () => {
      const catalogue = fallbackModelCatalogue();
      catalogue.deployments = [{
        name: 'test-chat', model: 'test-chat', version: '1', sku: 'GlobalStandard',
        capacity: 1, capabilities: ['chat', 'responses'], reasoningEfforts: ['none', 'high'],
      }];
      const { app, record } = fixture({ catalogue });
      const http = await app.inject({ url: '/settings', headers });
      const response = await app.inject({ method: 'POST', url: '/tools/get_settings', headers, payload: {} });
      const { settings, options, fields } = response.json().result;

      expect(options).toEqual(http.json().options);
      expect(settings).toEqual(http.json().settings);
      expect(options.roles.chat).toEqual({
        models: ['test-chat'], reasoningEffortsByModel: { 'test-chat': ['none', 'high'] },
      });
      expect(fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'roles.chat.model', type: 'string', allowedValues: ['test-chat'], nowConfirmation: true }),
        expect.objectContaining({ path: 'voice.defaultLanguage', allowedValues: ['da', 'en'], nowConfirmation: false }),
        expect.objectContaining({ path: 'appearance.radius', type: 'number', minimum: 0, maximum: 24, nowConfirmation: false }),
        expect.objectContaining({ path: 'global.visionDailyBudgetUsd', minimum: 0, maximum: 100, nowConfirmation: true }),
        expect.objectContaining({ path: 'personality.modeInstructions.present', type: 'string', maxLength: 2_000 }),
      ]));
      const paths: string[] = fields.map((field: { path: string }) => field.path);
      const checkPaths = (values: Record<string, unknown>, prefix = '') => {
        for (const [key, value] of Object.entries(values)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'object' && value !== null) checkPaths(value as Record<string, unknown>, path);
          else expect(paths).toContain(path);
        }
      };
      checkPaths(settings);
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        arguments: { redacted: true }, result: { redacted: true },
      }));
    });

    it.each(['roles', 'voice', 'research', 'memory', 'timeouts', 'appearance', 'personality'])(
      'filters settings, options and fields to %s', async (area) => {
        const { app } = fixture();
        const full = await app.inject({ method: 'POST', url: '/tools/get_settings', headers, payload: {} });
        const response = await app.inject({ method: 'POST', url: '/tools/get_settings', headers, payload: { area } });
        const result = response.json().result;

        expect(response.json().outcome).toBe('ok');
        expect(result.settings).toEqual({ [area]: full.json().result.settings[area] });
        expect(result.fields.length).toBeGreaterThan(0);
        expect(result.fields.every((field: { path: string }) => field.path.startsWith(`${area}.`))).toBe(true);
        for (const [key, value] of Object.entries(result.options)) expect(value).toEqual(full.json().result.options[key]);
        if (area !== 'roles') expect(result.options).not.toHaveProperty('roles');
      },
    );

    it.each([
      [{ voice: { defaultLanguage: 'de' } }, 'voice.defaultLanguage', '"da", "en"'],
      [{ appearance: { theme: 'blue' } }, 'appearance.theme', '"light", "dark", "system"'],
      [{ voice: { maxSpokenReplyTokens: 0 } }, 'voice.maxSpokenReplyTokens', 'from 1 to 4096'],
      [{ memory: { unsupported: 'private-value' } }, 'memory.[unsupported key]', 'similarityThreshold'],
      [{ memory: { privateTokenIdentifier: 'private-value' } }, 'memory.[unsupported key]', 'similarityThreshold'],
      [{ memory: { 'private text in key': 'private-value' } }, 'memory.[unsupported key]', 'similarityThreshold'],
      [{ roles: { unknown: { model: 'private-value' } } }, 'roles.[unsupported key]', 'chat'],
      [{ roles: { chat: {} } }, 'roles.chat', 'reasoningEffort'],
      [{ roles: { chat: { model: 'gpt-6-luna', reasoningEffort: 'default' } } }, 'roles.chat.reasoningEffort', '"xhigh"'],
      [{ roles: { chat: { model: 'missing' } } }, 'roles.chat.model', 'gpt-5.6-luna'],
      [{ roles: { voice: { reasoningEffort: 'high' } } }, 'roles.voice.reasoningEffort', '"none"'],
      [{ jarvis: { reasoning: 'xhigh' } }, 'jarvis.reasoning', '"none", "low", "medium", "high"'],
      [{ personality: { modeInstructions: { present: '\u0001private-value' } } }, 'personality.modeInstructions.present', '2000'],
    ])('returns actionable refusal for %j', async (settings, path, valid) => {
      const { app, settingsStore, record } = fixture();
      const response = await app.inject({
        method: 'POST', url: '/tools/update_settings', headers, payload: { settings },
      });
      const body = response.json();
      expect(body.outcome).toBe('refused');
      expect(JSON.stringify(body)).toContain(path);
      expect(JSON.stringify(body)).toContain(valid.replaceAll('"', '\\"'));
      expect(JSON.stringify(body)).not.toContain('private-value');
      expect(JSON.stringify(body)).not.toContain('privateTokenIdentifier');
      expect(settingsStore.write).not.toHaveBeenCalled();
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        arguments: { redacted: true }, result: { redacted: true },
      }));
    });

    it('validates reasoning against the proposed model rather than the current model', async () => {
      const runConfirmed = vi.fn(async (_kind: string, _summary: string, action: () => Promise<unknown>) => action());
      const { app, values } = fixture({
        teamsNotifications: { runConfirmed } as unknown as TeamsNotificationService,
      });
      const response = await app.inject({
        method: 'POST', url: '/tools/update_settings', headers,
        payload: { settings: { roles: { chat: { model: 'gpt-6-luna', reasoningEffort: 'xhigh' } } } },
      });
      expect(response.json().outcome).toBe('ok');
      expect(values['roles.chat.reasoning_effort']).toBe('"xhigh"');
    });

  it('confirms model-role and budget changes in Now before writing', async () => {
    let approve!: () => void;
    const runConfirmed = vi.fn(async (_kind: string, _summary: string, action: () => Promise<unknown>) => {
      await new Promise<void>((resolve) => { approve = resolve; });
      return action();
    });
    const { app, settingsStore, values } = fixture({
      teamsNotifications: { runConfirmed } as unknown as TeamsNotificationService,
    });
    const pending = app.inject({
      method: 'POST',
      url: '/tools/update_settings',
      headers,
      payload: {
        settings: {
          roles: { chat: { reasoningEffort: 'high' } },
          global: { visionDailyBudgetUsd: 2 },
        },
      },
    });
    await vi.waitFor(() => expect(runConfirmed).toHaveBeenCalledOnce());

    expect(runConfirmed).toHaveBeenCalledWith(
      'other',
      'Change chat model settings and the daily vision budget in Jarvis settings.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(settingsStore.write).not.toHaveBeenCalled();
    approve();
    expect((await pending).json()).toMatchObject({ outcome: 'ok' });
    expect(values).toMatchObject({
      'roles.chat.reasoning_effort': '"high"',
      'global.vision_daily_budget_usd': '2',
    });
  });

  it('refuses unsupported or credential-like keys without writing', async () => {
    const { app, settingsStore } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/tools/update_settings',
      headers,
      payload: { settings: { credentials: { apiKey: 'not-a-secret' } } },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(settingsStore.write).not.toHaveBeenCalled();
  });

  it('refuses role changes if Now confirmation is unavailable', async () => {
    const { app, settingsStore } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/tools/update_settings',
      headers,
      payload: { settings: { roles: { chat: { reasoningEffort: 'high' } } } },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(settingsStore.write).not.toHaveBeenCalled();
  });

  it('does not write a model change when Dan rejects Now confirmation', async () => {
    const runConfirmed = vi.fn(async () => { throw new ToolRefusal('Dan rejected the request.'); });
    const { app, settingsStore } = fixture({
      teamsNotifications: { runConfirmed } as unknown as TeamsNotificationService,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/update_settings',
      headers,
      payload: { settings: { roles: { chat: { reasoningEffort: 'high' } } } },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(settingsStore.write).not.toHaveBeenCalled();
  });
});
