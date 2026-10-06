import type { FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { EventHub } from './event-hub.js';
import type { JarvisActivityHub } from './activity.js';
import { defaultAwayModeState } from './away-mode.js';
import type { BrowserConfirmation } from '../teams/service.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 };

export type NowActivityCategory = 'attention' | 'release' | 'credential' | 'alert' | 'mode';

export interface NowRunningTask {
  id: string;
  title: string;
  project: string;
  agent: 'codex' | 'copilot';
  activity: string;
  startedAt: string;
}

export interface NowActivityItem {
  id: string;
  category: NowActivityCategory;
  title: string;
  link: string | null;
  at: string;
}

export interface NowFeed {
  running: NowRunningTask[];
  items: NowActivityItem[];
  updatedAt: string;
  awayMode: boolean;
  confirmations: readonly BrowserConfirmation[];
}

export type NowFeedSnapshot = Omit<NowFeed, 'awayMode' | 'confirmations'>;

export interface NowFeedStore {
  read(): Promise<NowFeedSnapshot>;
  dismiss(id: string): Promise<boolean>;
}

export type NowFeedStatusKind = 'pull_request_ready' | 'deployment_failed';

export type NowFeedUpdate =
  | { type: 'refresh' }
  | { type: 'mode_changed'; away: boolean }
  | { type: 'status'; kind: NowFeedStatusKind };

export type NowFeedEventHub = EventHub<NowFeedUpdate>;

declare module 'fastify' {
  interface FastifyInstance {
    nowFeedStore: NowFeedStore | null;
    nowEventHub: NowFeedEventHub;
    jarvisActivityHub: JarvisActivityHub;
  }
}

function sendBounded(reply: FastifyReply, value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized) > 1024 * 1024) {
    return reply.code(413).send({ error: 'Response too large' });
  }
  return reply.send(value);
}

export function registerNowRoutes(app: FastifyInstance) {
  app.post('/now/present', async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.awayModeStore) return reply.code(503).send({ error: 'Away mode unavailable' });
    const state = await app.awayModeStore.markPresent();
    return { away: state.away };
  });

  app.get('/now', async (_request, reply) => {
    if (!app.nowFeedStore) return reply.code(503).send({ error: 'Now feed unavailable' });
    reply.header('Cache-Control', 'no-store');
    const [feed, awayMode] = await Promise.all([
      app.nowFeedStore.read(),
      app.awayModeStore?.read() ?? Promise.resolve(defaultAwayModeState),
    ]);
    const confirmations = awayMode.away
      ? []
      : app.teamsNotifications?.pendingBrowserConfirmations() ?? [];
    const snapshot = awayMode.away
      ? {
        ...feed,
        running: [],
        items: feed.items.filter((item) => item.category === 'mode'),
      }
      : feed;
    return sendBounded(reply, { ...snapshot, awayMode: awayMode.away, confirmations });
  });

  app.post<{ Params: { id: string }; Body: { decision: 'approve' | 'reject' } }>('/now/confirmations/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', maxLength: 43 } },
        required: ['id'],
        additionalProperties: false,
      },
      body: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
        required: ['decision'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const service = app.teamsNotifications;
    if (!service || !app.awayModeStore) {
      return reply.code(503).send({ error: 'Confirmation service unavailable' });
    }
    if ((await app.awayModeStore.read()).away) {
      return reply.code(409).send({ error: 'Approvals are sent to Teams while away.' });
    }
    if (!await service.resolveBrowserConfirmation(request.params.id, request.body.decision)) {
      return reply.code(404).send({ error: 'Confirmation is no longer available.' });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/now/activity/:id/dismiss', {
    schema: {
      params: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
      response: { 400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } },
    },
  }, async (request, reply) => {
    if (!app.nowFeedStore) return reply.code(503).send({ error: 'Now feed unavailable' });
    const { id } = request.params;
    if (BigInt(id) > maxSqlBigInt) return reply.code(400).send({ error: 'Invalid activity ID' });
    if (!await app.nowFeedStore.dismiss(id)) return reply.code(404).send({ error: 'Activity item not found' });
    app.nowEventHub.publish({ type: 'refresh' });
    return reply.code(204).send();
  });

  app.get('/now/events', async (request, reply) => {
    const principal = request.principal;
    if (!principal || principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const response = reply.raw;
    let closed = false;
    let unsubscribe: () => void = () => {};
    let unsubscribeActivity: () => void = () => {};
    let closeWorkspace = () => {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeActivity();
      closeWorkspace();
    };
    const end = () => {
      cleanup();
      if (!response.writableEnded) response.end();
    };
    unsubscribe = app.nowEventHub.subscribe((event) => {
      void (async () => {
        let away: boolean;
        try {
          away = (await app.awayModeStore?.read() ?? defaultAwayModeState).away;
        } catch {
          return;
        }
        if (closed) return;
        const frame = event.type === 'mode_changed'
          ? 'event: mode\ndata: {}\n\n'
          : away ? null : 'event: now\ndata: {}\n\n';
        if (frame && !response.write(frame)) end();
      })();
    });
    unsubscribeActivity = app.jarvisActivityHub.subscribe((event) => {
      if (closed) return;
      const frame = event.type === 'voice.wake'
        ? `event: voice-wake\ndata: ${JSON.stringify(event)}\n\n`
        : `event: jarvis-activity\ndata: ${JSON.stringify(event)}\n\n`;
      if (!response.write(frame)) end();
    });
    reply.hijack();
    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) end();
    }, 25_000);
    response.once('close', cleanup);
    response.once('error', end);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const workspaceConnection = app.workspaceCommands.connect(principal.objectId, (event, data) => {
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      if (response.writableLength + Buffer.byteLength(frame) > 1024 * 1024) return false;
      return response.write(frame);
    });
    closeWorkspace = workspaceConnection.close;
    const trustedBlobHost = generatedViewValidationOptions(app).trustedBlobHost;
    const ready = {
      sessionId: workspaceConnection.sessionId,
      ...(trustedBlobHost ? { trustedBlobHost } : {}),
    };
    if (!response.write(`event: workspace-ready\ndata: ${JSON.stringify(ready)}\n\n`)) {
      end();
    }
    return reply;
  });
}
