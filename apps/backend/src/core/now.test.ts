import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { createEventHub } from './event-hub.js';
import { InMemoryOwnerSessionStore } from '../auth/session/memory-store.js';
import { OwnerSessionService } from '../auth/session/service.js';
import type { NowFeed, NowFeedEventHub, NowFeedStore } from './now.js';
import type { AwayModeStore } from './away-mode.js';
import type { OwnerInteractionService } from './owner-interactions.js';
import type { TaskEventHub, TaskEventMessage } from '../factory/task-store.js';
import { PendingGoogleActions } from '../google/pending-actions.js';
import { createGoogleModule } from '../google/tools.js';
import { coreModule } from './index.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}` };
const feed: NowFeed = {
  updatedAt: '2026-10-04T00:00:00.000Z',
  awayMode: false,
  confirmations: [],
  running: [{
    id: '42',
    title: 'Ship the feed',
    project: 'Jarvis',
    agent: 'copilot',
    activity: 'Running tests',
    startedAt: '2026-10-03T23:00:00.000Z',
  }],
  items: [{
    id: '7',
    category: 'attention',
    title: 'Sandbox crashed',
    link: 'task:43',
    at: '2026-10-03T23:30:00.000Z',
  }],
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(
  store?: NowFeedStore,
  auth: TokenVerifier = async () => ({
    objectId: config.auth.ownerObjectId,
    tenantId: config.auth.tenantId,
    displayName: 'Dan',
  }),
  awayModeStore?: AwayModeStore,
  ownerSessions?: OwnerSessionService,
) {
  const nowEventHub: NowFeedEventHub = createEventHub();
  const app = buildApp(ownerSessions ? { ...config, ownerSessionEnabled: true } : config, undefined, {
    auth, nowFeedStore: store, nowEventHub, awayModeStore,
    ...(ownerSessions ? { ownerSessions } : {}),
  });
  apps.push(app);
  return { app, nowEventHub };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Now feed API', () => {
  it('returns and updates the owner presence mode', async () => {
    let state: {
      mode: 'present' | 'away' | 'on_the_move';
      source: 'manual' | 'device' | 'browser' | 'jarvis';
      changedAt: string | null;
    } = { mode: 'present', source: 'browser', changedAt: null };
    const awayModeStore: AwayModeStore = {
      read: vi.fn(async () => state),
      set: vi.fn(async (mode, source = 'manual') => {
        state = { mode, source, changedAt: '2026-10-06T12:00:00.000Z' };
        return source === 'device' ? { ...state, ignored: 'recent_manual' } : state;
      }),
      markPresent: vi.fn(),
    };
    const { app } = fixture(undefined, undefined, awayModeStore);

    expect((await app.inject({ url: '/presence', headers })).json()).toEqual({
      mode: 'present',
      source: 'browser',
      changedAt: null,
    });
    const changed = await app.inject({
      method: 'PUT',
      url: '/presence',
      headers,
      payload: { mode: 'on_the_move' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({
      mode: 'on_the_move',
      source: 'manual',
      changedAt: '2026-10-06T12:00:00.000Z',
    });
    expect(awayModeStore.set).toHaveBeenCalledWith('on_the_move', 'manual');
    const deviceChanged = await app.inject({
      method: 'PUT',
      url: '/presence',
      headers,
      payload: { mode: 'on_the_move', source: 'device' },
    });
    expect(deviceChanged.statusCode).toBe(200);
    expect(deviceChanged.json()).toEqual({
      mode: 'on_the_move',
      source: 'device',
      changedAt: '2026-10-06T12:00:00.000Z',
      ignored: 'recent_manual',
    });
    expect(awayModeStore.set).toHaveBeenLastCalledWith('on_the_move', 'device');
    expect((await app.inject({
      method: 'PUT', url: '/presence', headers, payload: { mode: 'driving' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PUT', url: '/presence', headers, payload: { mode: 'present', source: 'browser' },
    })).statusCode).toBe(400);

    const otherUser = fixture(undefined, async () => ({
      objectId: '00000000-0000-0000-0000-000000000099',
      tenantId: config.auth.tenantId,
      displayName: 'Other user',
    }), awayModeStore).app;
    expect((await otherUser.inject({ url: '/presence', headers })).statusCode).toBe(403);
    expect((await otherUser.inject({
      method: 'PUT', url: '/presence', headers, payload: { mode: 'present' },
    })).statusCode).toBe(403);
  });

  it('returns the current running tasks and activity to the signed-in user', async () => {
    const store: NowFeedStore = { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) };
    const { app } = fixture(store);

    const response = await app.inject({ url: '/now', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(feed);
    expect(store.read).toHaveBeenCalledOnce();
  });

  it('marks explicit authenticated browser activity as present', async () => {
    let away = true;
    const awayModeStore = {
      read: vi.fn(async () => ({ mode: away ? 'away' as const : 'present' as const, source: away ? 'manual' as const : 'browser' as const, changedAt: null })),
      markPresent: vi.fn(async () => {
        away = false;
        return { mode: 'present' as const, source: 'browser' as const, changedAt: null };
      }),
      set: vi.fn(),
    };
    const app = buildApp({ ...config, staticWebAppOrigin: 'https://fixture.azurestaticapps.net' }, undefined, {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
      nowFeedStore: { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) },
      awayModeStore,
    });
    apps.push(app);

    const feedResponse = await app.inject({
      url: '/now',
      headers: { ...headers, origin: 'https://fixture.azurestaticapps.net' },
    });
    const anonymousPresence = await app.inject({ method: 'POST', url: '/now/present' });
    const presenceResponse = await app.inject({
      method: 'POST',
      url: '/now/present',
      headers: { ...headers, origin: 'https://fixture.azurestaticapps.net' },
    });

    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json().awayMode).toBe(true);
    expect(anonymousPresence.statusCode).toBe(401);
    expect(presenceResponse.statusCode).toBe(200);
    expect(presenceResponse.json()).toEqual({ away: false });
    expect(awayModeStore.markPresent).toHaveBeenCalledOnce();
  });

  it('keeps the Now feed available in the browser while away', async () => {
    const awayModeStore: AwayModeStore = {
      read: vi.fn(async () => ({ mode: 'away', source: 'manual', changedAt: null })),
      markPresent: vi.fn(),
      set: vi.fn(),
    };
    const { app } = fixture(
      {
        read: vi.fn(async () => ({
          ...feed,
        })),
        dismiss: vi.fn(async () => true),
      },
      undefined,
      awayModeStore,
    );

    const response = await app.inject({ url: '/now', headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      awayMode: true,
      running: feed.running,
      items: feed.items,
      confirmations: [],
    });
  });

  it('lists browser confirmations and accepts an authenticated approval while away', async () => {
    let away = true;
    const confirmation = {
      id: 'A'.repeat(43),
      actionKind: 'merge',
      summary: 'Merge the reviewed change.',
      expiresAt: '2026-10-04T00:05:00.000Z',
    } as const;
    const awayModeStore: AwayModeStore = {
      read: vi.fn(async () => ({
        mode: away ? 'away' as const : 'present' as const,
        source: away ? 'manual' : 'browser',
        changedAt: null,
      })),
      markPresent: vi.fn(async () => {
        away = false;
        return { mode: 'present', source: 'browser', changedAt: null };
      }),
      set: vi.fn(),
    };
    const resolveBrowserConfirmation = vi.fn(async () => true);
    const ownerInteractions = {
      pendingBrowserConfirmations: () => [confirmation],
      resolveBrowserConfirmation,
    } as unknown as OwnerInteractionService;
    const app = buildApp({ ...config, staticWebAppOrigin: 'https://fixture.azurestaticapps.net' }, undefined, {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
      nowFeedStore: { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) },
      awayModeStore,
      ownerInteractions,
    });
    apps.push(app);

    const shown = await app.inject({
      url: '/now',
      headers: { ...headers, origin: 'https://fixture.azurestaticapps.net' },
    });
    expect(shown.json().confirmations).toEqual([confirmation]);

    expect((await app.inject({
      method: 'POST',
      url: `/now/confirmations/${confirmation.id}`,
      payload: { decision: 'approve' },
    })).statusCode).toBe(401);
    expect(resolveBrowserConfirmation).not.toHaveBeenCalled();

    const approved = await app.inject({
      method: 'POST',
      url: `/now/confirmations/${confirmation.id}`,
      headers,
      payload: { decision: 'approve' },
    });
    expect(approved.statusCode).toBe(204);
    expect(resolveBrowserConfirmation).toHaveBeenCalledWith(confirmation.id, 'approve');

    const invalid = await app.inject({
      method: 'POST',
      url: `/now/confirmations/${confirmation.id}`,
      headers,
      payload: { decision: 'allow' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it.each(['owner', 'agent', 'other', 'anonymous'])('gates calendar tap approvals for %s', async (identity) => {
    const actions = new PendingGoogleActions();
    const execute = vi.fn(async () => ({ status: 'completed' }));
    actions.stage({ scope: 'calendar', sourceSessionId: '1', sourceMessageId: '42',
      summary: 'Move the synthetic meeting to 15:00.', execute });
    const card = actions.pendingBrowserConfirmations()[0]!;
    const app = buildApp(config, undefined, {
      auth: async () => identity === 'agent'
        ? { kind: 'jarvis-agent', objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }
        : { objectId: identity === 'other' ? 'other-owner' : config.auth.ownerObjectId,
          tenantId: config.auth.tenantId, displayName: 'Dan' },
      nowFeedStore: { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) },
      modules: [coreModule, createGoogleModule({ request: vi.fn() }, {
        timeZone: 'Europe/Copenhagen', pendingActions: actions,
      })],
    });
    apps.push(app);
    if (identity === 'owner') {
      const shown = await app.inject({ url: '/now', headers });
      expect(shown.json().confirmations).toEqual([card]);
      expect(execute).not.toHaveBeenCalled();
    }
    const response = await app.inject({
      method: 'POST', url: `/now/confirmations/${card.id}`,
      ...(identity === 'anonymous' ? {} : { headers }),
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(identity === 'owner' ? 204 : identity === 'anonymous' ? 401 : 403);
    expect(execute).toHaveBeenCalledTimes(identity === 'owner' ? 1 : 0);
    if (identity === 'owner') {
      expect((await app.inject({ url: '/now', headers })).json().confirmations).toEqual([]);
      expect((await app.inject({ method: 'POST', url: `/now/confirmations/${card.id}`, headers,
        payload: { decision: 'approve' } })).statusCode).toBe(404);
      expect(execute).toHaveBeenCalledOnce();
    }
  });

  it.each(['partial', 'unverified', 'throw'])('shows %s calendar tap results instead of false success', async (status) => {
    const actions = new PendingGoogleActions();
    const execute = vi.fn(async () => {
      if (status === 'throw') throw new Error('Unsafe provider diagnostic');
      return { status, detail: 'Only one event was created.', items: [
        { summary: 'First meeting', status: 'completed' },
        { summary: 'Second meeting', status: 'unverified', detail: 'Check the calendar.' },
      ] };
    });
    actions.stage({ scope: 'calendar', sourceSessionId: '1', sourceMessageId: '42',
      summary: 'Create both synthetic meetings.', execute });
    const card = actions.pendingBrowserConfirmations()[0]!;
    const recordNotification = vi.fn<NonNullable<NowFeedStore['recordNotification']>>(async () => {});
    const app = buildApp(config, undefined, {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
      modules: [coreModule, createGoogleModule({ request: vi.fn() }, {
        timeZone: 'Europe/Copenhagen', pendingActions: actions,
      })],
      nowFeedStore: { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true), recordNotification },
    });
    apps.push(app);
    const response = await app.inject({ method: 'POST', url: `/now/confirmations/${card.id}`, headers,
      payload: { decision: 'approve' } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toContain('do not repeat');
    expect(response.body).not.toContain('Unsafe provider diagnostic');
    if (status !== 'throw') expect(response.json().error).toContain('Second meeting: Check the calendar.');
    expect(recordNotification).toHaveBeenCalledWith('error', expect.stringContaining('do not repeat'));
    if (status !== 'throw') {
      expect(recordNotification).toHaveBeenCalledWith('error',
        expect.stringContaining('Second meeting: Check the calendar.'));
    }
    expect(recordNotification.mock.calls.every(([, text]) => text.length <= 400)).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/now/confirmations/${card.id}`, headers,
      payload: { decision: 'approve' } })).statusCode).toBe(404);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('refuses browser approvals and presence updates from a different authenticated identity', async () => {
    const markPresent = vi.fn();
    const resolveBrowserConfirmation = vi.fn();
    const app = buildApp(config, undefined, {
      auth: async () => ({
        objectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        tenantId: config.auth.tenantId,
        displayName: 'Other user',
      }),
      awayModeStore: {
        read: vi.fn(async () => ({ mode: 'present', source: 'browser', changedAt: null })),
        markPresent,
        set: vi.fn(),
      } as unknown as AwayModeStore,
      ownerInteractions: {
        pendingBrowserConfirmations: () => [],
        resolveBrowserConfirmation,
      } as unknown as OwnerInteractionService,
    });
    apps.push(app);

    const presence = await app.inject({ method: 'POST', url: '/now/present', headers });
    const approval = await app.inject({
      method: 'POST',
      url: `/now/confirmations/${'A'.repeat(43)}`,
      headers,
      payload: { decision: 'approve' },
    });

    expect(presence.statusCode).toBe(403);
    expect(approval.statusCode).toBe(403);
    expect(markPresent).not.toHaveBeenCalled();
    expect(resolveBrowserConfirmation).not.toHaveBeenCalled();
  });

  it('routes away task-state updates through Now and refreshes the app', async () => {
    const nowEventHub = createEventHub();
    const update = vi.fn();
    nowEventHub.subscribe(update);
    const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
    const awayModeStore = {
      read: vi.fn(async () => ({ mode: 'away', source: 'manual', changedAt: null })),
      set: vi.fn(),
      markPresent: vi.fn(),
    } as unknown as AwayModeStore;
    const notify = vi.fn(async () => {});
    const app = buildApp(config, undefined, {
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' }),
      eventHub,
      nowEventHub,
      awayModeStore,
      ownerInteractions: { notify } as unknown as OwnerInteractionService,
    });
    apps.push(app);

    eventHub.publish({
      id: '20',
      taskId: '42',
      type: 'state_changed',
      summary: null,
      payload: { from: 'Ready', to: 'Running' },
      payloadTruncated: false,
      source: 'backend',
      at: '2026-10-04T00:00:00.000Z',
    });

    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('info', 'Task 42 is now Running.'));
    expect(update).toHaveBeenCalledWith({ type: 'refresh' });
  });

  it('protects the read and returns unavailable when its store is missing', async () => {
    const store: NowFeedStore = { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) };
    const { app } = fixture(store);

    expect((await app.inject({ url: '/now' })).statusCode).toBe(401);
    expect(store.read).not.toHaveBeenCalled();

    const unavailable = fixture();
    const response = await unavailable.app.inject({ url: '/now', headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Now feed unavailable' });
  });

  it('persists a dismissal, publishes an update, and returns not found for an unknown item', async () => {
    const store: NowFeedStore = {
      read: vi.fn(async () => feed),
      dismiss: vi.fn(async (id) => id === '7'),
    };
    const { app, nowEventHub } = fixture(store);
    const update = vi.fn();
    nowEventHub.subscribe(update);

    const dismissed = await app.inject({ method: 'POST', url: '/now/activity/7/dismiss', headers });
    const missing = await app.inject({ method: 'POST', url: '/now/activity/8/dismiss', headers });

    expect(dismissed.statusCode).toBe(204);
    expect(store.dismiss).toHaveBeenNthCalledWith(1, '7');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'Activity item not found' });
    expect(store.dismiss).toHaveBeenNthCalledWith(2, '8');
    expect(update).toHaveBeenCalledOnce();
  });

  it('rejects IDs outside SQL bigint range before dismissing', async () => {
    const store: NowFeedStore = { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) };
    const { app } = fixture(store);

    const response = await app.inject({
      method: 'POST',
      url: '/now/activity/9223372036854775808/dismiss',
      headers,
    });

    expect(response.statusCode).toBe(400);
    expect(store.dismiss).not.toHaveBeenCalled();
  });

  it('sends CORS headers on the hijacked stream so the web app can read it', async () => {
    const store: NowFeedStore = { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) };
    const { app } = fixture(store);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const origin = 'http://localhost:5173';
    const response = await fetch(`${address}/now/events`, { headers: { ...headers, origin }, signal: controller.signal });
    try {
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    } finally {
      controller.abort();
      await app.close();
    }
  });
  it('streams authenticated refresh events after a task event', async () => {
    const store: NowFeedStore = { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) };
    const { app } = fixture(store);
    expect((await app.inject({ url: '/now/events' })).statusCode).toBe(401);

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/now/events`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();

    try {
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: workspace-ready');
      app.eventHub.publish({
        id: '20',
        taskId: '42',
        type: 'progress',
        summary: 'Tests passed',
        payload: null,
        payloadTruncated: false,
        source: 'runner',
        at: '2026-10-04T00:00:00.000Z',
      });
      const chunk = await reader.read();
      expect(new TextDecoder().decode(chunk.value)).toContain('event: now\ndata: {}');
      const activity = {
        type: 'tool-call-finished',
        activityId: '11111111-1111-4111-8111-111111111111',
        source: 'chat',
        toolName: 'workspace_command',
        outcome: 'ok',
      } as const;
      const activityFrame = reader.read();
      app.jarvisActivityHub.publish(activity);
      const activityChunk = new TextDecoder().decode((await activityFrame).value);
      expect(activityChunk).toContain('event: jarvis-activity');
      expect(activityChunk).toContain(JSON.stringify(activity));
      expect(activityChunk).not.toMatch(/arguments|result|transcript|secret/iu);
      const wake = { type: 'voice.wake', at: '2026-10-06T14:24:37.078Z' } as const;
      const wakeFrame = reader.read();
      app.jarvisActivityHub.publish(wake);
      const wakeChunk = new TextDecoder().decode((await wakeFrame).value);
      expect(wakeChunk).toBe(`event: voice-wake\ndata: ${JSON.stringify(wake)}\n\n`);
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it('sends Now refresh events while away', async () => {
    const away = true;
    const nowEventHub: NowFeedEventHub = createEventHub();
    const app = buildApp(config, undefined, {
      auth: async () => ({
        objectId: config.auth.ownerObjectId,
        tenantId: config.auth.tenantId,
        displayName: 'Dan',
      }),
      nowEventHub,
      awayModeStore: {
        read: vi.fn(async () => ({
          mode: away ? 'away' : 'present',
          source: away ? 'manual' : 'browser',
          changedAt: null,
        })),
        markPresent: vi.fn(),
        set: vi.fn(),
      } as unknown as AwayModeStore,
    });
    apps.push(app);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const response = await fetch(`${address}/now/events`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();

    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: workspace-ready');
      const next = reader.read().then(({ value }) => new TextDecoder().decode(value));
      nowEventHub.publish({ type: 'refresh' });
      expect(await next).toContain('event: now\ndata: {}');

      const mode = reader.read().then(({ value }) => new TextDecoder().decode(value));
      nowEventHub.publish({ type: 'mode_changed', mode: 'present', away: false });
      expect(await mode).toContain('event: mode\ndata: {}');

      const board = reader.read().then(({ value }) => new TextDecoder().decode(value));
      nowEventHub.publish({ type: 'board', projectId: '42', version: 3 });
      expect(await board).toContain('event: board\ndata: {"projectId":"42","version":3}');
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it('ends a Now stream opened with a session token after current-session revoke', async () => {
    const store: NowFeedStore = { read: vi.fn(async () => feed), dismiss: vi.fn(async () => true) };
    const sessions = new OwnerSessionService({
      store: new InMemoryOwnerSessionStore(),
      ownerObjectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
    });
    const created = await sessions.create({
      ownerObjectId: config.auth.ownerObjectId, displayName: 'Dan', deviceLabel: null,
    });
    const { app } = fixture(store, undefined, undefined, sessions);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const sessionHeaders = { authorization: `${['Bear', 'er'].join('')} ${created.token}` };
    const response = await fetch(`${address}/now/events`, { headers: sessionHeaders, signal: controller.signal });
    const reader = response.body!.getReader();

    try {
      expect(response.status).toBe(200);
      await reader.read();
      const revoked = await app.inject({ method: 'DELETE', url: '/auth/session', headers: sessionHeaders });
      expect(revoked.statusCode).toBe(204);
      expect((await reader.read()).done).toBe(true);
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
      await app.close();
    }
  });
});
