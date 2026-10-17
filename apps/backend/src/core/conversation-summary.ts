import type { FastifyInstance, FastifyRequest } from 'fastify';
import { defaultSettings, readSettings } from './settings.js';
import { redactWorkContent } from './work-presentation.js';

const maxSqlBigInt = 9_223_372_036_854_775_807n;
const maxSqlInt = 2_147_483_646;
const summaryMaxLength = 6_000;
const openItemsMaxLength = 3_000;
const modelMaxLength = 128;
const unavailable = 'Conversation summary is unavailable';
const idSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
};
const budgetResponse = {
  type: 'object',
  properties: { limit: { type: 'integer' }, usedLast24h: { type: 'integer' } },
  required: ['limit', 'usedLast24h'],
  additionalProperties: false,
};
const conflictResponse = {
  type: 'object',
  properties: { error: { type: 'string' }, latestVersion: { type: 'integer' } },
  required: ['error', 'latestVersion'],
  additionalProperties: false,
};
const limitResponse = {
  type: 'object',
  properties: { error: { type: 'string' }, budget: budgetResponse },
  required: ['error', 'budget'],
  additionalProperties: false,
};
const numberFields = ['baseVersion', 'messageCount'];
const stringFields = ['fromMessageId', 'throughMessageId', 'summary', 'openItems', 'model'];

interface SummaryBody {
  baseVersion: number;
  fromMessageId: string;
  throughMessageId: string;
  messageCount: number;
  summary: string;
  openItems: string;
  model: string;
}

function isOwner(request: FastifyRequest, app: FastifyInstance): boolean {
  return request.principal?.objectId.toLowerCase() === app.ownerObjectId.toLowerCase();
}

// Fastify strips unknown body properties and coerces null/boolean/number to the schema type.
function isStrictBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const fields = Object.entries(body);
  return fields.length === numberFields.length + stringFields.length && fields.every(([key, value]) =>
    numberFields.includes(key) ? typeof value === 'number' : stringFields.includes(key) && typeof value === 'string');
}

async function dailyLimit(app: FastifyInstance): Promise<number> {
  return app.settingsStore
    ? (await readSettings(app.settingsStore)).global.conversationSummaryDailyLimit
    : defaultSettings.global.conversationSummaryDailyLimit;
}

export function registerConversationSummaryRoutes(app: FastifyInstance): void {
  app.get('/conversation/summary', {
    schema: { response: { 403: errorResponse, 503: errorResponse } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
    const store = app.conversationSummaryStore;
    if (!store) return reply.code(503).send({ error: unavailable });
    try {
      const [limit, summary, usedLast24h] = await Promise.all([
        dailyLimit(app), store.latest(app.ownerObjectId), store.usedSince(app.ownerObjectId),
      ]);
      return { summary, budget: { limit, usedLast24h } };
    } catch {
      request.log.warn('conversation_summary.read_failed');
      return reply.code(503).send({ error: unavailable });
    }
  });

  app.post<{ Body: SummaryBody }>('/conversation/summary', {
    bodyLimit: 64 * 1024,
    preValidation: async (request, reply) => {
      if (!isStrictBody(request.body)) return reply.code(400).send({ error: 'Invalid request' });
    },
    schema: {
      body: {
        type: 'object',
        properties: {
          baseVersion: { type: 'integer', minimum: 0, maximum: maxSqlInt },
          fromMessageId: idSchema,
          throughMessageId: idSchema,
          messageCount: { type: 'integer', minimum: 1, maximum: 1_000_000 },
          summary: { type: 'string', minLength: 1, maxLength: summaryMaxLength },
          openItems: { type: 'string', maxLength: openItemsMaxLength },
          model: { type: 'string', minLength: 1, maxLength: modelMaxLength },
        },
        required: [...numberFields, ...stringFields],
        additionalProperties: false,
      },
      response: {
        400: errorResponse,
        403: errorResponse,
        409: conflictResponse,
        422: errorResponse,
        429: limitResponse,
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
    const store = app.conversationSummaryStore;
    if (!store) return reply.code(503).send({ error: unavailable });
    const body = request.body;
    const fromId = BigInt(body.fromMessageId);
    const throughId = BigInt(body.throughMessageId);
    if (fromId > maxSqlBigInt || throughId > maxSqlBigInt) return reply.code(400).send({ error: 'Invalid message ID' });
    if (throughId < fromId) return reply.code(422).send({ error: 'Invalid conversation summary range' });
    // Secret-like text is redacted rather than rejected; the stored and returned text is the redacted text.
    const summary = redactWorkContent(body.summary.trim()).trim();
    const openItems = redactWorkContent(body.openItems.trim()).trim();
    const model = body.model.trim();
    if (!summary) return reply.code(422).send({ error: 'Conversation summary cannot be empty' });
    if (summary.length > summaryMaxLength || openItems.length > openItemsMaxLength || !model || model.length > modelMaxLength) {
      return reply.code(422).send({ error: 'Conversation summary text is empty or too long' });
    }
    try {
      const limit = await dailyLimit(app);
      const result = await store.append({
        ownerObjectId: app.ownerObjectId,
        baseVersion: body.baseVersion,
        fromMessageId: body.fromMessageId,
        throughMessageId: body.throughMessageId,
        messageCount: body.messageCount,
        summary,
        openItems,
        model,
        dailyLimit: limit,
      });
      if (result.status === 'saved') {
        return reply.code(201).send({ summary: result.record, budget: { limit, usedLast24h: result.usedLast24h } });
      }
      if (result.status === 'conflict') {
        return reply.code(409).send({ error: 'Conversation summary version is out of date', latestVersion: result.latestVersion });
      }
      if (result.status === 'invalid_range') {
        return reply.code(422).send({ error: 'Invalid conversation summary range' });
      }
      return reply.code(429).send({
        error: 'Daily conversation summary limit reached',
        budget: { limit, usedLast24h: result.used },
      });
    } catch {
      request.log.warn('conversation_summary.save_failed');
      return reply.code(503).send({ error: unavailable });
    }
  });
}
