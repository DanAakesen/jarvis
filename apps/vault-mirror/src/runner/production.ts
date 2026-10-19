import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManagedIdentityCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { validatePolicy } from '../engine/policy.js';
import { createGitHubMirrorClient } from './github.js';
import { createObsidianClient } from './obsidian.js';
import { runMirror } from './run.js';
import { AzureMirrorStorage } from './storage.js';
import type { MirrorConfig } from './config.js';
import type { MirrorSecrets, RunDependencies } from './types.js';

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { statusCode?: unknown; status?: unknown }).statusCode ??
    (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function createProductionDependencies(config: MirrorConfig): RunDependencies {
  const credential = new ManagedIdentityCredential({ clientId: config.managedIdentityClientId });
  const keyVault = new SecretClient(config.keyVaultUri, credential);
  return {
    async readSecrets(signal): Promise<MirrorSecrets> {
      const secret = async (name: string, optional = false): Promise<string | undefined> => {
        try {
          const value = await keyVault.getSecret(name, {
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          });
          return value.value;
        } catch (error) {
          if (optional && errorStatus(error) === 404) return undefined;
          if (signal.aborted) throw signal.reason;
          if (name === 'vault-mirror-policy' && errorStatus(error) === 404) {
            throw new Error('policy-missing', { cause: error });
          }
          throw new Error('auth', { cause: error });
        }
      };
      const [obsidianToken, vaultName, vaultPassword, policyJson, githubPrivateKey] = await Promise.all([
        secret('obsidian-auth-token'),
        secret('obsidian-vault'),
        secret('obsidian-vault-password', true),
        secret('vault-mirror-policy'),
        secret('github-app-private-key'),
      ]);
      if (!obsidianToken?.trim() || !vaultName?.trim() || !githubPrivateKey?.trim()) {
        throw new Error('auth');
      }
      const validated = validatePolicy(policyJson);
      if (!validated.success) throw new Error('policy-missing');
      return {
        obsidianToken,
        vaultName: vaultName.trim(),
        ...(vaultPassword === undefined ? {} : { vaultPassword }),
        policy: validated.policy,
        githubPrivateKey,
      };
    },
    createGitHub: (privateKey, policy) => createGitHubMirrorClient({
      appId: config.githubAppId,
      privateKey,
      policy,
    }),
    storage: new AzureMirrorStorage(config.storageUrl, credential),
    async createWorkspace() {
      const root = await mkdtemp(join(tmpdir(), 'jarvis-vault-mirror-'));
      const workingCopy = resolve(root, 'working-copy');
      const configHome = resolve(root, 'state');
      await Promise.all([
        mkdir(workingCopy, { recursive: true, mode: 0o700 }),
        mkdir(configHome, { recursive: true, mode: 0o700 }),
      ]);
      return {
        workingCopy,
        configHome,
        cleanup: () => rm(root, { recursive: true, force: true }),
      };
    },
    createObsidian(options) {
      return createObsidianClient({
        configHome: options.configHome,
        token: options.token,
        workingCopy: options.workingCopy,
        ...(options.password === undefined ? {} : { password: options.password }),
        signal: options.signal,
        timeoutMs: Math.min(60_000, options.remainingMs()),
      });
    },
    log(entry) {
      const allowed = Object.fromEntries(Object.entries(entry).filter(([key]) =>
        ['runId', 'outcome', 'reason', 'durationMs', 'approved', 'pushed', 'writtenBack',
          'deleted', 'conflicts', 'skipped', 'credentialMatches', 'pendingWriteBack'].includes(key)));
      console.log(JSON.stringify(allowed));
    },
  };
}

export async function runProduction(config: MirrorConfig): Promise<number> {
  const dependencies = createProductionDependencies(config);
  const result = await runMirror({
    config,
    dependencies,
  });
  return result.exitCode;
}
