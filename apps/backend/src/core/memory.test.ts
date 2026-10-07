import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryRecord, MemoryStore } from '../database/memory-store.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from './conversation-store.js';
import { coreModule } from './index.js';
import { createMemoryModule } from './memory.js';
import type { MemoryEmbedder } from './memory-embeddings.js';

const config = loadConfig({});
const source = { messageId: '42', text: 'I prefer VS Code for this project.' };
const record: MemoryRecord = {
  id: '501',
  category: 'preference',
  key: 'editor',
  content: 'Dan prefers VS Code for this project.',
  sourceMessageId: source.messageId,
  sourceText: source.text,
  sourceTextTruncated: false,
  revision: 1,
  updatedAt: new Date('2026-10-04T12:00:00Z'),
};
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function memoryStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    initialize: vi.fn(async () => {}),
    supportsVectorSearch: vi.fn(() => false),
    getSourceMessage: vi.fn(async (messageId) => messageId === source.messageId ? source : null),
    save: vi.fn(async () => ({ memory: record, created: true, changed: true })),
    correct: vi.fn(async () => ({ memory: { ...record, revision: 2 }, created: false, changed: true })),
    list: vi.fn(async () => ({ memories: [record], hasMore: false })),
    history: vi.fn(async () => [{ ...record, changedAt: record.updatedAt }]),
    forget: vi.fn(async () => ({ category: record.category, key: record.key })),
    searchByVector: vi.fn(async () => [record]),
    searchByFullText: vi.fn(async () => ({ method: 'fulltext' as const, memories: [record] })),
    ...overrides,
  };
}

function appFor(
  store: MemoryStore,
  options: {
    readonly agent?: boolean;
    readonly embedder?: MemoryEmbedder;
    readonly conversationStore?: Pick<ConversationStore, 'getDanMessageIdBySourceItemId'>;
  } = {},
) {
  const recordCall = vi.fn(async () => {});
  const app = buildApp(config, undefined, {
    modules: [
      coreModule,
      createMemoryModule({
        store,
        ...(options.embedder ? { embedder: options.embedder } : {}),
      }),
    ],
    auth: async () => options.agent
      ? { kind: 'jarvis-agent' as const, objectId: 'a'.repeat(36), tenantId: config.auth.tenantId }
      : { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' },
    toolCallStore: { record: recordCall },
    ...(options.conversationStore
      ? { conversationStore: options.conversationStore as ConversationStore }
      : {}),
  });
  apps.push(app);
  return { app, recordCall };
}

const userHeaders = {
  authorization: ['Bearer', 'test.test.test'].join(' '),
  'x-jarvis-message-id': source.messageId,
};

describe('long-term memory tools', () => {
  it('saves only against a stored Dan source and confirms the category and key', async () => {
    const store = memoryStore();
    const { app, recordCall } = appFor(store);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_remember',
      headers: userHeaders,
      payload: { category: 'preference', key: 'editor', content: record.content },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { id: record.id, category: 'preference', key: 'editor', revision: 1 },
      confirmation: 'Remembered the preference: editor.',
    });
    expect(store.save).toHaveBeenCalledWith({
      category: 'preference',
      key: 'editor',
      content: record.content,
      sourceMessageId: source.messageId,
      embedding: null,
      embeddingModel: null,
    }, expect.any(AbortSignal));
    expect(recordCall).toHaveBeenCalledWith({
      messageId: source.messageId,
      tool: 'memory_remember',
      arguments: {},
      result: { confirmation: 'Memory operation completed.' },
      outcome: 'ok',
    });
  });

  it('refuses missing source evidence and never writes an unsupported fact', async () => {
    const store = memoryStore({
      getSourceMessage: vi.fn(async () => null),
    });
    const { app } = appFor(store);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_remember',
      headers: { ...userHeaders, 'x-jarvis-message-id': '99' },
      payload: { category: 'decision', key: 'deploy_region', content: 'Use the approved region.' },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(response.json().result.refused).toContain('source message is missing');
    expect(store.save).not.toHaveBeenCalled();
  });

  it('resolves a voice transcript item to its persisted Dan message before writing', async () => {
    const store = memoryStore();
    const lookup = vi.fn(async () => source.messageId);
    const { app } = appFor(store, {
      conversationStore: { getDanMessageIdBySourceItemId: lookup },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_remember',
      headers: {
        authorization: userHeaders.authorization,
        'x-jarvis-voice-item-id': 'item_abc123',
      },
      payload: { category: 'project_fact', key: 'project_ide', content: 'The project uses VS Code.' },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(lookup).toHaveBeenCalledWith('item_abc123');
    expect(store.getSourceMessage).toHaveBeenCalledWith(source.messageId, expect.any(AbortSignal));
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId: source.messageId }), expect.any(AbortSignal));
  });

  it('requires the explicit word remember before retaining sensitive information', async () => {
    const store = memoryStore();
    const { app } = appFor(store);
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_remember',
      headers: userHeaders,
      payload: { category: 'preference', key: 'bank', content: 'Dan has a bank account.' },
    });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(store.save).not.toHaveBeenCalled();

    const explicitStore = memoryStore({
      getSourceMessage: vi.fn(async () => ({ ...source, text: 'Remember that this is my bank account.' })),
    });
    const explicitApp = appFor(explicitStore).app;
    const explicit = await explicitApp.inject({
      method: 'POST',
      url: '/tools/memory_remember',
      headers: userHeaders,
      payload: { category: 'preference', key: 'bank', content: 'Dan has a bank account.' },
    });
    expect(explicit.json()).toMatchObject({ outcome: 'ok' });
  });

  it('corrects the existing stable key and forgets only the selected memory', async () => {
    const store = memoryStore();
    const { app } = appFor(store);
    const corrected = await app.inject({
      method: 'POST',
      url: '/tools/memory_correct',
      headers: userHeaders,
      payload: { memoryId: record.id, content: 'Dan prefers VS Code and Vim.' },
    });

    expect(corrected.json()).toMatchObject({
      outcome: 'ok',
      result: { id: record.id, category: 'preference', key: 'editor', revision: 2 },
      confirmation: 'Updated the preference: editor.',
    });
    expect(store.correct).toHaveBeenCalledWith(record.id, {
      category: 'preference',
      key: 'editor',
      content: 'Dan prefers VS Code and Vim.',
      sourceMessageId: source.messageId,
      embedding: null,
      embeddingModel: null,
    }, expect.any(AbortSignal));

    const forgotten = await app.inject({
      method: 'POST',
      url: '/tools/memory_forget',
      headers: userHeaders,
      payload: { memoryId: record.id },
    });
    expect(forgotten.json()).toMatchObject({
      outcome: 'ok',
      confirmation: 'Forgot the preference: editor.',
    });
    expect(store.forget).toHaveBeenCalledWith(record.id, source.messageId, expect.any(AbortSignal));
  });

  it('uses a bounded full-text fallback when query embeddings fail', async () => {
    const store = memoryStore({ supportsVectorSearch: vi.fn(() => true) });
    const embedder = { embed: vi.fn(async () => { throw new Error('provider detail'); }) };
    const { app, recordCall } = appFor(store, { embedder });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_search',
      headers: userHeaders,
      payload: { query: 'Which editor do I prefer?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: {
        count: 1,
        method: 'fulltext',
        fallbackReason: 'embedding_unavailable',
        memories: [{ source: { messageId: '42', text: source.text } }],
      },
    });
    expect(store.searchByFullText).toHaveBeenCalledWith(
      ['which', 'editor', 'do', 'prefer'],
      6,
      expect.any(AbortSignal),
    );
    expect(recordCall).toHaveBeenCalledWith({
      messageId: source.messageId,
      tool: 'memory_search',
      arguments: {},
      result: { confirmation: 'Memory operation completed.' },
      outcome: 'ok',
    });
  });

  it('returns a sanitized retrieval error instead of claiming that no memory matched', async () => {
    const store = memoryStore({
      supportsVectorSearch: vi.fn(() => true),
      searchByFullText: vi.fn(async () => { throw new Error('database-secret'); }),
    });
    const embedder = { embed: vi.fn(async () => { throw new Error('embedding-secret'); }) };
    const { app } = appFor(store, { embedder });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_search',
      headers: userHeaders,
      payload: { query: 'earlier decision' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'Tool execution failed' },
      confirmation: 'Not done: memory_search failed.',
    });
    expect(response.body).not.toContain('secret');
  });

  it('lets the app-only voice agent retrieve relevant memories without a stored turn ID', async () => {
    const store = memoryStore();
    const { app, recordCall } = appFor(store, { agent: true });
    const response = await app.inject({
      method: 'POST',
      url: '/tools/memory_search',
      headers: { authorization: ['Bearer', 'test.test.test'].join(' ') },
      payload: { query: 'editor preference' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.memories).toHaveLength(1);
    expect(response.json().result.memories[0].source.messageId).toBe(source.messageId);
    expect(recordCall).not.toHaveBeenCalled();

    const mutation = await app.inject({
      method: 'POST',
      url: '/tools/memory_remember',
      headers: { authorization: userHeaders.authorization },
      payload: { category: 'decision', key: 'test', content: 'Use the test.' },
    });
    expect(mutation.statusCode).toBe(400);
    expect(store.save).not.toHaveBeenCalled();
  });
});
