import type { BackendModule } from '../modules.js';
import type {
  ConversationChannel,
  ConversationLanguage,
  ConversationRole,
} from './conversation-store.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
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
          at: { type: 'string', format: 'date-time' },
          toolCalls: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                tool: { type: 'string' },
                outcome: { type: 'string', enum: ['ok', 'error'] },
                taskId: { type: ['string', 'null'] },
              },
              required: ['id', 'tool', 'outcome', 'taskId'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'sessionId', 'channel', 'language', 'role', 'text', 'model', 'at', 'toolCalls'],
        additionalProperties: false,
      },
    },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['messages', 'nextCursor'],
  additionalProperties: false,
};

export const conversationModule: BackendModule = {
  id: 'conversation',
  tools: [],
  registerRoutes: async (app) => {
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
