import type { FastifyRequest } from 'fastify';

/** Why an owner-session request was refused. For the audit log only; a client always sees the same 401. */
export const ownerSessionAuditReasons = [
  'disabled', 'malformed', 'unknown_session', 'secret_mismatch', 'revoked', 'idle_expired', 'absolute_expired',
  'owner_mismatch', 'store_unavailable', 'rate_limited', 'forbidden',
] as const;
export type OwnerSessionAuditReason = (typeof ownerSessionAuditReasons)[number];

// The query string can carry secrets, so only the path is ever logged.
const requestPath = (request: FastifyRequest): string | undefined => (request.raw.url ?? '').split('?')[0]?.slice(0, 200);

// These helpers are the only place owner-session audit events are written. They take the session id prefix
// and never a token, a secret, a hash or a header; logging.ts allowlists the same fields again.
export function auditOwnerSessionRejected(
  request: FastifyRequest,
  reason: OwnerSessionAuditReason,
  details: { readonly statusCode: number; readonly sessionPrefix?: string | null },
): void {
  request.log.warn({
    reason,
    method: request.method,
    route: requestPath(request),
    statusCode: details.statusCode,
    ...(details.sessionPrefix ? { sessionPrefix: details.sessionPrefix } : {}),
  }, 'owner_session.rejected');
}

export function auditOwnerSessionCreated(request: FastifyRequest, sessionPrefix: string, evicted: number): void {
  request.log.info({ sessionPrefix, evicted }, 'owner_session.created');
}

export function auditOwnerSessionRevoked(
  request: FastifyRequest,
  details: { readonly scope: 'current'; readonly sessionPrefix: string } | { readonly scope: 'all'; readonly count: number },
): void {
  request.log.info(details, 'owner_session.revoked');
}

export function auditOwnerSessionRefreshFailed(request: FastifyRequest, sessionPrefix: string): void {
  request.log.warn({ sessionPrefix }, 'owner_session.refresh_failed');
}
