import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { flattenSettings, type SettingsStore } from './settings.js';
import type { CredentialStatusStore } from '../credentials/credential-status.js';

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

function fixture(settingsStore?: SettingsStore, credentialStatusStore?: CredentialStatusStore) {
  const app = buildApp(config, undefined, {
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    ...(settingsStore ? { settingsStore } : {}),
    ...(credentialStatusStore ? { credentialStatusStore } : {}),
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
        jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
        voice: { defaultLanguage: 'da' },
        codex: { model: 'default' },
        copilot: { model: 'default' },
        global: { maxParallelTasks: 1 },
      },
    });
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
          jarvis: { reasoning: 'high' },
          voice: { defaultLanguage: 'en' },
          global: { maxParallelTasks: 4 },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: {
        jarvis: { model: 'gpt-5.6-luna', reasoning: 'high' },
        voice: { defaultLanguage: 'en' },
        global: { maxParallelTasks: 4 },
      },
    });
    expect(values).toEqual({
      'jarvis.reasoning_effort': '"high"',
      'voice.default_language': '"en"',
      'global.max_parallel_tasks': '4',
    });
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
      completeCodexRenewal: async () => {},
    };
    const app = fixture(store, credentials);
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

  it.each([
    { settings: { jarvis: { model: 'not-available' } } },
    { settings: { jarvis: { reasoning: 'unsupported' } } },
    { settings: { global: { maxParallelTasks: 101 } } },
    { settings: { voice: { unknown: 'value' } } },
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

  it('ignores persisted keys and values outside the current catalog', async () => {
    const store: SettingsStore = {
      read: async () => ({
        'jarvis.model': '"unsupported-model"',
        'global.max_parallel_tasks': '1000',
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
        global: { maxParallelTasks: 1 },
      },
    });
    expect(response.body).not.toContain('never-return-this');
  });
});
