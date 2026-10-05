import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig } from './config.js';

export interface UserPrincipal { objectId: string; tenantId: string; displayName: string }
export interface AgentPrincipal { kind: 'jarvis-agent'; objectId: string; tenantId: string }
export interface RunnerPrincipal { kind: 'jarvis-runner'; objectId: string; tenantId: string }
export interface PcBridgePrincipal { kind: 'jarvis-pc-bridge'; objectId: string; tenantId: string }
export interface PhoneEventGridPrincipal { kind: 'jarvis-phone-event-grid'; objectId: string; tenantId: string }
export type TokenVerifier = (token: string) =>
  Promise<UserPrincipal | AgentPrincipal | RunnerPrincipal | PcBridgePrincipal | PhoneEventGridPrincipal>;
export const agentToolsRole = 'Jarvis.Tools';
export const runnerEventsRole = 'Jarvis.Runner.Events';
export function isAgentPrincipal(
  principal: UserPrincipal | AgentPrincipal | RunnerPrincipal | PcBridgePrincipal | PhoneEventGridPrincipal,
): principal is AgentPrincipal {
  return 'kind' in principal && principal.kind === 'jarvis-agent';
}
export function isRunnerPrincipal(
  principal: UserPrincipal | AgentPrincipal | RunnerPrincipal | PcBridgePrincipal | PhoneEventGridPrincipal,
): principal is RunnerPrincipal {
  return 'kind' in principal && principal.kind === 'jarvis-runner';
}
export function isPcBridgePrincipal(
  principal: UserPrincipal | AgentPrincipal | RunnerPrincipal | PcBridgePrincipal | PhoneEventGridPrincipal,
): principal is PcBridgePrincipal {
  return 'kind' in principal && principal.kind === 'jarvis-pc-bridge';
}
export function isPhoneEventGridPrincipal(
  principal: UserPrincipal | AgentPrincipal | RunnerPrincipal | PcBridgePrincipal | PhoneEventGridPrincipal,
): principal is PhoneEventGridPrincipal {
  return 'kind' in principal && principal.kind === 'jarvis-phone-event-grid';
}
export class AuthenticationDenied extends Error {
  constructor(public readonly statusCode: 401 | 403) { super('Authentication denied'); }
}

export function createTokenVerifier(config: AuthConfig, keys?: JWTVerifyGetKey): TokenVerifier {
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        algorithms: ['RS256'], issuer, audience: config.apiClientId,
        requiredClaims: ['exp', 'nbf', 'iat', 'tid', 'ver', 'oid'],
        clockTolerance: 5,
      }));
    } catch { throw new AuthenticationDenied(401); }
    if (payload.ver !== '2.0' || payload.tid !== config.tenantId || typeof payload.oid !== 'string' ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(payload.oid)) {
      throw new AuthenticationDenied(401);
    }
    const objectId = payload.oid.toLowerCase();
    if (config.pcBridgeClientId !== undefined && payload.azp === config.pcBridgeClientId) {
      if (objectId !== config.ownerObjectId || typeof payload.scp !== 'string' ||
          !payload.scp.split(' ').includes('access_as_user') ||
          (payload.idtyp !== undefined && payload.idtyp !== 'user')) {
        throw new AuthenticationDenied(403);
      }
      return { kind: 'jarvis-pc-bridge', objectId, tenantId: config.tenantId };
    }
    if (Array.isArray(payload.roles) && payload.roles.includes(runnerEventsRole)) {
      if (payload.scp !== undefined || (payload.idtyp !== undefined && payload.idtyp !== 'app')) {
        throw new AuthenticationDenied(403);
      }
      return { kind: 'jarvis-runner', objectId, tenantId: config.tenantId };
    }
    if (config.phoneEventGridObjectId !== undefined && objectId === config.phoneEventGridObjectId) {
      if (payload.scp !== undefined || (payload.idtyp !== undefined && payload.idtyp !== 'app')) {
        throw new AuthenticationDenied(403);
      }
      return { kind: 'jarvis-phone-event-grid', objectId, tenantId: config.tenantId };
    }
    if (config.agentObjectId !== undefined && objectId === config.agentObjectId) {
      // The agent identity signs in app-only: an assigned application role and no delegated scope.
      if (payload.scp !== undefined || !Array.isArray(payload.roles) || !payload.roles.includes(agentToolsRole) ||
        (payload.idtyp !== undefined && payload.idtyp !== 'app')) {
        throw new AuthenticationDenied(403);
      }
      return { kind: 'jarvis-agent', objectId, tenantId: config.tenantId };
    }
    // ID tokens and app-only tokens have no delegated API scope and cannot pass.
    if (objectId !== config.ownerObjectId || typeof payload.scp !== 'string' ||
      !payload.scp.split(' ').includes('access_as_user')) {
      throw new AuthenticationDenied(403);
    }
    const displayName = payload.name;
    return {
      objectId,
      tenantId: config.tenantId,
      displayName: typeof displayName === 'string' && displayName.trim().length > 0 &&
        displayName.length <= 200 && !Array.from(displayName).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
        ? displayName.trim()
        : 'Dan',
    };
  };
}
