import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ToolFailure, ToolRefusal, createToolRegistry, type JarvisTool } from '../core/tool-registry.js';
import { capabilityIndex } from '../core/capability-index.js';
import { VaultWriteConflictError, type VaultFile, type VaultTreeFile } from '../vault/github-client.js';
import { createInboxIndex, type InboxIndexRow, type InboxIndexStore } from './item-index.js';
import { createInboxModule } from './module.js';
import { blobSha, noteId } from './note.js';
import { createInboxStore, type InboxVault } from './store.js';

const signal = new AbortController().signal;
const owner = '00000000-0000-4000-8000-000000000001';
const at = new Date('2026-11-14T21:41:00Z');

function memoryVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const vault: InboxVault = {
    async tree(): Promise<VaultTreeFile[]> { return [...files.keys()].map((path) => ({ path, sha: blobSha(files.get(path)!) })); },
    async read(path: string): Promise<VaultFile | null> {
      const content = files.get(path);
      return content === undefined ? null : { path, sha: blobSha(content), content };
    },
    async write(path: string, content: string, _message: string, expected: string | undefined) {
      writes.push(path);
      if (files.has(path) ? expected !== blobSha(files.get(path)!) : expected !== undefined) throw new VaultWriteConflictError();
      files.set(path, content);
      return 'c'.repeat(40);
    },
    async move(from: string, to: string, content: string, expected: string) {
      if (!files.has(from) || blobSha(files.get(from)!) !== expected || files.has(to)) throw new VaultWriteConflictError();
      files.delete(from);
      files.set(to, content);
      return 'd'.repeat(40);
    },
  };
  return { files, writes, vault };
}

function memoryIndexStore(): InboxIndexStore & { rows: Map<string, InboxIndexRow> } {
  const rows = new Map<string, InboxIndexRow>();
  const base = { path: null, sha: null, lastNudgedAt: null, lastFeedback: null, lastFeedbackAt: null, createdAt: at };
  return {
    rows,
    async all() { return [...rows.values()]; },
    async get(itemId) { return rows.get(itemId) ?? null; },
    async reserve(itemId) {
      const existing = rows.get(itemId);
      if (existing) return { row: existing, inserted: false };
      const row = { ...base, itemId };
      rows.set(itemId, row);
      return { row, inserted: true };
    },
    async upsert(value) { rows.set(value.itemId, { ...(rows.get(value.itemId) ?? base), itemId: value.itemId, path: value.path, sha: value.sha }); },
    async remove(ids) { for (const id of ids) rows.delete(id); },
    async markNudged() { return true; },
    async setFeedback() { return true; },
  };
}

function fixture(options: { files?: Record<string, string>; messages?: Record<string, string>; index?: boolean } = {}) {
  const memory = memoryVault(options.files);
  const store = createInboxStore({ vault: memory.vault, now: () => at });
  const indexStore = memoryIndexStore();
  const index = options.index === false ? undefined : createInboxIndex({ store: indexStore, inbox: store, now: () => at });
  const messages = options.messages ?? { '42': 'we should do a padel night, maybe before Christmas? Also look at the tax thing.' };
  const module = createInboxModule({
    store,
    index,
    memoryStore: { getSourceMessage: async (id) => messages[id] === undefined ? null : { messageId: id, text: messages[id]! } },
  });
  const tool = (name: string) => module.tools.find((entry) => entry.name === name) as JarvisTool;
  const request = (overrides: Record<string, unknown> = {}, messageId: string | null = '42') => ({
    principal: { objectId: owner },
    server: { ownerObjectId: owner },
    headers: messageId === null ? {} : { 'x-jarvis-message-id': messageId },
    log: { warn: vi.fn(), info: vi.fn() },
    ...overrides,
  }) as unknown as FastifyRequest;
  return { ...memory, store, index, indexStore, tool, request };
}

describe('inbox tools', () => {
  it('captures an idea with the owner\'s words verbatim, and reports where it went', async () => {
    const { tool, request, files, indexStore } = fixture();
    const result = await tool('inbox_capture').execute({ title: 'Padel night before Christmas', note: 'What: team evening.' }, request(), signal) as
      { id: string; path: string; created: boolean; confirmation: string };
    expect(result).toMatchObject({ created: true, confirmation: 'Saved to the inbox: Padel night before Christmas.' });
    const content = files.get(result.path)!;
    expect(content).toContain('> Dan, 14 Nov 22:41: "we should do a padel night, maybe before Christmas? Also look at the tax thing."');
    expect(noteId(content)).toBe(result.id);
    expect(indexStore.rows.get(result.id)).toMatchObject({ path: result.path });
  });

  it('quotes only a passage that is really in the owner\'s message', async () => {
    const { tool, request, files } = fixture();
    const real = await tool('inbox_capture').execute({ title: 'Tax', quote: 'look at the tax thing' }, request(), signal) as { path: string };
    expect(files.get(real.path)).toContain('"look at the tax thing"');
    const invented = await tool('inbox_capture').execute({ title: 'Other', quote: 'Dan promised the board a demo' }, request(), signal) as { path: string };
    expect(files.get(invented.path)).not.toContain('promised the board');
    expect(files.get(invented.path)).toContain('"we should do a padel night');
  });

  it('is idempotent: the same message and title never makes a second note, even after a lost index row', async () => {
    const { tool, request, files, indexStore } = fixture();
    const first = await tool('inbox_capture').execute({ title: 'Padel night', note: 'one' }, request(), signal) as { id: string };
    const again = await tool('inbox_capture').execute({ title: 'Padel Night', note: 'reworded' }, request(), signal) as { id: string; created: boolean };
    expect(again).toMatchObject({ id: first.id, created: false });
    indexStore.rows.clear();
    const afterLoss = await tool('inbox_capture').execute({ title: 'Padel night', note: 'three' }, request(), signal) as { created: boolean };
    expect(afterLoss.created).toBe(false);
    expect(files.size).toBe(1);
    const other = await tool('inbox_capture').execute({ title: 'Tax thing', note: 'x' }, request(), signal) as { id: string };
    expect(other.id).not.toBe(first.id);
    expect(files.size).toBe(2);
  });

  it('resolves the capture id in the vault when there is no index: another title spelling or the next day makes no second note', async () => {
    const memory = memoryVault();
    let clock = at;
    const store = createInboxStore({ vault: memory.vault, now: () => clock });
    const module = createInboxModule({
      store,
      memoryStore: { getSourceMessage: async (id) => ({ messageId: id, text: 'we should do a padel night' }) },
    });
    const capture = module.tools.find((entry) => entry.name === 'inbox_capture')!;
    const request = ({
      principal: { objectId: owner }, server: { ownerObjectId: owner },
      headers: { 'x-jarvis-message-id': '42' }, log: { warn: vi.fn() },
    }) as unknown as FastifyRequest;
    const first = await capture.execute({ title: 'Padel night', note: 'one' }, request, signal) as { created: boolean };
    clock = new Date('2026-11-14T23:30:00Z');
    const second = await capture.execute({ title: 'Padel Night', note: 'two' }, request, signal) as { created: boolean };
    expect([first.created, second.created]).toEqual([true, false]);
    expect(memory.files.size).toBe(1);
  });

  it('rereads the vault when an earlier attempt reserved a capture but never confirmed it', async () => {
    const { tool, request, files, indexStore, store } = fixture();
    const first = await store.create({ title: 'Padel night', note: 'written before the crash', id: 'aaaaaaaa' }, signal);
    expect(first.created).toBe(true);
    const { captureItemId } = await import('./note.js');
    const id = captureItemId('42', 'Padel night');
    await store.create({ title: 'Padel night', note: 'earlier attempt', id }, signal);
    await indexStore.reserve(id, signal);
    const result = await tool('inbox_capture').execute({ title: 'Padel night', note: 'retry' }, request(), signal) as { created: boolean; id: string };
    expect(result).toMatchObject({ created: false, id });
    expect([...files.keys()].filter((path) => path.includes('Padel night'))).toHaveLength(2);
    expect(indexStore.rows.get(id)?.path).toBe('Inbox/2026-11-14 Padel night 2.md');
  });

  it('still saves when the index is unavailable', async () => {
    const { tool, request, files, indexStore } = fixture();
    indexStore.reserve = async () => { throw new Error('database down'); };
    indexStore.upsert = async () => { throw new Error('database down'); };
    const result = await tool('inbox_capture').execute({ title: 'Idea', note: 'x' }, request(), signal) as { created: boolean };
    expect(result.created).toBe(true);
    expect(files.size).toBe(1);
  });

  it('refuses without the owner, without a stored owner message, and with secrets', async () => {
    const { tool, request, writes } = fixture();
    const capture = tool('inbox_capture');
    await expect(capture.execute({ title: 'x', note: 'y' }, request({ principal: { objectId: 'someone-else' } }), signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(capture.execute({ title: 'x', note: 'y' }, request({ principal: undefined }), signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(capture.execute({ title: 'x', note: 'y' }, request({}, null), signal)).rejects.toThrow(/no stored Dan message/u);
    await expect(capture.execute({ title: 'x', note: 'y' }, request({}, '999'), signal)).rejects.toThrow(/missing or is not from Dan/u);
    await expect(capture.execute({ title: 'x', note: 'password: hunter2hunter2' }, request(), signal)).rejects.toThrow(/Secrets/u);
    await expect(capture.execute({ title: 'x', note: 'y', extra: true }, request(), signal)).rejects.toThrow(/invalid/u);
    expect(writes).toEqual([]);
    const agent = await capture.execute({ title: 'x', note: 'y' }, request({ principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } }), signal);
    expect(agent).toMatchObject({ created: true });
  });

  it('says it was not saved when the vault fails, with no private text in the message', async () => {
    const { tool, request, vault } = fixture();
    vault.write = async () => { throw new Error('GitHub 503 for Inbox/2026-11-14 Private title.md'); };
    const failure = await tool('inbox_capture').execute({ title: 'Private title', note: 'private' }, request(), signal).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as Error).message).toMatch(/Nothing is confirmed as saved/u);
    expect((failure as Error).message).not.toContain('Private title');
  });

  it('lists live items with the nudge facts, filters, and reads one in full', async () => {
    const { tool, request, files, indexStore } = fixture({
      files: {
        'Inbox/2026-11-12 Older.md': '# Older\n\nabout padel\n\n<!-- jarvis-inbox:11111111 -->\n',
        'Inbox/2026-11-13 Tax.md': '# Tax\n\nabout tax\n\n<!-- jarvis-inbox:22222222 -->\n',
        'Inbox/Closed/2026-11-01 Done.md': '# Done\n\nabout padel\n\n<!-- jarvis-inbox:33333333 -->\n',
      },
    });
    indexStore.rows.set('11111111', {
      itemId: '11111111', path: 'Inbox/2026-11-12 Older.md', sha: blobSha(files.get('Inbox/2026-11-12 Older.md')!),
      lastNudgedAt: new Date('2026-11-13T07:00:00Z'), lastFeedback: 'down', lastFeedbackAt: at, createdAt: at,
    });
    const items = tool('inbox_items');
    const live = await items.execute({}, request({}, null), signal) as { items: Array<Record<string, unknown>>; truncated: boolean };
    expect(live.items.map((item) => item.title)).toEqual(['Older', 'Tax']);
    expect(live.items[0]).toMatchObject({ id: '11111111', lastNudgedAt: '2026-11-13T07:00:00.000Z', lastFeedback: 'down', excerpt: 'about padel' });
    expect(live.items[0]).not.toHaveProperty('content');
    expect((await items.execute({ includeClosed: true, query: 'padel' }, request(), signal) as { count: number }).count).toBe(2);
    const one = await items.execute({ id: '22222222' }, request(), signal) as { item: { content: string; sha: string } };
    expect(one.item.content).toContain('about tax');
    expect(one.item.sha).toMatch(/^[0-9a-f]{40}$/u);
    await expect(items.execute({ id: '99999999' }, request(), signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(items.execute({ limit: 500 }, request(), signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(items.execute({}, request({ principal: { objectId: 'someone-else' } }), signal)).rejects.toBeInstanceOf(ToolRefusal);
  });

  it('closes an item only on Dan\'s stored word, by id or path, and moves rather than deletes', async () => {
    const { tool, request, files, indexStore } = fixture({
      files: {
        'Inbox/2026-11-12 Older.md': '# Older\n\nbody\n\n<!-- jarvis-inbox:11111111 -->\n',
        'Inbox/2026-11-13 Tax.md': '# Tax\n\nbody\n\n<!-- jarvis-inbox:22222222 -->\n',
      },
    });
    indexStore.rows.set('11111111', { itemId: '11111111', path: 'Inbox/2026-11-12 Older.md', sha: 'a'.repeat(40), lastNudgedAt: null, lastFeedback: null, lastFeedbackAt: null, createdAt: at });
    const close = tool('inbox_close');
    await expect(close.execute({ id: '11111111', reason: 'binned' }, request({}, null), signal)).rejects.toThrow(/no stored Dan message/u);
    expect(files.has('Inbox/2026-11-12 Older.md')).toBe(true);
    const byId = await close.execute({ id: '11111111', reason: 'binned: not this year' }, request(), signal) as { confirmation: string };
    expect(byId.confirmation).toBe('Closed in the inbox: Older.');
    expect(files.get('Inbox/Closed/2026-11-12 Older.md')).toContain('closed: binned: not this year');
    expect(indexStore.rows.has('11111111')).toBe(false);
    await close.execute({ path: 'Inbox/2026-11-13 Tax.md', reason: 'became an issue' }, request(), signal);
    expect([...files.keys()].filter((path) => !path.startsWith('Inbox/Closed/'))).toEqual([]);
    await expect(close.execute({ id: '11111111', reason: 'again' }, request(), signal)).rejects.toThrow(/No live inbox item/u);
    await expect(close.execute({ id: '11111111', path: 'Inbox/a.md', reason: 'x' }, request(), signal)).rejects.toThrow(/invalid/u);
    await expect(close.execute({ path: 'Personal/Inbox.md', reason: 'x' }, request(), signal)).rejects.toThrow(/invalid/u);
  });

  it('appears in the capability index with its routing hint, and only when the tools exist', () => {
    const { tool } = fixture();
    const registry = createToolRegistry([{ id: 'inbox', tools: ['inbox_capture', 'inbox_items', 'inbox_close'].map(tool) }]);
    const index = capabilityIndex(registry);
    expect(index).toContain("Inbox for Dan's ideas, asks and loose thoughts that are not dated tasks or facts about him: inbox_capture, inbox_items, inbox_close");
    expect(capabilityIndex(createToolRegistry([]))).not.toContain('Inbox');
  });
});
