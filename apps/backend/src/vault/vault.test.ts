import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  MemoryRecord,
  MemoryStore,
  MemoryVersion,
  VaultGraphData,
  VaultGraphFile,
  VaultIndexStore,
  VaultIndexedChunk,
  VaultSearchHit,
} from '../database/memory-store.js';
import { MemoryEmbeddingHttpError, type MemoryEmbedder } from '../core/memory-embeddings.js';
import { createGitHubVaultClient, VAULT_BRANCH, VAULT_REPOSITORY } from './github-client.js';
import { createVaultModule } from './index.js';
import { buildApp } from '../app.js';
import { coreModule } from '../core/index.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { TeamsNotificationService } from '../teams/service.js';
import { WorkspaceCommandBroker } from '../core/workspace-commands.js';
import type { WorkspaceCommand } from '@jarvis/contracts';

const sha = (character: string) => character.repeat(40);
const signal = () => new AbortController().signal;

interface RemoteFile {
  sha: string;
  content: string;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeGitHub(initial: Record<string, RemoteFile> = {}, conflicts = 0) {
  const files = new Map(Object.entries(initial));
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  let conflictCount = conflicts;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    const parsed = new URL(url);
    const treePath = `/repos/${VAULT_REPOSITORY}/git/trees/${VAULT_BRANCH}`;
    if (parsed.pathname === treePath) {
      return response({
        truncated: false,
        tree: [...files].map(([path, file]) => ({ path, sha: file.sha, type: 'blob', mode: '100644' })),
      });
    }
    if (parsed.pathname === `/repos/${VAULT_REPOSITORY}/commits`) {
      const file = files.get(parsed.searchParams.get('path') ?? '');
      return response(file ? [{
        sha: file.sha,
        commit: { committer: { date: '2026-10-06T12:00:00.000Z' }, message: 'Update note' },
      }] : []);
    }
    const contentPrefix = `/repos/${VAULT_REPOSITORY}/contents/`;
    if (!parsed.pathname.startsWith(contentPrefix)) throw new Error(`Unexpected GitHub request ${url}`);
    const path = decodeURIComponent(parsed.pathname.slice(contentPrefix.length));
    if (method === 'GET') {
      const file = files.get(path);
      if (!file) return response({ message: 'Not Found' }, 404);
      return response({
        type: 'file', path, sha: file.sha, encoding: 'base64',
        content: Buffer.from(file.content).toString('base64'),
      });
    }
    if (method === 'DELETE' && body && typeof body.sha === 'string') {
      if (files.get(path)?.sha !== body.sha) return response({ message: 'Conflict' }, 409);
      files.delete(path);
      return response({ commit: { sha: sha('d') } });
    }
    if (method !== 'PUT' || !body || typeof body.content !== 'string') {
      throw new Error(`Unexpected GitHub request ${url}`);
    }
    const current = files.get(path);
    if (conflictCount > 0) {
      conflictCount -= 1;
      files.set(path, { sha: sha('e'), content: 'The note changed concurrently.' });
      return response({ message: 'Conflict' }, 409);
    }
    if ((current && body.sha !== current.sha) || (!current && body.sha !== undefined)) {
      return response({ message: 'Conflict' }, 409);
    }
    const content = Buffer.from(body.content, 'base64').toString('utf8');
    const nextSha = sha('f');
    files.set(path, { sha: nextSha, content });
    return response({ commit: { sha: nextSha } }, 201);
  });
  return {
    fetcher,
    calls,
    files,
    set(path: string, file: RemoteFile) { files.set(path, file); },
    delete(path: string) { files.delete(path); },
  };
}

class FakeIndexStore implements VaultIndexStore {
  private readonly indexed = new Map<string, {
    blobSha: string;
    chunks: VaultIndexedChunk[];
    links: string[];
  }>();
  vectorSearch = vi.fn(async (_embedding: readonly number[], _model: string, limit: number) =>
    [...this.indexed.entries()].flatMap(([path, file]) => file.chunks.map((chunk) => ({
      path, heading: chunk.heading, content: chunk.content,
    } satisfies VaultSearchHit))).slice(0, limit));
  termSearch = vi.fn(async (terms: readonly string[], limit: number) =>
    [...this.indexed.entries()].flatMap(([path, file]) => file.chunks
      .filter((chunk) => terms.some((term) => `${chunk.heading} ${chunk.content}`.toLowerCase().includes(term)))
      .map((chunk) => ({ path, heading: chunk.heading, content: chunk.content }))).slice(0, limit));

  constructor(private readonly vectors = false) {}
  async initialize() {}
  supportsVectorSearch() { return this.vectors; }
  async files(embeddingModel: string | null) {
    return [...this.indexed.entries()].map(([path, file]) => ({
      path,
      blobSha: file.blobSha,
      embeddingMissing: file.chunks.some((chunk) =>
        chunk.embedding === null || chunk.embeddingModel !== embeddingModel),
    }));
  }
  async replaceFile(path: string, blobSha: string, chunks: readonly VaultIndexedChunk[], links: readonly string[]) {
    this.indexed.set(path, { blobSha, chunks: [...chunks], links: [...links] });
  }
  async deleteFiles(paths: readonly string[]) {
    for (const path of paths) this.indexed.delete(path);
  }
  searchByVector(embedding: readonly number[], model: string, limit: number) {
    return this.vectorSearch(embedding, model, limit);
  }
  searchByTerms(terms: readonly string[], limit: number) {
    return this.termSearch(terms, limit);
  }
  async graphFiles(): Promise<VaultGraphFile[]> {
    return [...this.indexed.entries()].map(([path, file]) => ({
      path,
      title: file.chunks[0]?.heading ?? '',
      updatedAt: new Date('2026-10-07T12:00:00.000Z'),
    }));
  }
  async graphData(paths: readonly string[], model: string): Promise<VaultGraphData> {
    const selected = new Set(paths);
    return {
      links: [...this.indexed.entries()].flatMap(([sourcePath, file]) =>
        selected.has(sourcePath) ? file.links.map((targetPath) => ({ sourcePath, targetPath })) : []),
      similarities: [],
      embeddings: [...this.indexed.entries()].flatMap(([path, file]) =>
        selected.has(path) ? file.chunks.flatMap((chunk) =>
          chunk.embedding && chunk.embeddingModel === model ? [{ path, embedding: chunk.embedding }] : []) : []),
    };
  }
  entry(path: string) { return this.indexed.get(path); }
  setRankedHits(hits: readonly VaultSearchHit[]) {
    this.vectorSearch.mockImplementation(async (_embedding, _model, limit) => [...hits].slice(0, limit));
  }
}

function moduleFor(options: {
  readonly remote?: Record<string, RemoteFile>;
  readonly index?: FakeIndexStore;
  readonly source?: string;
  readonly embedder?: MemoryEmbedder;
  readonly conflicts?: number;
  readonly apiMemoryStore?: MemoryStore;
} = {}) {
  const github = fakeGitHub(options.remote, options.conflicts);
  const indexStore = options.index ?? new FakeIndexStore();
  const tokenIssuer = { issueForContentsWrite: vi.fn(async () => 'installation-token') };
  const client = createGitHubVaultClient({ tokenIssuer, fetcher: github.fetcher });
  const sourceText = options.source ?? 'I prefer TypeScript for this project.';
  const memoryStore = {
    getSourceMessage: vi.fn(async (messageId: string) =>
      messageId === '42' ? { messageId, text: sourceText } : null),
  } as Pick<MemoryStore, 'getSourceMessage'>;
  const module = createVaultModule({
    client,
    indexStore,
    memoryStore,
    ...(options.apiMemoryStore ? { apiMemoryStore: options.apiMemoryStore } : {}),
    ...(options.embedder ? { embedder: options.embedder } : {}),
  });
  return { github, indexStore, module, tokenIssuer, memoryStore };
}

const request = {
  principal: { objectId: 'dan', tenantId: 'tenant', displayName: 'Dan' },
  agentPrincipal: null,
  headers: { 'x-jarvis-message-id': '42' },
} as unknown as FastifyRequest;

function tool(module: ReturnType<typeof createVaultModule>, name: string) {
  const match = module.tools.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing ${name} tool`);
  return match;
}

const apiConfig = { ...loadConfig({}), logLevel: 'silent' as const };
const apiApps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apiApps.splice(0).map((app) => app.close())); });

function apiMemoryStore(): { store: MemoryStore; record: MemoryRecord; version: MemoryVersion } {
  const record: MemoryRecord = {
    id: '17',
    category: 'preference',
    key: 'editor',
    content: 'Dan prefers VS Code.',
    sourceMessageId: '42',
    sourceText: 'I prefer VS Code.',
    sourceTextTruncated: false,
    revision: 2,
    updatedAt: new Date('2026-10-06T12:00:00.000Z'),
  };
  const version: MemoryVersion = { ...record, changedAt: record.updatedAt };
  const store: MemoryStore = {
    initialize: async () => {},
    supportsVectorSearch: () => false,
    getSourceMessage: async () => ({ messageId: '42', text: 'I prefer VS Code.' }),
    save: async () => ({ memory: record, created: false, changed: false }),
    correct: vi.fn(async (_id, input) => ({
      memory: { ...record, ...input, revision: record.revision + 1, updatedAt: new Date() },
      created: false,
      changed: true,
    })),
    list: vi.fn(async (limit) => ({ memories: [record].slice(0, limit), hasMore: false })),
    history: vi.fn(async () => [version]),
    forget: vi.fn(async () => ({ category: record.category, key: record.key })),
    searchByVector: async () => [record],
    searchByFullText: vi.fn(async () => ({ method: 'fulltext', memories: [record] })),
  };
  return { store, record, version };
}

function memoryApiApp(
  module: ReturnType<typeof createVaultModule>,
  options: { auth?: TokenVerifier; teamsNotifications?: TeamsNotificationService } = {},
) {
  const app = buildApp(apiConfig, undefined, {
    modules: [module],
    auth: options.auth ?? (async () => ({
      objectId: apiConfig.auth.ownerObjectId,
      tenantId: apiConfig.auth.tenantId,
      displayName: 'Dan',
    })),
    ...(options.teamsNotifications ? { teamsNotifications: options.teamsNotifications } : {}),
  });
  apiApps.push(app);
  return app;
}

const apiAuthorization = { authorization: `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}` };

describe('GitHub vault', () => {
  it('indexes added and changed Markdown, deletes removed notes, and skips excluded paths and binaries', async () => {
    const github = fakeGitHub({
      'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nEngineer.' },
      'General/old.md': { sha: sha('b'), content: '# Old\n\nStale.' },
      '.obsidian/plugins/config.md': { sha: sha('c'), content: '# Private config' },
      '.github/instructions/notes.instructions.md': { sha: sha('d'), content: '# Instructions' },
      'Work/diagram.png': { sha: sha('e'), content: 'binary-like' },
    });
    const indexStore = new FakeIndexStore();
    const module = moduleFor().module;
    const configured = createVaultModule({
      client: createGitHubVaultClient({
        tokenIssuer: { issueForContentsWrite: async () => 'installation-token' },
        fetcher: github.fetcher,
      }),
      indexStore,
      memoryStore: { getSourceMessage: async () => null },
    });

    await expect(configured.synchronize(signal())).resolves.toEqual({ added: 2, changed: 0, removed: 0 });
    expect(indexStore.entry('People/Alex.md')?.chunks[0]).toMatchObject({
      heading: 'Alex', content: 'Engineer.',
    });
    expect(indexStore.entry('.obsidian/plugins/config.md')).toBeUndefined();
    expect(indexStore.entry('.github/instructions/notes.instructions.md')).toBeUndefined();
    expect(indexStore.entry('Work/diagram.png')).toBeUndefined();

    github.set('People/Alex.md', { sha: sha('f'), content: '# Alex\n\nSenior engineer.' });
    github.delete('General/old.md');
    github.set('General/new.md', { sha: sha('1'), content: '# New\n\nCurrent.' });
    await expect(configured.synchronize(signal())).resolves.toEqual({ added: 1, changed: 1, removed: 1 });
    expect(indexStore.entry('People/Alex.md')?.blobSha).toBe(sha('f'));
    expect(indexStore.entry('General/old.md')).toBeUndefined();
    expect(indexStore.entry('General/new.md')).toBeDefined();
    expect(module.tools.map(({ name }) => name)).toEqual([
      'vault_search', 'show_knowledge', 'vault_read', 'vault_write',
    ]);
  });

  it('returns semantic results in index ranking order with a bounded snippet and source URL', async () => {
    const remote = {
      'Work/project.md': { sha: sha('a'), content: '# Decisions\n\nProject detail.' },
    };
    const index = new FakeIndexStore(true);
    const ranked = [
      { path: 'Work/project.md', heading: 'Decisions', content: 'Most relevant decision.' },
      { path: 'General/notes.md', heading: 'Overview', content: 'Second result.' },
    ];
    index.setRankedHits(ranked);
    const embedder = { embed: vi.fn(async () => [0.5]) };
    const { module } = moduleFor({ remote, index, embedder });
    await module.synchronize(signal());

    const result = await tool(module, 'vault_search').execute(
      { query: 'project decision', k: 2 }, {} as FastifyRequest, signal(),
    ) as { results: Array<Record<string, string>>; count: number };
    expect(embedder.embed).toHaveBeenCalledWith('project decision', expect.any(AbortSignal));
    expect(index.vectorSearch).toHaveBeenCalledWith([0.5], 'text-embedding-3-small', 2);
    expect(result).toMatchObject({
      count: 2,
      results: [
        {
          path: 'Work/project.md', heading: 'Decisions', snippet: 'Most relevant decision.',
          url: 'https://github.com/DanAakesen/vault/blob/master/Work/project.md',
        },
        { path: 'General/notes.md', heading: 'Overview' },
      ],
    });

  });

  it('re-embeds unchanged vault files when the active embedding model changes', async () => {
    const remote = { 'Work/project.md': { sha: sha('a'), content: '# Project\n\nSame stored note.' } };
    const index = new FakeIndexStore(true);
    await index.replaceFile('Work/project.md', sha('a'), [{
      index: 0, heading: 'Project', content: 'Same stored note.', embedding: [1],
      embeddingModel: 'text-embedding-3-small',
    }], []);
    const embedder: MemoryEmbedder = {
      model: 'text-embedding-3-large',
      embed: vi.fn(async () => [0, 1]),
    };
    const { module } = moduleFor({ remote, index, embedder });

    await module.synchronize(signal());

    expect(embedder.embed).toHaveBeenCalledOnce();
    expect(index.entry('Work/project.md')?.chunks[0]).toMatchObject({
      embedding: [0, 1],
      embeddingModel: 'text-embedding-3-large',
    });
  });

  it('backfills missing memory vectors and reports paced vault progress', async () => {
    const index = new FakeIndexStore(true);
    const apiMemoryStore = {
      embeddingsToBackfill: vi.fn()
        .mockResolvedValueOnce([{ id: '7', content: 'Saved preference.', revision: 2 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      updateEmbedding: vi.fn(async () => true),
    } as unknown as MemoryStore;
    const embedder: MemoryEmbedder = {
      model: 'text-embedding-3-large',
      embed: vi.fn(async () => [0, 1]),
    };
    const { module } = moduleFor({
      remote: { 'Work/project.md': { sha: sha('a'), content: '# Project\n\nVault note.' } },
      index, embedder, apiMemoryStore,
    });
    const progress = vi.fn(async () => {});

    await expect(module.reembed(signal(), progress)).resolves.toMatchObject({
      memories: 1,
      memoryPending: false,
      vaultFiles: 1,
      vaultPending: 0,
    });
    expect(apiMemoryStore.updateEmbedding).toHaveBeenCalledWith(
      '7', 2, 'text-embedding-3-large', [0, 1], expect.any(AbortSignal),
    );
    expect(progress).toHaveBeenCalledWith(1, 'Updated 1 memories');
    expect(progress).toHaveBeenCalledWith(2, 'Vault backfill complete');
  });

  it('returns a cached graph with stable note IDs, persisted links, mean-vector neighbours, and degrees', async () => {
    const remote = {
      'People/Alex.md': {
        sha: sha('a'),
        content: '# Alex\n\n[[Work/Project#plan]] and [guide](../General/Guide.md) and ' +
          '[project](https://github.com/DanAakesen/vault/blob/master/Work/Project.md#overview) ' +
          'and [external](https://example.com/not-a-note.md).',
      },
      'Work/Project.md': { sha: sha('b'), content: '# Project\n\nProject notes.' },
      'General/Guide.md': { sha: sha('c'), content: '# Guide\n\nReference.' },
    };
    const index = new FakeIndexStore(true);
    const embedder = {
      embed: vi.fn(async (text: string) => text.includes('Alex') ? [1, 0, 0] :
        text.includes('Project') ? [0.8, 0.6, 0] : [0, 1, 0]),
    };
    const { module } = moduleFor({ remote, index, embedder });
    await module.synchronize(signal());
    const graphFiles = vi.spyOn(index, 'graphFiles');
    const app = memoryApiApp(module);

    const response = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
    expect(response.statusCode).toBe(200);
    const graph = response.json();
    const alex = graph.nodes.find((node: { path: string }) => node.path === 'People/Alex.md');
    const project = graph.nodes.find((node: { path: string }) => node.path === 'Work/Project.md');
    const guide = graph.nodes.find((node: { path: string }) => node.path === 'General/Guide.md');
    expect(alex).toMatchObject({
      id: createHash('sha256').update('People/Alex.md').digest('hex'),
      title: 'Alex',
      folder: 'People',
      updatedAt: '2026-10-07T12:00:00.000Z',
      degree: 4,
    });
    expect(graph.edges).toEqual(expect.arrayContaining([
      { source: alex.id, target: project.id, type: 'link' },
      { source: alex.id, target: guide.id, type: 'link' },
      { source: alex.id, target: project.id, type: 'similar', score: 0.8 },
    ]));
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.length).toBeLessThanOrEqual(8_000);

    const second = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
    expect(second.json()).toEqual(graph);
    expect(graphFiles).toHaveBeenCalledOnce();
    await module.synchronize(signal());
    await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
    expect(graphFiles).toHaveBeenCalledTimes(2);
  });

  it('prefers stored chunk embeddings over precomputed similarities when building graph edges', async () => {
    const remote = {
      'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nEngineer.' },
      'Work/Project.md': { sha: sha('b'), content: '# Project\n\nProject notes.' },
      'General/Other.md': { sha: sha('c'), content: '# Other\n\nOther notes.' },
    };
    const index = new FakeIndexStore(true);
    const { module } = moduleFor({
      remote,
      index,
      embedder: { embed: async (text) => text.includes('Alex') ? [1, 0] : [0.8, 0.6] },
    });
    await module.synchronize(signal());
    vi.spyOn(index, 'graphData').mockResolvedValue({
      links: [],
      similarities: [{
        sourcePath: 'People/Alex.md', targetPath: 'General/Other.md', score: 0.95,
      }],
      embeddings: [
        { path: 'People/Alex.md', embedding: [1, 0] },
        { path: 'Work/Project.md', embedding: [0.8, 0.6] },
        { path: 'General/Other.md', embedding: [0, 1] },
      ],
    });
    const app = memoryApiApp(module);
    const graph = (await app.inject({ url: '/knowledge/graph', headers: apiAuthorization })).json();
    const id = (path: string) => createHash('sha256').update(path).digest('hex');
    expect(graph.edges).toContainEqual({
      source: id('People/Alex.md'), target: id('Work/Project.md'), type: 'similar', score: 0.8,
    });
    expect(graph.edges).not.toContainEqual({
      source: id('People/Alex.md'), target: id('General/Other.md'), type: 'similar', score: 0.95,
    });
  });

  it('resumes indexing existing notes that are missing embeddings and reports embedding usage', async () => {
    const remote = {
      'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nEngineer.' },
    };
    const index = new FakeIndexStore();
    const initial = moduleFor({ remote, index }).module;
    await initial.synchronize(signal());
    expect(index.entry('People/Alex.md')?.chunks[0]?.embedding).toBeNull();

    const logEmbedding = vi.fn();
    const recordFoundryUsage = vi.fn(async () => {});
    const embedder = {
      embedWithUsage: vi.fn(async () => ({ embedding: [1, 0], inputTokens: 12 })),
      embed: vi.fn(async () => [1, 0]),
    };
    const backfillModule = createVaultModule({
      client: createGitHubVaultClient({
        tokenIssuer: { issueForContentsWrite: async () => 'installation-token' },
        fetcher: fakeGitHub(remote).fetcher,
      }),
      indexStore: index,
      memoryStore: { getSourceMessage: async () => null },
      embedder,
      embeddingModel: 'text-embedding-3-small',
      usageStore: { recordFoundryUsage },
      logEmbedding,
    });
    await backfillModule.synchronize(signal());
    expect(embedder.embedWithUsage).toHaveBeenCalledOnce();
    expect(index.entry('People/Alex.md')?.chunks[0]?.embedding).toEqual([1, 0]);
    expect(logEmbedding).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', inputTokens: 12 }));
    expect(recordFoundryUsage).toHaveBeenCalledWith({
      role: 'embeddings',
      model: 'text-embedding-3-small',
      inputTokens: 12,
      outputTokens: 0,
      eventId: expect.any(String),
    });
  });

  it('waits out embedding throttling during indexing instead of storing a null vector', async () => {
    const remote = { 'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nEngineer.' } };
    const index = new FakeIndexStore();
    const embedWithUsage = vi.fn()
      .mockRejectedValueOnce(new MemoryEmbeddingHttpError(429, 0))
      .mockResolvedValueOnce({ embedding: [1, 0] });
    const throttled = createVaultModule({
      client: createGitHubVaultClient({
        tokenIssuer: { issueForContentsWrite: async () => 'installation-token' },
        fetcher: fakeGitHub(remote).fetcher,
      }),
      indexStore: index,
      memoryStore: { getSourceMessage: async () => null },
      embedder: { embedWithUsage, embed: vi.fn() },
    });
    await throttled.synchronize(signal());
    expect(embedWithUsage).toHaveBeenCalledTimes(2);
    expect(index.entry('People/Alex.md')?.chunks[0]?.embedding).toEqual([1, 0]);
  });

  it('reads links from indexed note text when no link rows were stored', async () => {
    const remote = {
      'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nSee [[Project]].' },
      'Work/Project.md': { sha: sha('b'), content: '# Project\n\nProject notes.' },
    };
    const index = new FakeIndexStore(true);
    const { module } = moduleFor({ remote, index });
    await module.synchronize(signal());
    vi.spyOn(index, 'graphData').mockResolvedValue({
      links: [],
      similarities: [],
      embeddings: [],
      contents: [{ path: 'People/Alex.md', content: 'See [[Project]] and [[Missing note]].' }],
    });
    const app = memoryApiApp(module);

    const graph = (await app.inject({ url: '/knowledge/graph', headers: apiAuthorization })).json();
    const id = (path: string) => createHash('sha256').update(path).digest('hex');
    expect(graph.edges).toEqual([{ source: id('People/Alex.md'), target: id('Work/Project.md'), type: 'link' }]);
  });
  it('falls back to text similarity when the database stores no embeddings', async () => {
    const remote = {
      'Work/Azure.md': { sha: sha('a'), content: '# Azure\n\nFoundry agents and hosted runners.' },
      'Work/Foundry.md': { sha: sha('b'), content: '# Foundry\n\nFoundry agents deploy hosted runners.' },
      'Personal/Garden.md': { sha: sha('c'), content: '# Garden\n\nTomatoes and basil.' },
      'Personal/Kitchen.md': { sha: sha('d'), content: '# Kitchen\n\nBasil pesto with tomatoes.' },
    };
    const index = new FakeIndexStore(true);
    const { module } = moduleFor({ remote, index });
    await module.synchronize(signal());
    vi.spyOn(index, 'graphData').mockResolvedValue({
      links: [],
      similarities: [],
      embeddings: [],
      contents: Object.entries(remote).map(([path, note]) => ({ path, content: note.content })),
    });
    const app = memoryApiApp(module);

    const graph = (await app.inject({ url: '/knowledge/graph', headers: apiAuthorization })).json();
    const id = (path: string) => createHash('sha256').update(path).digest('hex');
    const pairs = graph.edges.filter((edge: { type: string }) => edge.type === 'similar')
      .map((edge: { source: string; target: string }) => [edge.source, edge.target].sort().join(':'));
    expect(pairs).toContain([id('Work/Azure.md'), id('Work/Foundry.md')].sort().join(':'));
    expect(pairs).toContain([id('Personal/Garden.md'), id('Personal/Kitchen.md')].sort().join(':'));
    expect(pairs).not.toContain([id('Work/Azure.md'), id('Personal/Garden.md')].sort().join(':'));
  });
  it('bounds the graph to two thousand nodes and eight thousand edges', async () => {
    const index = new FakeIndexStore();
    const { module } = moduleFor({ index });
    await module.synchronize(signal());
    const seedCount = 2_005;
    await Promise.all(Array.from({ length: seedCount }, (_, number) =>
      index.replaceFile(`General/Note-${String(number).padStart(4, '0')}.md`, sha('a'), [
        {
          index: 0, heading: `Note ${number}`, content: 'Bounded node.',
          embedding: [1, 0], embeddingModel: 'text-embedding-3-small',
        },
      ], number < 2_000
        ? [`General/Note-${String((number + 1) % 2_000).padStart(4, '0')}.md`]
        : [], signal())));
    const app = memoryApiApp(module);

    const response = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
    expect(response.statusCode).toBe(200);
    expect(response.json().nodes).toHaveLength(2_000);
    expect(response.json().edges).toHaveLength(8_000);
  });

  it('maps ranked vault search hits to unique graph nodes and enforces Dan-only access', async () => {
    const index = new FakeIndexStore(true);
    index.setRankedHits([
      { path: 'Work/Project.md', heading: 'Project', content: 'Top result.' },
      { path: 'Work/Project.md', heading: 'Details', content: 'Duplicate note result.' },
      { path: 'People/Alex.md', heading: 'Alex', content: 'Second result.' },
      { path: 'General/missing.md', heading: 'Missing', content: 'Not in graph.' },
    ]);
    const { module } = moduleFor({
      index,
      remote: {
        'Work/Project.md': { sha: sha('a'), content: '# Project\n\nProject details.' },
        'People/Alex.md': { sha: sha('b'), content: '# Alex\n\nProject teammate.' },
      },
      embedder: { embed: async () => [1, 0, 0] },
    });
    await module.synchronize(signal());
    const app = memoryApiApp(module);
    const response = await app.inject({ url: '/knowledge/search?q=project', headers: apiAuthorization });
    expect(response.statusCode).toBe(200);
    expect(response.json().hits).toEqual([
      {
        nodeId: createHash('sha256').update('Work/Project.md').digest('hex'),
        score: 1,
        snippet: 'Top result.',
      },
      {
        nodeId: createHash('sha256').update('People/Alex.md').digest('hex'),
        score: 0.75,
        snippet: 'Second result.',
      },
    ]);
    expect((await app.inject({ url: '/knowledge/graph' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/knowledge/search?q=project' })).statusCode).toBe(401);

    const forbidden = memoryApiApp(module, {
      auth: async () => ({ objectId: 'not-dan', tenantId: apiConfig.auth.tenantId, displayName: 'Other' }),
    });
    expect((await forbidden.inject({ url: '/knowledge/graph', headers: apiAuthorization })).statusCode).toBe(403);
    expect((await forbidden.inject({ url: '/knowledge/search?q=project', headers: apiAuthorization })).statusCode).toBe(403);
  });

  it('opens or updates the knowledge graph through the workspace command broker', async () => {
    const { module } = moduleFor({
      remote: { 'General/Project.md': { sha: sha('a'), content: '# Project\n\nProject notes.' } },
    });
    await module.synchronize(signal());
    const broker = new WorkspaceCommandBroker();
    const commands: WorkspaceCommand[] = [];
    const app = buildApp(apiConfig, undefined, {
      modules: [coreModule, module],
      auth: async () => ({
        kind: 'jarvis-agent',
        objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef',
        tenantId: apiConfig.auth.tenantId,
      }),
      toolCallStore: { record: async () => {} },
      workspaceCommands: broker,
    });
    apiApps.push(app);
    const connection = broker.connect(app.ownerObjectId, (event, data) => {
      if (event === 'workspace-command') {
        const command = (data as { command: WorkspaceCommand }).command;
        commands.push(command);
        broker.acknowledge(app.ownerObjectId, connection.sessionId, command.commandId, true);
      }
      return true;
    });
    broker.updateSnapshot(app.ownerObjectId, connection.sessionId, {
      windows: [], contextPanelOpen: false,
    });
    const headers = {
      authorization: ['Bearer', 'header.agent.signature'].join(' '),
      'x-jarvis-message-id': '42',
    };
    const first = await app.inject({ method: 'POST', url: '/tools/show_knowledge', headers, payload: { query: 'project' } });
    expect(first.statusCode, first.body).toBe(200);
    expect(commands[0]).toMatchObject({
      operation: 'create',
      viewId: 'knowledge-graph',
      view: {
        renderer: 'knowledge-graph',
        data: { query: 'project', highlight: [createHash('sha256').update('General/Project.md').digest('hex')] },
      },
    });
    expect(commands[1]).toMatchObject({ operation: 'focus', viewId: 'knowledge-graph' });
    broker.updateSnapshot(app.ownerObjectId, connection.sessionId, {
      windows: [{ viewId: 'knowledge-graph', title: 'Knowledge graph' }],
      contextPanelOpen: false,
    });
    const second = await app.inject({ method: 'POST', url: '/tools/show_knowledge', headers, payload: { query: 'project' } });
    expect(second.statusCode).toBe(200);
    expect(commands[2]?.operation).toBe('update');
    expect(commands[3]).toMatchObject({ operation: 'focus', viewId: 'knowledge-graph' });
    connection.close();
  });

  it('reads bounded root and hidden Markdown instruction paths', async () => {
    const { module } = moduleFor({
      remote: {
        'AGENTS.md': { sha: sha('a'), content: '# Routing\nFollow the vault rules.' },
        '.github/agent-state/routing.md': { sha: sha('b'), content: 'Write durable facts under General/.' },
      },
    });
    const read = tool(module, 'vault_read');
    await expect(read.execute({ path: 'AGENTS.md' }, {} as FastifyRequest, signal()))
      .resolves.toMatchObject({ path: 'AGENTS.md', content: '# Routing\nFollow the vault rules.' });
    await expect(read.execute(
      { path: '.github/agent-state/routing.md' }, {} as FastifyRequest, signal(),
    )).resolves.toMatchObject({ path: '.github/agent-state/routing.md' });
  });

  it('retries one Contents SHA conflict and reports the committed link', async () => {
    const remote = {
      'AGENTS.md': { sha: sha('a'), content: '# Routing\nPeople/ Work/ Personal/ General/' },
      '.github/agent-state/routing.md': { sha: sha('b'), content: 'Route notes to People/, Work/, Personal/ or General/.' },
      '.github/instructions/notes.instructions.md': {
        sha: sha('c'), content: '---\napplyTo: General/**\n---\nUse headings.',
      },
      'General/decision.md': { sha: sha('d'), content: '# Decision\n\nOld.' },
    };
    const { github, module, tokenIssuer } = moduleFor({ remote, conflicts: 1 });
    const result = await tool(module, 'vault_write').execute({
      path: 'General/decision.md',
      content: '# Decision\n\nUse TypeScript.',
      reason: 'capture confirmed decision',
    }, request, signal()) as { path: string; commit: string; confirmation: string };

    const writes = github.calls.filter(({ method }) => method === 'PUT');
    expect(writes).toHaveLength(2);
    expect(writes[0]?.body).toMatchObject({ sha: sha('d'), branch: 'master' });
    expect(writes[1]?.body).toMatchObject({
      sha: sha('e'),
      branch: 'master',
      message: 'jarvis: capture confirmed decision\n\nCo-authored-by: Jarvis',
    });
    expect(Buffer.from(String(writes[1]?.body?.content), 'base64').toString()).toBe('# Decision\n\nUse TypeScript.');
    expect(result).toEqual({
      path: 'General/decision.md',
      commit: sha('f'),
      url: `https://github.com/DanAakesen/vault/commit/${sha('f')}`,
      confirmation: `Saved to vault: General/decision.md — https://github.com/DanAakesen/vault/commit/${sha('f')}`,
    });
    expect(tokenIssuer.issueForContentsWrite).toHaveBeenCalledOnce();
    expect(github.calls.filter(({ url }) => new URL(url).pathname === `/repos/${VAULT_REPOSITORY}/git/trees/${VAULT_BRANCH}`))
      .toHaveLength(1);
  });

  it('refuses sensitive captures without explicit remember and always refuses actual credentials', async () => {
    const health = moduleFor({ source: 'I was diagnosed with a condition.' });
    await expect(tool(health.module, 'vault_write').execute({
      path: 'Personal/health.md', content: 'Diagnosis: sensitive detail.', reason: 'capture',
    }, request, signal())).rejects.toThrow('unless Dan explicitly says “remember”');
    expect(health.github.calls.some(({ method }) => method === 'PUT')).toBe(false);

    const password = moduleFor({ source: 'Remember my password is apple.' });
    await expect(tool(password.module, 'vault_write').execute({
      path: 'Personal/credentials.md', content: 'Password: apple.', reason: 'capture',
    }, request, signal())).rejects.toThrow('Secrets and credentials can never be saved');
    expect(password.github.calls.some(({ method }) => method === 'PUT')).toBe(false);

    const credential = moduleFor({ source: 'Remember this API key: abcdefghijklmnopqrstuvwxyz123456.' });
    await expect(tool(credential.module, 'vault_write').execute({
      path: 'Work/configuration.md',
      content: 'API key: abcdefghijklmnopqrstuvwxyz123456.',
      reason: 'remember credential',
    }, request, signal())).rejects.toThrow('Secrets and credentials can never be saved');
    expect(credential.github.calls.some(({ method }) => method === 'PUT')).toBe(false);
  });

  it('refuses paths outside the vault routing folders and writes larger than 256 KB', async () => {
    const module = moduleFor();
    await expect(tool(module.module, 'vault_write').execute({
      path: '../General/note.md', content: 'Fact.', reason: 'capture',
    }, request, signal())).rejects.toThrow('Markdown path');
    await expect(tool(module.module, 'vault_write').execute({
      path: 'General/note.md', content: 'x'.repeat(256 * 1024 + 1), reason: 'capture',
    }, request, signal())).rejects.toThrow('vault content is invalid');
    expect(module.github.calls).toHaveLength(0);
  });

  it('refuses an append that would make an existing note exceed 256 KB', async () => {
    const { github, module } = moduleFor({
      remote: {
        'AGENTS.md': { sha: sha('a'), content: '# Routing\nPeople/ Work/ Personal/ General/' },
        '.github/agent-state/routing.md': {
          sha: sha('b'), content: 'Route notes to People/, Work/, Personal/ or General/.',
        },
        'General/large.md': { sha: sha('c'), content: 'x'.repeat(256 * 1024) },
      },
    });
    await expect(tool(module, 'vault_write').execute({
      path: 'General/large.md', append: 'More.', reason: 'capture',
    }, request, signal())).rejects.toThrow('limited to 256 KB');
    expect(github.calls.some(({ method }) => method === 'PUT')).toBe(false);
  });

  it('lists memory and vault notes, exposes history/status, and corrects or forgets durable memories', async () => {
    const { store } = apiMemoryStore();
    const { module } = moduleFor({
      apiMemoryStore: store,
      remote: { 'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nEngineer.' } },
    });
    await module.synchronize(signal());
    const app = memoryApiApp(module);

    expect((await app.inject({ url: '/memory' })).statusCode).toBe(401);
    const forbidden = memoryApiApp(module, {
      auth: async () => ({
        objectId: 'not-dan',
        tenantId: apiConfig.auth.tenantId,
        displayName: 'Other',
      }),
    });
    expect((await forbidden.inject({ url: '/memory', headers: apiAuthorization })).statusCode).toBe(403);
    const firstPage = await app.inject({ url: '/memory?limit=1', headers: apiAuthorization });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      items: [{ id: '17', type: 'memory', folder: 'General', title: 'editor', source: { messageId: '42' } }],
      hasMore: true,
    });
    const secondPage = await app.inject({ url: '/memory?offset=1&limit=1', headers: apiAuthorization });
    expect(secondPage.json().items).toMatchObject([{
      type: 'vault_note',
      path: 'People/Alex.md',
      folder: 'People',
      source: { type: 'github', url: 'https://github.com/DanAakesen/vault/blob/master/People/Alex.md' },
    }]);

    const details = await app.inject({ url: '/memory/17', headers: apiAuthorization });
    expect(details.json()).toMatchObject({
      id: '17',
      content: 'Dan prefers VS Code.',
      history: [{ revision: 2, content: 'Dan prefers VS Code.' }],
    });
    const status = await app.inject({ url: '/memory/status', headers: apiAuthorization });
    expect(status.json()).toMatchObject({
      notesByFolder: { People: 1, Work: 0, Personal: 0, General: 0 },
      lastIndexOutcome: { outcome: 'ok', added: 1 },
    });
    expect(status.json().lastVaultSyncAt).toEqual(expect.any(String));

    const corrected = await app.inject({
      method: 'PATCH', url: '/memory/17', headers: apiAuthorization, payload: { text: 'Prefer Cursor and VS Code.' },
    });
    expect(corrected.statusCode).toBe(200);
    expect(store.correct).toHaveBeenCalledWith('17', expect.objectContaining({
      content: 'Prefer Cursor and VS Code.',
      sourceMessageId: '42',
    }), expect.any(AbortSignal));
    const forgotten = await app.inject({ method: 'DELETE', url: '/memory/17', headers: apiAuthorization });
    expect(forgotten.statusCode).toBe(204);
    expect(store.forget).toHaveBeenCalledWith('17', '42', expect.any(AbortSignal));
    expect((await app.inject({
      method: 'PATCH', url: '/memory/17', headers: apiAuthorization,
      payload: { text: 'api_key: abcdefghijklmnopqrstuvwxyz123456' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PATCH', url: '/memory/17', headers: apiAuthorization,
      payload: { text: 'Health diagnosis details.' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'PATCH', url: '/memory/17', headers: apiAuthorization,
      payload: { text: 'x'.repeat(2_001) },
    })).statusCode).toBe(400);
    expect((await app.inject({ url: '/memory?folder=Secrets', headers: apiAuthorization })).statusCode).toBe(400);
  });

  it('uses vector search before the existing full-text fallback for API queries', async () => {
    const { store } = apiMemoryStore();
    store.supportsVectorSearch = () => true;
    const vectorSearch = vi.fn(async () => [] as MemoryRecord[]);
    store.searchByVector = vectorSearch;
    const index = new FakeIndexStore(true);
    index.setRankedHits([{ path: 'People/Alex.md', heading: 'Alex', content: 'Engineer.' }]);
    const embedder = { embed: vi.fn(async () => [0.5]) };
    const { module } = moduleFor({
      apiMemoryStore: store,
      remote: { 'People/Alex.md': { sha: sha('a'), content: '# Alex\n\nEngineer.' } },
      index,
      embedder,
    });
    await module.synchronize(signal());

    const response = await memoryApiApp(module).inject({
      url: '/memory?query=Alex&limit=10',
      headers: apiAuthorization,
    });
    expect(response.statusCode).toBe(200);
    expect(embedder.embed).toHaveBeenCalledWith('Alex', expect.any(AbortSignal));
    expect(vectorSearch).toHaveBeenCalledOnce();
    expect(store.searchByFullText).toHaveBeenCalledOnce();
    expect(index.vectorSearch).toHaveBeenCalledOnce();
    expect(response.json()).toMatchObject({
      method: 'fulltext',
      items: expect.arrayContaining([expect.objectContaining({ type: 'vault_note', path: 'People/Alex.md' })]),
    });
  });

  it('redacts credential-like content from memory detail and history responses', async () => {
    const { store, version } = apiMemoryStore();
    const credentialVersion = { ...version, content: 'password: never-return-this-value' };
    store.history = vi.fn(async () => [credentialVersion]);
    const { module } = moduleFor({ apiMemoryStore: store });

    const response = await memoryApiApp(module).inject({ url: '/memory/17', headers: apiAuthorization });
    expect(response.statusCode).toBe(200);
    expect(response.json().content).toBe('[redacted]');
    expect(response.json().history[0].content).toBe('[redacted]');
    expect(response.body).not.toContain('never-return-this-value');
  });

  it('commits vault corrections and holds vault deletion behind browser approval', async () => {
    const { store } = apiMemoryStore();
    const { github, module } = moduleFor({
      apiMemoryStore: store,
      remote: {
        'AGENTS.md': { sha: sha('a'), content: '# Routing\nPeople/ Work/ Personal/ General/' },
        '.github/agent-state/routing.md': {
          sha: sha('b'), content: 'Route notes to People/, Work/, Personal/ or General/.',
        },
        'People/Alex.md': { sha: sha('c'), content: '# Alex\n\nEngineer.' },
      },
    });
    const path = 'People/Alex.md';
    const id = `vault_${Buffer.from(path, 'utf8').toString('base64url')}`;
    let approve: (() => Promise<unknown>) | undefined;
    const runConfirmed = vi.fn((_kind: unknown, _summary: unknown, action: () => Promise<unknown>) =>
      new Promise<unknown>((resolve, reject) => {
        approve = async () => {
          try { resolve(await action()); } catch (error) { reject(error); }
        };
      }));
    const notifications = { runConfirmed } as unknown as TeamsNotificationService;
    const app = memoryApiApp(module, { teamsNotifications: notifications });

    const correction = await app.inject({
      method: 'PATCH', url: `/memory/${id}`, headers: apiAuthorization,
      payload: { text: '# Alex\n\nSenior engineer.' },
    });
    expect(correction.statusCode).toBe(200);
    expect(correction.json().commitUrl).toBe(`https://github.com/DanAakesen/vault/commit/${sha('f')}`);
    expect(github.calls.find(({ method }) => method === 'PUT')?.body).toMatchObject({
      branch: 'master',
      message: expect.stringContaining('correct memory note'),
    });

    const deletion = await app.inject({ method: 'DELETE', url: `/memory/${id}`, headers: apiAuthorization });
    expect(deletion.statusCode).toBe(202);
    expect(deletion.json()).toEqual({ status: 'approval_pending', message: 'approval pending in Jarvis' });
    expect(runConfirmed).toHaveBeenCalledWith('delete', expect.stringContaining(path), expect.any(Function), expect.any(AbortSignal));
    expect(github.calls.some(({ method }) => method === 'DELETE')).toBe(false);
    const repeated = await app.inject({ method: 'DELETE', url: `/memory/${id}`, headers: apiAuthorization });
    expect(repeated.statusCode).toBe(202);
    expect(runConfirmed).toHaveBeenCalledTimes(1);

    await approve!();
    expect(github.calls.some(({ method }) => method === 'DELETE')).toBe(true);
    expect(github.files.has(path)).toBe(false);
  });
});
