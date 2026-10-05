import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ToolCallRecord } from './tool-calls.js';
import { flattenSettings, type SettingsStore } from './settings.js';
import { coreModule } from './index.js';

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
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    settingsStore,
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, settingsStore, values, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Jarvis model tool', () => {
  it('registers a schema-backed tool and applies supported settings to the next session', async () => {
    const { app, settingsStore, values } = fixture();
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
      jarvis: { model: 'gpt-5.6-luna', reasoning: 'high' },
    });
    expect(values).toEqual({
      'jarvis.model': '"gpt-5.6-luna"',
      'jarvis.reasoning_effort': '"high"',
    });
  });

  it.each([
    ['model', { model: 'not-verified' }, 'Unsupported Jarvis model. Valid models: gpt-5.6-luna.'],
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
