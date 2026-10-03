import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig } from './config.js';

export interface UserPrincipal { objectId: string; tenantId: string }
export type TokenVerifier = (token: string) => Promise<UserPrincipal>;
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
    // ID tokens and app-only tokens have no delegated API scope and cannot pass.
    if (payload.oid.toLowerCase() !== config.ownerObjectId || typeof payload.scp !== 'string' ||
      !payload.scp.split(' ').includes('access_as_user')) {
      throw new AuthenticationDenied(403);
    }
    return { objectId: payload.oid.toLowerCase(), tenantId: config.tenantId };
  };
}
