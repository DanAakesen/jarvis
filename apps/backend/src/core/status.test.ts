import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AwayModeStore } from './away-mode.js';
import type { NowFeedSnapshot, NowFeedStore } from './now.js';
import { coreModule } from './index.js';
import { summarizeNowFeed } from './status.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}`,
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

const feed: NowFeedSnapshot = {
  updatedAt: '2026-10-04T12:00:00.000Z',
  running: [{
    id: '1',
    title: 'Secret task title',
    project: 'Private project',
    agent: 'codex',
    activity: 'Full private log',
    startedAt: '2026-10-04T11:00:00.000Z',
  }],
  items: [
    { id: '2', category: 'attention', title: 'Private question', link: null, at: '2026-10-04T11:30:00.000Z' },
    { id: '3', category: 'release', title: 'Private release log', link: null, at: '2026-10-04T11:31:00.000Z' },
    { id: '4', category: 'credential', title: 'Private credential', link: null, at: '2026-10-04T11:32:00.000Z' },
    { id: '5', category: 'alert', title: 'Private alert', link: null, at: '2026-10-04T11:33:00.000Z' },
    { id: '6', category: 'mode', title: 'Private mode detail', link: null, at: '2026-10-04T11:34:00.000Z' },
  ],
};

function fixture(store: NowFeedStore | null, awayModeStore?: AwayModeStore) {
  const record = vi.fn(async () => {});
  const app = buildApp(config, undefined, {
    modules: [coreModule],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
    nowFeedStore: store,
    awayModeStore,
    toolCallStore: { record },
  });
  apps.push(app);
  return { app, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('get_status_summary', () => {
  it('summarizes only bounded Now-feed counts without exposing feed contents', async () => {
    const read = vi.fn(async () => feed);
    const { app, record } = fixture({ read, dismiss: vi.fn(async () => true) });
    const response = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      tool: 'get_status_summary',
      outcome: 'ok',
      result: {
        summary: 'The Now feed shows 1 running task, 1 task needing attention, 1 release or deployment update, 1 credential warning, 1 alert, 1 mode update.',
      },
      confirmation: 'Done: get_status_summary succeeded.',
    });
    expect(JSON.stringify(response.json())).not.toMatch(/Secret task title|Private project|Full private log|Private question|Private release log|Private credential|Private alert|Private mode detail/u);
    expect(read).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '42',
      tool: 'get_status_summary',
      arguments: {},
      outcome: 'ok',
    }));
    expect(summarizeNowFeed(feed)).toContain('1 running task');
  });

  it('refuses to invent a summary when the feed is unavailable and rejects extra input', async () => {
    const { app } = fixture(null);
    const unavailable = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: {},
    });
    const invalid = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: [],
    });

    expect(unavailable.json()).toMatchObject({ outcome: 'refused', result: { refused: 'The Now feed is unavailable.' } });
    expect(invalid.statusCode).toBe(400);
  });

  it('applies away mode visibility before summarizing status', async () => {
    const awayModeStore: AwayModeStore = {
      read: async () => ({ away: true, source: 'manual', changedAt: null, presenceAwaySince: null }),
      markPresent: async () => ({ away: false, source: 'browser', changedAt: null, presenceAwaySince: null }),
      set: async () => ({ away: true, source: 'manual', changedAt: null, presenceAwaySince: null }),
      observePresence: async () => ({ away: true, source: 'presence', changedAt: null, presenceAwaySince: null }),
    };
    const { app } = fixture({ read: async () => feed, dismiss: vi.fn(async () => true) }, awayModeStore);
    const response = await app.inject({
      method: 'POST', url: '/tools/get_status_summary', headers, payload: {},
    });

    expect(response.json()).toMatchObject({
      result: {
        summary: 'The Now feed shows 0 running tasks, 0 tasks needing attention, 0 release or deployment updates, 0 credential warnings, 0 alerts, 1 mode update.',
      },
    });
  });
});
