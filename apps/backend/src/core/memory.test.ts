import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type {
  MemoryActionSource,
  MemoryRecord,
  MemorySaveInput,
  MemoryStore,
  MemoryVersion,
} from '../database/memory-store.js';
import { createMemoryModule, isExplicitMemoryRequest } from './memory.js';
import { createToolRegistry, ToolRefusal } from './tool-registry.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const ownerToken = 'owner.memory.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function record(
  input: Pick<MemorySaveInput, 'category' | 'key' | 'content' | 'source'>,
  id = '1',
  revision = 1,
): MemoryRecord {
  const sourceMessageId = input.source.kind === 'conversation' ? input.source.messageId : null;
  return {
    id,
    category: input.category,
    key: input.key,
    content: input.content,
    sourceMessageId,
    settingsAction: input.source.kind === 'settings'
      ? { requestId: input.source.requestId, ownerObjectId: input.source.ownerObjectId }
      : null,
    sourceText: sourceMessageId ? 'Dan source message' : '',
    sourceTextTruncated: false,
    revision,
    updatedAt: new Date('2026-11-20T04:00:00.000Z'),
  };
}

function memoryStore(sourceMessages = new Map<string, string>(), vectorSearch = false): {
  readonly store: MemoryStore;
  readonly records: Map<string, MemoryRecord>;
  readonly writes: MemorySaveInput[];
  readonly forgetSources: MemoryActionSource[];
} {
  const records = new Map<string, MemoryRecord>();
  const writes: MemorySaveInput[] = [];
  const forgetSources: MemoryActionSource[] = [];
  let nextId = 1;
  const store: MemoryStore = {
    async initialize() {},
    supportsVectorSearch: () => vectorSearch,
    async getSourceMessage(messageId) {
      const text = sourceMessages.get(messageId);
      return text === undefined ? null : { messageId, text };
    },
    async save(input) {
      writes.push(input);
      const existing = [...records.values()].find((item) =>
        item.category === input.category && item.key === input.key);
      const sameSource = input.source.kind === 'conversation'
        ? existing?.sourceMessageId === input.source.messageId && existing.settingsAction === null
        : existing?.sourceMessageId === null &&
          existing.settingsAction?.requestId === input.source.requestId &&
          existing.settingsAction.ownerObjectId === input.source.ownerObjectId;
      if (existing && existing.content === input.content && sameSource) {
        return { memory: existing, created: false, changed: false };
      }
      const created = !existing;
      const memory = record(input, existing?.id ?? String(nextId++), (existing?.revision ?? 0) + 1);
      records.set(memory.id, memory);
      return { memory, created, changed: true };
    },
    async correct(memoryId, input) {
      writes.push(input);
      const existing = records.get(memoryId);
      if (!existing) throw new Error('Missing memory');
      const memory = record(input, memoryId, existing.revision + 1);
      records.set(memory.id, memory);
      return { memory, created: false, changed: existing.content !== input.content };
    },
    async list(limit) {
      const values = [...records.values()].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      return { memories: values.slice(0, limit), hasMore: values.length > limit };
    },
    async history(memoryId, limit): Promise<MemoryVersion[]> {
      const current = records.get(memoryId);
      return current ? [{ ...current, changedAt: current.updatedAt }].slice(0, limit) : [];
    },
    async forget(memoryId, source) {
      forgetSources.push(source);
      const current = records.get(memoryId);
      records.delete(memoryId);
      return current ? { category: current.category, key: current.key } : null;
    },
    async searchByVector() { return []; },
    async embeddingsToBackfill() { return []; },
    async updateEmbedding() { return false; },
    async searchByFullText(terms, limit) {
      const memories = [...records.values()].filter((item) =>
        terms.some((term) => `${item.key} ${item.content}`.toLowerCase().includes(term)));
      return { method: 'substring', memories: memories.slice(0, limit) };
    },
  };
  return { store, records, writes, forgetSources };
}

function ownerRequest(messageId: string): FastifyRequest {
  return {
    headers: { 'x-jarvis-message-id': messageId },
    principal: { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' },
    agentPrincipal: null,
    log: { info() {}, warn() {} },
  } as unknown as FastifyRequest;
}

function tool(module: ReturnType<typeof createMemoryModule>, name: string) {
  const found = module.tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

describe('Personal Memory', () => {
  it('recognises natural English and Danish remember requests, but not recall questions', () => {
    for (const text of [
      'Remember that I prefer afternoon appointments.',
      'Please remember this',
      'Don’t forget that my trainer is Alex.',
      'Keep this in mind for later.',
      'Husk at jeg foretrækker morgenaftaler.',
      'Glem ikke at jeg arbejder hjemme fredag.',
    ]) expect(isExplicitMemoryRequest(text)).toBe(true);
    expect(isExplicitMemoryRequest('Do you remember which appointment I chose?')).toBe(false);
  });

  it('registers every supported memory tool in the normal catalogue', () => {
    const fixture = memoryStore();
    const module = createMemoryModule({ store: fixture.store });
    const catalogue = createToolRegistry([module]);
    expect(catalogue.list().map(({ name }) => name)).toEqual([
      'memory_remember',
      'memory_search',
      'memory_list',
      'memory_history',
      'memory_correct',
      'memory_forget',
    ]);
  });

  it('lets an explicit remember request write while automatic capture is off and attributes the stored Dan message', async () => {
    const automatic = vi.fn(async () => false);
    const fixture = memoryStore(new Map([['42', 'Remember that I prefer afternoon appointments.']]));
    const module = createMemoryModule({ store: fixture.store, automaticCapture: automatic });
    const result = await tool(module, 'memory_remember').execute({
      category: 'preference',
      key: 'appointments.time',
      content: 'Prefers afternoon appointments.',
      sourceIntent: 'automatic',
    }, ownerRequest('42'), AbortSignal.timeout(1_000));

    expect(result).toMatchObject({ id: '1', changed: true });
    expect(fixture.writes[0]).toMatchObject({ source: { kind: 'conversation', messageId: '42' } });
    expect(automatic).not.toHaveBeenCalled();
  });

  it('automatically captures one clearly stated fact without creating duplicate identities', async () => {
    const fixture = memoryStore(new Map([['42', 'I prefer afternoon appointments.']]));
    const module = createMemoryModule({
      store: fixture.store,
      automaticCapture: async () => true,
    });
    const input = {
      category: 'preference',
      key: 'appointments.time',
      content: 'I prefer afternoon appointments.',
      sourceIntent: 'automatic',
    };
    await tool(module, 'memory_remember').execute(input, ownerRequest('42'), AbortSignal.timeout(1_000));
    const second = await tool(module, 'memory_remember').execute(input, ownerRequest('42'), AbortSignal.timeout(1_000));
    expect(fixture.records.size).toBe(1);
    expect(second).toMatchObject({ changed: false, revision: 1 });
  });

  it('enforces the capture switch and keeps secrets and automatic sensitive details out', async () => {
    const disabled = memoryStore(new Map([['42', 'I prefer afternoon appointments.']]));
    const disabledModule = createMemoryModule({
      store: disabled.store,
      automaticCapture: async () => false,
    });
    await expect(tool(disabledModule, 'memory_remember').execute({
      category: 'preference', key: 'appointments.time', content: 'Prefers afternoon appointments.',
    }, ownerRequest('42'), AbortSignal.timeout(1_000))).rejects.toBeInstanceOf(ToolRefusal);

    const automatic = memoryStore(new Map([
      ['43', 'My diagnosis is private.'],
      ['44', 'Remember this password: violet-thunder.'],
    ]));
    const automaticModule = createMemoryModule({
      store: automatic.store,
      automaticCapture: async () => true,
    });
    await expect(tool(automaticModule, 'memory_remember').execute({
      category: 'preference', key: 'health.diagnosis', content: 'The diagnosis is private.',
    }, ownerRequest('43'), AbortSignal.timeout(1_000))).rejects.toThrow(/Sensitive/u);
    await expect(tool(automaticModule, 'memory_remember').execute({
      category: 'preference', key: 'login', content: 'violet-thunder',
    }, ownerRequest('44'), AbortSignal.timeout(1_000))).rejects.toThrow(/Secrets/u);
    expect(automatic.records.size).toBe(0);
  });

  it('checks category, key, source and content for secrets before embedding remember or correct', async () => {
    const embed = vi.fn(async () => Array.from({ length: 1536 }, () => 0));
    const fixture = memoryStore(new Map([
      ['42', 'Remember this harmless fact.'],
      ['43', 'Correct that harmless fact.'],
    ]), true);
    fixture.records.set('1', record({
      category: 'preference',
      key: 'password',
      content: 'Existing content.',
      source: { kind: 'conversation', messageId: '42' },
    }));
    const module = createMemoryModule({
      store: fixture.store,
      automaticCapture: async () => true,
      embedder: { model: 'fixture-embedding', embed },
    });

    await expect(tool(module, 'memory_remember').execute({
      category: 'preference',
      key: 'password',
      content: 'An innocuous value.',
      sourceIntent: 'requested',
    }, ownerRequest('42'), AbortSignal.timeout(1_000))).rejects.toThrow(/Secrets/u);
    await expect(tool(module, 'memory_correct').execute({
      memoryId: '1',
      content: 'Another innocuous value.',
    }, ownerRequest('43'), AbortSignal.timeout(1_000))).rejects.toThrow(/Secrets/u);
    expect(embed).not.toHaveBeenCalled();
    expect(fixture.writes).toEqual([]);
  });

  it('corrects the same identity and keeps revision history behind the new source', async () => {
    const fixture = memoryStore(new Map([
      ['42', 'Remember that I prefer afternoons.'],
      ['43', 'I changed that; I prefer mornings.'],
    ]));
    fixture.records.set('1', record({
      category: 'preference',
      key: 'appointments.time',
      content: 'Prefers afternoon appointments.',
      source: { kind: 'conversation', messageId: '42' },
    }));
    const module = createMemoryModule({
      store: fixture.store,
      automaticCapture: async () => true,
    });
    const result = await tool(module, 'memory_correct').execute({
      memoryId: '1',
      content: 'Prefers morning appointments.',
    }, ownerRequest('43'), AbortSignal.timeout(1_000));

    expect(result).toMatchObject({ id: '1', key: 'appointments.time', revision: 2 });
    expect(fixture.records.get('1')).toMatchObject({
      key: 'appointments.time',
      content: 'Prefers morning appointments.',
      sourceMessageId: '43',
    });
  });
});

describe('Personal Memory API', () => {
  it('serves only SQL Personal Memory, independent of Vault, with owner-only fresh pagination', async () => {
    const fixture = memoryStore(new Map([['42', 'Remember this preference.']]));
    fixture.records.set('1', record({
      category: 'preference',
      key: 'appointments.time',
      content: 'Prefers afternoon appointments.',
      source: { kind: 'conversation', messageId: '42' },
    }));
    fixture.records.set('2', record({
      category: 'project_fact',
      key: 'jarvis.database',
      content: 'Jarvis uses Azure SQL.',
      source: { kind: 'conversation', messageId: '42' },
    }, '2'));
    const module = createMemoryModule({ store: fixture.store });
    const app = buildApp(config, undefined, {
      modules: [module],
      auth: async (token) => {
        if (token !== ownerToken) throw new Error('rejected');
        return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' };
      },
    });
    apps.push(app);

    const response = await app.inject({
      url: '/memory?folder=General&limit=1&offset=0',
      headers: { authorization: bearer(ownerToken) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      count: 1,
      limit: 1,
      offset: 0,
      hasMore: true,
      items: [{ type: 'memory' }],
    });
    expect(response.json().items.every((item: { type: string }) => item.type !== 'vault_note')).toBe(true);
    expect((await app.inject({
      url: '/memory/vault_dGVzdA',
      headers: { authorization: bearer(ownerToken) },
    })).statusCode).toBe(400);
    fixture.records.set('3', record({
      category: 'preference',
      key: 'password',
      content: 'Legacy key that policy must refuse.',
      source: { kind: 'conversation', messageId: '42' },
    }, '3'));
    const blocked = await app.inject({
      method: 'PATCH',
      url: '/memory/3',
      headers: { authorization: bearer(ownerToken) },
      payload: { text: 'An innocuous replacement.' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(fixture.writes).toEqual([]);
    const corrected = await app.inject({
      method: 'PATCH',
      url: '/memory/1',
      headers: { authorization: bearer(ownerToken) },
      payload: { text: 'Prefers morning appointments.' },
    });
    expect(corrected.statusCode).toBe(200);
    const correction = corrected.json();
    expect(correction.item).toMatchObject({
      id: '1',
      type: 'memory',
      source: {
        type: 'settings',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    });
    expect(fixture.writes.at(-1)?.source).toMatchObject({
      kind: 'settings',
      requestId: correction.item.source.requestId,
      ownerObjectId: config.auth.ownerObjectId,
    });
    const detail = await app.inject({
      url: '/memory/1',
      headers: { authorization: bearer(ownerToken) },
    });
    expect(detail.json()).toMatchObject({
      id: '1',
      content: 'Prefers morning appointments.',
      category: 'preference',
      source: { type: 'settings', requestId: correction.item.source.requestId },
    });
    const forgotten = await app.inject({
      method: 'DELETE',
      url: '/memory/1',
      headers: { authorization: bearer(ownerToken) },
    });
    expect(forgotten.statusCode).toBe(204);
    expect(fixture.forgetSources.at(-1)).toMatchObject({
      kind: 'settings',
      ownerObjectId: config.auth.ownerObjectId,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(fixture.forgetSources.at(-1)?.kind === 'settings'
      ? fixture.forgetSources.at(-1)?.requestId
      : '').not.toBe(correction.item.source.requestId);
    expect(fixture.records.has('1')).toBe(false);
    expect((await app.inject({ url: '/memory?folder=General' })).statusCode).toBe(401);
  });
});
