import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  auditOwnerSessionCreated, auditOwnerSessionRejected, auditOwnerSessionRevoked, type OwnerSessionAuditReason,
} from './audit.js';
import { ownerSessionPolicy } from './config.js';
import { OwnerSessionUnavailable, type OwnerSessionService } from './service.js';

export interface OwnerSessionRoutesOptions {
  readonly service: OwnerSessionService;
}

// Printable text only: letters, marks, numbers, punctuation, symbols and the ordinary space.
const deviceLabelPattern = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u;

type DeviceLabelResult = { readonly valid: true; readonly label: string | null } | { readonly valid: false };

function parseDeviceLabel(body: unknown): DeviceLabelResult {
  if (body === undefined || body === null) return { valid: true, label: null };
  if (typeof body !== 'object' || Array.isArray(body)) return { valid: false };
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== 'deviceLabel')) return { valid: false };
  const value = fields.deviceLabel;
  if (value === undefined || value === null) return { valid: true, label: null };
  if (typeof value !== 'string') return { valid: false };
  const label = value.trim();
  if (label.length < 1 || label.length > ownerSessionPolicy.deviceLabelMaxLength || !deviceLabelPattern.test(label)) {
    return { valid: false };
  }
  return { valid: true, label };
}

/**
 * Session management for the owner (#1217). Registered only while the feature switch is on, so with the switch
 * off these paths do not exist and answer 404. Authentication happens in the shared hook before any handler runs.
 */
export async function registerOwnerSessionRoutes(app: FastifyInstance, { service }: OwnerSessionRoutesOptions): Promise<void> {
  // The create response carries the only readable copy of a token; no cache or proxy may keep any response here.
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  const refuse = (request: FastifyRequest, reply: FastifyReply, reason: OwnerSessionAuditReason) => {
    auditOwnerSessionRejected(request, reason, { statusCode: 403 });
    return reply.code(403).send({ error: 'Forbidden' });
  };

  // The shared hook only yields an owner user principal here; the check keeps that true if the hook ever changes.
  const ownerPrincipal = (request: FastifyRequest) =>
    request.principal && service.isOwner(request.principal.objectId) ? request.principal : null;

  // A store failure is never a 401 or a false success: the caller keeps its session and retries.
  const guarded = <Result>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<Result>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await handler(request, reply);
      } catch (error) {
        if (!(error instanceof OwnerSessionUnavailable)) throw error;
        auditOwnerSessionRejected(request, 'store_unavailable', { statusCode: 503 });
        return reply.code(503).header('Retry-After', String(ownerSessionPolicy.unavailableRetryAfterSeconds))
          .send({ error: 'Service unavailable' });
      }
    };

  app.post('/auth/session', guarded(async (request, reply) => {
    const principal = ownerPrincipal(request);
    // Only a verified Entra owner token may mint a session. A session must not mint sessions, or the absolute cap means nothing.
    if (!principal || request.ownerSession) return refuse(request, reply, 'forbidden');
    const allowance = service.consumeCreateAllowance(principal.objectId);
    if (!allowance.allowed) {
      auditOwnerSessionRejected(request, 'rate_limited', { statusCode: 429 });
      return reply.code(429).header('Retry-After', String(allowance.retryAfterSeconds)).send({ error: 'rate_limited' });
    }
    const parsed = parseDeviceLabel(request.body);
    if (!parsed.valid) return reply.code(400).send({ error: 'Invalid request' });
    const created = await service.create({
      ownerObjectId: principal.objectId,
      displayName: principal.displayName,
      deviceLabel: parsed.label,
    });
    auditOwnerSessionCreated(request, created.prefix, created.evicted);
    return reply.code(201).send({
      sessionId: created.sessionId,
      token: created.token,
      idleExpiresAt: created.idleExpiresAt.toISOString(),
      absoluteExpiresAt: created.absoluteExpiresAt.toISOString(),
    });
  }));

  app.delete('/auth/session', guarded(async (request, reply) => {
    const principal = ownerPrincipal(request);
    const session = request.ownerSession;
    if (!principal || !session) return refuse(request, reply, 'forbidden');
    await service.revokeCurrent(principal.objectId, session.id);
    auditOwnerSessionRevoked(request, { scope: 'current', sessionPrefix: session.prefix });
    return reply.code(204).send();
  }));

  app.delete('/auth/sessions', guarded(async (request, reply) => {
    const principal = ownerPrincipal(request);
    if (!principal) return refuse(request, reply, 'forbidden');
    const revoked = await service.revokeAll(principal.objectId);
    auditOwnerSessionRevoked(request, { scope: 'all', count: revoked });
    return reply.code(200).send({ revoked });
  }));
}
