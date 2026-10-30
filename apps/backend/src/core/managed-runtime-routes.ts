import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validateManagedTarget, type ManagedSessionTarget, type ManagedTurnClaim, type RuntimeSessionStore } from './runtime-session.js';

export interface ManagedRuntimeServices {
  readonly sessions: RuntimeSessionStore;
  readonly readTargetMetadata?: () => Promise<{
    projectEndpoint: string; target: ManagedSessionTarget; definition: Record<string, unknown>;
  } | null>;
  /** Real definition, endpoint selector, settings and policy verification; no configured-only success. */
  readonly readVerifiedTarget: () => Promise<ManagedSessionTarget | null>;
}

const id = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
const uuid = { type: 'string', format: 'uuid' };
const params = { type: 'object', properties: { sessionId: id }, required: ['sessionId'], additionalProperties: false };
const targetSchema = { type: 'object', properties: {
  model: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
  effort: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
  agentName: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
  version: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
  fingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, required: ['model', 'effort', 'agentName', 'version', 'fingerprint'], additionalProperties: false };

function source(request: FastifyRequest): string | null {
  const value = request.headers['x-jarvis-message-id'];
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/u.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n ? value : null;
}
const sameTarget = (a: ManagedSessionTarget, b: ManagedSessionTarget) =>
  a.agentName === b.agentName && a.model === b.model && a.effort === b.effort &&
  a.version === b.version && a.fingerprint === b.fingerprint;

/** Internal agent-only persistence, never a browser or model tool permission. */
export function registerManagedRuntimeRoutes(app: FastifyInstance): void {
  const claims = (sessionId: string, sourceMessageId: string, claimId: string): ManagedTurnClaim => ({
    ownerObjectId: app.ownerObjectId, sessionId, sourceMessageId, claimId,
  });
  app.get('/agent/runtime-tests/target', { config: { jarvisAgent: true } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.agentPrincipal) return reply.code(403).send({ error: 'Agent identity required.' });
    try {
      const metadata = await app.managedRuntime?.readTargetMetadata?.();
      if (!metadata) return reply.code(503).send({ code: 'managed_not_verified', error: 'Managed runtime is unavailable.' });
      validateManagedTarget(metadata.target);
      return metadata;
    } catch {
      return reply.code(503).send({ code: 'managed_target_unavailable', error: 'Managed target metadata is unavailable.' });
    }
  });
  app.post<{ Params: { sessionId: string }; Body: { target: ManagedSessionTarget } }>(
    '/agent/runtime-tests/:sessionId/claim', { config: { jarvisAgent: true }, schema: { params,
      body: { type: 'object', properties: { target: targetSchema }, required: ['target'], additionalProperties: false } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.agentPrincipal) return reply.code(403).send({ error: 'Agent identity required.' });
      const sourceMessageId = source(request);
      if (!sourceMessageId) return reply.code(400).send({ error: 'Stored source required.' });
      const runtime = app.managedRuntime;
      if (!runtime) return reply.code(503).send({ code: 'managed_not_verified', error: 'Managed runtime is unavailable.' });
      try {
        const target = await runtime.readVerifiedTarget();
        if (!target) return reply.code(503).send({ code: 'managed_not_verified', error: 'Managed runtime is unavailable.' });
        validateManagedTarget(target);
        if (!sameTarget(target, request.body.target)) return reply.code(409).send({ code: 'managed_target_mismatch', error: 'Managed target changed.' });
        const result = await runtime.sessions.claimTurn({ ownerObjectId: app.ownerObjectId,
          sessionId: request.params.sessionId, sourceMessageId, target });
        if (result.kind !== 'claimed') return reply.code(result.kind === 'unavailable' ? 404 : 409)
          .send({ code: `managed_${result.kind}`, error: 'The managed turn could not be claimed. No retry was attempted.' });
        return { claimId: result.claimId, nativeConversationId: result.nativeConversationId };
      } catch {
        return reply.code(503).send({ code: 'managed_binding_unavailable', error: 'Managed turn storage is unavailable. Check its status before retrying.' });
      }
    });
  app.post<{ Params: { sessionId: string }; Body: { claimId: string; nativeConversationId: string } }>(
    '/agent/runtime-tests/:sessionId/bind', { config: { jarvisAgent: true }, schema: { params,
      body: { type: 'object', properties: { claimId: uuid, nativeConversationId: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[^\\u0000-\\u001f\\u007f]+$' } },
        required: ['claimId', 'nativeConversationId'], additionalProperties: false } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.agentPrincipal) return reply.code(403).send({ error: 'Agent identity required.' });
      const sourceMessageId = source(request);
      if (!sourceMessageId) return reply.code(400).send({ error: 'Stored source required.' });
      if (!app.managedRuntime) return reply.code(503).send({ code: 'managed_not_verified', error: 'Managed runtime is unavailable.' });
      try {
        const bound = await app.managedRuntime.sessions.bindNativeConversation({
          ...claims(request.params.sessionId, sourceMessageId, request.body.claimId), nativeConversationId: request.body.nativeConversationId,
        });
        return bound ? reply.code(204).send() : reply.code(409).send({ code: 'managed_claim_mismatch', error: 'The active managed claim did not match.' });
      } catch {
        return reply.code(503).send({ code: 'managed_binding_unavailable', error: 'Managed binding storage is unavailable.' });
      }
    });
  app.post<{ Params: { sessionId: string }; Body: { claimId: string; outcome: 'succeeded' | 'failed' } }>(
    '/agent/runtime-tests/:sessionId/finish', { config: { jarvisAgent: true }, schema: { params,
      body: { type: 'object', properties: { claimId: uuid, outcome: { type: 'string', enum: ['succeeded', 'failed'] } },
        required: ['claimId', 'outcome'], additionalProperties: false } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.agentPrincipal) return reply.code(403).send({ error: 'Agent identity required.' });
      const sourceMessageId = source(request);
      if (!sourceMessageId) return reply.code(400).send({ error: 'Stored source required.' });
      if (!app.managedRuntime) return reply.code(503).send({ code: 'managed_not_verified', error: 'Managed runtime is unavailable.' });
      try {
        const finished = await app.managedRuntime.sessions.completeTurn({
          ...claims(request.params.sessionId, sourceMessageId, request.body.claimId), outcome: request.body.outcome,
        });
        return finished ? reply.code(204).send() : reply.code(409).send({ code: 'managed_claim_mismatch', error: 'The active managed claim did not match.' });
      } catch {
        return reply.code(503).send({ code: 'managed_binding_unavailable', error: 'Managed completion storage is unavailable.' });
      }
    });
  app.post<{ Params: { sessionId: string }; Body: { claimId: string; additionalSourceMessageId: string } }>(
    '/agent/runtime-tests/:sessionId/source', { config: { jarvisAgent: true }, schema: { params,
      body: { type: 'object', properties: { claimId: uuid, additionalSourceMessageId: id },
        required: ['claimId', 'additionalSourceMessageId'], additionalProperties: false } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.agentPrincipal) return reply.code(403).send({ error: 'Agent identity required.' });
      const sourceMessageId = source(request);
      if (!sourceMessageId) return reply.code(400).send({ error: 'Stored source required.' });
      if (!app.managedRuntime) return reply.code(503).send({ code: 'managed_not_verified', error: 'Managed runtime is unavailable.' });
      try {
        const attached = await app.managedRuntime.sessions.attachSource({
          ...claims(request.params.sessionId, sourceMessageId, request.body.claimId),
          additionalSourceMessageId: request.body.additionalSourceMessageId,
        });
        return attached ? reply.code(204).send() : reply.code(409).send({ code: 'managed_claim_mismatch', error: 'The managed source did not match.' });
      } catch {
        return reply.code(503).send({ code: 'managed_binding_unavailable', error: 'Managed source storage is unavailable.' });
      }
    });
}
