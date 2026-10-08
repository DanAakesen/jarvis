import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import type { ConversationSearchPage } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import type {
  ConversationChannel,
  ConversationLanguage,
  ConversationRole,
  ConversationSteeringMessage,
} from './conversation-store.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';
import {
  executeReflexAction,
  registerChatReflex,
  reflexTargets,
  logReflexDecision,
  type ReflexClassifier,
  type ReflexActionResult,
  type ReflexClassification,
  type ReflexTarget,
} from './reflex.js';
import { isJevFailure } from './jev.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const chatReflexBudgetMs = 800;
const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
};
const searchDatePattern = '^\\d{4}-\\d{2}-\\d{2}$';
const searchSourceValues = ['chat', 'voice', 'phone'] as const;
const conversationSearchResponseSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          messageId: idSchema,
          sessionId: idSchema,
          source: { type: 'string', enum: searchSourceValues },
          role: { type: 'string', enum: ['dan', 'jarvis'] },
          at: { type: 'string', format: 'date-time' },
          snippet: { type: 'string', maxLength: 240 },
        },
        required: ['messageId', 'sessionId', 'source', 'role', 'at', 'snippet'],
        additionalProperties: false,
      },
    },
    hasMore: { type: 'boolean' },
  },
  required: ['results', 'hasMore'],
  additionalProperties: false,
};

interface ConversationSearchArgs {
  readonly query: string;
  readonly from?: string;
  readonly to?: string;
  readonly source?: ConversationChannel;
  readonly limit?: number;
}

function searchDate(value: string | undefined): Date | undefined {
  if (value === undefined || value.startsWith('0000-') || !new RegExp(searchDatePattern, 'u').test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined;
}

function searchDateRange(fromValue?: string, toValue?: string): {
  readonly from?: Date;
  readonly toExclusive?: Date;
} | null {
  const from = searchDate(fromValue);
  const to = searchDate(toValue);
  if ((fromValue !== undefined && !from) || (toValue !== undefined && !to) ||
      (from && to && from.getTime() > to.getTime())) return null;
  const toExclusive = to && to.toISOString().startsWith('9999-12-31')
    ? undefined
    : to ? new Date(to.getTime() + 86_400_000) : undefined;
  return {
    ...(from === undefined ? {} : { from }),
    ...(toExclusive === undefined ? {} : { toExclusive }),
  };
}

const conversationSearchTool: JarvisTool = {
  name: 'conversation_search',
  description: 'Search saved chat, voice and phone messages for keywords. Use UTC date-only bounds and the source filter when known. Use the returned message IDs and excerpts as evidence for past decisions.',
  sensitive: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      from: { type: 'string', pattern: searchDatePattern },
      to: { type: 'string', pattern: searchDatePattern },
      source: { type: 'string', enum: searchSourceValues },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(value, request, signal) {
    const input = value as ConversationSearchArgs;
    if (!input.query.trim()) throw new ToolRefusal('Enter one or more search keywords.');
    const dateRange = searchDateRange(input.from, input.to);
    if (!dateRange) throw new ToolRefusal('Use valid UTC dates with the start date no later than the end date.');
    const store = request.server.conversationStore;
    if (!store?.searchMessages) throw new ToolRefusal('Conversation search is unavailable.');
    return store.searchMessages({
      query: input.query,
      ...dateRange,
      ...(input.source === undefined ? {} : { source: input.source }),
      limit: input.limit ?? 8,
    }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
  },
};
const steeringMessagesSchema = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string', enum: ['da', 'en'] },
        },
        required: ['id', 'text', 'language'],
        additionalProperties: false,
      },
    },
  },
  required: ['messages'],
  additionalProperties: false,
};

interface ActiveChatTurn {
  readonly sessionId: string;
  rootMessageId: string;
  phase: 'model' | 'tools' | 'finishing';
  consumedThrough: string;
  roundController: AbortController | null;
}

const maxSteeringMessages = 100;

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
          interrupted: { type: 'boolean' },
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
        required: ['id', 'sessionId', 'channel', 'language', 'role', 'text', 'model', 'interrupted', 'voiceMinutes', 'at', 'toolCalls'],
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
  phase: 'reflex_targets' | 'jev' | 'agent_first_byte' | 'turn_first_token' | 'turn_complete',
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
  const startedAt = performance.now();
  let attempted = false;
  let classification: ReflexClassification | null = null;
  let action: ReflexActionResult | null = null;
  let failureReason: string | undefined;
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
    attempted = true;
    try {
      const result = await raceWithAbort(
        classifier.classify(text, language, targets, classificationSignal),
        classificationSignal,
      );
      if (result === undefined) return null;
      if (isJevFailure(result)) failureReason = result.failure;
      else classification = result;
    } finally {
      logChatLatency(request, 'jev', jevStartedAt);
    }
    if (classificationSignal.aborted) return null;
    action = await executeReflexAction(classification, request, messageId, signal);
    return action;
  } catch {
    // Reflex is best effort; the agent stream owns the chat response.
    return null;
  } finally {
    if (attempted) {
      logReflexDecision(request, classification, 'chat', startedAt, classificationSignal, action, failureReason);
    }
    clearTimeout(timeout);
  }
}

export const conversationModule: BackendModule = {
  id: 'conversation',
  tools: [conversationSearchTool],
  registerRoutes: async (app) => {
    const activeTurns = new Map<string, ActiveChatTurn>();
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
      const turnStartedAt = performance.now();
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
      if (activeTurns.has(sessionId)) return reply.code(409).send({ error: 'A chat turn is already active' });
      const activeTurn: ActiveChatTurn = {
        sessionId,
        rootMessageId: '',
        phase: 'model',
        consumedThrough: '',
        roundController: null,
      };
      activeTurns.set(sessionId, activeTurn);
      if (request.body.sharedScreenContext !== undefined) {
        request.requireSharedScreenContext = true;
        request.sharedScreenContext = request.body.sharedScreenContext;
      }

      let userMessage;
      try {
        userMessage = await store.addMessage({
          sessionId,
          role: 'dan',
          text,
          model: null,
          language: session.language,
        });
        if (!userMessage) {
          activeTurns.delete(sessionId);
          return reply.code(404).send({ error: 'Active chat session not found' });
        }
      } catch (error) {
        activeTurns.delete(sessionId);
        throw error;
      }
      activeTurn.rootMessageId = userMessage.id;
      activeTurn.consumedThrough = userMessage.id;

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
        publishActivity('thinking');
        try {
          const classifier = request.requireSharedScreenContext ? undefined : app.reflexClassifier;
          const finishReflex = classifier ? registerChatReflex(userMessage.id) : undefined;
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
          let turnMessageId = userMessage.id;
          let turnText = text;
          let turnLanguage = session.language;
          let isSteering = false;
          let firstTurnTokenLogged = false;
          while (!controller.signal.aborted) {
            const answer = '';
            let partial = answer;
            const roundController = new AbortController();
            activeTurn.roundController = roundController;
            activeTurn.phase = 'model';
            const signal = AbortSignal.any([controller.signal, roundController.signal]);
            const agentStartedAt = performance.now();
            let firstByteLogged = false;
            let agentIterator: AsyncIterator<string> | undefined;
            let interrupted = false;
            try {
              agentIterator = agent.stream({
                messageId: turnMessageId,
                text: turnText,
                language: turnLanguage,
                turnId: activeTurn.rootMessageId,
                ...(isSteering ? { steering: true } : {}),
                ...(!isSteering && request.body.screenContext !== undefined
                  ? { screenContext: request.body.screenContext }
                  : {}),
              }, authorization, signal)[Symbol.asyncIterator]();
              let next = agentIterator.next();
              while (true) {
                const chunk = await next;
                if (chunk.done) break;
                const delta = chunk.value;
                if (!firstByteLogged) {
                  firstByteLogged = true;
                  logChatLatency(request, 'agent_first_byte', agentStartedAt);
                }
                if (!firstTurnTokenLogged) {
                  firstTurnTokenLogged = true;
                  logChatLatency(request, 'turn_first_token', turnStartedAt);
                }
                partial += delta;
                if (Buffer.byteLength(partial) > 512 * 1024) throw new Error('Chat response exceeded the size limit');
                yield streamEvent('delta', { text: delta });
                next = agentIterator.next();
              }
            } catch (error) {
              if (controller.signal.aborted) throw error;
              if (!roundController.signal.aborted) throw error;
              interrupted = true;
            } finally {
              await agentIterator?.return?.();
            }

            if (controller.signal.aborted) break;
            activeTurn.phase = 'finishing';
            const steeringMessages: readonly ConversationSteeringMessage[] = await store.getDanMessagesAfter({
              sessionId,
              after: activeTurn.consumedThrough,
              limit: maxSteeringMessages,
            });
            if (steeringMessages.length > 0) {
              const partialMessage = partial.trim()
                ? await store.addMessage({
                  sessionId,
                  role: 'jarvis',
                  text: partial,
                  model: null,
                  language: turnLanguage,
                  interrupted: true,
                })
                : null;
              if (partialMessage) yield streamEvent('interrupted', { ...partialMessage, interrupted: true });
              const latest = steeringMessages.at(-1)!;
              activeTurn.consumedThrough = latest.id;
              turnMessageId = latest.id;
              turnText = latest.text;
              turnLanguage = latest.language;
              isSteering = true;
              activeTurn.roundController = null;
              continue;
            }

            if (interrupted) {
              throw new Error('Chat turn was interrupted without a steering message');
            }
            if (!partial.trim()) throw new Error('Chat response was empty');
            const assistantMessage = await store.addMessage({
              sessionId,
              role: 'jarvis',
              text: partial,
              model: null,
              language: turnLanguage,
            });
            if (!assistantMessage) throw new Error('Chat session ended');
            publishActivity('ended');
            logChatLatency(request, 'turn_complete', turnStartedAt);
            yield streamEvent('done', assistantMessage);
            break;
          }
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
          activeTurn.roundController = null;
          if (activeTurns.get(sessionId) === activeTurn) activeTurns.delete(sessionId);
          if (!activityFinished) publishActivity(controller.signal.aborted ? 'interrupted' : 'ended');
          request.raw.removeListener('aborted', abortOnClose);
          reply.raw.removeListener('close', abortOnClose);
        }
      })());
      return reply.send(stream);
    });

    app.post<{
      Params: { sessionId: string };
      Body: { text: string; language: ConversationLanguage };
    }>('/conversation/sessions/:sessionId/steer', {
      schema: {
        params: { type: 'object', properties: { sessionId: idSchema }, required: ['sessionId'], additionalProperties: false },
        body: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 20_000 },
            language: { type: 'string', enum: ['da', 'en'] },
          },
          required: ['text', 'language'],
          additionalProperties: false,
        },
        response: { 202: { type: 'object', additionalProperties: true }, 400: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
      },
    }, async (request, reply) => {
      const store = app.conversationStore;
      if (!store) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      const { sessionId } = request.params;
      if (!validId(sessionId)) return reply.code(400).send({ error: 'Invalid conversation session ID' });
      const text = request.body.text.trim();
      if (!text) return reply.code(400).send({ error: 'Message text cannot be empty' });
      const activeTurn = activeTurns.get(sessionId);
      if (!activeTurn?.rootMessageId || activeTurn.phase === 'finishing') {
        return reply.code(409).send({ error: 'No active chat turn to steer' });
      }
      const message = await store.addMessage({
        sessionId,
        role: 'dan',
        text,
        model: null,
        language: request.body.language,
      });
      if (!message) return reply.code(404).send({ error: 'Active chat session not found' });
      if (activeTurn.phase === 'model') activeTurn.roundController?.abort();
      return reply.code(202).send({ ...message, language: request.body.language });
    });

    app.post<{
      Params: { sessionId: string; messageId: string };
      Body: { phase: 'model' | 'tools' };
    }>('/conversation/sessions/:sessionId/turns/:messageId/phase', {
      schema: {
        params: {
          type: 'object',
          properties: { sessionId: idSchema, messageId: idSchema },
          required: ['sessionId', 'messageId'],
          additionalProperties: false,
        },
        body: {
          type: 'object',
          properties: { phase: { type: 'string', enum: ['model', 'tools'] } },
          required: ['phase'],
          additionalProperties: false,
        },
        response: { 204: { type: 'null' }, 400: errorResponse, 404: errorResponse },
      },
    }, async (request, reply) => {
      const activeTurn = activeTurns.get(request.params.sessionId);
      if (!activeTurn || activeTurn.rootMessageId !== request.params.messageId) {
        return reply.code(404).send({ error: 'Active chat turn not found' });
      }
      activeTurn.phase = request.body.phase;
      return reply.code(204).send();
    });

    app.get<{
      Params: { sessionId: string; messageId: string };
      Querystring: { after?: string };
    }>('/conversation/sessions/:sessionId/turns/:messageId/steering', {
      schema: {
        params: {
          type: 'object',
          properties: { sessionId: idSchema, messageId: idSchema },
          required: ['sessionId', 'messageId'],
          additionalProperties: false,
        },
        querystring: {
          type: 'object',
          properties: { after: idSchema },
          additionalProperties: false,
        },
        response: { 200: steeringMessagesSchema, 400: errorResponse, 404: errorResponse, 503: errorResponse },
      },
    }, async (request, reply) => {
      const store = app.conversationStore;
      if (!store) return reply.code(503).send({ error: 'Conversation storage unavailable' });
      const activeTurn = activeTurns.get(request.params.sessionId);
      if (!activeTurn || activeTurn.rootMessageId !== request.params.messageId) {
        return reply.code(404).send({ error: 'Active chat turn not found' });
      }
      const after = request.query.after ?? request.params.messageId;
      if (!validId(after) || BigInt(after) < BigInt(request.params.messageId)) {
        return reply.code(400).send({ error: 'Invalid steering cursor' });
      }
      const cursor = BigInt(after) > BigInt(activeTurn.consumedThrough)
        ? after
        : activeTurn.consumedThrough;
      const messages = await store.getDanMessagesAfter({
        sessionId: activeTurn.sessionId,
        after: cursor,
        limit: 20,
      });
      if (messages.length > 0) activeTurn.consumedThrough = messages.at(-1)!.id;
      return { messages };
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
      app.onConversationSessionEnded(request.params.sessionId);
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

    app.get<{
      Querystring: {
        q: string;
        from?: string;
        to?: string;
        source?: ConversationChannel;
        limit?: number;
      };
    }>('/conversation/search', {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 500 },
            from: { type: 'string', pattern: searchDatePattern },
            to: { type: 'string', pattern: searchDatePattern },
            source: { type: 'string', enum: searchSourceValues },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          required: ['q'],
          additionalProperties: false,
        },
        response: {
          200: conversationSearchResponseSchema,
          400: errorResponse,
          503: errorResponse,
        },
      },
    }, async (request, reply) => {
      const store = app.conversationStore;
      if (!store?.searchMessages) return reply.code(503).send({ error: 'Conversation search unavailable' });
      const dateRange = searchDateRange(request.query.from, request.query.to);
      if (!dateRange) return reply.code(400).send({ error: 'Invalid conversation search date range' });
      if (!request.query.q.trim()) return reply.code(400).send({ error: 'Enter one or more search keywords' });
      const controller = new AbortController();
      const abortOnRequest = () => controller.abort();
      const abortOnClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
      request.raw.once('aborted', abortOnRequest);
      reply.raw.once('close', abortOnClose);
      try {
        const result: ConversationSearchPage = await store.searchMessages({
          query: request.query.q,
          ...dateRange,
          ...(request.query.source === undefined ? {} : { source: request.query.source }),
          limit: request.query.limit ?? 20,
        }, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
        return result;
      } finally {
        request.raw.removeListener('aborted', abortOnRequest);
        reply.raw.removeListener('close', abortOnClose);
      }
    });
  },
};
