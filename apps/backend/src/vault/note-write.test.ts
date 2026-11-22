import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../core/memory-embeddings.js';
import { isVaultDefaultBranchPush } from '../github/webhook-mapping.js';
import { createGithubWebhookModule } from '../github/webhook.js';
import type { BackendModule } from '../modules.js';
import { createMemoryVault, createVaultIndexFake } from '../pi/conformance/groups/notes-vault.testkit.js';
import { VAULT_BRANCH, VAULT_REPOSITORY } from './github-client.js';
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
const ownerApp = (...modules: BackendModule[]) => buildApp(config, undefined, {
  modules,
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

function legacyFixture(count: number, withEmbedder = false, folder = 'Personal') {
  const vault = createMemoryVault();
  const index = createVaultIndexFake();
  const log = vi.fn();
  const embedding = Array<number>(MEMORY_EMBEDDING_DIMENSIONS).fill(1);
  const embed = vi.fn(async () => embedding);
  const model = 'fixture-model';
  const paths = Array.from({ length: count }, (_, index) => `${folder}/legacy-${String(index + 1).padStart(2, '0')}.md`);
  for (const [i, path] of paths.entries()) {
    const heading = `Saved title ${i + 1}`;
    const content = 'A legacy note body.';
    const embedded = withEmbedder && i < paths.length - 1;
    vault.seed(path, `# ${heading}\n\n${content}`);
    index.seedLegacyFile(path, vault.shaOf(path)!, [{
      index: 0, heading, content, embedding: embedded ? embedding : null, embeddingModel: embedded ? model : null,
    }], new Date(Date.UTC(2026, 10, 22, 0, i)));
  }
  const module = createVaultModule({
    client: vault, indexStore: index, log,
    memoryStore: { getSourceMessage: async () => null },
    ...(withEmbedder ? { embedder: { model, embed } } : {}),
  });
  return { vault, index, log, embed, model, paths, module };
}

describe('legacy vault title backfill', () => {
  it('caps legacy reads in newest-first order and repairs a missing embedding in the same pass', async () => {
    const { vault, index, embed, model, paths, module } = legacyFixture(33, true);
    const pendingPath = paths[0]!;
    const dualMissingPath = paths.at(-1)!;
    const newPath = 'Personal/new-note.md';
    vault.seed(newPath, '# New title');
    const read = vi.spyOn(vault, 'read');
    const app = ownerApp(module);
    try {
      await expect(module.synchronize(signal)).resolves.toMatchObject({ added: 1 });
      expect(read.mock.calls.map(([path]) => path)).toEqual([newPath, ...paths.slice(1).reverse()]);
      expect(embed).toHaveBeenCalledTimes(1);
      const indexed = await index.files(model, signal);
      expect(indexed.filter((file) => file.titleMissing)).toMatchObject([{ path: pendingPath }]);
      expect(indexed.find(({ path }) => path === dualMissingPath))
        .toMatchObject({ titleMissing: false, embeddingMissing: false });
      const page = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(page.statusCode).toBe(200);
      expect(page.json().notes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: newPath, title: 'New title' }),
        expect.objectContaining({ path: pendingPath, title: 'Legacy 01' }),
      ]));

      read.mockClear();
      await module.synchronize(signal);
      expect(read.mock.calls.map(([path]) => path)).toEqual([pendingPath]);
      const refreshed = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(refreshed.json().notes).toContainEqual(expect.objectContaining({ path: pendingPath, title: 'Saved title 1' }));
      expect((await index.files(model, signal)).some((file) => file.titleMissing)).toBe(false);
    } finally { await app.close(); }
  });

  it('fills the requested Work pin on first view only, without applying a mismatched blob title', async () => {
    const { vault, index, paths, module } = legacyFixture(32);
    const pin = 'Work/Events/old-name.md';
    const movedOn = 'Work/Events/another-old-name.md';
    const hidden = 'Work/password.md';
    for (const path of [pin, movedOn, hidden, 'Work/not-requested.md']) {
      vault.seed(path, '---\ntags: [events]\n---\n\n# Changed agenda\n\nThe file name did not change.');
      index.seedLegacyFile(path, vault.shaOf(path)!, [], new Date('2026-11-01T00:00:00Z'));
    }
    await module.synchronize(signal);
    vault.seed(movedOn, '# Newer blob');
    const read = vi.spyOn(vault, 'read');
    const app = ownerApp(module);
    try {
      const request = { method: 'POST' as const, url: '/notes/summaries', headers, payload: {
        paths: [pin, pin, paths[0], movedOn, 'Work/missing.md', hidden, '../bad.md'],
      } };
      const first = await app.inject(request);
      expect(first.statusCode).toBe(200);
      expect(first.json().notes).toMatchObject([
        { path: paths[0], title: 'Saved title 1' },
        { path: movedOn, title: 'Another old name' },
        { path: pin, title: 'Changed agenda' },
      ]);
      expect(read.mock.calls.map(([path]) => path)).toEqual([movedOn, pin]);
      expect((await index.graphFiles(signal, [pin, movedOn])).map(({ title }) => title)).toEqual([null, 'Changed agenda']);
      const folder = await app.inject({ url: '/notes?directory=Work%2FEvents', headers });
      expect(folder.json().notes).toContainEqual(expect.objectContaining({ path: pin, title: 'Changed agenda' }));

      read.mockClear();
      const second = await app.inject(request);
      expect(second.json()).toEqual(first.json());
      expect(read.mock.calls.map(([path]) => path)).toEqual([movedOn]);
    } finally { await app.close(); }
  });

  it('counts a failed read, continues with later notes, and refreshes the graph once after the batch', async () => {
    const { vault, index, log, paths: [oldest, middle, newest], module } = legacyFixture(3, false, 'General');
    const read = vault.read;
    const startNewest = Promise.withResolvers<void>();
    const failNewest = Promise.withResolvers<void>();
    const startOldest = Promise.withResolvers<void>();
    const finishOldest = Promise.withResolvers<void>();
    const readSpy = vi.spyOn(vault, 'read').mockImplementation(async (path, signal) => {
      if (path === newest) {
        startNewest.resolve();
        await failNewest.promise;
        throw new Error('GitHub fixture read failed');
      }
      if (path === oldest) {
        startOldest.resolve();
        await finishOldest.promise;
      }
      return read(path, signal);
    });
    const graphData = vi.spyOn(index, 'graphData');
    const app = ownerApp(module);
    const graph = () => app.inject({ url: '/knowledge/graph', headers });
    const sync = module.synchronize(signal);
    try {
      await startNewest.promise;
      const before = await graph();
      expect(before.statusCode).toBe(200);
      expect(before.json().nodes).toContainEqual(expect.objectContaining({ path: middle, title: 'Legacy 02' }));
      failNewest.resolve();

      // The middle title is already persisted, but the in-flight batch must not invalidate the graph yet.
      await startOldest.promise;
      expect((await index.graphFiles(signal, [middle!]))[0]?.title).toBe('Saved title 2');
      expect((await graph()).json().nodes).toEqual(before.json().nodes);
      expect(graphData).toHaveBeenCalledTimes(1);
      finishOldest.resolve();

      await sync;
      expect(module.syncStatus().outcome).toBe('ok');
      expect(log).toHaveBeenCalledWith('vault.title_backfill', { outcome: 'error', failed: 1 });
      expect((await graph()).json().nodes).toMatchObject([
        { path: oldest, title: 'Saved title 1' },
        { path: middle, title: 'Saved title 2' },
        { path: newest, title: 'Legacy 03' },
      ]);
      await graph();
      expect(graphData).toHaveBeenCalledTimes(2);

      readSpy.mockRestore();
      await module.synchronize(signal);
      expect((await index.graphFiles(signal, [newest!]))[0]?.title).toBe('Saved title 3');
    } finally {
      failNewest.resolve();
      finishOldest.resolve();
      await sync.catch(() => undefined);
      await app.close();
    }
  });

  it('bounds both background and pin title reads even if GitHub is still waiting', async () => {
    const { vault, log, paths, module } = legacyFixture(2);
    const read = vault.read;
    const startedRead = Promise.withResolvers<AbortSignal>();
    const resumeRead = Promise.withResolvers<void>();
    const readSpy = vi.spyOn(vault, 'read').mockImplementationOnce(read).mockImplementationOnce(async (path, readSignal) => {
      startedRead.resolve(readSignal);
      await resumeRead.promise;
      return read(path, readSignal);
    });
    let deadline = new AbortController();
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
        { path: paths[0], title: 'Legacy 01' },
        { path: paths[1], title: 'Saved title 2' },
      ]);

      deadline.abort();
      expect(batchSignal.aborted).toBe(true);
      expect(signal.aborted).toBe(false);
      await expect(sync).resolves.toEqual({ added: 0, changed: 0, removed: 0 });
      expect(module.syncStatus().outcome).toBe('ok');
      expect(log).toHaveBeenCalledWith('vault.title_backfill', { outcome: 'error', failed: 1 });

      deadline = new AbortController();
      const startedPinRead = Promise.withResolvers<AbortSignal>();
      readSpy.mockImplementationOnce(async (path, readSignal) => {
        startedPinRead.resolve(readSignal);
        await resumeRead.promise;
        return read(path, readSignal);
      });
      const request = Promise.resolve(app.inject({ method: 'POST', url: '/notes/summaries', headers, payload: { paths } }));
      const pinSignal = await startedPinRead.promise;
      deadline.abort();
      expect(pinSignal.aborted).toBe(true);
      const pins = await request;
      expect(pins.statusCode).toBe(200);
      expect(pins.json().notes).toMatchObject([{ title: 'Legacy 01' }, { title: 'Saved title 2' }]);
      const graph = await app.inject({ url: '/knowledge/graph', headers });
      expect(graph.statusCode).toBe(200);
      expect(graph.json().nodes).toContainEqual(expect.objectContaining({ path: paths[0], title: 'Legacy 01' }));
      expect(await callTool(module, 'vault_search', { query: 'legacy' })).toMatchObject({ count: 2 });
    } finally {
      resumeRead.resolve();
      await sync.catch(() => undefined);
      timeout.mockRestore();
      await app.close();
    }
  });

  it('coalesces vault push deliveries during title backfill into one fresh-tree sync', async () => {
    const { vault, module } = legacyFixture(1);
    const tree = vi.spyOn(vault, 'tree');
    const read = vault.read;
    const startedRead = Promise.withResolvers<void>();
    const resumeRead = Promise.withResolvers<void>();
    vi.spyOn(vault, 'read').mockImplementationOnce(async (path, signal) => {
      startedRead.resolve();
      await resumeRead.promise;
      return read(path, signal);
    });
    const refreshes: Promise<unknown>[] = [];
    const secret = 'vault-webhook-fixture';
    const webhook = createGithubWebhookModule({
      getSecret: async () => secret,
      deliveryStore: { hasDelivery: async () => false, record: async () => true, recordPullRequest: async () => {} },
      onMapping: async (mapping) => {
        if (isVaultDefaultBranchPush(mapping)) refreshes.push(module.queueSynchronization());
      },
    });
    const app = ownerApp(module, webhook);
    const push = (id: string) => {
      const payload = JSON.stringify({
        repository: { full_name: VAULT_REPOSITORY, pushed_at: '2026-11-22T10:00:00Z' },
        ref: `refs/heads/${VAULT_BRANCH}`, after: id.repeat(40),
      });
      return app.inject({
        method: 'POST', url: '/github/webhooks', payload,
        headers: {
          'content-type': 'application/json', 'x-github-event': 'push', 'x-github-delivery': id,
          'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
        },
      });
    };
    const sync = module.synchronize(signal);
    try {
      await startedRead.promise;
      const first = 'Personal/First push.md';
      const last = 'Personal/Second push.md';
      vault.seed(first, '# First push\n\nA new note.');
      expect((await push('a')).json()).toEqual({ status: 'accepted' });
      vault.seed(last, '# Second push\n\nAnother new note.');
      expect((await push('b')).json()).toEqual({ status: 'accepted' });
      expect(refreshes).toHaveLength(2);
      expect(tree).toHaveBeenCalledTimes(1);

      resumeRead.resolve();
      await expect(sync).resolves.toMatchObject({ added: 0 });
      await expect(Promise.all(refreshes)).resolves.toMatchObject([{ added: 2 }, { added: 2 }]);
      expect(tree).toHaveBeenCalledTimes(2);
      const page = await app.inject({ url: '/notes?directory=Personal', headers });
      expect(page.json().notes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: first }), expect.objectContaining({ path: last }),
      ]));
    } finally {
      resumeRead.resolve();
      await Promise.allSettled([sync, ...refreshes]);
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
