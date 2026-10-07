import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneSessionStore } from '../database/phone-session-store.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createPhoneStatusModule } from './status.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' ') };
const history = [{
  startedAt: '2026-10-07T12:00:00.000Z',
  durationSeconds: 120,
  outcome: 'ended' as const,
}];
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(store: PhoneSessionStore | null, configured = true) {
  const app = buildApp(config, undefined, {
    modules: [createPhoneStatusModule({ configured, store })],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('phone status API', () => {
  it('returns configured state and recent call history to the signed-in owner', async () => {
    const store = { recent: vi.fn(async () => history) } as unknown as PhoneSessionStore;
    const response = await fixture(store).inject({ url: '/phone/status', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      configured: true,
      historyAvailable: true,
      recentCalls: history,
    });
    expect(store.recent).toHaveBeenCalledOnce();
  });

  it('reports an unconfigured service and unavailable history without a database', async () => {
    const response = await fixture(null, false).inject({ url: '/phone/status', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      configured: false,
      historyAvailable: false,
      recentCalls: [],
    });
  });

  it('requires owner authentication and reports history failures without details', async () => {
    const store = {
      recent: vi.fn(async () => { throw new Error('database details'); }),
    } as unknown as PhoneSessionStore;
    const app = fixture(store);

    expect((await app.inject({ url: '/phone/status' })).statusCode).toBe(401);
    const response = await app.inject({ url: '/phone/status', headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Phone status unavailable' });
    expect(JSON.stringify(response.json())).not.toContain('database details');
  });
});
