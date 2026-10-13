import { createHash } from 'node:crypto';

export const healthUploadLimit = 8 * 1024 * 1024;
export const metadataLimit = 32 * 1024;
export const healthPermissions = ['health-ingest','health-heartbeat'] as const;
export type HealthPermission = typeof healthPermissions[number];
export type HealthKind = 'upload' | 'heartbeat';
export class HealthDenied extends Error { constructor() { super('Health capability denied'); } }
export class HealthConflict extends Error { constructor() { super('Health session conflicts'); } }
export class HealthUnavailable extends Error { constructor() { super('Health buffer unavailable'); } }
export interface HealthCapability {
  version: 1; ownerObjectId: string; deviceId: string; permissions: HealthPermission[]; expiresAt: string; revoked: boolean;
}
export type HealthCredentialVerifier = (token: string,signal: AbortSignal) => Promise<HealthCapability | null>;
export interface HealthManifest {
  version: 1; acceptanceId: string; ownerObjectId: string; deviceId: string; kind: HealthKind;
  automationId: string; sessionId: string; checksum: string; rawKey: string; bytes: number; acceptedAt: string;
  delivery: 'pending' | 'queued';
}
export interface HealthReceipt {
  acceptanceId: string; acceptedAt: string; status: 'accepted'; queue: 'pending' | 'queued';
  processing: 'not-confirmed'; duplicate: boolean;
}
export function sha256(body: string | Buffer): string { return createHash('sha256').update(body).digest('hex'); }
export function ownerId(value: string): string {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value)) throw new TypeError('Invalid configured owner');
  return value.toLowerCase();
}
export function opaqueId(value: unknown,max = 1024): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.trim() !== value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new TypeError('Invalid identifier');
}
export function authorizeHealth(capability: HealthCapability | null,owner: string,permission: HealthPermission,now = Date.now()): HealthCapability {
  try {
    if (!capability || Object.keys(capability).some(key => !['version','ownerObjectId','deviceId','permissions','expiresAt','revoked'].includes(key)) || capability.version !== 1 ||
        ownerId(capability.ownerObjectId) !== ownerId(owner) || capability.revoked !== false || !Array.isArray(capability.permissions) ||
        capability.permissions.length < 1 || capability.permissions.length > 2 || new Set(capability.permissions).size !== capability.permissions.length ||
        capability.permissions.some(scope => !healthPermissions.includes(scope)) || !capability.permissions.includes(permission) ||
        typeof capability.expiresAt !== 'string' || !Number.isFinite(Date.parse(capability.expiresAt)) || Date.parse(capability.expiresAt) <= now) throw new HealthDenied();
    opaqueId(capability.deviceId,256);
    return { ...capability,ownerObjectId: ownerId(owner),permissions: [...capability.permissions] };
  } catch { throw new HealthDenied(); }
}
export function validateManifest(value: unknown): HealthManifest {
  const row = value as HealthManifest;
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['version','acceptanceId','ownerObjectId','deviceId','kind','automationId','sessionId','checksum','rawKey','bytes','acceptedAt','delivery'].includes(key)) ||
      row.version !== 1 || !['upload','heartbeat'].includes(row.kind) || !['pending','queued'].includes(row.delivery) ||
      !/^[a-f\d]{64}$/u.test(row.checksum) || !/^raw\/[a-f\d]{64}\.json$/u.test(row.rawKey) || !Number.isInteger(row.bytes) || row.bytes < 1 || row.bytes > healthUploadLimit ||
      typeof row.acceptedAt !== 'string' || !Number.isFinite(Date.parse(row.acceptedAt))) throw new HealthUnavailable();
  ownerId(row.ownerObjectId); ownerId(row.acceptanceId); opaqueId(row.deviceId,256); opaqueId(row.automationId); opaqueId(row.sessionId);
  return row;
}
