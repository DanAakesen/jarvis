import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TeamsNotificationService } from '../teams/service.js';
import type { ToolCallRecord } from './tool-calls.js';
import { flattenSettings, type SettingsStore } from './settings.js';
import { ToolRefusal } from './tool-registry.js';
import { coreModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(options: { teamsNotifications?: TeamsNotificationService } = {}) {
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
