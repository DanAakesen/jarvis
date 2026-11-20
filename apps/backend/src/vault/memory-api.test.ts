import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryConflictError, type MemoryStore, type MemoryVersion, type VaultIndexStore } from '../database/memory-store.js';
import type { createGitHubVaultClient } from './github-client.js';
import { createMemoryApiModule, createVaultModule } from './index.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const authorization = `${['Bear', 'er'].join('')} ${['a', 'b', 'c'].join('.')}`;
const apps: ReturnType<typeof buildApp>[] = [];
const now = new Date('2026-11-20T04:00:00Z');
const records: MemoryVersion[] = ['3', '2', '1'].map(id => ({
  id, category: 'preference', key: `tea-${id}`, content: 'I prefer tea',
  sourceMessageId: '51', sourceText: 'I prefer tea', sourceTextTruncated: false,
  revision: 1, updatedAt: now, changedAt: now,
}));
const notePath = 'General/tea.md';
const noteId = `vault_${Buffer.from(notePath).toString('base64url')}`;

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

function fixture(mode: 'vault' | 'sql' | 'unavailable' = 'vault', auth?: BuildAppOptions['auth']) {
  const store = {
    list: vi.fn<MemoryStore['list']>(async limit => ({
      memories: records.slice(0, limit), hasMore: records.length > limit,
    })),
    history: vi.fn<MemoryStore['history']>(async id => records.filter(memory => memory.id === id)),
    forget: vi.fn<MemoryStore['forget']>(async () => ({ category: 'preference', key: 'tea-2' })),
    correct: vi.fn<MemoryStore['correct']>(async (_id, input) => ({
      memory: { ...records[1]!, content: input.content }, created: false, changed: true,
    })),
    supportsVectorSearch: vi.fn(() => false),
    searchByVector: vi.fn<MemoryStore['searchByVector']>(),
    searchByFullText: vi.fn<MemoryStore['searchByFullText']>(async (_terms, limit) => ({
      memories: records.slice(0, limit), method: 'fulltext',
    })),
  };
  const client = {
    read: vi.fn(async () => ({ path: notePath, content: 'Vault tea note', sha: 'a'.repeat(40) })),
    history: vi.fn(async () => []),
    write: vi.fn(async () => 'b'.repeat(40)),
    tree: vi.fn(async () => []),
  };
  const index = {
    files: vi.fn(async () => [{ path: notePath }]),
    searchByTerms: vi.fn(),
  };
  const source = vi.fn<MemoryStore['getSourceMessage']>();
  const vault = createVaultModule({
    client: client as unknown as ReturnType<typeof createGitHubVaultClient>,
    indexStore: index as unknown as VaultIndexStore,
    memoryStore: { getSourceMessage: source },
    apiMemoryStore: store as unknown as MemoryStore,
  });
  const app = buildApp(config, undefined, {
    modules: [mode === 'vault' ? vault : createMemoryApiModule({ store: mode === 'sql' ? store : undefined })],
    auth: auth ?? (async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' })),
  });
  apps.push(app);
  const call = (url: string, method: 'GET' | 'PATCH' | 'DELETE' = 'GET', authenticated = true) => app.inject({
    url, method, headers: authenticated ? { authorization } : {},
    ...(method === 'PATCH' ? { payload: { text: 'I prefer coffee' } } : {}),
  });
  return { call, client, index, source, store, vault };
}

describe('personal Memory API', () => {
  it('paginates SQL records only and does not consult the Vault index, notes or embeddings', async () => {
    const { call, client, index, store } = fixture();
    const first = await call('/memory?scope=personal&limit=2');
    const final = await call('/memory?scope=personal&limit=2&offset=2');
    const empty = await call('/memory?scope=personal&limit=2&offset=4');
    const search = await call('/memory?scope=personal&limit=1&offset=1&query=Tea');
    const searchEnd = await call('/memory?scope=personal&limit=1&offset=2&query=Tea');
    for (const response of [first, final, empty, search, searchEnd]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(first.json()).toMatchObject({ items: [{ id: '3', type: 'memory' }, { id: '2', type: 'memory' }],
      count: 2, limit: 2, offset: 0, hasMore: true });
    expect(final.json()).toMatchObject({ items: [{ id: '1' }], count: 1, offset: 2, hasMore: false });
    expect(empty.json()).toMatchObject({ items: [], count: 0, offset: 4, hasMore: false });
    expect(search.json()).toMatchObject({ items: [{ id: '2' }], offset: 1, hasMore: true, method: 'fulltext' });
    expect(searchEnd.json()).toMatchObject({ items: [{ id: '1' }], offset: 2, hasMore: false, method: 'fulltext' });
    expect(store.list).toHaveBeenNthCalledWith(2, 5, expect.any(AbortSignal));
    expect(store.searchByFullText).toHaveBeenNthCalledWith(1, ['tea'], 3, expect.any(AbortSignal));
    expect(store.searchByVector).not.toHaveBeenCalled();
    expect(index.files).not.toHaveBeenCalled();
    expect(index.searchByTerms).not.toHaveBeenCalled();
    expect(client.read).not.toHaveBeenCalled();
    expect(client.history).not.toHaveBeenCalled();
  });

  it('preserves the unscoped mixed list and Vault note detail', async () => {
    const { call, client, index } = fixture();
    const list = await call('/memory?folder=General&offset=3&limit=1');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [{ id: noteId, type: 'vault_note' }], count: 1, hasMore: false });
    expect(index.files).toHaveBeenCalledOnce();
    const detail = await call(`/memory/${noteId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: noteId, content: 'Vault tea note' });
    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it('reads, corrects, and forgets SQL records with no Vault module', async () => {
    const { call, store } = fixture('sql');
    const detail = await call('/memory/2?scope=personal');
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: '2', content: 'I prefer tea', history: [{ revision: 1 }] });
    const corrected = await call('/memory/2?scope=personal', 'PATCH');
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({ item: { id: '2' }, commitUrl: null });
    expect(store.correct).toHaveBeenCalledWith(
      '2', expect.objectContaining({ content: 'I prefer coffee', expectedRevision: 1 }), expect.any(AbortSignal),
    );
    const forgotten = await call('/memory/2?scope=personal', 'DELETE');
    expect(forgotten.statusCode).toBe(204);
    expect(store.forget).toHaveBeenCalledWith('2', '51', expect.any(AbortSignal));
    for (const response of [detail, corrected, forgotten]) expect(response.headers['cache-control']).toBe('no-store');
    expect((await call('/memory?scope=personal')).statusCode).toBe(200);
    expect((await call('/memory')).statusCode).toBe(503);
  });

  it('rejects Vault IDs, malformed selectors, and callers other than the owner', async () => {
    const { call, client } = fixture();
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const response = await call(`/memory/${noteId}?scope=personal`, method);
      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(client.read).not.toHaveBeenCalled();
    for (const url of ['/memory?scope=invalid', '/memory?scope=personal&folder=General', `/memory/${noteId}?scope=invalid`]) {
      const response = await call(url);
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const anonymous = await call('/memory?scope=personal', 'GET', false);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
    const other = fixture('vault', async () => ({ objectId: 'other', tenantId: config.auth.tenantId, displayName: 'Other' }));
    const forbidden = await other.call('/memory?scope=personal');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.headers['cache-control']).toBe('no-store');
    expect(other.store.list).not.toHaveBeenCalled();
  });

  it('reports SQL failure without leaking details and recovers on the next request', async () => {
    const { call, store } = fixture('sql');
    const absent = await fixture('unavailable').call('/memory?scope=personal');
    expect(absent.statusCode).toBe(503);
    expect(absent.headers['cache-control']).toBe('no-store');
    store.list.mockRejectedValueOnce(new Error('private SQL details'));
    const failed = await call('/memory?scope=personal');
    expect(failed.statusCode).toBe(503);
    expect(failed.headers['cache-control']).toBe('no-store');
    expect(failed.json()).toEqual({ error: 'Memory storage unavailable. Try again.' });
    expect((await call('/memory?scope=personal')).statusCode).toBe(200);
    store.forget.mockRejectedValueOnce(new Error('private SQL details'));
    const uncertain = await call('/memory/2?scope=personal', 'DELETE');
    expect(uncertain.statusCode).toBe(503);
    expect(uncertain.body).toContain('Refresh to check the result before retrying');
    expect(uncertain.body).not.toContain('private SQL details');
    expect(store.forget).toHaveBeenCalledOnce();
  });

  it('reports a concurrent correction as a conflict with no automatic retry', async () => {
    const { call, store } = fixture('sql');
    store.correct.mockRejectedValueOnce(new MemoryConflictError());
    const conflict = await call('/memory/2?scope=personal', 'PATCH');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.headers['cache-control']).toBe('no-store');
    expect(conflict.json()).toEqual({ error: 'Memory changed. Refresh before retrying.' });
    expect(store.correct).toHaveBeenCalledOnce();
  });
});

describe('Vault note capture', () => {
  it('refuses automatic capture before reading its source or accessing a note', async () => {
    const { client, source, vault } = fixture();
    const tool = vault.tools.find(tool => tool.name === 'vault_write')!;
    const request = {} as Parameters<typeof tool.execute>[1];
    const input = { path: notePath, content: 'I prefer tea', reason: 'Record a preference', automaticCapture: true };
    await expect(tool.execute(input, request, AbortSignal.timeout(1_000))).rejects.toThrow('Automatic capture cannot write to the vault');
    expect(source).not.toHaveBeenCalled();
    expect(client.read).not.toHaveBeenCalled();
    expect(client.write).not.toHaveBeenCalled();
  });

  it('still supports an explicitly requested note edit with automaticCapture false', async () => {
    const { client, source, vault } = fixture();
    const tool = vault.tools.find(tool => tool.name === 'vault_write')!;
    source.mockResolvedValueOnce({ messageId: '51', text: 'Update the menu note.' });
    const request = {
      principal: { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' },
      headers: { 'x-jarvis-message-id': '51' },
    } as Parameters<typeof tool.execute>[1];
    const input = {
      path: notePath, content: 'Updated menu', expectedSha: 'a'.repeat(40), reason: 'Edit note', automaticCapture: false,
    };
    const signal = AbortSignal.timeout(1_000);
    await expect(tool.execute(input, request, signal)).resolves.toMatchObject({ path: notePath, commit: 'b'.repeat(40) });
    expect(source).toHaveBeenCalledWith('51', signal);
    expect(client.write).toHaveBeenCalledWith(notePath, 'Updated menu', expect.stringContaining('Edit note'), input.expectedSha, signal);
  });
});
