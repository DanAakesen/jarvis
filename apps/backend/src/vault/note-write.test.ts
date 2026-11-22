import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { createMemoryVault, createVaultIndexFake } from '../pi/conformance/groups/notes-vault.testkit.js';
import { createVaultModule } from './index.js';

const signal = new AbortController().signal;
const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', 'header.owner.signature'].join(' ') };
const gardenPlan = '# Garden plan\n\nRaised beds along the south fence.';
const pergola = {
  path: 'Personal/Pergola.md', content: '# Pergola\n\nBuild a pergola over the terrace.', reason: 'Dan asked for a note', automaticCapture: false,
};

/** Hold the first tree read after a write so the test can browse before the background sync finishes. */
async function fixture(seed?: (vault: ReturnType<typeof createMemoryVault>) => void) {
  const vault = createMemoryVault();
  vault.seed('Personal/Garden plan.md', gardenPlan);
  seed?.(vault);
  let holdNextTree = false;
  let releaseReindex!: () => void;
  const reindexGate = new Promise<void>((resolve) => { releaseReindex = resolve; });
  const tree = vault.tree;
  vi.spyOn(vault, 'tree').mockImplementation(async (signal) => {
    if (holdNextTree) {
      holdNextTree = false;
      await reindexGate;
    }
    return tree(signal);
  });
  const writeToVault = vault.write;
  const write = vi.spyOn(vault, 'write').mockImplementation(async (...args) => {
    const commit = await writeToVault(...args);
    holdNextTree = true;
    return commit;
  });
  const index = createVaultIndexFake();
  const replaceFile = vi.spyOn(index, 'replaceFile');
  const module = createVaultModule({
    client: vault, indexStore: index,
    memoryStore: { getSourceMessage: async (messageId) => ({ messageId, text: 'Save a note about the pergola.' }) },
  });
  await module.synchronize(signal);
  const request = { principal: { objectId: 'owner' }, headers: { 'x-jarvis-message-id': '42' } } as unknown as FastifyRequest;
  const call = (name: string, args: Record<string, unknown>) =>
    module.tools.find((tool) => tool.name === name)!.execute(args, request, signal) as Promise<Record<string, unknown>>;
  const ownerApp = () => buildApp(config, undefined, {
    modules: [module],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Fixture owner' }),
  });
  return { index, replaceFile, vault, write, module, call, releaseReindex, ownerApp };
}

describe('vault_search straight after vault_write', () => {
  it('finds the note Jarvis just saved while the re-index it started is still running', async () => {
    const { replaceFile, module, call, releaseReindex } = await fixture();

    await call('vault_write', pergola);
    const found = await call('vault_search', { query: 'pergola terrace' });
    const existing = await call('vault_search', { query: 'raised beds' });

    expect((found.results as { path: string }[]).map((hit) => hit.path)).toEqual(['Personal/Pergola.md']);
    expect((existing.results as { path: string }[]).map((hit) => hit.path)).toEqual(['Personal/Garden plan.md']);

    releaseReindex();
    await module.synchronize(signal);
    // The re-index found the note already indexed with Git's own sha, so it did not index it a second time.
    expect(replaceFile.mock.calls.filter(([path]) => path === pergola.path)).toHaveLength(1);
  });

  it('still saves the note when indexing it straight away fails, and the re-index finds it later', async () => {
    const { replaceFile, module, call, releaseReindex, ownerApp } = await fixture();
    replaceFile.mockRejectedValueOnce(new Error('index database unavailable'));

    const saved = await call('vault_write', pergola);

    expect(saved).toMatchObject({ path: pergola.path, confirmation: expect.stringContaining('Saved to vault') });
    releaseReindex();
    await module.synchronize(signal);
    expect((await call('vault_search', { query: 'pergola terrace' })).count).toBe(1);
    const app = ownerApp();
    try {
      const page = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(page.json().notes).toEqual(expect.arrayContaining([expect.objectContaining({ path: pergola.path })]));
    } finally { await app.close(); }
  });
});

describe('browsing committed vault notes', () => {
  it('lists a freshly saved title-only note before resync, on the first page of its exact directory', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    const nested = 'Personal/Home/Family.md';
    const { call, ownerApp, releaseReindex, module, replaceFile } = await fixture((vault) => {
      vault.seed(nested, '# Family');
    });
    const app = ownerApp();
    try {
      vi.setSystemTime(new Date('2026-11-22T10:01:00Z'));
      const path = 'Personal/Test 2.md'; // Sorts after Garden plan by path.
      const saved = await call('vault_write', { ...pergola, path, content: '# Test 2' });
      expect(saved.confirmation).toContain('Saved to vault');
      const first = await app.inject({ url: '/notes?directory=Personal&sort=updated&limit=1', headers });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ hasMore: true, notes: [{ path, title: 'Test 2', directory: 'Personal' }] });
      const second = await app.inject({ url: '/notes?directory=Personal&sort=updated&limit=1&offset=1', headers });
      expect(second.json()).toMatchObject({ hasMore: false, notes: [{ path: 'Personal/Garden plan.md' }] });
      expect(replaceFile.mock.calls.find(([savedPath]) => savedPath === path)?.[3]).toEqual([]);
    } finally {
      releaseReindex();
      await module.synchronize(signal);
      await app.close();
      vi.useRealTimers();
    }
  });

  it('uses the edited H1 across list, pins and the linked graph node without changing the path', async () => {
    const path = 'Work/Events/old-title.md';
    const source = 'Work/events-index.md';
    const title = 'New > schedule';
    const { vault, module, ownerApp, releaseReindex } = await fixture((vault) => {
      vault.seed(path, '# Old title\n\nOld notes.');
      vault.seed(source, `Body\n[[${path}]]`);
      vault.seed('Work/Events/venue_map.md', 'Preamble.\n\n## Details\n\nVenue information.');
    });
    const app = ownerApp();
    try {
      await app.inject({ url: '/knowledge/graph', headers }); // Warm the graph with the original title.
      const content = `---\r\ntags: [work]\r\n...\r\n\r\n# ${title}\r\n# Later heading\r\nThe body is under this heading.`;
      const edited = await app.inject({ method: 'PUT', url: '/notes/note', headers, payload: {
        path, sha: vault.shaOf(path), content,
      } });
      expect(edited.statusCode).toBe(200);
      const folder = await app.inject({ url: '/notes?directory=Work%2FEvents', headers });
      expect(folder.json().notes).toMatchObject([{ path, title }, { title: 'Venue map' }]);
      const pins = await app.inject({ method: 'POST', url: '/notes/summaries', headers, payload: { paths: [path, 'Work/missing.md'] } });
      expect(pins.statusCode).toBe(200);
      expect(pins.json().notes).toMatchObject([{ path, title }]);
      const graph = (await app.inject({ url: '/knowledge/graph', headers })).json();
      const linkedNode = graph.nodes.find((node: { path: string }) => node.path === path);
      expect(linkedNode).toMatchObject({ title });
      expect(graph.edges).toContainEqual(expect.objectContaining({ target: linkedNode.id, type: 'link' }));
      const read = await app.inject({ url: `/notes/note?path=${encodeURIComponent(path)}`, headers });
      expect(read.json()).toMatchObject({ path, content });
      const invalid = await app.inject({ method: 'POST', url: '/notes/summaries', headers, payload: { paths: ['../bad.md'] } });
      expect(invalid.statusCode).toBe(400);
      const anonymous = await app.inject({ method: 'POST', url: '/notes/summaries', payload: { paths: [path] } });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      releaseReindex();
      await module.synchronize(signal);
      await app.close();
    }
  });
});

describe('a vault write whose commit cannot be confirmed', () => {
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
    const { write, module } = await fixture();
    write.mockRejectedValueOnce(new Error('socket hang up'));

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
    const { write, module } = await fixture();
    write.mockRejectedValueOnce(new Error('socket hang up'));

    const answer = await viaRoute(module, 'vault_task_create', { text: 'Order the pergola kit' });

    expect(answer).toMatchObject({ outcome: 'error', result: { outcomeUnknown: true } });
    expect(answer.confirmation).toMatch(/^The task save outcome is unknown\./u);
  });
});
