import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AwayModeStore } from '../core/away-mode.js';
import { createEventHub } from '../core/event-hub.js';
import type { TaskEventHub, TaskEventMessage, TaskStore } from './task-store.js';

const config = {
  ...loadConfig({}),
  logLevel: 'silent' as const,
  staticWebAppOrigin: 'https://fixture.azurestaticapps.net',
};
const authHeader = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}` };

describe('away-mode task stream', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('withholds live task events from an already-open browser stream while away', async () => {
    let away = false;
    const awayModeStore = {
      read: vi.fn(async () => ({ away, source: away ? 'manual' : 'browser', changedAt: null })),
      markPresent: vi.fn(async () => {
        away = false;
        return { away, source: 'browser', changedAt: null };
      }),
      set: vi.fn(),
    } as unknown as AwayModeStore;
    const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
    const taskStore = {
      get: vi.fn(async () => ({})),
      getEventsAfter: vi.fn(async () => []),
    } as unknown as TaskStore;
    app = buildApp(config, undefined, {
      auth: async () => ({
        objectId: config.auth.ownerObjectId,
        tenantId: config.auth.tenantId,
        displayName: 'Dan',
      }),
      awayModeStore,
      eventHub,
      taskStore,
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/factory/tasks/42/events`, {
      headers: { ...authHeader, origin: config.staticWebAppOrigin },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();

    try {
      let initial = '';
      while (!initial.includes('event: ready')) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Task event stream closed before replay completed');
        initial += new TextDecoder().decode(value);
      }
      away = true;
      const nextEvent = reader.read().then(() => true, () => true);
      eventHub.publish({
        id: '21',
        taskId: '42',
        type: 'progress',
        summary: 'Do not send this update to the browser',
        payload: null,
        payloadTruncated: false,
        source: 'runner',
        at: '2026-10-04T00:00:01.000Z',
      });
      const received = await Promise.race([
        nextEvent,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(received).toBe(false);
      expect(awayModeStore.read).toHaveBeenCalled();
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
});
