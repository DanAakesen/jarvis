import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import type { BackendModule } from '../modules.js';
import type {
  ConversationChannel,
  ConversationLanguage,
  ConversationRole,
} from './conversation-store.js';
import {
  executeReflexAction,
  registerChatReflex,
  reflexTargets,
  type ReflexClassifier,
  type ReflexActionResult,
  type ReflexTarget,
} from './reflex.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const chatReflexBudgetMs = 800;
const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
};

function validId(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxSqlBigInt;
}

const sessionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    channel: { type: 'string', enum: ['chat', 'voice'] },
    language: { type: 'string', enum: ['da', 'en'] },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: ['string', 'null'], format: 'date-time' },
  },
  required: ['id', 'channel', 'language', 'startedAt', 'endedAt'],
  additionalProperties: false,
};

const historySchema = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sessionId: { type: 'string' },
          channel: { type: 'string', enum: ['chat', 'voice'] },
          language: { type: 'string', enum: ['da', 'en'] },
          role: { type: 'string', enum: ['dan', 'jarvis'] },
          text: { type: 'string' },
          model: { type: ['string', 'null'] },
          voiceMinutes: { type: ['number', 'null'], minimum: 0 },
          at: { type: 'string', format: 'date-time' },
          toolCalls: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                tool: { type: 'string' },
                outcome: { type: 'string', enum: ['ok', 'refused', 'error'] },
                taskId: { type: ['string', 'null'] },
              },
              required: ['id', 'tool', 'outcome', 'taskId'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'sessionId', 'channel', 'language', 'role', 'text', 'model', 'voiceMinutes', 'at', 'toolCalls'],
        additionalProperties: false,
      },
    },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['messages', 'nextCursor'],
  additionalProperties: false,
};

function streamEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function logChatLatency(
  request: FastifyRequest,
  phase: 'reflex_targets' | 'jev' | 'agent_first_byte',
  startedAt: number,
): void {
  request.log.info({
    msg: 'chat.latency',
    phase,
    durationMs: Math.max(0, performance.now() - startedAt),
  }, 'chat.latency');
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return undefined;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function runChatReflex(
  request: FastifyRequest,
  classifier: ReflexClassifier,
  text: string,
  language: ConversationLanguage,
  messageId: string,
  signal: AbortSignal,
): Promise<ReflexActionResult | null> {
  const budgetController = new AbortController();
  const timeout = setTimeout(() => budgetController.abort(), chatReflexBudgetMs);
  const classificationSignal = AbortSignal.any([signal, budgetController.signal]);
  try {
    const targetsStartedAt = performance.now();
    let targets: ReflexTarget[];
    try {
      const resolvedTargets = await raceWithAbort(reflexTargets(request, text), classificationSignal);
      if (resolvedTargets === undefined) return null;
      targets = resolvedTargets;
    } finally {
      logChatLatency(request, 'reflex_targets', targetsStartedAt);
    }
    if (classificationSignal.aborted) return null;

    const jevStartedAt = performance.now();
    let classification: Awaited<ReturnType<ReflexClassifier['classify']>>;
    try {
      const result = await raceWithAbort(
        classifier.classify(text, language, targets, classificationSignal),
        classificationSignal,
      );
      if (result === undefined) return null;
      classification = result;
    } finally {
      logChatLatency(request, 'jev', jevStartedAt);
    }
    if (classificationSignal.aborted) return null;
    return await executeReflexAction(classification, request, messageId, signal);
  } catch {
    // Reflex is best effort; the agent stream owns the chat response.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const conversationModule: BackendModule = {
  id: 'conversation',
  tools: [],
  registerRoutes: async (app) => {
    app.post<{
      Params: { sessionId: string };
      Body: {
        text: string;
        screenContext?: string;
        sharedScreenContext?: { screenDescription: string; sharedWindowTitle?: string };
      };
    }>('/conversation/sessions/:sessionId/turns', {
      schema: {
        params: { type: 'object', properties: { sessionId: idSchema }, required: ['sessionId'], additionalProperties: false },
        body: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 20_000 },
            screenContext: { type: 'string', minLength: 1, maxLength: 5_000 },
            sharedScreenContext: {
              type: 'object',
              properties: {
                screenDescription: { type: 'string', minLength: 1, maxLength: 5_000 },
                sharedWindowTitle: { type: 'string', minLength: 1, maxLength: 300 },
              },
              required: ['screenDescription'],
              additionalProperties: false,
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
        response: { 400: errorResponse, 404: errorResponse, 503: errorResponse },
      },
    }, async (request, reply) => {
      const store = app.conversationStore;
      const agent = app.conversationAgent;
      if (!store) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      if (!agent) return reply.code(503).send({ error: 'Chat is unavailable until the Jarvis agent is configured' });
      const { sessionId } = request.params;
      if (!validId(sessionId)) return reply.code(400).send({ error: 'Invalid conversation session ID' });
      const text = request.body.text.trim();
      if (!text) return reply.code(400).send({ error: 'Message text cannot be empty' });
      if (request.body.screenContext !== undefined && !request.body.screenContext.trim()) {
        return reply.code(400).send({ error: 'Screen context cannot be empty' });
      }

      const session = await store.getSession(sessionId);
      if (!session || session.endedAt !== null) return reply.code(404).send({ error: 'Active chat session not found' });
      if (session.channel !== 'chat') return reply.code(400).send({ error: 'Session is not a chat session' });
      const authorization = request.headers.authorization;
      if (!authorization) return reply.code(401).send({ error: 'Unauthorized' });
      if (request.body.sharedScreenContext !== undefined) {
        request.requireSharedScreenContext = true;
        request.sharedScreenContext = request.body.sharedScreenContext;
      }

      const userMessage = await store.addMessage({ sessionId, role: 'dan', text, model: null });
      if (!userMessage) return reply.code(404).send({ error: 'Active chat session not found' });

      const controller = new AbortController();
      const activityId = randomUUID();
      let activityFinished = false;
      const publishActivity = (type: 'thinking' | 'interrupted' | 'failed' | 'ended') => {
        if (activityFinished) return;
        app.jarvisActivityHub.publish({ type, activityId, source: 'chat' });
        if (type !== 'thinking') activityFinished = true;
      };
      const abortOnClose = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      request.raw.once('aborted', abortOnClose);
      reply.raw.once('close', abortOnClose);
      reply.header('Content-Type', 'text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no');
      const stream = Readable.from((async function* () {
        yield streamEvent('user', userMessage);
        let answer = '';
        publishActivity('thinking');
        try {
          const agentStartedAt = performance.now();
          const classifier = request.requireSharedScreenContext ? undefined : app.reflexClassifier;
          const finishReflex = classifier ? registerChatReflex(userMessage.id) : undefined;
          const agentIterator = agent.stream({
            messageId: userMessage.id,
            text,
            language: session.language,
            ...(request.body.screenContext === undefined ? {} : { screenContext: request.body.screenContext }),
          }, authorization, controller.signal, { agentSessionId: `chat-${sessionId}` })[Symbol.asyncIterator]();
          let next = agentIterator.next();
          if (classifier && finishReflex) {
            void runChatReflex(
              request,
              classifier,
              text,
              session.language,
              userMessage.id,
              controller.signal,
            ).then(finishReflex, () => finishReflex(null));
          }
          let firstByteLogged = false;
          try {
            while (true) {
              const chunk = await next;
              if (chunk.done) break;
              const delta = chunk.value;
              if (!firstByteLogged) {
                firstByteLogged = true;
                logChatLatency(request, 'agent_first_byte', agentStartedAt);
              }
              answer += delta;
              if (Buffer.byteLength(answer) > 512 * 1024) throw new Error('Chat response exceeded the size limit');
              yield streamEvent('delta', { text: delta });
              next = agentIterator.next();
            }
          } finally {
            await agentIterator.return?.();
          }
          if (!answer.trim()) throw new Error('Chat response was empty');
          const assistantMessage = await store.addMessage({
            sessionId,
            role: 'jarvis',
            text: answer,
            model: null,
          });
          if (!assistantMessage) throw new Error('Chat session ended');
          publishActivity('ended');
          yield streamEvent('done', assistantMessage);
        } catch (error) {
          if (controller.signal.aborted) {
            publishActivity('interrupted');
          } else {
            request.log.warn(
              { failure: error instanceof Error ? error.message.slice(0, 120) : 'unknown' },
              'conversation.reply_failed',
            );
            publishActivity('failed');
            yield streamEvent('error', {
              error: 'Jarvis could not finish the reply. A task action may still have completed; check its status before trying again.',
            });
          }
        } finally {
          if (!activityFinished) publishActivity(controller.signal.aborted ? 'interrupted' : 'ended');
          request.raw.removeListener('aborted', abortOnClose);
          reply.raw.removeListener('close', abortOnClose);
        }
      })());
      return reply.send(stream);
    });

    app.post<{ Body: { channel: ConversationChannel; language: ConversationLanguage } }>('/conversation/sessions', {
      schema: {
        body: {
          type: 'object',
          properties: {
            channel: { type: 'string', enum: ['chat', 'voice'] },
            language: { type: 'string', enum: ['da', 'en'] },
          },
          required: ['channel', 'language'],
          additionalProperties: false,
        },
        response: { 201: sessionSchema, 503: errorResponse },
      },
    }, async (request, reply) => {
      if (!app.conversationStore) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      const session = await app.conversationStore.createSession(request.body);
      return reply.code(201).send(session);
    });

    app.post<{ Params: { sessionId: string } }>('/conversation/sessions/:sessionId/end', {
      schema: {
        params: { type: 'object', properties: { sessionId: idSchema }, required: ['sessionId'], additionalProperties: false },
        response: { 204: { type: 'null' }, 400: errorResponse, 404: errorResponse, 503: errorResponse },
      },
    }, async (request, reply) => {
      if (!app.conversationStore) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      if (!validId(request.params.sessionId)) return reply.code(400).send({ error: 'Invalid conversation session ID' });
      if (!await app.conversationStore.endSession(request.params.sessionId)) {
        return reply.code(404).send({ error: 'Conversation session not found' });
      }
      return reply.code(204).send();
    });

    app.post<{
      Params: { sessionId: string };
      Body: { role: ConversationRole; text: string; model?: string };
    }>('/conversation/sessions/:sessionId/messages', {
      schema: {
        params: { type: 'object', properties: { sessionId: idSchema }, required: ['sessionId'], additionalProperties: false },
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['dan', 'jarvis'] },
            text: { type: 'string', minLength: 1, maxLength: 20_000 },
            model: { type: 'string', maxLength: 100 },
          },
          required: ['role', 'text'],
          additionalProperties: false,
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              sessionId: { type: 'string' },
              role: { type: 'string', enum: ['dan', 'jarvis'] },
              text: { type: 'string' },
              model: { type: ['string', 'null'] },
              at: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'sessionId', 'role', 'text', 'model', 'at'],
            additionalProperties: false,
          },
          400: errorResponse,
          404: errorResponse,
          503: errorResponse,
        },
      },
    }, async (request, reply) => {
      if (!app.conversationStore) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      const { sessionId } = request.params;
      if (!validId(sessionId)) return reply.code(400).send({ error: 'Invalid conversation session ID' });
      if (!request.body.text.trim()) return reply.code(400).send({ error: 'Message text cannot be empty' });
      const message = await app.conversationStore.addMessage({
        sessionId,
        role: request.body.role,
        text: request.body.text,
        model: request.body.model ?? null,
      });
      if (!message) return reply.code(404).send({ error: 'Conversation session not found' });
      return reply.code(201).send(message);
    });

    app.get<{ Querystring: { before?: string; limit?: number } }>('/conversation/history', {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            before: idSchema,
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
        response: { 200: historySchema, 400: errorResponse, 503: errorResponse },
      },
    }, async (request, reply) => {
      if (!app.conversationStore) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      const { before, limit = 50 } = request.query;
      if (before !== undefined && !validId(before)) return reply.code(400).send({ error: 'Invalid history cursor' });
      return app.conversationStore.getHistory({ limit, ...(before === undefined ? {} : { before }) });
    });
  },
};
