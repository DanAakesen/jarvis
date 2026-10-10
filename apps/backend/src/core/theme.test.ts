import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { flattenSettings, type SettingsStore } from './settings.js';
import type { ToolCallRecord } from './tool-calls.js';
import { coreModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['a', 'b', 'c'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function createStore(write: SettingsStore['write'] = async () => {}): SettingsStore {
  const values: Record<string, unknown> = {};
  return {
    read: async () => ({ ...values }),
    write: async (patch) => {
      await write(patch);
      for (const { key, value } of flattenSettings(patch)) values[key] = value;
    },
  };
}

function fixture(settingsStore?: SettingsStore, auth: TokenVerifier = async () => ({
  kind: 'jarvis-agent',
  objectId: '00000000-0000-0000-0000-000000000001',
  tenantId: config.auth.tenantId,
})) {
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth,
    ...(settingsStore ? { settingsStore } : {}),
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, record };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('set_theme tool', () => {
  it('registers and persists only accepted appearance tokens', async () => {
    const store = createStore();
    const { app, record } = fixture(store);
    const catalogue = await app.inject({ url: '/tools', headers });
    expect(catalogue.statusCode).toBe(200);
    expect(catalogue.json().map((tool: { name: string }) => tool.name)).toContain('set_theme');

    const response = await app.inject({
      method: 'POST',
      url: '/tools/set_theme',
      headers,
      payload: { tokens: { appearance: 'dark', accent: '#1a2B3c', radius: 18, density: 'compact' } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tool: 'set_theme',
      outcome: 'ok',
      result: {
        updated: true,
        tokens: { appearance: 'dark', accent: '#1a2B3c', radius: 18, density: 'compact' },
      },
    });
    expect(await store.read()).toEqual({
      'appearance.theme': '"dark"',
      'appearance.accent': '"#1a2B3c"',
      'appearance.radius': '18',
      'appearance.density': '"compact"',
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', tool: 'set_theme' }));
  });

  it('reports unavailable preferences as refused and storage failures as sanitized errors', async () => {
    const unavailable = fixture();
    const refused = await unavailable.app.inject({
      method: 'POST', url: '/tools/set_theme', headers, payload: { tokens: { appearance: 'dark' } },
    });
    expect(refused.json()).toMatchObject({ outcome: 'refused', result: { refused: 'Settings are unavailable.' } });
    expect(unavailable.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'refused' }));

    const failure = fixture(createStore(async () => { throw new Error('private SQL detail'); }));
    const errored = await failure.app.inject({
      method: 'POST', url: '/tools/set_theme', headers, payload: { tokens: { appearance: 'dark' } },
    });
    expect(errored.json()).toMatchObject({ outcome: 'error', result: { error: 'Tool execution failed' } });
    expect(errored.body).not.toContain('private SQL detail');
    expect(failure.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
  });

  it('clears a colour with null and resets all colour overrides', async () => {
    const store = createStore();
    const { app } = fixture(store, async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }));
    const set = await app.inject({
      method: 'POST',
      url: '/tools/set_theme',
      headers,
      payload: { tokens: { accent: '#a1b2c3', 'accent-secondary': '#123456', 'surface-tint': '#abcdef' } },
    });
    expect(set.json()).toMatchObject({ outcome: 'ok' });

    const clear = await app.inject({
      method: 'POST',
      url: '/tools/set_theme',
      headers,
      payload: { tokens: { accent: null } },
    });
    expect(clear.json()).toMatchObject({ outcome: 'ok', result: { tokens: { accent: null } } });
    const partial = await app.inject({ url: '/settings', headers });
    expect(partial.json().settings.appearance).not.toHaveProperty('accent');
    expect(partial.json().settings.appearance).toMatchObject({
      'accent-secondary': '#123456',
      'surface-tint': '#abcdef',
    });

    const reset = await app.inject({
      method: 'POST',
      url: '/tools/set_theme',
      headers,
      payload: { tokens: { reset: true } },
    });
    expect(reset.json()).toMatchObject({
      outcome: 'ok',
      result: { tokens: { reset: true, accent: null, 'accent-secondary': null, 'surface-tint': null } },
    });
    const cleared = await app.inject({ url: '/settings', headers });
    for (const key of ['accent', 'accent-secondary', 'surface-tint']) {
      expect(cleared.json().settings.appearance).not.toHaveProperty(key);
    }
  });

  it('rejects invalid hex and null for non-clearable appearance tokens', async () => {
    const write = vi.fn<SettingsStore['write']>(async () => {});
    const { app, record } = fixture(createStore(write));
    for (const tokens of [{ accent: 'red' }, { appearance: null }, { background: null }, { radius: null }]) {
      const response = await app.inject({
        method: 'POST', url: '/tools/set_theme', headers, payload: { tokens },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json(), JSON.stringify(tokens)).toMatchObject({ outcome: 'refused' });
    }
    expect(write).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
