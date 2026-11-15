import { describe, expect, it } from 'vitest';
import { VaultWriteConflictError, type VaultFile, type VaultTreeFile } from '../vault/github-client.js';
import { createInboxCapture } from './capture.js';
import { createInboxIndex, type InboxIndexRow, type InboxIndexStore } from './item-index.js';
import { blobSha, captureNoteId } from './note.js';
import { createInboxStore, type InboxVault } from './store.js';

const signal = new AbortController().signal;
const now = new Date('2026-11-15T10:00:00Z');
const captureId = 'key-0123456789abcdef';

function setup(reservedAgoMs: number) {
  const files = new Map<string, string>();
  const vault: InboxVault = {
    async tree(): Promise<VaultTreeFile[]> { return [...files.keys()].map((path) => ({ path, sha: blobSha(files.get(path)!) })); },
    async read(path: string): Promise<VaultFile | null> { const content = files.get(path); return content === undefined ? null : { path, sha: blobSha(content), content }; },
    async write(path: string, content: string, _message: string, expected: string | undefined) {
      if (files.has(path) ? expected !== blobSha(files.get(path)!) : expected !== undefined) throw new VaultWriteConflictError();
      files.set(path, content);
      return 'c'.repeat(40);
    },
    async move() { throw new Error('not used'); },
  };
  const rows = new Map<string, InboxIndexRow>();
  const firstId = captureNoteId(captureId, 0);
  rows.set(firstId, { itemId: firstId, path: null, sha: null, lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: new Date(now.getTime() - reservedAgoMs) });
  const base = { lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: now };
  const indexStore: InboxIndexStore = {
    async all() { return [...rows.values()]; },
    async get(id) { return rows.get(id) ?? null; },
    async reserve(id) { const existing = rows.get(id); if (existing) return { row: existing, inserted: false }; const row = { ...base, itemId: id, path: null, sha: null }; rows.set(id, row); return { row, inserted: true }; },
    async upsert(value) { rows.set(value.itemId, { ...(rows.get(value.itemId) ?? base), itemId: value.itemId, path: value.path, sha: value.sha }); },
    async upsertMany() {},
    async remove() {},
    async markNudged() { return true; },
    async setFeedback() { return true; },
  };
  const store = createInboxStore({ vault, now: () => now });
  const index = createInboxIndex({ store: indexStore, inbox: store, now: () => now });
  return { files, capture: createInboxCapture({ store, index, now: () => now }) };
}

describe('capture reservations across replicas', () => {
  it('asks the caller to retry while another attempt with the same key is still running', async () => {
    const { capture, files } = setup(5_000);
    await expect(capture({ captureId, text: 'a thought about padel' }, signal)).rejects.toMatchObject({ code: 'conflict' });
    expect(files.size).toBe(0);
  });

  it('treats an old reservation as an unknown outcome: the vault is checked, then the capture is written once', async () => {
    const { capture, files } = setup(120_000);
    expect(await capture({ captureId, text: 'a thought about padel' }, signal)).toMatchObject({ repeated: false });
    expect(await capture({ captureId, text: 'a thought about padel' }, signal)).toMatchObject({ repeated: true });
    expect(files.size).toBe(1);
  });
});
