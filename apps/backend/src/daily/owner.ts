import type { FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../auth/verify.js';

/** Only call after the existing root authentication hook; never accept an input owner. */
export function resolveDailyOwner(request: FastifyRequest): string {
  const owner = request.server.ownerObjectId;
  const user = request.principal;
  const connector = request.dailyConnectorPrincipal;
  if (!owner || request.nutritionExportPrincipal || request.runnerPrincipal || request.pcBridgePrincipal ||
      request.phoneEventGridPrincipal || request.deployPrincipal ||
      (user && request.agentPrincipal) || (connector && (user || request.agentPrincipal))) throw new AuthenticationDenied(403);
  if (connector?.kind === 'jarvis-daily-connector' && connector.objectId.toLowerCase() === owner.toLowerCase()) return owner;
  if (request.agentPrincipal?.kind === 'jarvis-agent') return owner;
  if (user && user.objectId.toLowerCase() === owner.toLowerCase()) return owner;
  throw new AuthenticationDenied(403);
}

export function resolveDailyFeedOwner(request: FastifyRequest): string {
  if (request.dailyConnectorPrincipal) throw new AuthenticationDenied(403);
  return resolveDailyOwner(request);
}

export function resolveDailyBrowserOwner(request: FastifyRequest): string {
  if (!request.principal || request.agentPrincipal) throw new AuthenticationDenied(403);
  return resolveDailyFeedOwner(request);
}
