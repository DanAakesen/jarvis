import { describe, expect, it, vi } from 'vitest';
import type { VaultIndexStore } from '../database/memory-store.js';
import { MAX_VAULT_FILE_BYTES } from './github-client.js';
import { createVaultModule } from './index.js';

const sha = (digit: string) => digit.repeat(40);

describe('vault index synchronization', () => {
  it('leaves a note above the size limit out of the index instead of failing every synchronization', async () => {
    const client = {
      tree: vi.fn(async () => [
        { path: 'Personal/small.md', sha: sha('a'), size: 24 },
        { path: 'General/huge.md', sha: sha('b'), size: MAX_VAULT_FILE_BYTES + 1 },
      ]),
      // The real client cannot read a note this large in one contents response and fails with a plain error.
      read: vi.fn(async (path: string) => {
        if (path === 'General/huge.md') throw new Error('GitHub response is too large');
        return { path, sha: sha('a'), content: '# Small\n\nA short note.' };
      }),
    };
    const indexed: string[] = [];
    const index = {
      files: vi.fn(async () => []),
      replaceFile: vi.fn(async (path: string) => { indexed.push(path); }),
      deleteFiles: vi.fn(async () => {}),
      supportsVectorSearch: () => false,
    };
    const module = createVaultModule({
      client: client as never, indexStore: index as unknown as VaultIndexStore, memoryStore: { getSourceMessage: vi.fn() },
    });

    await expect(module.synchronize(AbortSignal.timeout(5_000))).resolves.toEqual({ added: 1, changed: 0, removed: 1 });
    expect(indexed).toEqual(['Personal/small.md']);
    expect(client.read).not.toHaveBeenCalledWith('General/huge.md', expect.anything());
  });
});
