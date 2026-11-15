import { describe, expect, it } from 'vitest';
import { VaultFileTooLargeError } from '../vault/github-client.js';
import { createInboxIndex, type InboxIndexRow, type InboxIndexStore } from './item-index.js';
import type { InboxEntry, InboxItem } from './store.js';

const signal = new AbortController().signal;
const now = new Date('2026-11-15T10:00:00Z');
const earlier = new Date('2026-11-10T10:00:00Z');
const sha = (value: string) => value.repeat(40).slice(0, 40);

function memoryStore(initial: InboxIndexRow[] = []): InboxIndexStore & { rows: Map<string, InboxIndexRow> } {
  const rows = new Map(initial.map((row) => [row.itemId, row]));
  return {
    rows,
    async all() { return [...rows.values()]; },
    async get(itemId) { return rows.get(itemId) ?? null; },
    async reserve(itemId) {
      const existing = rows.get(itemId);
      if (existing) return { row: existing, inserted: false };
      const created = row({ itemId, path: null, sha: null, createdAt: now });
      rows.set(itemId, created);
      return { row: created, inserted: true };
    },
    async upsert(value) {
      const existing = rows.get(value.itemId);
      rows.set(value.itemId, existing
        ? { ...existing, path: value.path, sha: value.sha }
        : row({ itemId: value.itemId, path: value.path, sha: value.sha, lastNudgedAt: value.lastNudgedAt ?? null }));
    },
    async upsertMany(values, signal) { for (const value of values) await this.upsert(value, signal); },
    async remove(ids) { for (const id of ids) rows.delete(id); },
    async markNudged(itemId, at) {
      const existing = rows.get(itemId);
      if (existing) rows.set(itemId, { ...existing, lastNudgedAt: at });
      return Boolean(existing);
    },
    async setFeedback(itemId, feedback, at) {
      const existing = rows.get(itemId);
      if (existing) rows.set(itemId, { ...existing, lastFeedback: feedback, lastFeedbackAt: at });
      return Boolean(existing);
    },
  };
}

function row(value: Partial<InboxIndexRow> & { itemId: string }): InboxIndexRow {
  return {
    path: null, sha: null, lastNudgedAt: null, lastFeedback: null, lastFeedbackAt: null, createdAt: earlier, ...value,
  };
}

function vault(notes: Record<string, { id: string; sha: string; closed?: boolean; tooLarge?: boolean }>) {
  const reads: string[] = [];
  const inbox = {
    async entries(): Promise<InboxEntry[]> {
      return Object.entries(notes).map(([path, note]) => ({ path, sha: note.sha, closed: note.closed === true }));
    },
    async read(path: string): Promise<InboxItem | null> {
      reads.push(path);
      const note = notes[path];
      if (!note) return null;
      if (note.tooLarge) throw new VaultFileTooLargeError();
      return { id: note.id, path, sha: note.sha, title: path, closed: false, excerpt: '', content: '' };
    },
  };
  return { inbox, reads };
}

describe('inbox index', () => {
  it('rebuilds from the vault: restored nudge times where known, otherwise now, so nothing is nudged in a storm', async () => {
    const store = memoryStore();
    const { inbox } = vault({
      'Inbox/a.md': { id: 'aaaaaaaa', sha: sha('a') },
      'Inbox/b.md': { id: 'bbbbbbbb', sha: sha('b') },
      'Inbox/Closed/c.md': { id: 'cccccccc', sha: sha('c'), closed: true },
    });
    const restored = new Map([['aaaaaaaa', earlier]]);
    const index = createInboxIndex({ store, inbox, now: () => now, restoreLastNudged: async () => restored });
    expect(await index.sync(signal)).toMatchObject({ live: 2, added: 2, rebuilt: true });
    expect(store.rows.get('aaaaaaaa')?.lastNudgedAt).toEqual(earlier);
    expect(store.rows.get('bbbbbbbb')?.lastNudgedAt).toEqual(now);
    expect(store.rows.has('cccccccc')).toBe(false);
  });

  it('adds a note from another tool as never nudged, rereads only changed notes, and keeps nudges and thumbs across edits and renames', async () => {
    const store = memoryStore([
      row({ itemId: 'aaaaaaaa', path: 'Inbox/a.md', sha: sha('a'), lastNudgedAt: earlier, lastFeedback: 'down', lastFeedbackAt: earlier }),
      row({ itemId: 'bbbbbbbb', path: 'Inbox/b.md', sha: sha('b'), lastNudgedAt: earlier }),
    ]);
    const { inbox, reads } = vault({
      'Inbox/a.md': { id: 'aaaaaaaa', sha: sha('a') },
      'Inbox/b renamed.md': { id: 'bbbbbbbb', sha: sha('f') },
      'Inbox/new.md': { id: 'dddddddd', sha: sha('d') },
    });
    const result = await createInboxIndex({ store, inbox, now: () => now }).sync(signal);
    expect(result).toMatchObject({ live: 3, added: 1, changed: 1, removed: 0, rebuilt: false });
    expect(reads.sort()).toEqual(['Inbox/b renamed.md', 'Inbox/new.md']);
    expect(store.rows.get('bbbbbbbb')).toMatchObject({ path: 'Inbox/b renamed.md', sha: sha('f'), lastNudgedAt: earlier });
    expect(store.rows.get('aaaaaaaa')).toMatchObject({ lastFeedback: 'down', lastNudgedAt: earlier });
    expect(store.rows.get('dddddddd')?.lastNudgedAt).toBeNull();
  });

  it('drops rows for closed, moved-away or deleted notes, but keeps a note it could not read', async () => {
    const store = memoryStore([
      row({ itemId: 'aaaaaaaa', path: 'Inbox/a.md', sha: sha('a') }),
      row({ itemId: 'bbbbbbbb', path: 'Inbox/b.md', sha: sha('b') }),
      row({ itemId: 'cccccccc', path: 'Inbox/c.md', sha: sha('c') }),
    ]);
    const { inbox } = vault({
      'Inbox/Closed/a.md': { id: 'aaaaaaaa', sha: sha('a'), closed: true },
      'Inbox/c.md': { id: 'cccccccc', sha: sha('e'), tooLarge: true },
    });
    const result = await createInboxIndex({ store, inbox, now: () => now }).sync(signal);
    expect(result).toMatchObject({ live: 0, removed: 2, unreadable: 1 });
    expect([...store.rows.keys()]).toEqual(['cccccccc']);
  });

  it('drops the old identity when a note gains a hidden id at the same path', async () => {
    const store = memoryStore([row({ itemId: 'abcdef01', path: 'Inbox/a.md', sha: sha('a'), lastNudgedAt: earlier })]);
    const { inbox } = vault({ 'Inbox/a.md': { id: 'aaaaaaaa', sha: sha('b') } });
    await createInboxIndex({ store, inbox, now: () => now }).sync(signal);
    expect([...store.rows.values()].map((value) => [value.itemId, value.path])).toEqual([['aaaaaaaa', 'Inbox/a.md']]);
  });

  it('retries a failed rebuild as a rebuild, because the rebuild writes are all or nothing', async () => {
    const store = memoryStore();
    const upsertMany = store.upsertMany.bind(store);
    let attempts = 0;
    store.upsertMany = async (values, abort) => {
      attempts += 1;
      if (attempts === 1) throw new Error('database down');
      return upsertMany(values, abort);
    };
    const { inbox } = vault({
      'Inbox/a.md': { id: 'aaaaaaaa', sha: sha('a') },
      'Inbox/b.md': { id: 'bbbbbbbb', sha: sha('b') },
    });
    const index = createInboxIndex({ store, inbox, now: () => now, restoreLastNudged: async () => new Map([['aaaaaaaa', earlier]]) });
    await expect(index.sync(signal)).rejects.toThrow('database down');
    expect(store.rows.size).toBe(0);
    expect(await index.sync(signal)).toMatchObject({ rebuilt: true, added: 2 });
    expect(store.rows.get('aaaaaaaa')?.lastNudgedAt).toEqual(earlier);
    expect(store.rows.get('bbbbbbbb')?.lastNudgedAt).toEqual(now);
  });

  it('leaves a copy with a repeated hidden id out instead of failing', async () => {
    const store = memoryStore();
    const { inbox } = vault({
      'Inbox/a.md': { id: 'aaaaaaaa', sha: sha('a') },
      'Inbox/a copy.md': { id: 'aaaaaaaa', sha: sha('b') },
    });
    const result = await createInboxIndex({ store, inbox, now: () => now }).sync(signal);
    expect(result).toMatchObject({ live: 1, duplicates: 1 });
    expect(store.rows.get('aaaaaaaa')?.path).toBe(['Inbox/a.md', 'Inbox/a copy.md'].sort((left, right) => left.localeCompare(right))[0]);
  });

  it('keeps a fresh reservation, completes it when the note shows up, and drops an abandoned one after a week', async () => {
    const store = memoryStore([
      row({ itemId: 'aaaaaaaa', createdAt: new Date('2026-11-15T09:59:00Z') }),
      row({ itemId: 'bbbbbbbb', createdAt: new Date('2026-11-01T00:00:00Z') }),
      row({ itemId: 'cccccccc', createdAt: new Date('2026-11-15T09:59:00Z') }),
    ]);
    const { inbox } = vault({ 'Inbox/c.md': { id: 'cccccccc', sha: sha('c') } });
    await createInboxIndex({ store, inbox, now: () => now }).sync(signal);
    expect([...store.rows.keys()].sort()).toEqual(['aaaaaaaa', 'cccccccc']);
    expect(store.rows.get('cccccccc')).toMatchObject({ path: 'Inbox/c.md', lastNudgedAt: null });
  });

  it('reserves a capture once and tells a retry that the earlier outcome is unknown', async () => {
    const store = memoryStore();
    const index = createInboxIndex({ store, inbox: vault({}).inbox, now: () => now });
    expect(await index.reserve('aaaaaaaa', signal)).toMatchObject({ inserted: true, row: { path: null } });
    expect(await index.reserve('aaaaaaaa', signal)).toMatchObject({ inserted: false, row: { path: null } });
    await index.complete('aaaaaaaa', 'Inbox/a.md', sha('a'), signal);
    expect(await index.reserve('aaaaaaaa', signal)).toMatchObject({ inserted: false, row: { path: 'Inbox/a.md' } });
    expect(await index.get('not-hex!', signal)).toBeNull();
  });

  it('records a nudge and a thumb, and reports an unknown item', async () => {
    const store = memoryStore([row({ itemId: 'aaaaaaaa', path: 'Inbox/a.md', sha: sha('a') })]);
    const index = createInboxIndex({ store, inbox: vault({}).inbox, now: () => now });
    expect(await index.markNudged('aaaaaaaa', now, signal)).toBe(true);
    expect(await index.setFeedback('aaaaaaaa', 'up', now, signal)).toBe(true);
    expect(await index.setFeedback('zzzzzzzz', 'up', now, signal)).toBe(false);
    expect(store.rows.get('aaaaaaaa')).toMatchObject({ lastNudgedAt: now, lastFeedback: 'up', lastFeedbackAt: now });
  });

  it('runs one sync at a time', async () => {
    const store = memoryStore();
    const { inbox } = vault({ 'Inbox/a.md': { id: 'aaaaaaaa', sha: sha('a') } });
    const index = createInboxIndex({ store, inbox, now: () => now });
    const [first, second] = await Promise.all([index.sync(signal), index.sync(signal)]);
    expect(second).toBe(first);
  });
});
