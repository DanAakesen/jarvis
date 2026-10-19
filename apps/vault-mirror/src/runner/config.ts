import type { WriteBack } from '../engine/types.js';

export interface MirrorConfig {
  readonly keyVaultUri: string;
  readonly managedIdentityClientId: string;
  readonly githubAppId: string;
  readonly storageUrl: string;
  readonly writeBack: WriteBack;
  readonly maxChanged: number;
  readonly maxDeletes: number;
}

function httpsUrl(value: string | undefined, name: string, allowPath: boolean): string {
  if (!value) throw new TypeError(`Missing ${name}`);
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError(`Invalid ${name}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    (!allowPath && url.pathname !== '/')) throw new TypeError(`Invalid ${name}`);
  return url.toString().replace(/\/$/u, '');
}

function limit(value: string | undefined, fallback: number, maximum: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new TypeError(`Invalid ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new TypeError(`Invalid ${name}`);
  return parsed;
}

export function readMirrorConfig(env: NodeJS.ProcessEnv): MirrorConfig {
  const managedIdentityClientId = env.AZURE_CLIENT_ID;
  if (!managedIdentityClientId || managedIdentityClientId.length > 128) {
    throw new TypeError('Invalid AZURE_CLIENT_ID');
  }
  const githubAppId = env.GITHUB_APP_ID;
  if (!githubAppId || !/^[1-9]\d{0,19}$/u.test(githubAppId)) {
    throw new TypeError('Invalid GITHUB_APP_ID');
  }
  const writeBack: WriteBack = env.VAULT_MIRROR_WRITE_BACK === 'on' ? 'on' : 'dry-run';
  return {
    keyVaultUri: httpsUrl(env.KEY_VAULT_URI, 'KEY_VAULT_URI', false),
    managedIdentityClientId,
    githubAppId,
    storageUrl: httpsUrl(env.VAULT_MIRROR_STORAGE_URL, 'VAULT_MIRROR_STORAGE_URL', false),
    writeBack,
    maxChanged: limit(env.VAULT_MIRROR_MAX_CHANGED, 25, 100, 'VAULT_MIRROR_MAX_CHANGED'),
    maxDeletes: limit(env.VAULT_MIRROR_MAX_DELETES, 3, 10, 'VAULT_MIRROR_MAX_DELETES'),
  };
}
