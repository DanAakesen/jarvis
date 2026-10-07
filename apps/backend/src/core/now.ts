import type { FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { EventHub } from './event-hub.js';
import type { JarvisActivityHub } from './activity.js';
import type { NowSseEvent } from '@jarvis/contracts';
import { defaultAwayModeState } from './away-mode.js';
import { presenceModes, type PresenceMode } from './away-mode.js';
import type { BrowserConfirmation } from '../teams/service.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { formatSseEvent, writeSseEvent } from './sse.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$', maxLength: 19 };

export type NowActivityCategory = 'attention' | 'release' | 'credential' | 'alert';

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
  recordNotification?(kind: string, text: string): Promise<void>;
}

export type NowFeedStatusKind = 'pull_request_ready' | 'deployment_failed' | 'approval_pending';

export type NowFeedUpdate =
  | { type: 'refresh' }
  | { type: 'mode_changed'; mode: PresenceMode; away: boolean }
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

/** Fastify reply headers (CORS, Vary) that a hijacked stream must send itself. */
export function sseHeaders(reply: FastifyReply): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

export function registerNowRoutes(app: FastifyInstance) {
  app.get('/presence', async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.awayModeStore) return reply.code(503).send({ error: 'Presence mode unavailable' });
    reply.header('Cache-Control', 'no-store');
    return app.awayModeStore.read();
  });

  app.put<{ Body: { mode: PresenceMode } }>('/presence', {
    schema: {
      body: {
        type: 'object',
        properties: { mode: { type: 'string', enum: [...presenceModes] } },
        required: ['mode'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.awayModeStore) return reply.code(503).send({ error: 'Presence mode unavailable' });
    return app.awayModeStore.set(request.body.mode, 'manual');
  });

  app.post('/now/present', async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.awayModeStore) return reply.code(503).send({ error: 'Away mode unavailable' });
    const state = await app.awayModeStore.markPresent();
    return { away: state.mode !== 'present' };
  });

  app.get('/now', async (_request, reply) => {
    if (!app.nowFeedStore) return reply.code(503).send({ error: 'Now feed unavailable' });
    reply.header('Cache-Control', 'no-store');
    const [feed, awayMode] = await Promise.all([
      app.nowFeedStore.read(),
      app.awayModeStore?.read() ?? Promise.resolve(defaultAwayModeState),
    ]);
    const confirmations = app.teamsNotifications?.pendingBrowserConfirmations() ?? [];
    return sendBounded(reply, {
      ...feed,
      awayMode: awayMode.mode !== 'present',
      confirmations,
    });
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
    if (!service) {
      return reply.code(503).send({ error: 'Confirmation service unavailable' });
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
      if (closed) return;
      const frame: NowSseEvent = event.type === 'mode_changed'
        ? { event: 'mode', data: {} }
        : { event: 'now', data: {} };
      if (!writeSseEvent(response, frame)) end();
    });
    unsubscribeActivity = app.jarvisActivityHub.subscribe((event) => {
      if (closed) return;
      const frame: NowSseEvent = event.type === 'voice.wake'
        ? { event: 'voice-wake', data: event }
        : event.type === 'job'
          ? { event: 'job', data: event.job }
          : { event: 'jarvis-activity', data: event };
      if (!writeSseEvent(response, frame)) end();
    });
    reply.hijack();
    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) end();
    }, 25_000);
    response.once('close', cleanup);
    response.once('error', end);
    // hijack() bypasses Fastify's reply headers, so carry CORS across or browsers block the stream.
    response.writeHead(200, {
      ...sseHeaders(reply),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const workspaceConnection = app.workspaceCommands.connect(principal.objectId, (event) => {
      const frame = formatSseEvent(event);
      if (response.writableLength + Buffer.byteLength(frame) > 1024 * 1024) return false;
      return writeSseEvent(response, event);
    });
    closeWorkspace = workspaceConnection.close;
    const trustedBlobHost = generatedViewValidationOptions(app).trustedBlobHost;
    const ready = {
      sessionId: workspaceConnection.sessionId,
      ...(trustedBlobHost ? { trustedBlobHost } : {}),
    };
    if (!writeSseEvent(response, { event: 'workspace-ready', data: ready })) {
      end();
    }
    return reply;
  });
}
