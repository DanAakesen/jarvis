import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  acceptedContent, createMcpHandler, createRequestStateCodec, inputRequired, inputResponse, McpServer,
  type CallToolResult, type InputRequiredResult,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { isDailyQuery } from '@jarvis/contracts';
import { AuthenticationDenied, dailyNutritionScopes } from '../../auth/verify.js';
import type { AuthConfig } from '../../auth/config.js';
import type { DailyMcpAuditRecord } from '../../core/tool-calls.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import type { createNutritionHandlers, NutritionExecution } from '../nutrition/handlers.js';
import { canonicalJson, prepareMeal } from '../nutrition/model.js';
import { resolveDailyOwner } from '../owner.js';
import { dailyResultByteLimit, projectNutritionRecord, type DailyQueryService } from '../query.js';
import { dailyMcpMetadataPath, dailyMcpPath } from './paths.js';

export interface DailyMcpOptions {
  auth: Pick<AuthConfig, 'tenantId' | 'apiClientId' | 'dailyConnectorClientId'>;
  resource: string;
  nutrition: ReturnType<typeof createNutritionHandlers>;
  /** A separate trusted composition gate; never a tool argument or environment rollout. */
  writesEnabled?: boolean;
  now?: () => string;
}

const exactText = (max = 256) => z.string().min(1).max(max).refine(value =>
  value.trim() === value && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const nutrient = z.number().finite().min(0).max(1000).nullable();
const nutrients = {
  energyKcal: z.number().finite().min(0).max(10000),
  proteinGrams: nutrient.default(null), carbohydratesGrams: nutrient.default(null),
  fatGrams: nutrient.default(null), fiberGrams: nutrient.default(null),
};
const logSchema = z.object({
  operationId: exactText(120), mealName: exactText(2000),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).nullable().default(null),
  components: z.array(z.json()).max(100).default([]),
  occurredAt: z.iso.datetime({ offset: true }).optional(), mealDate: z.iso.date().optional(),
  captureMethod: z.enum(['text', 'voice', 'photo', 'mixed']),
  confidence: z.enum(['accurate', 'approximate', 'estimate']),
  ...nutrients,
}).strict();
const revision = z.string().regex(/^[1-9]\d{0,18}$/u).refine(value => BigInt(value) < 9223372036854775807n);
const removeSchema = z.object({ idempotencyKey: exactText(), expectedRevision: revision }).strict();
const correctionSchema = removeSchema.extend({
  changes: z.object({
    mealName: exactText(2000).optional(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).nullable().optional(),
    components: z.array(z.json()).max(100).optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(), mealDate: z.iso.date().optional(),
    captureMethod: z.enum(['text', 'voice', 'photo', 'mixed']).optional(),
    confidence: z.enum(['accurate', 'approximate', 'estimate']).optional(),
    energyKcal: nutrients.energyKcal.optional(),
    proteinGrams: nutrient.optional(), carbohydratesGrams: nutrient.optional(),
    fatGrams: nutrient.optional(), fiberGrams: nutrient.optional(),
  }).strict().refine(value => Object.keys(value).length > 0),
}).strict();
const querySchema = z.object({
  source: z.enum(['daily.nutrition.meals', 'daily.nutrition.favorites', 'daily.nutrition.plans']),
  startDate: z.iso.date().optional(), endDate: z.iso.date().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.union([
    z.object({ id: exactText() }).strict(),
    z.object({ createdAt: z.iso.datetime({ offset: true }), id: exactText() }).strict(),
  ]).optional(),
}).strict().refine(isDailyQuery);
const lookupSchema = z.object({
  components: z.array(z.object({
    name: exactText(120), grams: z.number().finite().gt(0).max(5000).nullable(),
    preparationMethod: exactText(120).nullable(),
  }).strict()).min(1).max(25).optional(),
  savedName: exactText(2000).optional(),
}).strict().refine(input => (input.components !== undefined) !== (input.savedName !== undefined));
// MCP form schemas exclude additionalProperties; validate returned content strictly.
const confirmSchema = z.object({ confirm: z.boolean() });
const pendingSchema = z.object({
  owner: z.string(), clientId: z.string(), tool: z.string(), digest: z.string(), requestTime: z.string(),
}).strict();
type Pending = z.infer<typeof pendingSchema>;
type Responses = Parameters<typeof inputResponse>[0];

function response(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}
function receipt(row: Record<string, unknown>, operation: string): CallToolResult {
  const revision = String(row.revision ?? '');
  if (typeof row.id !== 'string' || typeof row.idempotency_key !== 'string' || !/^[1-9]\d*$/u.test(revision)) {
    throw new ToolFailure('The write may have committed, but its receipt is unavailable. Retry the same operation ID; do not create another intake.');
  }
  return response({
    status: 'committed', operation, id: row.id, idempotencyKey: row.idempotency_key, revision,
    mealName: row.meal_name, occurredAt: row.occurred_at, deletedAt: row.deleted_at,
    energyKcal: row.energy_kcal, proteinGrams: row.protein_grams, carbohydratesGrams: row.carbohydrates_grams,
    fatGrams: row.fat_grams, fiberGrams: row.fiber_grams,
  });
}
function authorize(request: FastifyRequest, write = false): string {
  const owner = resolveDailyOwner(request);
  if (!request.dailyConnectorPrincipal?.scopes.includes(write ? dailyNutritionScopes.write : dailyNutritionScopes.read)) {
    throw new AuthenticationDenied(403);
  }
  return owner;
}
function execution(request: FastifyRequest, signal: AbortSignal, requestTime: string, intent: NutritionExecution['intent']): NutritionExecution {
  return { request, signal, requestTime, intent, explicit: true, proposalRequired: true, proposalAccepted: true };
}
async function safe(request: FastifyRequest, operation: DailyMcpAuditRecord['tool'], challenge: string, action: () => Promise<CallToolResult | InputRequiredResult>) {
  const store = request.server.toolCallStore;
  const mutation = ['log_food', 'correct_food', 'delete_food'].includes(operation);
  if (!store?.recordDailyMcp) return { isError: true, content: [{ type: 'text' as const, text: 'Nutrition audit storage is unavailable. No operation was executed.' }] };
  let result: CallToolResult | InputRequiredResult;
  let outcome: 'ok' | 'refused' | 'error' = 'ok';
  try { result = await action(); }
  catch (error) {
    outcome = error instanceof ToolRefusal || error instanceof AuthenticationDenied || error instanceof TypeError ? 'refused' : 'error';
    request.log.warn('daily.mcp_operation_failed');
    const message = error instanceof ToolRefusal || error instanceof ToolFailure ? error.message
      : error instanceof AuthenticationDenied ? 'This nutrition operation is not authorised.'
        : error instanceof TypeError ? 'Invalid nutrition input. No successful write is claimed.'
          : mutation ? 'Nutrition operation failed or was interrupted. A write may have committed; retry the same operation and keys.'
            : 'Nutrition read failed or was interrupted. No result is available.';
    result = {
      isError: true, content: [{ type: 'text', text: message }],
      ...(error instanceof AuthenticationDenied ? { _meta: { 'mcp/www_authenticate': [challenge] } } : {}),
    };
  }
  try {
    await store.recordDailyMcp({
      requestId: request.id, tool: operation,
      phase: 'resultType' in result && result.resultType === 'input_required' ? 'awaiting_confirmation' : outcome,
      outcome,
    });
  } catch {
    request.log.error('daily.mcp_audit_failed');
    return { isError: true, content: [{ type: 'text' as const, text: mutation
      ? 'Nutrition audit failed. A write may have committed; retry the same operation and keys, not a new intake.'
      : 'Nutrition audit failed. The read result is withheld.' }] };
  }
  return result;
}

export function dailyMcpRoutes(query: Pick<DailyQueryService, 'query'>, options: DailyMcpOptions): FastifyPluginAsync {
  const resource = new URL(options.resource);
  const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
  if (resource.protocol !== 'https:' || resource.username || resource.password || resource.search || resource.hash ||
      resource.pathname !== dailyMcpPath || !options.auth.dailyConnectorClientId ||
      !uuid.test(options.auth.dailyConnectorClientId) || !uuid.test(options.auth.tenantId) ||
      !uuid.test(options.auth.apiClientId) || options.auth.dailyConnectorClientId.toLowerCase() === options.auth.apiClientId.toLowerCase()) {
    throw new TypeError('Explicit HTTPS resource and separate approved Entra connector client are required');
  }
  const now = options.now ?? (() => new Date().toISOString());
  const clientId = options.auth.dailyConnectorClientId.toLowerCase();
  const scope = (write = false) => `api://${options.auth.apiClientId}/${write ? dailyNutritionScopes.write : dailyNutritionScopes.read}`;
  const challenge = (write = false) =>
    `Bearer error="insufficient_scope", resource_metadata="${new URL(dailyMcpMetadataPath, resource).href}", scope="${scope(write)}"`;
  const security = (write = false) => ({ securitySchemes: [{ type: 'oauth2', scopes: [scope(write)] }] });
  const codec = createRequestStateCodec<Pending>({ key: randomBytes(32), ttlSeconds: 600 });
  const writes = options.writesEnabled === true;
  return async app => {
    app.get(dailyMcpMetadataPath, { config: { jarvisDailyMcpMetadata: true } }, async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return {
        resource: resource.href,
        authorization_servers: [`https://login.microsoftonline.com/${options.auth.tenantId}/v2.0`],
        scopes_supported: [scope(), ...(writes ? [scope(true)] : [])],
        bearer_methods_supported: ['header'],
      };
    });
    app.route({
      method: ['POST', 'GET', 'DELETE'], url: dailyMcpPath,
      config: { jarvisDailyMcp: true, jarvisDailyMcpMetadataUrl: new URL(dailyMcpMetadataPath, resource).href },
      bodyLimit: 96 * 1024,
      onRequest: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!request.dailyConnectorPrincipal || request.dailyConnectorPrincipal.clientId !== clientId) {
          throw new AuthenticationDenied(403);
        }
        if (request.headers.host?.toLowerCase() !== resource.host.toLowerCase() ||
            request.headers.origin !== undefined ||
            Object.keys(request.query as Record<string, unknown>).length) {
          return reply.code(400).send({ error: 'Invalid nutrition connector request' });
        }
      },
      handler: async (request, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const disconnect = () => { if (!reply.raw.writableEnded) abort(); };
        request.raw.once('aborted', abort);
        reply.raw.once('close', disconnect);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
        const context = (requestTime: string, intent: NutritionExecution['intent'], mcpSignal: AbortSignal) =>
          execution(request, AbortSignal.any([signal, mcpSignal]), requestTime, intent);
        const handler = createMcpHandler(() => {
          const server = new McpServer({ name: 'jarvis-nutrition', version: '1.0.0' }, { requestState: { verify: codec.verify } });
          const approve = async (tool: string, payload: unknown, state: unknown, responses: Responses, requestTime = now()): Promise<InputRequiredResult | undefined> => {
            const owner = authorize(request, true);
            const digest = createHash('sha256').update(canonicalJson(payload)).digest('hex');
            const parsed = pendingSchema.safeParse(state);
            if (!parsed.success) {
              const message = `Review this exact ${tool} proposal. Nothing has changed.\n${JSON.stringify(payload, null, 2)}`;
              if (message.length > 20000) throw new ToolRefusal('This proposal is too large to review safely. Use a smaller food entry.');
              return inputRequired({
                requestState: await codec.mint({ owner, clientId, tool, digest, requestTime }),
                inputRequests: { confirm: inputRequired.elicit({ message, requestedSchema: confirmSchema }) },
              });
            }
            const pending = parsed.data;
            if (pending.owner !== owner || pending.clientId !== request.dailyConnectorPrincipal?.clientId ||
                pending.tool !== tool || pending.digest !== digest) throw new ToolRefusal('The proposal changed. Start a new review; nothing was authorised.');
            const answer = inputResponse(responses, 'confirm');
            if (answer.kind !== 'elicit' || answer.action !== 'accept' || acceptedContent(responses, 'confirm', confirmSchema.strict())?.confirm !== true) {
              throw new ToolRefusal('The proposal was not accepted. Nothing was changed by this call.');
            }
          };
          server.registerTool('read_nutrition', {
            title: 'Read nutrition', description: 'Read bounded meal history, saved favourites or meal plans. Definitions and plans are not eaten meals.',
            _meta: security(),
            inputSchema: querySchema, annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
          }, async (input, ctx) => safe(request, 'read_nutrition', challenge(), async () => {
            authorize(request);
            return response({ ...await query.query(input, request, AbortSignal.any([signal, ctx.mcpReq.signal])) });
          }));
          server.registerTool('lookup_food', {
            title: 'Look up food', description: 'Supply either savedName to resolve an owned favourite/alias before an exact historical meal name, or components for DTU Frida estimates. Saved records retain their quantities and unknowns; no match does not trigger a provider lookup. This never logs food.',
            _meta: security(),
            inputSchema: lookupSchema, annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
          }, async (input, ctx) => safe(request, 'lookup_food', challenge(), async () => {
            authorize(request);
            const readContext = context(now(), 'lookup', ctx.mcpReq.signal);
            if (input.savedName !== undefined) {
              const match = await options.nutrition.lookupSaved(input.savedName, readContext);
              const result = {
                status: match ? 'available' : 'empty', period: null,
                match: match ? { source: match.source, record: projectNutritionRecord(match.row, match.source) } : null,
                units: { energy_kcal: 'kcal', '*_grams': 'g', meal_date: 'Europe/Copenhagen calendar date' },
                provenance: { store: 'daily-sql', detail: 'retained-record' },
                freshness: { observedAt: new Date(readContext.requestTime).toISOString(), staleness: 'unknown' },
              };
              if (Buffer.byteLength(JSON.stringify(result)) > dailyResultByteLimit) throw new ToolRefusal('Saved food exceeds the shared Daily response limit. No complete result is available.');
              return response(result);
            }
            if (input.components === undefined) throw new ToolRefusal('Supply either savedName or components for food lookup.');
            return response({ ...await options.nutrition.lookup(input.components, readContext) });
          }));
          if (writes) {
            server.registerTool('log_food', {
              title: 'Log food', description: 'Log eaten food only after native review. Keep operationId unchanged on retries. Supplied nutrients are not independently verified; no Apple Health export occurs.',
              _meta: security(true),
              inputSchema: logSchema, annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
            }, async (input, ctx) => safe(request, 'log_food', challenge(true), async () => {
              const owner = authorize(request, true);
              const state = pendingSchema.safeParse(ctx.mcpReq.requestState());
              const requestTime = state.success ? state.data.requestTime : now();
              const { operationId, occurredAt, mealDate, ...definition } = input;
              const idempotencyKey = `mcp:${clientId}:${operationId}`;
              const saved = await options.nutrition.intake(idempotencyKey, context(requestTime, 'lookup', ctx.mcpReq.signal));
              if (saved && typeof saved.occurred_at !== 'string') throw new ToolFailure('Stored occurrence is unavailable. Retry the same operation; do not create another intake.');
              const occurrence = occurredAt ?? saved?.occurred_at;
              const payload = prepareMeal({
                ...definition,
                ...(typeof occurrence === 'string' ? { occurredAt: occurrence } : {}),
                ...(mealDate !== undefined ? { mealDate } : {}),
                id: createHash('sha256').update(`${owner}:${idempotencyKey}`).digest('hex'), idempotencyKey,
                provenance: { source: 'chatgpt-supplied', independentlyVerified: false },
              }, requestTime);
              const pending = await approve('log_food', payload, ctx.mcpReq.requestState(), ctx.mcpReq.inputResponses, requestTime);
              if (pending) return pending;
              return receipt(await options.nutrition.log(payloadWithoutExpiry(payload), context(requestTime, 'log-intake', ctx.mcpReq.signal)), 'log');
            }));
            server.registerTool('correct_food', {
              title: 'Correct food', description: 'Correct one owned intake using its exact idempotency key and current revision, after native review. No Health export.',
              _meta: security(true),
              inputSchema: correctionSchema, annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
            }, async (input, ctx) => safe(request, 'correct_food', challenge(true), async () => {
              authorize(request, true);
              const pending = await approve('correct_food', input, ctx.mcpReq.requestState(), ctx.mcpReq.inputResponses);
              if (pending) return pending;
              const parsed = pendingSchema.parse(ctx.mcpReq.requestState());
              const changes = input.changes;
              return receipt(await options.nutrition.correct({
                idempotencyKey: input.idempotencyKey, expectedRevision: BigInt(input.expectedRevision),
                changes: {
                  ...(changes.mealName !== undefined ? { mealName: changes.mealName } : {}),
                  ...(changes.mealType !== undefined ? { mealType: changes.mealType } : {}),
                  ...(changes.components !== undefined ? { components: changes.components } : {}),
                  ...(changes.occurredAt !== undefined ? { occurredAt: changes.occurredAt } : {}),
                  ...(changes.mealDate !== undefined ? { mealDate: changes.mealDate } : {}),
                  ...(changes.captureMethod !== undefined ? { captureMethod: changes.captureMethod } : {}),
                  ...(changes.confidence !== undefined ? { confidence: changes.confidence } : {}),
                  ...(changes.energyKcal !== undefined ? { energyKcal: changes.energyKcal } : {}),
                  ...(changes.proteinGrams !== undefined ? { proteinGrams: changes.proteinGrams } : {}),
                  ...(changes.carbohydratesGrams !== undefined ? { carbohydratesGrams: changes.carbohydratesGrams } : {}),
                  ...(changes.fatGrams !== undefined ? { fatGrams: changes.fatGrams } : {}),
                  ...(changes.fiberGrams !== undefined ? { fiberGrams: changes.fiberGrams } : {}),
                  ...(Object.keys(changes).some(key => key === 'components' || key in nutrients)
                    ? { provenance: { source: 'chatgpt-supplied', independentlyVerified: false } } : {}),
                },
              }, context(parsed.requestTime, 'correct-intake', ctx.mcpReq.signal)), 'correct');
            }));
            server.registerTool('delete_food', {
              title: 'Delete food', description: 'Soft-delete one owned intake using its exact idempotency key and current revision, after native review. No Health deletion/export.',
              _meta: security(true),
              inputSchema: removeSchema, annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true },
            }, async (input, ctx) => safe(request, 'delete_food', challenge(true), async () => {
              authorize(request, true);
              const pending = await approve('delete_food', input, ctx.mcpReq.requestState(), ctx.mcpReq.inputResponses);
              if (pending) return pending;
              const parsed = pendingSchema.parse(ctx.mcpReq.requestState());
              return receipt(await options.nutrition.remove(input.idempotencyKey, BigInt(input.expectedRevision),
                context(parsed.requestTime, 'delete-intake', ctx.mcpReq.signal)), 'delete');
            }));
          }
          return server;
        }, { legacy: 'reject' });
        try {
          reply.hijack();
          const incoming = Object.assign(request.raw, { method: request.method, url: request.url });
          await toNodeHandler(handler)(incoming, reply.raw, request.body);
        } finally {
          request.raw.off('aborted', abort);
          reply.raw.off('close', disconnect);
        }
      },
    });
  };
}

function payloadWithoutExpiry(payload: ReturnType<typeof prepareMeal>) {
  const { expiresAt: _expiresAt, ...input } = payload;
  void _expiresAt;
  return input;
}
