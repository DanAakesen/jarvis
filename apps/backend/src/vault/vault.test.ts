import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryStore, VaultIndexStore, VaultIndexedChunk, VaultSearchHit } from '../database/memory-store.js';
import type { MemoryEmbedder } from '../core/memory-embeddings.js';
import { createGitHubVaultClient, VAULT_BRANCH, VAULT_REPOSITORY } from './github-client.js';
import { createVaultModule } from './index.js';

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
  private readonly indexed = new Map<string, { blobSha: string; chunks: VaultIndexedChunk[] }>();
  vectorSearch = vi.fn(async (_embedding: readonly number[], limit: number) =>
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
  async files() {
    return [...this.indexed.entries()].map(([path, file]) => ({ path, blobSha: file.blobSha }));
  }
  async replaceFile(path: string, blobSha: string, chunks: readonly VaultIndexedChunk[]) {
    this.indexed.set(path, { blobSha, chunks: [...chunks] });
  }
  async deleteFiles(paths: readonly string[]) {
    for (const path of paths) this.indexed.delete(path);
  }
  searchByVector(embedding: readonly number[], limit: number) {
    return this.vectorSearch(embedding, limit);
  }
  searchByTerms(terms: readonly string[], limit: number) {
    return this.termSearch(terms, limit);
  }
  entry(path: string) { return this.indexed.get(path); }
  setRankedHits(hits: readonly VaultSearchHit[]) {
    this.vectorSearch.mockImplementation(async (_embedding, limit) => [...hits].slice(0, limit));
  }
}

function moduleFor(options: {
  readonly remote?: Record<string, RemoteFile>;
  readonly index?: FakeIndexStore;
  readonly source?: string;
  readonly embedder?: MemoryEmbedder;
  readonly conflicts?: number;
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
  const module = createVaultModule({ client, indexStore, memoryStore, ...(options.embedder ? { embedder: options.embedder } : {}) });
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
    expect(module.tools.map(({ name }) => name)).toEqual(['vault_search', 'vault_read', 'vault_write']);
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
    expect(index.vectorSearch).toHaveBeenCalledWith([0.5], 2);
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
});
