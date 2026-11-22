import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../core/memory-embeddings.js';
import { createMemoryVault, createVaultIndexFake } from '../pi/conformance/groups/notes-vault.testkit.js';
import { createVaultModule, type VaultModule } from './index.js';

const signal = new AbortController().signal;
const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', 'header.owner.signature'].join(' ') };
const gardenPlan = '# Garden plan\n\nRaised beds along the south fence.';
const pergola = {
  path: 'Personal/Pergola.md', content: '# Pergola\n\nBuild a pergola over the terrace.', reason: 'Dan asked for a note', automaticCapture: false,
};
const request = { principal: { objectId: 'owner' }, headers: { 'x-jarvis-message-id': '42' } } as unknown as FastifyRequest;
const callTool = (module: VaultModule, name: string, args: Record<string, unknown>) =>
  module.tools.find((tool) => tool.name === name)!.execute(args, request, signal) as Promise<Record<string, unknown>>;
const ownerApp = (module: VaultModule) => buildApp(config, undefined, {
  modules: [module],
  auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Fixture owner' }),
});

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
  const call = (name: string, args: Record<string, unknown>) =>
    callTool(module, name, args);
  return { index, replaceFile, vault, write, module, call, releaseReindex, ownerApp: () => ownerApp(module) };
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

  it('shows a Chat note with a body on page one after a pull refresh, before the resync', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    const { call, ownerApp, vault, releaseReindex, module } = await fixture((vault) => {
      vault.seed('Welcome.md', '# Welcome\n\nThis note is at the root.');
      for (let i = 0; i < 50; i += 1) vault.seed(`Personal/Archive ${i}.md`, '# Archived\n\nAn old note.');
    });
    const app = ownerApp();
    try {
      const url = '/notes?directory=Personal&sort=updated&limit=50&offset=0';
      const before = await app.inject({ url, headers });
      expect(before.statusCode).toBe(200);
      expect(before.json().notes).toHaveLength(50);
      expect(before.headers.etag).toEqual(expect.any(String));
      vi.setSystemTime(new Date('2026-11-22T10:01:00Z'));
      const path = 'Personal/Build 122.md';
      const head = '---\r\ntags: [test]\r\n---\r\n# Build 122';
      const body = '\r\n\r\nThe test word is cobalt.\r\n\r\n# Build 122\r\nThis heading later in the note stays.';
      const saved = await call('vault_write', { ...pergola, path, content: `${head}\r\n\r\n# Build 122${body}` });
      expect(saved.confirmation).toContain('Saved to vault');
      expect(vault.files.get(path)).toBe(head + body);

      const page = await app.inject({ url, headers: { ...headers, 'cache-control': 'no-cache' } });
      expect(page.statusCode).toBe(200);
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.headers.etag).not.toBe(before.headers.etag);
      expect(page.json()).toMatchObject({ hasMore: true, offset: 0, limit: 50 });
      expect(page.json().notes[0]).toMatchObject({ path, title: 'Build 122', directory: 'Personal' });
      expect((await call('vault_search', { query: 'cobalt' })).results).toEqual([
        expect.objectContaining({ path, snippet: expect.stringContaining('cobalt') }),
      ]);
      const root = await app.inject({ url: '/notes?directory=&sort=updated&limit=50&offset=0', headers });
      expect(root.statusCode).toBe(200);
      expect(root.json().notes).toMatchObject([{ path: 'Welcome.md', directory: '' }]);
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
    const { vault, index, module, ownerApp, releaseReindex } = await fixture((vault) => {
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
      const graphFiles = vi.spyOn(index, 'graphFiles');
      const pins = await app.inject({ method: 'POST', url: '/notes/summaries', headers, payload: {
        paths: ['../bad.md', path, 'Work/missing.md', '', `Work/${'a'.repeat(181)}.md`],
      } });
      expect(pins.statusCode).toBe(200);
      expect(pins.json().notes).toMatchObject([{ path, title }]);
      expect(graphFiles).toHaveBeenLastCalledWith(expect.any(AbortSignal), [path, 'Work/missing.md']);
      const graph = (await app.inject({ url: '/knowledge/graph', headers })).json();
      const linkedNode = graph.nodes.find((node: { path: string }) => node.path === path);
      expect(linkedNode).toMatchObject({ title });
      expect(graph.edges).toContainEqual(expect.objectContaining({ target: linkedNode.id, type: 'link' }));
      const read = await app.inject({ url: `/notes/note?path=${encodeURIComponent(path)}`, headers });
      expect(read.json()).toMatchObject({ path, content });
      const invalid = await app.inject({ method: 'POST', url: '/notes/summaries', headers, payload: { paths: ['../bad.md'] } });
      expect(invalid.statusCode).toBe(200);
      expect(invalid.json()).toEqual({ notes: [] });
      const anonymous = await app.inject({ method: 'POST', url: '/notes/summaries', payload: { paths: [path] } });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      releaseReindex();
      await module.synchronize(signal);
      await app.close();
    }
  });
});

function legacyFixture(count: number, withEmbedder = false) {
  const vault = createMemoryVault();
  const index = createVaultIndexFake();
  const log = vi.fn();
  const embedding = Array<number>(MEMORY_EMBEDDING_DIMENSIONS).fill(1);
  const embed = vi.fn(async () => embedding);
  const model = 'fixture-model';
  const paths = Array.from({ length: count }, (_, index) => `Personal/legacy-${String(index + 1).padStart(2, '0')}.md`);
  for (const [i, path] of paths.entries()) {
    const heading = `Saved title ${i + 1}`;
    const content = 'A legacy note body.';
    const embedded = withEmbedder && i < paths.length - 1;
    vault.seed(path, `# ${heading}\n\n${content}`);
    index.seedLegacyFile(path, vault.shaOf(path)!, [{
      index: 0, heading, content, embedding: embedded ? embedding : null, embeddingModel: embedded ? model : null,
    }]);
  }
  const module = createVaultModule({
    client: vault, indexStore: index, log,
    memoryStore: { getSourceMessage: async () => null },
    ...(withEmbedder ? { embedder: { model, embed } } : {}),
  });
  return { vault, index, log, embed, model, paths, module };
}

describe('legacy vault title backfill', () => {
  it('caps legacy reads while listing pending titles by filename, then resumes the remaining rows', async () => {
    const { vault, index, embed, model, paths, module } = legacyFixture(33, true);
    const pendingPath = paths.at(-1)!; // Also missing its embedding.
    const newPath = 'Personal/new-note.md';
    vault.seed(newPath, '# New title');
    const read = vi.spyOn(vault, 'read');
    const app = ownerApp(module);
    try {
      await expect(module.synchronize(signal)).resolves.toMatchObject({ added: 1 });
      expect(read).toHaveBeenCalledTimes(33); // One new note and at most 32 old blobs.
      expect(read).not.toHaveBeenCalledWith(pendingPath, expect.anything());
      expect(embed).not.toHaveBeenCalled();
      expect((await index.files(model, signal)).filter((file) => file.titleMissing))
        .toMatchObject([{ path: pendingPath, embeddingMissing: true }]);
      const page = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(page.statusCode).toBe(200);
      expect(page.json().notes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: newPath, title: 'New title' }),
        expect.objectContaining({ path: pendingPath, title: 'Legacy 33' }),
      ]));

      read.mockClear();
      await module.synchronize(signal);
      expect(read.mock.calls.map(([path]) => path)).toEqual([pendingPath]);
      const refreshed = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(refreshed.json().notes).toContainEqual(expect.objectContaining({ path: pendingPath, title: 'Saved title 33' }));
      expect((await index.files(model, signal)).some((file) => file.titleMissing)).toBe(false);
    } finally { await app.close(); }
  });

  it.each(['read failure', 'deadline'])('keeps serving through a title backfill %s', async (failure) => {
    const { vault, log, paths, module } = legacyFixture(2);
    const read = vault.read;
    const startedRead = Promise.withResolvers<AbortSignal>();
    const resumeRead = Promise.withResolvers<void>();
    vi.spyOn(vault, 'read').mockImplementationOnce(read).mockImplementationOnce(async (path, readSignal) => {
      startedRead.resolve(readSignal);
      await resumeRead.promise;
      if (failure === 'read failure') throw new Error('GitHub request failed');
      return read(path, readSignal);
    });
    const deadline = new AbortController();
    const nativeTimeout = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
      ms === 20_000 ? deadline.signal : nativeTimeout(ms));
    const app = ownerApp(module);
    const sync = module.synchronize(signal);
    try {
      const batchSignal = await startedRead.promise;
      const page = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(page.statusCode).toBe(200);
      expect(page.json().notes).toMatchObject([
        { path: paths[0], title: 'Saved title 1' },
        { path: paths[1], title: 'Legacy 02' },
      ]);

      if (failure === 'deadline') {
        deadline.abort();
        expect(batchSignal.aborted).toBe(true);
        expect(signal.aborted).toBe(false);
      }
      resumeRead.resolve();
      await expect(sync).resolves.toEqual({ added: 0, changed: 0, removed: 0 });
      expect(module.syncStatus().outcome).toBe('ok');
      expect(log).toHaveBeenCalledWith('vault.title_backfill', { outcome: 'error' });
      const pins = await app.inject({ method: 'POST', url: '/notes/summaries', headers, payload: { paths } });
      expect(pins.statusCode).toBe(200);
      expect(pins.json().notes).toMatchObject([{ title: 'Saved title 1' }, { title: 'Legacy 02' }]);
      const graph = await app.inject({ url: '/knowledge/graph', headers });
      expect(graph.statusCode).toBe(200);
      expect(graph.json().nodes).toContainEqual(expect.objectContaining({ path: paths[1], title: 'Legacy 02' }));
      expect(await callTool(module, 'vault_search', { query: 'legacy' })).toMatchObject({ count: 2 });
    } finally {
      resumeRead.resolve();
      await sync.catch(() => undefined);
      timeout.mockRestore();
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
