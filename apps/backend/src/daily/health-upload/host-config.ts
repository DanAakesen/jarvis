import { ownerId } from './contracts.js';
import { validateHealthStorageEndpoints } from './azure-buffer.js';
import { validateHealthRatePolicy,validateHealthTrustedProxies,type HealthRatePolicy } from './rate-policy.js';

export interface HealthHostConfig {
  enabled: boolean; mode: 'serve' | 'recover-once'; host: '127.0.0.1' | '0.0.0.0' | '::'; port: number;
  ownerObjectId: string; managedIdentityClientId: string; blobUrl: string; queueUrl: string;
  rawContainer: string; deviceContainer: string; queueName: string;
  recoveryEnabled: boolean; recoveryIntervalMs: number; recoveryPageSize: number; recoveryDeadlineMs: number;
  replayQueued: boolean; shutdownMs: number;
  ratePolicy: HealthRatePolicy; trustedProxyCidrs: string[];
}
function flag(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new TypeError('Invalid health host configuration');
}
function integer(value: string | undefined,fallback: number,min: number,max: number): number {
  if (value !== undefined && !/^\d+$/u.test(value)) throw new TypeError('Invalid health host configuration');
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new TypeError('Invalid health host configuration');
  return number;
}
function storageName(value: string | undefined): string {
  if (!value || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(value) || value.includes('--')) throw new TypeError('Invalid health host configuration');
  return value;
}
/** Nonsecret configuration only; no bearer/connection string or credential fallback. */
export function readHealthHostConfig(env: Record<string,string | undefined>): HealthHostConfig {
  const enabled = flag(env.DAILY_HEALTH_UPLOAD_ENABLED);
  const recoveryEnabled = flag(env.DAILY_HEALTH_RECOVERY_ENABLED);
  const replayQueued = flag(env.DAILY_HEALTH_REPLAY_QUEUED);
  const mode = env.DAILY_HEALTH_MODE ?? 'serve'; const host = env.DAILY_HEALTH_HOST ?? '0.0.0.0';
  const proxyText = env.DAILY_HEALTH_TRUSTED_PROXY_CIDRS ?? '';
  if (proxyText.length > 1024) throw new TypeError('Invalid health host configuration');
  const trustedProxyCidrs = validateHealthTrustedProxies(proxyText ? proxyText.split(',').map(value => value.trim()) : []);
  const ratePolicy = validateHealthRatePolicy({ perClient: integer(env.DAILY_HEALTH_RATE_PER_CLIENT,60,1,1000),
    perInstance: integer(env.DAILY_HEALTH_RATE_PER_INSTANCE,120,1,1000),windowMs: integer(env.DAILY_HEALTH_RATE_WINDOW_MS,60000,1000,300000) });
  if (!['serve','recover-once'].includes(mode) || !['127.0.0.1','0.0.0.0','::'].includes(host) ||
      recoveryEnabled && !enabled || mode === 'recover-once' && (!enabled || !recoveryEnabled) || replayQueued && mode !== 'recover-once') throw new TypeError('Invalid health host configuration');
  const base = { enabled,mode: mode as HealthHostConfig['mode'],host: host as HealthHostConfig['host'],
    port: integer(env.DAILY_HEALTH_PORT,3001,1024,65535),recoveryEnabled,
    recoveryIntervalMs: integer(env.DAILY_HEALTH_RECOVERY_INTERVAL_MS,60000,1000,300000),
    recoveryPageSize: integer(env.DAILY_HEALTH_RECOVERY_PAGE_SIZE,25,1,100),
    recoveryDeadlineMs: integer(env.DAILY_HEALTH_RECOVERY_DEADLINE_MS,20000,1000,20000),
    replayQueued,shutdownMs: integer(env.DAILY_HEALTH_SHUTDOWN_MS,35000,3000,35000),ratePolicy,trustedProxyCidrs };
  if (!enabled) return { ...base,ownerObjectId: '',managedIdentityClientId: '',blobUrl: '',queueUrl: '',rawContainer: '',deviceContainer: '',queueName: '' };
  const ownerObjectId = ownerId(env.DAILY_HEALTH_OWNER_OBJECT_ID ?? '');
  const managedIdentityClientId = ownerId(env.DAILY_HEALTH_MANAGED_IDENTITY_CLIENT_ID ?? '');
  const endpoints = validateHealthStorageEndpoints(env.DAILY_HEALTH_BLOB_URL ?? '',env.DAILY_HEALTH_QUEUE_URL ?? '');
  const rawContainer = storageName(env.DAILY_HEALTH_RAW_CONTAINER); const deviceContainer = storageName(env.DAILY_HEALTH_DEVICE_CONTAINER);
  if (rawContainer === deviceContainer) throw new TypeError('Invalid health host configuration');
  return { ...base,ownerObjectId,managedIdentityClientId,...endpoints,rawContainer,deviceContainer,queueName: storageName(env.DAILY_HEALTH_QUEUE_NAME) };
}
