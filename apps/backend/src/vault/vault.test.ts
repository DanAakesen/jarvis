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
import { createVaultModule, isVaultLineSafe } from './index.js';
import { buildApp } from '../app.js';
import { coreModule } from '../core/index.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { OwnerInteractionService } from '../core/owner-interactions.js';
import { WorkspaceCommandBroker } from '../core/workspace-commands.js';
import type { Settings } from '../core/settings.js';
import type { WorkspaceCommand } from '@jarvis/contracts';

const sha = (character: string) => character.repeat(40);
const signal = () => new AbortController().signal;

describe('vault line safety', () => {
  it('applies credential, secret, and sensitive-data patterns to one line only', () => {
    expect(isVaultLineSafe('Review the synthetic release checklist')).toBe(true);
    expect(isVaultLineSafe('Store the password in the note')).toBe(false);
    expect(isVaultLineSafe('Add api-key: abcdefgh1234')).toBe(false);
    expect(isVaultLineSafe('Call the bank')).toBe(false);
  });
});

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
  let writeCount = 0;
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

      it('uses the configured default top-k for vault search', async () => {
        const remote = { 'Work/project.md': { sha: sha('a'), content: '# Project\n\nProject detail.' } };
        const index = new FakeIndexStore(true);
        const { module } = moduleFor({
          remote,
          index,
          embedder: { embed: vi.fn(async () => [0.5]) },
          memorySettings: { searchTopK: 2 },
        });
        await module.synchronize(signal());

        const result = await tool(module, 'vault_search').execute(
          { query: 'project detail' }, {} as FastifyRequest, signal(),
        ) as { results: unknown[] };
        await tool(module, 'vault_search').execute(
          { query: 'project detail', k: 5 }, {} as FastifyRequest, signal(),
        );

        expect(index.vectorSearch).toHaveBeenCalledTimes(2);
        expect(index.vectorSearch).toHaveBeenNthCalledWith(1, [0.5], 'text-embedding-3-small', 2);
        expect(index.vectorSearch).toHaveBeenNthCalledWith(2, [0.5], 'text-embedding-3-small', 2);
        expect(result.results).toHaveLength(1);
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

      it('refuses automatic captures when disabled but permits Dan-requested vault writes', async () => {
        const remote = {
          'AGENTS.md': { sha: sha('a'), content: '# Routing\nPeople/ Work/ Personal/ General/' },
          '.github/agent-state/routing.md': {
            sha: sha('b'), content: 'Route notes to People/, Work/, Personal/ or General/.',
          },
        };
        const { github, module } = moduleFor({
          remote,
          memorySettings: { automaticCapture: false },
        });
        const write = tool(module, 'vault_write');
        const input = {
          path: 'General/decision.md',
          content: 'Dan requested this note.',
          reason: 'requested by Dan',
        };

        await expect(write.execute({ ...input, automaticCapture: true }, request, signal()))
          .rejects.toThrow('Automatic memory capture is turned off');
        expect(github.calls.some(({ method }) => method === 'PUT')).toBe(false);

        await expect(write.execute({ ...input, automaticCapture: false }, request, signal()))
          .resolves.toMatchObject({ path: 'General/decision.md' });
        expect(github.calls.some(({ method }) => method === 'PUT')).toBe(true);
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
    const nextSha = writeCount === 0 ? sha('f') : sha('1');
    writeCount += 1;
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
  readonly memorySettings?: Partial<Settings['memory']>;
  readonly log?: NonNullable<Parameters<typeof createVaultModule>[0]['log']>;
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
  const settingsStore = options.memorySettings ? {
    read: async () => Object.fromEntries(Object.entries({
      similarityThreshold: 'memory.similarity_threshold',
      searchTopK: 'memory.search_top_k',
      graphTextSimilarityThreshold: 'memory.graph_text_similarity_threshold',
      automaticCapture: 'memory.automatic_capture',
    }).flatMap(([property, key]) => {
      const value = options.memorySettings?.[property as keyof Settings['memory']];
      return value === undefined ? [] : [[key, JSON.stringify(value)]];
    })),
    write: async () => {},
  } : undefined;
  const module = createVaultModule({
    client,
    indexStore,
    memoryStore,
    ...(options.apiMemoryStore ? { apiMemoryStore: options.apiMemoryStore } : {}),
    ...(options.embedder ? { embedder: options.embedder } : {}),
    ...(settingsStore ? { settingsStore } : {}),
    ...(options.log ? { log: options.log } : {}),
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
  options: { auth?: TokenVerifier; ownerInteractions?: OwnerInteractionService } = {},
) {
  const app = buildApp(apiConfig, undefined, {
    modules: [module],
    auth: options.auth ?? (async () => ({
      objectId: apiConfig.auth.ownerObjectId,
      tenantId: apiConfig.auth.tenantId,
      displayName: 'Dan',
    })),
    ...(options.ownerInteractions ? { ownerInteractions: options.ownerInteractions } : {}),
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
      'vault_search', 'show_knowledge', 'vault_read', 'vault_write', 'vault_delete',
    ]);
  });

  it('returns bounded, redacted vault tasks through the sensitive read-only tasks kind of vault_search', async () => {
    const { github, module } = moduleFor({
      remote: {
        'Personal/Inbox.md': {
          sha: sha('a'),
          content: '# Home\n- [ ] Buy a mirror 🔺 📅 2031-04-09 14:00\n- [ ] Password: hunter2\n- [x] Finished',
        },
      },
    });
    const result = await tool(module, 'vault_search').execute(
      { kind: 'tasks', query: 'mirror', state: 'open' }, {} as FastifyRequest, signal(),
    ) as { items: Array<Record<string, unknown>>; total: number; truncated: boolean };
    expect(result).toMatchObject({
      total: 1,
      truncated: false,
      items: [{
        text: 'Buy a mirror', done: false, dueDate: '2031-04-09', dueTime: '14:00',
        priority: 'high', path: 'Personal/Inbox.md', line: 2, heading: 'Home',
      }],
    });
    expect(tool(module, 'vault_search').sensitive).toBe(true);
    expect(github.calls.every(({ method }) => method === 'GET')).toBe(true);
    expect(github.calls.some(({ url }) => url.includes('/git/trees/'))).toBe(true);

    const bounded = moduleFor({ remote: { 'Personal/Inbox.md': {
      sha: sha('b'),
      content: Array.from({ length: 41 }, (_, index) => `- [ ] Synthetic tool item ${index}`).join('\n'),
    } } });
    const boundedResult = await tool(bounded.module, 'vault_search').execute(
      { kind: 'tasks' }, {} as FastifyRequest, signal(),
    ) as { items: unknown[]; total: number; truncated: boolean };
    expect(boundedResult).toMatchObject({ total: 41, truncated: true });
    expect(boundedResult.items).toHaveLength(40);
    expect(bounded.github.calls.every(({ method }) => method === 'GET')).toBe(true);
  });

  it('keeps notes and tasks apart inside vault_search and refuses mixed or malformed arguments', async () => {
    const { github, module } = moduleFor({
      remote: { 'Personal/Inbox.md': { sha: sha('a'), content: '- [ ] Buy a mirror' } },
    });
    const search = tool(module, 'vault_search');
    const schema = search.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(['dueWindowDays', 'k', 'kind', 'query', 'state']);
    for (const combinator of ['oneOf', 'anyOf', 'allOf', 'not']) expect(schema).not.toHaveProperty(combinator);
    expect(search.description).toContain('Tasks are not notes');

    const refused: Array<[unknown, string]> = [
      [{ kind: 'task', query: 'mirror' }, 'kind must be notes or tasks'],
      [{ kind: 'notes' }, 'query or result count is invalid'],
      [{ kind: 'notes', query: 'mirror', state: 'open' }, 'query or result count is invalid'],
      [{ kind: 'notes', query: 'mirror', dueWindowDays: 7 }, 'query or result count is invalid'],
      [{ kind: 'tasks', k: 3 }, 'task filters are invalid'],
      [{ kind: 'tasks', query: ' ' }, 'task filters are invalid'],
      [{ kind: 'tasks', query: 'x'.repeat(201) }, 'task filters are invalid'],
      [{ kind: 'tasks', state: 'archived' }, 'task filters are invalid'],
      [{ kind: 'tasks', dueWindowDays: 366 }, 'task filters are invalid'],
    ];
    for (const [input, message] of refused) {
      await expect(search.execute(input, {} as FastifyRequest, signal()), JSON.stringify(input))
        .rejects.toThrow(message);
    }
    expect(github.calls).toHaveLength(0);
  });

  it('serves owner-only vault tasks with no-store, filters, and a visible truncation marker', async () => {
    const { github, module } = moduleFor({
      remote: {
        'Personal/Inbox.md': {
          sha: sha('a'),
          content: '# Home\n- [ ] Buy a mirror 🔺 📅 2031-04-09 14:00\n- [x] Finished task\n- [ ] Password: hunter2',
        },
        'Work/Projects.md': { sha: sha('b'), content: '- [ ] Plan a garden' },
        'General/Notes.md': { sha: sha('c'), content: '- [ ] Not in the task scope' },
      },
    });
    const app = memoryApiApp(module);
    const response = await app.inject({ url: '/vault/tasks', headers: apiAuthorization });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      total: 3,
      truncated: false,
      items: [
        { text: 'Buy a mirror', priority: 'high', path: 'Personal/Inbox.md', line: 2, heading: 'Home' },
        { text: '[redacted]', done: false },
        { text: 'Plan a garden', path: 'Work/Projects.md' },
      ],
    });
    expect((await app.inject({
      url: '/vault/tasks?q=mirror', headers: apiAuthorization,
    })).json()).toMatchObject({ total: 1, items: [{ text: 'Buy a mirror' }] });
    expect((await app.inject({
      url: '/vault/tasks?state=done', headers: apiAuthorization,
    })).json()).toMatchObject({ total: 1, items: [{ text: 'Finished task', done: true }] });
    expect((await app.inject({ url: '/vault/tasks?state=invalid', headers: apiAuthorization })).statusCode).toBe(400);
    expect((await app.inject({ url: '/vault/tasks' })).statusCode).toBe(401);
    const nonOwner = memoryApiApp(module, { auth: async () => ({
      objectId: 'not-dan', tenantId: apiConfig.auth.tenantId, displayName: 'Other',
    }) });
    expect((await nonOwner.inject({ url: '/vault/tasks', headers: apiAuthorization })).statusCode).toBe(403);
    expect(github.calls.every(({ method }) => method === 'GET')).toBe(true);

    const many = moduleFor({
      remote: { 'Personal/Inbox.md': {
        sha: sha('d'),
        content: Array.from({ length: 501 }, (_, index) => `- [ ] Synthetic task ${index}`).join('\n'),
      } },
    });
    const truncated = await memoryApiApp(many.module).inject({ url: '/vault/tasks', headers: apiAuthorization });
    expect(truncated.statusCode).toBe(200);
    expect(truncated.json()).toMatchObject({ total: 501, truncated: true });
    expect(truncated.json().items).toHaveLength(500);
  });

  it('ticks and unticks one task line, keeping line endings and refusing stale or out-of-scope requests', async () => {
    const path = 'Personal/Inbox.md';
    const { github, module } = moduleFor({
      remote: {
        [path]: { sha: sha('a'), content: '# Home\r\n- [ ] Buy a mirror 📅 2031-04-09\r\n- [x] Finished task\r\n' },
        'General/Notes.md': { sha: sha('b'), content: '- [ ] Not in the task scope' },
      },
    });
    const app = memoryApiApp(module);
    const patch = (payload: object) => app.inject({
      method: 'PATCH', url: '/vault/tasks', headers: apiAuthorization, payload,
    });

    const ticked = await patch({ path, line: 2, text: 'Buy a mirror', done: true });
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json()).toMatchObject({ path, line: 2, done: true, commit: sha('f') });
    expect(github.files.get(path)?.content)
      .toBe('# Home\r\n- [x] Buy a mirror 📅 2031-04-09\r\n- [x] Finished task\r\n');
    const writes = github.calls.filter(({ method }) => method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ sha: sha('a'), message: expect.stringContaining('jarvis: complete a task') });

    const again = await patch({ path, line: 2, text: 'Buy a mirror', done: true });
    expect(again.json()).toMatchObject({ done: true, commit: null });
    expect(github.calls.filter(({ method }) => method === 'PUT')).toHaveLength(1);

    const reopened = await patch({ path, line: 3, text: 'Finished task', done: false });
    expect(reopened.statusCode).toBe(200);
    expect(github.files.get(path)?.content)
      .toBe('# Home\r\n- [x] Buy a mirror 📅 2031-04-09\r\n- [ ] Finished task\r\n');

    expect((await patch({ path, line: 2, text: 'Something else', done: false })).statusCode).toBe(409);
    expect((await patch({ path, line: 1, text: 'Home', done: true })).statusCode).toBe(409);
    expect((await patch({ path: 'Personal/Missing.md', line: 1, text: 'x', done: true })).statusCode).toBe(409);
    expect((await patch({ path: 'General/Notes.md', line: 1, text: 'Not in the task scope', done: true })).statusCode)
      .toBe(400);
    expect((await patch({ path: '.github/tasks.md', line: 1, text: 'x', done: true })).statusCode).toBe(400);
    expect((await patch({ path, line: 0, text: 'x', done: true })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/vault/tasks', payload: {} })).statusCode).toBe(401);
    const nonOwner = memoryApiApp(module, { auth: async () => ({
      objectId: 'not-dan', tenantId: apiConfig.auth.tenantId, displayName: 'Other',
    }) });
    expect((await nonOwner.inject({
      method: 'PATCH', url: '/vault/tasks', headers: apiAuthorization,
      payload: { path, line: 2, text: 'Buy a mirror', done: false },
    })).statusCode).toBe(403);
  });

  it('refuses a tick when the note changes under it', async () => {
    const path = 'Work/Projects.md';
    const { module } = moduleFor({
      remote: { [path]: { sha: sha('a'), content: '- [ ] Plan a garden' } },
      conflicts: 1,
    });
    const response = await memoryApiApp(module).inject({
      method: 'PATCH', url: '/vault/tasks', headers: apiAuthorization,
      payload: { path, line: 1, text: 'Plan a garden', done: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: expect.stringContaining('changed') });
  });

  it('adds a task to the Personal or Work Inbox, creating it when missing', async () => {
    const { github, module } = moduleFor({
      remote: { 'Work/Inbox.md': { sha: sha('a'), content: '# Inbox\n\n- [ ] Existing task' } },
    });
    const app = memoryApiApp(module);
    const post = (payload: object) => app.inject({
      method: 'POST', url: '/vault/tasks', headers: apiAuthorization, payload,
    });

    const work = await post({ text: '  Call the bank 📅  about the ✅ loan ', scope: 'work', due: '2031-04-09' });
    expect(work.statusCode).toBe(200);
    expect(work.json()).toMatchObject({ path: 'Work/Inbox.md', line: 4, done: false, commit: sha('f') });
    expect(github.files.get('Work/Inbox.md')?.content)
      .toBe('# Inbox\n\n- [ ] Existing task\n- [ ] Call the bank about the loan 📅 2031-04-09\n');

    const personal = await post({ text: 'Book a haircut', scope: 'personal' });
    expect(personal.statusCode).toBe(200);
    expect(personal.json()).toMatchObject({ path: 'Personal/Inbox.md', line: 3, done: false });
    expect(github.files.get('Personal/Inbox.md')?.content).toBe('# Inbox\n\n- [ ] Book a haircut\n');
    expect(github.calls.filter(({ method }) => method === 'PUT').map(({ body }) => body?.message))
      .toEqual(['jarvis: add a task\n\nCo-authored-by: Jarvis', 'jarvis: add a task\n\nCo-authored-by: Jarvis']);

    const timed = await post({ text: 'Send the report', scope: 'work', due: '2031-04-10', time: '09:30' });
    expect(timed.statusCode).toBe(200);
    expect(github.files.get('Work/Inbox.md')?.content).toMatch(/- \[ \] Send the report 📅 2031-04-10 09:30\n$/u);
    const listed = await app.inject({ url: '/vault/tasks', headers: apiAuthorization });
    expect(listed.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Book a haircut', path: 'Personal/Inbox.md', line: 3, id: personal.json().id }),
      expect.objectContaining({ text: 'Send the report', dueDate: '2031-04-10', dueTime: '09:30' }),
    ]));
  });

  it('refuses unsafe, empty or invalid new tasks without writing', async () => {
    const { github, module } = moduleFor({
      remote: {
        'Work/Inbox.md': { sha: sha('a'), content: '# Inbox\n\n```\n- [ ] open fence' },
      },
    });
    const app = memoryApiApp(module);
    const post = (payload: object) => app.inject({
      method: 'POST', url: '/vault/tasks', headers: apiAuthorization, payload,
    });
    expect((await post({ text: 'password: hunter2hunter2', scope: 'personal' })).statusCode).toBe(400);
    expect((await post({ text: ' 📅 ', scope: 'personal' })).statusCode).toBe(400);
    expect((await post({ text: 'Fine text', scope: 'work' })).statusCode).toBe(400);
    expect((await post({ text: 'Fine text', scope: 'other' })).statusCode).toBe(400);
    expect((await post({ text: 'Fine text', scope: 'personal', due: 'tomorrow' })).statusCode).toBe(400);
    expect((await post({ text: 'Fine text', scope: 'personal', time: '09:30' })).statusCode).toBe(400);
    expect((await post({ text: 'Fine text', scope: 'personal', due: '2031-04-10', time: '25:00' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/vault/tasks', payload: {} })).statusCode).toBe(401);
    const nonOwner = memoryApiApp(module, { auth: async () => ({
      objectId: 'not-dan', tenantId: apiConfig.auth.tenantId, displayName: 'Other',
    }) });
    expect((await nonOwner.inject({
      method: 'POST', url: '/vault/tasks', headers: apiAuthorization, payload: { text: 'Fine text', scope: 'personal' },
    })).statusCode).toBe(403);
    expect(github.calls.some(({ method }) => method === 'PUT')).toBe(false);
  });

  it('maps task source failures to stable 503 reasons', async () => {
    const assertReason = async (module: ReturnType<typeof createVaultModule>, reason: string) => {
      const response = await memoryApiApp(module).inject({ url: '/vault/tasks', headers: apiAuthorization });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ reason, error: expect.any(String) });
    };

    await assertReason(moduleFor({ remote: {} }).module, 'todo_file_missing');
    await assertReason(moduleFor({ remote: {
      'task.md': { sha: sha('a'), content: '- [ ] Synthetic one' },
      'tasks.md': { sha: sha('b'), content: '- [ ] Synthetic two' },
    } }).module, 'todo_file_ambiguous');

    const limited = Object.fromEntries(Array.from({ length: 257 }, (_, index) =>
      [`Personal/Note${index}.md`, { sha: sha(String(index % 16)), content: '- [ ] Synthetic' }]));
    await assertReason(moduleFor({ remote: limited }).module, 'scan_limit');
    await assertReason(moduleFor({ remote: {
      'Personal/Large.md': { sha: sha('c'), content: '- [ ] '.concat('x'.repeat(256 * 1024)) },
    } }).module, 'too_large');

    const tokenFailure = moduleFor({ remote: { 'Personal/Inbox.md': { sha: sha('d'), content: '- [ ] Synthetic' } } });
    tokenFailure.tokenIssuer.issueForContentsWrite.mockRejectedValueOnce(new Error('synthetic token failure'));
    await assertReason(tokenFailure.module, 'token_failed');
    const appMissing = moduleFor({ remote: { 'Personal/Inbox.md': { sha: sha('e'), content: '- [ ] Synthetic' } } });
    appMissing.tokenIssuer.issueForContentsWrite.mockRejectedValueOnce({ status: 404 });
    await assertReason(appMissing.module, 'app_not_installed');

    const timedOut = moduleFor({ remote: { 'Personal/Inbox.md': { sha: sha('f'), content: '- [ ] Synthetic' } } });
    timedOut.github.fetcher.mockRejectedValueOnce(Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' }));
    await assertReason(timedOut.module, 'timeout');
    const readFailed = moduleFor({ remote: { 'Personal/Inbox.md': { sha: sha('1'), content: '- [ ] Synthetic' } } });
    readFailed.github.fetcher.mockRejectedValueOnce(new Error('synthetic read failure'));
    await assertReason(readFailed.module, 'read_failed');

    const disconnected = createVaultModule({
      client: null as unknown as ReturnType<typeof createGitHubVaultClient>,
      indexStore: new FakeIndexStore(),
      memoryStore: { getSourceMessage: async () => null },
    });
    await assertReason(disconnected, 'not_connected');
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

  it('marks only graph notes with open in-scope tasks and matches the task panel total', async () => {
    const remote = {
      'Personal/Inbox.md': {
        sha: sha('a'),
        content: '# Inbox\n- [ ] Synthetic open task\n- [x] Synthetic completed task',
      },
      'Personal/Done.md': { sha: sha('b'), content: '- [x] Completed only' },
      'Personal/Quiet.md': { sha: sha('c'), content: '# Quiet' },
      'Work/Project.md': { sha: sha('d'), content: '- [ ] Work task' },
      'Work/Archive/Old.md': { sha: sha('e'), content: '- [ ] Archived task' },
      'General/Outside.md': { sha: sha('f'), content: '- [ ] Out-of-scope task' },
      'Tasks.md': { sha: sha('1'), content: '- [ ] Dashboard task' },
    };
    const { module } = moduleFor({ remote });
    await module.synchronize(signal());
    const app = memoryApiApp(module);

    const tasks = await app.inject({ url: '/vault/tasks', headers: apiAuthorization });
    const response = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });

    expect(tasks.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    const graph = response.json();
    expect(graph.openTaskNoteCount).toBe(3);
    expect(graph.taskCountsPartial).toBe(false);
    expect(graph.nodes.filter((node: { openTaskCount: number }) => node.openTaskCount > 0)
      .map((node: { path: string }) => node.path).sort()).toEqual([
      'Personal/Inbox.md', 'Tasks.md', 'Work/Project.md',
    ]);
    expect(graph.nodes.find((node: { path: string }) => node.path === 'Personal/Inbox.md').openTaskCount).toBe(1);
    expect(graph.nodes.find((node: { path: string }) => node.path === 'Personal/Done.md').openTaskCount).toBe(0);
    expect(graph.nodes.find((node: { path: string }) => node.path === 'Work/Archive/Old.md').openTaskCount).toBe(0);
    expect(graph.nodes.find((node: { path: string }) => node.path === 'General/Outside.md').openTaskCount).toBe(0);
    expect(graph.nodes.reduce((total: number, node: { openTaskCount: number }) => total + node.openTaskCount, 0))
      .toBe(tasks.json().total);
    expect(JSON.stringify(graph)).not.toContain('Synthetic open task');
  });

  it('keeps the graph available and marks task counts partial when the shared task-file cap is exceeded', async () => {
    const remote = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `Personal/Note${index}.md`,
      { sha: sha('a'), content: '- [ ] Synthetic task' },
    ]));
    const { module } = moduleFor({ remote });
    await module.synchronize(signal());
    const app = memoryApiApp(module);

    const response = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ taskCountsPartial: true });
    expect(response.json().openTaskNoteCount).toBeUndefined();
    expect(response.json().nodes[0].openTaskCount).toBeUndefined();
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
  it('includes every indexed Markdown directory in the graph and folder counts', async () => {
    const remote = Object.fromEntries([
      'Work/Fixture.md', 'General/skills-overview.md', 'Personal/Templates/Fixture.md',
      'Work/skills/references/Fixture.md', 'General/tools/Skills/Fixture.md',
      'Work/Fixture.template.md', 'Personal/Fixture.TEMPLATE.MD',
    ].map((path) => [path, { sha: sha('a'), content: '# Fixture\n\nFixture body.' }]));
    const index = new FakeIndexStore();
    const { module } = moduleFor({ remote, index, apiMemoryStore: {} as MemoryStore });
    await module.synchronize(signal());
    // The skipped GitHub metadata tree stays excluded even if stale rows exist.
    for (const path of ['skills/Fixture.md', '.github/Fixture.md']) {
      await index.replaceFile(path, sha('b'), [{ heading: 'Fixture', content: 'Fixture body.' }], []);
    }
    const app = memoryApiApp(module);
    const graph = (await app.inject({ url: '/knowledge/graph', headers: apiAuthorization })).json();
    expect(graph.nodes.map((node: { path: string }) => node.path).sort()).toEqual([
      'General/skills-overview.md', 'General/tools/Skills/Fixture.md',
      'Personal/Fixture.TEMPLATE.MD', 'Personal/Templates/Fixture.md',
      'Work/Fixture.md', 'Work/Fixture.template.md', 'Work/skills/references/Fixture.md',
      'skills/Fixture.md',
    ]);
    expect((await app.inject({ url: '/memory/status', headers: apiAuthorization })).json().notesByFolder)
      .toEqual({ '': 0, People: 0, Work: 3, Personal: 2, General: 2, skills: 1 });
    expect(await index.files('text-embedding-3-small')).toHaveLength(9);
    index.termSearch.mockResolvedValue([{
      path: 'Work/skills/references/Fixture.md', heading: 'Fixture', content: 'Fixture body.',
    }]);
    const search = await tool(module, 'vault_search').execute(
      { query: 'fixture' }, {} as FastifyRequest, signal(),
    ) as { results: Array<{ path: string }> };
    expect(search.results.map(({ path }) => path)).toContain('Work/skills/references/Fixture.md');
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
  it('applies the configured vault similarity threshold to graph edges', async () => {
    const remote = {
      'General/First.md': { sha: sha('a'), content: '# First\n\nNote one.' },
      'General/Second.md': { sha: sha('b'), content: '# Second\n\nNote two.' },
    };
    const index = new FakeIndexStore(true);
    const { module } = moduleFor({
      remote,
      index,
      memorySettings: { similarityThreshold: 0.6 },
    });
    await module.synchronize(signal());
    const graphData = vi.spyOn(index, 'graphData').mockResolvedValue({
      links: [],
      similarities: [{
        sourcePath: 'General/First.md',
        targetPath: 'General/Second.md',
        score: 0.55,
      }],
      embeddings: [],
      contents: [],
    });
    const app = memoryApiApp(module);

    const graph = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });

    expect(graph.statusCode).toBe(200);
    expect(graphData).toHaveBeenCalledWith(
      ['General/First.md', 'General/Second.md'],
      'text-embedding-3-small',
      expect.any(AbortSignal),
      0.6,
    );
    expect(graph.json().edges).toEqual([]);
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

  it('lists, reads, creates and edits owner notes, then refreshes the index', async () => {
    const log = vi.fn();
    const { github, indexStore, module } = moduleFor({
      remote: {
        'AGENTS.md': { sha: sha('a'), content: '# Routing\nPeople Work Personal General' },
        '.github/agent-state/routing.md': {
          sha: sha('b'), content: 'Route notes to People/, Work/, Personal/ and General/.',
        },
        'People/Alex.md': { sha: sha('c'), content: '# Alex\n\nProject engineer.' },
        'General/Old.md': { sha: sha('d'), content: '# Old\n\nArchived note.' },
        'General/Long-title.md': { sha: sha('e'), content: `# ${'L'.repeat(250)}\n\nDistinctive body.` },
      },
      log,
    });
    await module.synchronize(signal());
    const app = memoryApiApp(module);

    const firstPage = await app.inject({ url: '/notes?limit=1', headers: apiAuthorization });
    expect(firstPage.json()).toMatchObject({ limit: 1, offset: 0, hasMore: true });
    expect(firstPage.json().notes).toHaveLength(1);
    const list = await app.inject({
      url: '/notes?query=engineer&folder=People&limit=1', headers: apiAuthorization,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      notes: [{
        path: 'People/Alex.md', title: 'Alex', folder: 'People', directory: 'People',
        updatedAt: '2026-10-07T12:00:00.000Z',
      }],
      limit: 1, offset: 0, hasMore: false,
    });
    const longTitleList = await app.inject({
      url: '/notes?query=distinctive&limit=100', headers: apiAuthorization,
    });
    expect(longTitleList.statusCode).toBe(200);
    expect(longTitleList.json().notes).toEqual([
      expect.objectContaining({ path: 'General/Long-title.md', title: 'L'.repeat(200) }),
    ]);
    const detail = await app.inject({
      url: '/notes/note?path=People%2FAlex.md', headers: apiAuthorization,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual({
      path: 'People/Alex.md',
      content: '# Alex\n\nProject engineer.',
      sha: sha('c'),
      url: `https://github.com/${VAULT_REPOSITORY}/blob/${VAULT_BRANCH}/People/Alex.md`,
    });
    expect((await app.inject({
      url: '/notes/note?path=General%2Fmissing.md', headers: apiAuthorization,
    })).statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: apiAuthorization,
      payload: { path: 'General/New-note.md', content: '# New note\n\nFresh phrase.' },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      path: 'General/New-note.md',
      commit: sha('f'),
      url: `https://github.com/${VAULT_REPOSITORY}/commit/${sha('f')}`,
    });
    expect(github.calls.find(({ method }) => method === 'PUT')?.body).toMatchObject({
      message: 'jarvis: edited in Notes',
      branch: VAULT_BRANCH,
    });
    const existing = await app.inject({
      method: 'POST', url: '/notes', headers: apiAuthorization,
      payload: { path: 'General/New-note.md', content: '# Duplicate' },
    });
    expect(existing.statusCode).toBe(409);
    expect(existing.json()).toMatchObject({ currentSha: sha('f'), content: '# New note\n\nFresh phrase.' });
    expect(github.calls.filter(({ method }) => method === 'PUT')).toHaveLength(1);

    await module.synchronize(signal());
    expect(indexStore.entry('General/New-note.md')).toBeDefined();
    const search = await app.inject({ url: '/knowledge/search?q=fresh+phrase', headers: apiAuthorization });
    expect(search.statusCode).toBe(200);
    expect(search.json().hits).toHaveLength(1);
    expect((await app.inject({ url: '/knowledge/graph', headers: apiAuthorization })).json().nodes)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'General/New-note.md', title: 'New note' })]));

    const saved = await app.inject({
      method: 'PUT',
      url: '/notes/note',
      headers: apiAuthorization,
      payload: {
        path: 'General/New-note.md',
        content: '# New note\n\nRevised phrase.\n',
        sha: sha('f'),
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(github.files.get('General/New-note.md')?.content).toBe('# New note\n\nRevised phrase.\n');
    expect(github.calls.filter(({ method }) => method === 'PUT')[1]?.body).toMatchObject({
      sha: sha('f'),
      message: 'jarvis: edited in Notes',
      branch: VAULT_BRANCH,
    });
    await module.synchronize(signal());
    expect(indexStore.entry('General/New-note.md')?.chunks[0]?.content).toBe('Revised phrase.');
    expect((await app.inject({
      url: '/knowledge/search?q=revised+phrase', headers: apiAuthorization,
    })).json().hits).toHaveLength(1);
    expect(log.mock.calls.filter(([event]) => event === 'vault.write').map(([, fields]) => fields))
      .toEqual([
        { outcome: 'ok', folder: 'General' },
        { outcome: 'error', folder: 'General' },
        { outcome: 'ok', folder: 'General' },
      ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('Revised phrase');
    expect(JSON.stringify(log.mock.calls)).not.toContain('Fresh phrase');
    expect(JSON.stringify(log.mock.calls)).not.toContain('General/New-note.md');
  });

  it('covers root, arbitrary top-level and deep notes with the cached full-vault tree', async () => {
    const remote = {
      'README.md': { sha: sha('a'), content: '# Root note\n\nRoot inventory.' },
      'Customers/Client.md': { sha: sha('b'), content: '# Client\n\nCustomer record.' },
      'Meetings/2026/Planning/Quarterly.md': { sha: sha('c'), content: '# Quarterly\n\nMeeting record.' },
      '_agent-log/trace.md': { sha: sha('d'), content: '# Trace\n\nAgent record.' },
      'People/Alex.md': { sha: sha('e'), content: '# Alex\n\nPerson record.' },
      'Work/Project.md': { sha: sha('f'), content: '# Project\n\nWork record.' },
      'Personal/Notes.md': { sha: sha('1'), content: '# Personal\n\nPersonal record.' },
      'General/Notes.md': { sha: sha('2'), content: '# General\n\nGeneral record.' },
      '.git/ignored.md': { sha: sha('3'), content: '# Git internals' },
      '.github/workflows/ignored.md': { sha: sha('4'), content: '# Workflow metadata' },
      '.obsidian/ignored.md': { sha: sha('5'), content: '# Obsidian metadata' },
      '.codex/ignored.md': { sha: sha('6'), content: '# Codex metadata' },
      '.vscode/ignored.md': { sha: sha('7'), content: '# VS Code metadata' },
      'Attachments/Receipts/scan.pdf': { sha: sha('8'), content: 'binary' },
    };
    const { indexStore, module } = moduleFor({ remote });
    await module.synchronize(signal());
    const app = memoryApiApp(module);

    const tree = await app.inject({ url: '/notes/tree', headers: apiAuthorization });
    expect(tree.statusCode).toBe(200);
    expect(tree.json()).toMatchObject({
      directories: [
        'Attachments', 'Attachments/Receipts', 'Customers', 'General', 'Meetings', 'Meetings/2026',
        'Meetings/2026/Planning', 'People', 'Personal', 'Work', '_agent-log',
      ],
      rootNoteCount: 1,
      truncated: false,
    });
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ folder: 'Customers' })}`, headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({
      path: 'Customers/Client.md', folder: 'Customers', directory: 'Customers',
    })]);
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ directory: 'Meetings/2026/Planning' })}`,
      headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({
      path: 'Meetings/2026/Planning/Quarterly.md', folder: 'Meetings', directory: 'Meetings/2026/Planning',
    })]);
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ folder: '', directory: '' })}`,
      headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({
      path: 'README.md', folder: '', directory: '',
    })]);
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ query: 'inventory' })}`, headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({ path: 'README.md', folder: '', directory: '' })]);
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ query: 'record', folder: 'Customers' })}`, headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({
      path: 'Customers/Client.md', folder: 'Customers', directory: 'Customers',
    })]);
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ directory: 'Customers' })}`, headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({
      path: 'Customers/Client.md', folder: 'Customers', directory: 'Customers',
    })]);
    expect((await app.inject({
      url: `/notes?${new URLSearchParams({ directory: '' })}`, headers: apiAuthorization,
    })).json().notes).toEqual([expect.objectContaining({ path: 'README.md', folder: '', directory: '' })]);

    const createdNotes = [
      { path: 'new-root.md', term: 'rootunique' },
      { path: 'Invoices/Invoice.md', term: 'invoiceunique' },
      { path: 'Records/2026/Q4/Invoice.md', term: 'deepunique' },
    ];
    for (const { path, term } of createdNotes) {
      const created = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: apiAuthorization,
        payload: { path, content: `# ${term}\n\n${term} first.` },
      });
      expect(created.statusCode).toBe(200);
      const loaded = await app.inject({
        url: `/notes/note?path=${encodeURIComponent(path)}`,
        headers: apiAuthorization,
      });
      expect(loaded.statusCode).toBe(200);
      const stale = await app.inject({
        method: 'PUT',
        url: '/notes/note',
        headers: apiAuthorization,
        payload: { path, content: 'Stale replacement.', sha: sha('0') },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ currentSha: created.json().commit, content: `# ${term}\n\n${term} first.` });
      const saved = await app.inject({
        method: 'PUT',
        url: '/notes/note',
        headers: apiAuthorization,
        payload: { path, content: `# ${term}\n\n${term} revised.`, sha: loaded.json().sha },
      });
      expect(saved.statusCode).toBe(200);
    }

    await vi.waitFor(() => {
      for (const { path } of createdNotes) expect(indexStore.entry(path)).toBeDefined();
    });
    await module.synchronize(signal());
    for (const { path, term } of createdNotes) {
      const listing = await app.inject({
        url: `/notes?${new URLSearchParams({ directory: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' })}`,
        headers: apiAuthorization,
      });
      expect(listing.json().notes).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
      const search = await app.inject({
        url: `/knowledge/search?q=${encodeURIComponent(term)}`,
        headers: apiAuthorization,
      });
      expect(search.json().hits).toEqual(expect.arrayContaining([
        expect.objectContaining({ nodeId: createHash('sha256').update(path).digest('hex') }),
      ]));
      const graph = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
      expect(graph.json().nodes).toEqual(expect.arrayContaining([expect.objectContaining({
        path,
        folder: path.includes('/') ? path.split('/')[0] : '',
        directory: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
      })]));
    }
    const rootSearch = await app.inject({
      url: '/knowledge/search?q=inventory', headers: apiAuthorization,
    });
    expect(rootSearch.json().hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: createHash('sha256').update('README.md').digest('hex') }),
    ]));
    const otherFolderSearch = await app.inject({
      url: '/knowledge/search?q=record', headers: apiAuthorization,
    });
    expect(otherFolderSearch.json().hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: createHash('sha256').update('Customers/Client.md').digest('hex') }),
    ]));
    const graphNodes = (await app.inject({ url: '/knowledge/graph', headers: apiAuthorization })).json().nodes;
    expect(graphNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'README.md', folder: '', directory: '' }),
      expect.objectContaining({ path: 'Customers/Client.md', folder: 'Customers', directory: 'Customers' }),
    ]));
    expect((await app.inject({ url: '/notes/tree', headers: apiAuthorization })).json()).toMatchObject({
      directories: expect.arrayContaining(['Invoices', 'Records', 'Records/2026', 'Records/2026/Q4']),
      rootNoteCount: 2,
    });
    for (const path of [
      '.git/ignored.md', '.github/workflows/ignored.md', '.obsidian/ignored.md',
      '.codex/ignored.md', '.vscode/ignored.md',
    ]) {
      expect(indexStore.entry(path)).toBeUndefined();
    }
    const forbidden = memoryApiApp(module, {
      auth: async () => ({
        objectId: 'not-dan', tenantId: apiConfig.auth.tenantId, displayName: 'Other',
      }),
    });
    expect((await forbidden.inject({ url: '/notes/tree', headers: apiAuthorization })).statusCode).toBe(403);
  });

  it('restricts note routes to the owner and rejects unsafe note writes', async () => {
    const { github, module } = moduleFor({
      remote: {
        'AGENTS.md': { sha: sha('a'), content: '# Routing\nGeneral' },
        '.github/agent-state/routing.md': { sha: sha('b'), content: 'Route notes to General/.' },
        'General/decision.md': { sha: sha('c'), content: '# Decision\n\nCurrent.' },
      },
    });
    await module.synchronize(signal());
    const app = memoryApiApp(module);
    const forbidden = memoryApiApp(module, {
      auth: async () => ({
        objectId: 'not-dan', tenantId: apiConfig.auth.tenantId, displayName: 'Other',
      }),
    });
    expect((await forbidden.inject({ url: '/notes', headers: apiAuthorization })).statusCode).toBe(403);
    expect((await forbidden.inject({
      url: '/notes/note?path=General%2Fdecision.md', headers: apiAuthorization,
    })).statusCode).toBe(403);
    expect((await forbidden.inject({
      method: 'POST', url: '/notes', headers: apiAuthorization,
      payload: { path: 'General/new.md', content: 'Note.' },
    })).statusCode).toBe(403);
    expect((await forbidden.inject({
      method: 'PUT', url: '/notes/note', headers: apiAuthorization,
      payload: { path: 'General/decision.md', content: 'Changed.', sha: sha('c') },
    })).statusCode).toBe(403);

    expect((await app.inject({
      url: '/notes/note?path=General%2Fimage.png', headers: apiAuthorization,
    })).statusCode).toBe(400);
    expect((await app.inject({
      url: '/notes/note?path=People%2FAlex.md', headers: apiAuthorization,
    })).statusCode).toBe(404);
    const dotDirectory = await app.inject({
      method: 'POST', url: '/notes', headers: apiAuthorization,
      payload: { path: '.github/workflows/new.md', content: '# Workflow' },
    });
    expect(dotDirectory.statusCode).toBe(400);
    for (const path of [
      '../root.md', '/absolute.md', 'C:/absolute.md', 'Customers//empty.md',
      'Customers\\nested.md', 'Customers/readme.txt', 'Customers/../root.md',
      'Customers/file?.md', 'Customers/file#.md', 'Customers/file%.md',
    ]) {
      const unsafe = await app.inject({
        method: 'POST', url: '/notes', headers: apiAuthorization,
        payload: { path, content: '# Unsafe' },
      });
      expect(unsafe.statusCode, path).toBe(400);
    }
    const tooLarge = await app.inject({
      method: 'POST', url: '/notes', headers: apiAuthorization,
      payload: { path: 'General/large.md', content: 'é'.repeat(131_073) },
    });
    expect(tooLarge.statusCode).toBe(400);
    const secret = await app.inject({
      method: 'POST', url: '/notes', headers: apiAuthorization,
      payload: { path: 'General/secret.md', content: 'password: example-value' },
    });
    expect(secret.statusCode).toBe(400);
    const binaryText = await app.inject({
      method: 'POST', url: '/notes', headers: apiAuthorization,
      payload: { path: 'General/binary.md', content: 'before\u0000after' },
    });
    expect(binaryText.statusCode).toBe(400);
    expect(github.calls.some(({ method }) => method === 'PUT')).toBe(false);
  });

  it('refuses stale and racing note edits with the latest version and no retry', async () => {
    const path = 'General/decision.md';
    const { github, module } = moduleFor({
      conflicts: 1,
      remote: {
        'AGENTS.md': { sha: sha('a'), content: '# Routing\nGeneral' },
        '.github/agent-state/routing.md': { sha: sha('b'), content: 'Route notes to General/.' },
        [path]: { sha: sha('c'), content: '# Decision\n\nLoaded.' },
      },
    });
    await module.synchronize(signal());
    const app = memoryApiApp(module);
    const loaded = await app.inject({
      url: '/notes/note?path=General%2Fdecision.md', headers: apiAuthorization,
    });
    expect(loaded.statusCode).toBe(200);
    github.set(path, { sha: sha('d'), content: '# Decision\n\nChanged elsewhere.' });

    const stale = await app.inject({
      method: 'PUT', url: '/notes/note', headers: apiAuthorization,
      payload: { path, content: '# Decision\n\nAttempted stale save.', sha: loaded.json().sha },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      currentSha: sha('d'), content: '# Decision\n\nChanged elsewhere.',
    });
    expect(github.calls.filter(({ method }) => method === 'PUT')).toHaveLength(0);

    const latest = await app.inject({
      url: '/notes/note?path=General%2Fdecision.md', headers: apiAuthorization,
    });
    const racing = await app.inject({
      method: 'PUT', url: '/notes/note', headers: apiAuthorization,
      payload: { path, content: '# Decision\n\nAttempted racing save.', sha: latest.json().sha },
    });
    expect(racing.statusCode).toBe(409);
    expect(racing.json()).toMatchObject({
      currentSha: sha('e'), content: 'The note changed concurrently.',
    });
    expect(github.calls.filter(({ method }) => method === 'PUT')).toHaveLength(1);
    expect(github.files.get(path)?.content).toBe('The note changed concurrently.');
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
      automaticCapture: true,
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
      .toHaveLength(0);
  });

  it('deletes a vault note only after Now approval and removes it from the index and graph', async () => {
    const path = 'People/Alex.md';
    const { github, indexStore, module } = moduleFor({
      remote: { [path]: { sha: sha('a'), content: '# Alex\n\nEngineer.' } },
    });
    await module.synchronize(signal());
    let approve: (() => Promise<unknown>) | undefined;
    const runConfirmed = vi.fn((_kind: unknown, _summary: unknown, action: () => Promise<unknown>) =>
      new Promise<unknown>((resolve, reject) => {
        approve = async () => {
          try { resolve(await action()); } catch (error) { reject(error); }
        };
      }));
    const app = memoryApiApp(module, {
      ownerInteractions: { runConfirmed } as unknown as OwnerInteractionService,
    });
    const graphBefore = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
    expect(graphBefore.json().nodes).toHaveLength(1);

    const deleting = tool(module, 'vault_delete').execute(
      { path },
      { ...request, server: app } as FastifyRequest,
      signal(),
    );
    await vi.waitFor(() => expect(runConfirmed).toHaveBeenCalledOnce());
    expect(runConfirmed).toHaveBeenCalledWith(
      'delete',
      `Permanently delete vault note ${path}.`,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(github.calls.some(({ method }) => method === 'DELETE')).toBe(false);

    await approve!();
    await expect(deleting).resolves.toEqual({
      path,
      commit: sha('d'),
      url: `https://github.com/${VAULT_REPOSITORY}/commit/${sha('d')}`,
      confirmation: `Deleted vault note: ${path} — https://github.com/${VAULT_REPOSITORY}/commit/${sha('d')}`,
    });
    expect(github.calls.find(({ method }) => method === 'DELETE')?.body).toEqual({
      message: 'jarvis: forget vault note\n\nCo-authored-by: Jarvis',
      sha: sha('a'),
      branch: VAULT_BRANCH,
    });
    expect(github.files.has(path)).toBe(false);
    expect(indexStore.entry(path)).toBeUndefined();
    const graphAfter = await app.inject({ url: '/knowledge/graph', headers: apiAuthorization });
    expect(graphAfter.json().nodes).toEqual([]);
  });

  it('refuses vault deletion when the note changed during approval', async () => {
    const path = 'General/decision.md';
    const { github, indexStore, module } = moduleFor({
      remote: { [path]: { sha: sha('a'), content: '# Decision\n\nCurrent.' } },
    });
    await module.synchronize(signal());
    const runConfirmed = vi.fn(async (_kind: unknown, _summary: unknown, action: () => Promise<unknown>) => {
      github.set(path, { sha: sha('b'), content: '# Decision\n\nChanged.' });
      return action();
    });
    const toolRequest = {
      ...request,
      server: {
        ownerInteractions: { runConfirmed },
        awayModeStore: null,
      },
    } as unknown as FastifyRequest;

    await expect(tool(module, 'vault_delete').execute({ path }, toolRequest, signal()))
      .rejects.toThrow('changed while approval was pending');
    expect(github.calls.some(({ method }) => method === 'DELETE')).toBe(false);
    expect(indexStore.entry(path)).toBeDefined();
  });

  it('refuses invalid paths and unavailable Now approval before reading a note', async () => {
    const { github, module } = moduleFor();
    const toolRequest = {
      ...request,
      server: { ownerInteractions: null, awayModeStore: null },
    } as unknown as FastifyRequest;

    await expect(tool(module, 'vault_delete').execute({ path: '../General/note.md' }, toolRequest, signal()))
      .rejects.toThrow('Markdown path');
    await expect(tool(module, 'vault_delete').execute({ path: 'General/note.md' }, toolRequest, signal()))
      .rejects.toThrow('Now approval service is unavailable');
    expect(github.calls).toHaveLength(0);
  });

  it('refuses sensitive captures without explicit remember and always refuses actual credentials', async () => {
    const health = moduleFor({ source: 'I was diagnosed with a condition.' });
    await expect(tool(health.module, 'vault_write').execute({
      path: 'Personal/health.md', content: 'Diagnosis: sensitive detail.', reason: 'capture',
      automaticCapture: true,
    }, request, signal())).rejects.toThrow('unless Dan explicitly says “remember”');
    expect(health.github.calls.some(({ method }) => method === 'PUT')).toBe(false);

    const password = moduleFor({ source: 'Remember my password is apple.' });
    await expect(tool(password.module, 'vault_write').execute({
      path: 'Personal/credentials.md', content: 'Password: apple.', reason: 'capture',
      automaticCapture: true,
    }, request, signal())).rejects.toThrow('Secrets and credentials can never be saved');
    expect(password.github.calls.some(({ method }) => method === 'PUT')).toBe(false);

    const credential = moduleFor({ source: 'Remember this API key: abcdefghijklmnopqrstuvwxyz123456.' });
    await expect(tool(credential.module, 'vault_write').execute({
      path: 'Work/configuration.md',
      content: 'API key: abcdefghijklmnopqrstuvwxyz123456.',
      reason: 'remember credential',
      automaticCapture: true,
    }, request, signal())).rejects.toThrow('Secrets and credentials can never be saved');
    expect(credential.github.calls.some(({ method }) => method === 'PUT')).toBe(false);
  });

  it('allows arbitrary safe tool paths while requiring a stored Dan message and rejecting dot paths', async () => {
    const emptySource = moduleFor();
    const noMessage = { ...request, headers: {} } as FastifyRequest;
    await expect(tool(emptySource.module, 'vault_write').execute({
      path: 'Customers/Agent/deep.md', content: 'Fact.', reason: 'capture', automaticCapture: false,
    }, noMessage, signal())).rejects.toThrow('There is no stored Dan message');
    expect(emptySource.memoryStore.getSourceMessage).not.toHaveBeenCalled();
    expect(emptySource.github.calls.some(({ method }) => method === 'PUT')).toBe(false);

    const module = moduleFor();
    await expect(tool(module.module, 'vault_write').execute({
      path: '../General/note.md', content: 'Fact.', reason: 'capture', automaticCapture: true,
    }, request, signal())).rejects.toThrow('Markdown path');
    await expect(tool(module.module, 'vault_write').execute({
      path: '.github/workflows/new.md', content: 'Fact.', reason: 'capture', automaticCapture: true,
    }, request, signal())).rejects.toThrow('dot-directories');
    await expect(tool(module.module, 'vault_write').execute({
      path: 'General/note.md', content: 'x'.repeat(256 * 1024 + 1), reason: 'capture', automaticCapture: true,
    }, request, signal())).rejects.toThrow('vault content is invalid');
    expect(module.github.calls).toHaveLength(0);

    await expect(tool(module.module, 'vault_write').execute({
      path: 'Customers/Agent/deep.md',
      content: 'Fact in an arbitrary nested location.',
      reason: 'capture',
      automaticCapture: false,
    }, request, signal())).resolves.toMatchObject({ path: 'Customers/Agent/deep.md' });
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
      path: 'General/large.md', append: 'More.', reason: 'capture', automaticCapture: true,
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
    const notifications = { runConfirmed } as unknown as OwnerInteractionService;
    const app = memoryApiApp(module, { ownerInteractions: notifications });

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
