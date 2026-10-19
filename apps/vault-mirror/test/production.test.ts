import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProductionDependencies } from '../src/runner/production.js';
import { policyData } from './fixtures.js';

const { getSecret } = vi.hoisted(() => ({ getSecret: vi.fn() }));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class { getSecret = getSecret; },
}));
vi.mock('@azure/identity', () => ({
  ManagedIdentityCredential: class {},
}));

const config = {
  keyVaultUri: 'https://example.vault.azure.net',
  managedIdentityClientId: 'synthetic-client-id',
  githubAppId: '123456',
  storageUrl: 'https://example.blob.core.windows.net',
  writeBack: 'dry-run' as const,
  maxChanged: 25,
  maxDeletes: 3,
};

beforeEach(() => {
  getSecret.mockReset();
  getSecret.mockImplementation(async (name: string) => ({
    value: name === 'vault-mirror-policy' ? JSON.stringify(policyData)
      : name === 'obsidian-vault' ? 'synthetic-vault'
        : name === 'github-app-private-key' ? 'synthetic-private-key'
          : name === 'obsidian-auth-token' ? 'synthetic-token'
            : undefined,
  }));
});

describe('Key Vault failure classification', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'unexpected'],
    [500, 'unexpected'],
    [503, 'unexpected'],
    [undefined, 'unexpected'],
  ] as const)('classifies status %s as %s', async (statusCode, reason) => {
    getSecret.mockImplementation(async (name: string) => {
      if (name === 'obsidian-auth-token') {
        throw Object.assign(new Error('synthetic provider response'), {
          ...(statusCode === undefined ? {} : { statusCode }),
        });
      }
      return {
        value: name === 'vault-mirror-policy' ? JSON.stringify(policyData)
          : name === 'obsidian-vault' ? 'synthetic-vault'
            : name === 'github-app-private-key' ? 'synthetic-private-key'
              : undefined,
      };
    });
    const dependencies = createProductionDependencies(config);

    await expect(dependencies.readSecrets(new AbortController().signal))
      .rejects.toMatchObject({ message: reason });
  });

  it('treats an absent optional password as a normal configuration', async () => {
    getSecret.mockImplementation(async (name: string) => {
      if (name === 'obsidian-vault-password') {
        throw Object.assign(new Error('not found'), { statusCode: 404 });
      }
      return {
        value: name === 'vault-mirror-policy' ? JSON.stringify(policyData)
          : name === 'obsidian-vault' ? 'synthetic-vault'
            : name === 'github-app-private-key' ? 'synthetic-private-key'
              : 'synthetic-token',
      };
    });
    const dependencies = createProductionDependencies(config);

    await expect(dependencies.readSecrets(new AbortController().signal))
      .resolves.toMatchObject({ vaultName: 'synthetic-vault' });
  });

  it('does not call a missing required secret an authentication rejection', async () => {
    getSecret.mockImplementation(async (name: string) => ({
      value: name === 'obsidian-auth-token' ? undefined
        : name === 'vault-mirror-policy' ? JSON.stringify(policyData)
          : name === 'obsidian-vault' ? 'synthetic-vault'
            : name === 'github-app-private-key' ? 'synthetic-private-key'
              : undefined,
    }));
    const dependencies = createProductionDependencies(config);

    await expect(dependencies.readSecrets(new AbortController().signal))
      .rejects.toMatchObject({ message: 'unexpected' });
  });
});
