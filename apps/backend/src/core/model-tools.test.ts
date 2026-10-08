import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ToolCallRecord } from './tool-calls.js';
import { flattenSettings, type SettingsStore } from './settings.js';
import { coreModule } from './index.js';
import type { TeamsNotificationService } from '../teams/service.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture() {
  const values: Record<string, unknown> = {};
  const settingsStore: SettingsStore = {
    read: vi.fn(async () => ({ ...values })),
    write: vi.fn(async (settings) => {
      for (const { key, value } of flattenSettings(settings)) values[key] = value;
    }),
  };
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const runConfirmed = vi.fn(async (_kind: string, _summary: string, action: () => Promise<unknown>) => action());
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    settingsStore,
    toolCallStore: { record },
    teamsNotifications: { runConfirmed } as unknown as TeamsNotificationService,
  });
  apps.push(app);
  return { app, settingsStore, values, record, runConfirmed };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Jarvis model tool', () => {
  it('registers a schema-backed tool and applies supported settings to the next session', async () => {
    const { app, settingsStore, values, runConfirmed } = fixture();
    const discovery = await app.inject({ url: '/tools', headers });
    expect(discovery.json()).toContainEqual(expect.objectContaining({
      name: 'set_jarvis_model',
      inputSchema: expect.objectContaining({ type: 'object', additionalProperties: false }),
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/tools/set_jarvis_model',
      headers,
      payload: { model: 'gpt-5.6-luna', reasoning: 'high' },
    });

    expect(response.json()).toMatchObject({
      tool: 'set_jarvis_model',
      outcome: 'ok',
      result: { model: 'gpt-5.6-luna', reasoning: 'high', applies: 'next session' },
    });
    expect(settingsStore.write).toHaveBeenCalledWith({
      roles: { chat: { model: 'gpt-5.6-luna', reasoningEffort: 'high' } },
    });
    expect(runConfirmed).toHaveBeenCalledWith(
      'other',
      'Change chat model settings in Jarvis settings.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(values).toEqual({
      'roles.chat.model': '"gpt-5.6-luna"',
      'roles.chat.reasoning_effort': '"high"',
    });
  });

  it.each([
    ['model', { model: 'not-verified' }, 'Unsupported Jarvis model. Valid models: gpt-5.6-luna, gpt-6-luna.'],
    ['reasoning', { reasoning: 'extreme' }, 'Unsupported Jarvis reasoning. Valid reasoning levels: none, low, medium, high.'],
  ])('refuses an unknown %s and lists verified options', async (_name, payload, reason) => {
    const { app, settingsStore, record } = fixture();
    const response = await app.inject({
      method: 'POST',
      url: '/tools/set_jarvis_model',
      headers,
      payload,
    });

    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: reason } });
    expect(settingsStore.write).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'refused' }));
  });

  it('rejects an empty change before recording or writing settings', async () => {
    const { app, settingsStore, record } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/set_jarvis_model', headers, payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(settingsStore.write).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
