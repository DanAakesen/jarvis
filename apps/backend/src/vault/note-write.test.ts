import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { VaultIndexStore, VaultIndexedChunk } from '../database/memory-store.js';
import type { createGitHubVaultClient } from './github-client.js';
import { createVaultModule } from './index.js';

const signal = new AbortController().signal;
const gitSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const gardenPlan = '# Garden plan\n\nRaised beds along the south fence.';
const pergola = {
  path: 'Personal/Pergola.md', content: '# Pergola\n\nBuild a pergola over the terrace.', reason: 'Dan asked for a note', automaticCapture: false,
};

/** A vault whose first listing is the start-up index and whose later ones (the re-index a write starts) wait for `releaseReindex`. */
async function fixture() {
  const files = new Map([['Personal/Garden plan.md', gardenPlan]]);
  const indexed = new Map<string, { sha: string; chunks: readonly VaultIndexedChunk[] }>();
  let listings = 0;
  let releaseReindex!: () => void;
  const reindexGate = new Promise<void>((resolve) => { releaseReindex = resolve; });
  const client = {
    tree: vi.fn(async () => {
      if (listings++ > 0) await reindexGate;
      return [...files].map(([path, content]) => ({ path, sha: gitSha(content) }));
    }),
    read: vi.fn(async (path: string) => {
      const content = files.get(path);
      return content === undefined ? null : { path, sha: gitSha(content), content };
    }),
    write: vi.fn(async (path: string, content: string) => { files.set(path, content); return 'c'.repeat(40); }),
  };
  const index = {
    supportsVectorSearch: () => false,
    files: vi.fn(async () => [...indexed].map(([path, entry]) => ({ path, blobSha: entry.sha, embeddingMissing: false }))),
    replaceFile: vi.fn(async (path: string, sha: string, chunks: readonly VaultIndexedChunk[]) => { indexed.set(path, { sha, chunks }); }),
    deleteFiles: vi.fn(async () => {}),
    searchByTerms: vi.fn(async (terms: readonly string[], limit: number) => [...indexed].flatMap(([path, entry]) => entry.chunks
      .filter((chunk) => terms.some((term) => `${chunk.heading} ${chunk.content}`.toLowerCase().includes(term)))
      .map((chunk) => ({ path, heading: chunk.heading, content: chunk.content }))).slice(0, limit)),
  };
  const module = createVaultModule({
    client: client as unknown as ReturnType<typeof createGitHubVaultClient>,
    indexStore: index as unknown as VaultIndexStore,
    memoryStore: { getSourceMessage: async (messageId) => ({ messageId, text: 'Save a note about the pergola.' }) },
  });
  await module.synchronize(signal);
  const request = { principal: { objectId: 'owner' }, headers: { 'x-jarvis-message-id': '42' } } as unknown as FastifyRequest;
  const call = (name: string, args: Record<string, unknown>) =>
    module.tools.find((tool) => tool.name === name)!.execute(args, request, signal) as Promise<Record<string, unknown>>;
  return { index, client, module, call, releaseReindex };
}

describe('vault_search straight after vault_write', () => {
  it('finds the note Jarvis just saved while the re-index it started is still running', async () => {
    const { index, module, call, releaseReindex } = await fixture();

    await call('vault_write', pergola);
    const found = await call('vault_search', { query: 'pergola terrace' });
    const existing = await call('vault_search', { query: 'raised beds' });

    expect((found.results as { path: string }[]).map((hit) => hit.path)).toEqual(['Personal/Pergola.md']);
    expect((existing.results as { path: string }[]).map((hit) => hit.path)).toEqual(['Personal/Garden plan.md']);

    releaseReindex();
    await module.synchronize(signal);
    // The re-index found the note already indexed with Git's own sha, so it did not index it a second time.
    expect(index.replaceFile.mock.calls.filter(([path]) => path === pergola.path)).toHaveLength(1);
  });

  it('still saves the note when indexing it straight away fails, and the re-index finds it later', async () => {
    const { index, module, call, releaseReindex } = await fixture();
    index.replaceFile.mockRejectedValueOnce(new Error('index database unavailable'));

    const saved = await call('vault_write', pergola);

    expect(saved).toMatchObject({ path: pergola.path, confirmation: expect.stringContaining('Saved to vault') });
    releaseReindex();
    await module.synchronize(signal);
    expect((await call('vault_search', { query: 'pergola terrace' })).count).toBe(1);
  });
});

describe('a vault write whose commit cannot be confirmed', () => {
  const config = { ...loadConfig({}), logLevel: 'silent' as const };

  /** One tool call through the real tool route, as Jarvis makes it; `confirmation` is what Dan reads. */
  async function viaRoute(module: ReturnType<typeof createVaultModule>, name: string, payload: Record<string, unknown>) {
    const app = buildApp(config, undefined, {
      modules: [coreModule, module],
      auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
      toolCallStore: { record: async () => {} },
    });
    try {
      const response = await app.inject({
        method: 'POST', url: `/tools/${name}`, payload,
        headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '42' },
      });
      return response.json() as { outcome: string; result: Record<string, unknown>; confirmation: string };
    } finally {
      await app.close();
    }
  }

  it('is told as it is: the append may have gone through, so it does not say "Not done."', async () => {
    const { client, module } = await fixture();
    client.write.mockRejectedValueOnce(new Error('socket hang up'));

    const answer = await viaRoute(module, 'vault_write', { path: pergola.path, append: 'Build the pergola.', reason: pergola.reason, automaticCapture: false });

    expect(answer).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(answer.confirmation).toBe(answer.result.error);
    expect(answer.confirmation).toMatch(/^Vault write could not be confirmed\./u);
  });

  it('says "Not done." when the note changed, because the vault says nothing was committed', async () => {
    const { module } = await fixture();

    const answer = await viaRoute(module, 'vault_write', { path: 'Personal/Garden plan.md', content: '# Garden plan\n\nNew.', reason: pergola.reason, automaticCapture: false });

    expect(answer.result).not.toHaveProperty('outcomeUnknown');
    expect(answer.confirmation).toMatch(/^Not done\. The note changed or its read version is missing\./u);
  });

  it('is told as it is for a task too: "the task save outcome is unknown" is not "Not done."', async () => {
    const { client, module } = await fixture();
    client.write.mockRejectedValueOnce(new Error('socket hang up'));

    const answer = await viaRoute(module, 'vault_task_create', { text: 'Order the pergola kit' });

    expect(answer).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(answer.confirmation).toMatch(/^The task save outcome is unknown\./u);
  });
});
