import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/main.js';

const env = {
  KEY_VAULT_URI: 'https://example.vault.azure.net',
  AZURE_CLIENT_ID: 'synthetic-client-id',
  GITHUB_APP_ID: '123456',
  VAULT_MIRROR_STORAGE_URL: 'https://example.blob.core.windows.net',
};

describe('main', () => {
  it.each([0, 1])('returns the runner exit code %i', async exitCode => {
    const run = vi.fn(async () => exitCode);
    const output = vi.fn();

    await expect(main(env, run, output)).resolves.toBe(exitCode);
    expect(run).toHaveBeenCalledOnce();
    expect(output).not.toHaveBeenCalled();
  });

  it('uses a fixed failure status for configuration errors', async () => {
    const run = vi.fn(async () => 0);
    const output = vi.fn();

    await expect(main({ ...env, GITHUB_APP_ID: 'invalid' }, run, output)).resolves.toBe(1);

    expect(run).not.toHaveBeenCalled();
    expect(JSON.parse(output.mock.calls[0]![0]!)).toMatchObject({
      outcome: 'failed',
      reason: 'unexpected',
    });
  });
});
