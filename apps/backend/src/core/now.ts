import type { FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { EventHub } from './event-hub.js';
import { defaultAwayModeState } from './away-mode.js';

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
}

export type NowFeedSnapshot = Omit<NowFeed, 'awayMode'>;

export interface NowFeedStore {
  read(): Promise<NowFeedSnapshot>;
  dismiss(id: string): Promise<boolean>;
}

export interface NowFeedUpdate {
  type: 'refresh';
}

export type NowFeedEventHub = EventHub<NowFeedUpdate>;

declare module 'fastify' {
  interface FastifyInstance {
    nowFeedStore: NowFeedStore | null;
    nowEventHub: NowFeedEventHub;
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
  app.get('/now', async (_request, reply) => {
    if (!app.nowFeedStore) return reply.code(503).send({ error: 'Now feed unavailable' });
    const [feed, awayMode] = await Promise.all([
      app.nowFeedStore.read(),
      app.awayModeStore?.read() ?? Promise.resolve(defaultAwayModeState),
    ]);
    return sendBounded(reply, { ...feed, awayMode: awayMode.away });
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

  app.get('/now/events', async (_request, reply) => {
    const response = reply.raw;
    let closed = false;
    let unsubscribe: () => void = () => {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    const end = () => {
      cleanup();
      if (!response.writableEnded) response.end();
    };
    unsubscribe = app.nowEventHub.subscribe(() => {
      if (!closed && !response.write('event: now\ndata: {}\n\n')) end();
    });
    reply.hijack();
    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) end();
    }, 25_000);
    response.once('close', cleanup);
    response.once('error', end);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    return reply;
  });
}
