import { describe, expect, it } from 'vitest';
import { readMirrorConfig } from '../src/runner/config.js';

const env = {
  KEY_VAULT_URI: 'https://example.vault.azure.net',
  AZURE_CLIENT_ID: 'synthetic-client-id',
  GITHUB_APP_ID: '123456',
  VAULT_MIRROR_STORAGE_URL: 'https://example.blob.core.windows.net',
};

describe('readMirrorConfig', () => {
  it('uses safe write-back defaults and accepts the configured caps', () => {
    expect(readMirrorConfig(env)).toMatchObject({
      writeBack: 'dry-run',
      maxChanged: 25,
      maxDeletes: 3,
    });
    expect(readMirrorConfig({
      ...env,
      VAULT_MIRROR_WRITE_BACK: 'on',
      VAULT_MIRROR_MAX_CHANGED: '100',
      VAULT_MIRROR_MAX_DELETES: '10',
    })).toMatchObject({ writeBack: 'on', maxChanged: 100, maxDeletes: 10 });
  });

  it.each([
    { ...env, KEY_VAULT_URI: 'http://example.vault.azure.net' },
    { ...env, AZURE_CLIENT_ID: '' },
    { ...env, GITHUB_APP_ID: '0' },
    { ...env, VAULT_MIRROR_STORAGE_URL: 'https://example.blob.core.windows.net/path' },
    { ...env, VAULT_MIRROR_MAX_CHANGED: '101' },
    { ...env, VAULT_MIRROR_MAX_DELETES: '-1' },
  ])('rejects invalid or out-of-range configuration', invalid => {
    expect(() => readMirrorConfig(invalid)).toThrow(TypeError);
  });
});
