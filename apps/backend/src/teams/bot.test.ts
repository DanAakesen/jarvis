import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createEphemeralAudioStore } from './audio-store.js';
import { createTeamsBotModule } from './bot.js';
import type { TeamsNotificationService } from './service.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

it('serves only short-lived opaque audio URLs without Jarvis bearer authentication', async () => {
  const audioStore = createEphemeralAudioStore();
  const token = audioStore.put(Buffer.from('fake mp3 bytes'));
  expect(token).not.toBeNull();
  const service = {
    notify: async () => {},
    expirePendingConfirmations: async () => {},
    pendingBrowserConfirmations: () => [],
    resolveBrowserConfirmation: async () => false,
    requestConfirmation: async () => {},
    runConfirmed: async (_kind, _summary, action) => action(),
    rememberMessage: async () => {},
    receiveConfirmation: async () => false,
  } satisfies TeamsNotificationService;
  const teams = await createTeamsBotModule({
    clientId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    notificationService: service,
    audioStore,
  });
  const app = buildApp({ ...loadConfig({}), logLevel: 'silent' }, undefined, { modules: [teams] });
  apps.push(app);

  const response = await app.inject({ method: 'GET', url: `/teams/audio/${token}` });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('audio/mpeg');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.body).toBe('fake mp3 bytes');
  expect((await app.inject({ method: 'HEAD', url: `/teams/audio/${token}` })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/teams/audio/unknown' })).statusCode).toBe(404);
  const unauthenticatedActivity = await app.inject({
    method: 'POST',
    url: '/api/messages',
    payload: { type: 'message', channelId: 'msteams' },
  });
  expect(unauthenticatedActivity.statusCode).toBe(401);
});
