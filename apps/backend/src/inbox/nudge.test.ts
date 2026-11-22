import { describe, expect, it, vi } from 'vitest';
import type { FoundryModelUsage } from '../core/usage.js';
import type { FindingsStoredContext } from '../proactive/types.js';
import type { FindingInput } from '../proactive/store.js';
import { VaultWriteConflictError, type VaultFile, type VaultTreeFile } from '../vault/github-client.js';
import { createInboxIndex, type InboxIndexRow, type InboxIndexStore } from './item-index.js';
import { createInboxNudgePass } from './nudge.js';
import { blobSha } from './note.js';
import { createInboxNudgeHook, createProactiveNudgeDelivery } from './proactive-hook.js';
import { buildDigest, parseReview, preservesProtectedLines } from './review.js';
import { createInboxStore, type InboxVault } from './store.js';

const signal = new AbortController().signal;
const now = new Date('2026-11-15T06:00:00Z');
const old = new Date('2026-11-01T06:00:00Z');
const note = (title: string, id: string, extra = '') =>
  `# ${title}\n\n> Dan, 1 Nov 10:00: "original words about ${title}"\n\nwhat and why${extra}\n\n<!-- jarvis-inbox:${id} -->\n`;

function memoryVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const vault: InboxVault = {
    async tree(): Promise<VaultTreeFile[]> { return [...files.keys()].map((path) => ({ path, sha: blobSha(files.get(path)!) })); },
    async read(path: string): Promise<VaultFile | null> {
      const content = files.get(path);
      return content === undefined ? null : { path, sha: blobSha(content), content };
    },
    async write(path: string, content: string, _message: string, expected: string | undefined) {
      if (files.has(path) ? expected !== blobSha(files.get(path)!) : expected !== undefined) throw new VaultWriteConflictError();
      files.set(path, content);
      return 'c'.repeat(40);
    },
    async move() { throw new Error('not used'); },
  };
  return { files, vault };
}

function memoryIndexStore(): InboxIndexStore & { rows: Map<string, InboxIndexRow> } {
  const rows = new Map<string, InboxIndexRow>();
  const base = { path: null, sha: null, lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: old };
  const store: InboxIndexStore & { rows: Map<string, InboxIndexRow> } = {
    rows,
    async all() { return [...rows.values()]; },
    async get(itemId) { return rows.get(itemId) ?? null; },
    async reserve(itemId) { const row = { ...base, itemId }; rows.set(itemId, row); return { row, inserted: true }; },
    async upsert(value) { rows.set(value.itemId, { ...(rows.get(value.itemId) ?? { ...base, lastNudgedAt: value.lastNudgedAt ?? null }), itemId: value.itemId, path: value.path, sha: value.sha }); },
    async upsertMany(values, abort) { for (const value of values) await store.upsert(value, abort); },
    async remove(ids) { for (const id of ids) rows.delete(id); },
    async markNudged(itemId, at, _signal, nudgeItemId) {
      const row = rows.get(itemId);
      if (row) rows.set(itemId, { ...row, lastNudgedAt: at, lastNudgeItemId: nudgeItemId ?? null });
      return Boolean(row);
    },
    async setFeedback(itemId, feedback, at) {
      const row = rows.get(itemId);
      if (row) rows.set(itemId, { ...row, lastFeedback: feedback, lastFeedbackAt: at });
      return Boolean(row);
    },
  };
  return store;
}

function setup(options: {
  files?: Record<string, string>;
  model?: (prompt: { system: string; user: string }) => Promise<string | undefined>;
  thumb?: 'up' | 'down' | null;
  deliver?: () => Promise<string | null>;
} = {}) {
  const memory = memoryVault(options.files ?? {
    'Inbox/2026-11-01 Padel night.md': note('Padel night', '11111111'),
    'Inbox/2026-11-02 Tax thing.md': note('Tax thing', '22222222'),
  });
  const store = createInboxStore({ vault: memory.vault, now: () => now });
  const indexStore = memoryIndexStore();
  // An index that already knows these notes, never nudged: an empty table would be a rebuild, which starts every nudge clock.
  for (const [path, content] of memory.files) {
    const itemId = /jarvis-inbox:([0-9a-f]+)/u.exec(content)?.[1];
    if (itemId && !path.includes('/Closed/')) {
      indexStore.rows.set(itemId, { itemId, path, sha: blobSha(content), lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: old });
    }
  }
  const index = createInboxIndex({ store: indexStore, inbox: store, now: () => now });
  const prompts: Array<{ system: string; user: string }> = [];
  const delivered: unknown[] = [];
  const pass = createInboxNudgePass({
    store, index,
    model: async (prompt) => { prompts.push(prompt); return options.model ? options.model(prompt) : JSON.stringify({ nudge: null, rewrites: [] }); },
    delivery: { deliver: async (nudge) => { delivered.push(nudge); return options.deliver ? options.deliver() : 'aaaaaaaa-0000-4000-8000-000000000001'; } },
    reactions: { thumb: async () => options.thumb ?? null },
    now: () => now,
  });
  return { ...memory, store, index, indexStore, pass, prompts, delivered };
}

describe('inbox review validation', () => {
  const items = [
    { id: '11111111', title: 'Padel', path: 'Inbox/2026-11-01 Padel.md', sha: 'a'.repeat(40), content: note('Padel', '11111111') },
  ];
  const digest = () => buildDigest(items.map((item) => ({
    ...item, closed: false, date: '2026-11-01', excerpt: 'what and why',
  })), [], now);
  const valid = { id: '11111111', tier: 'low', title: 'Padel night?', body: 'Pick two weekends?', why: 'Asked twice' };

  it('accepts one nudge for an item that may be nudged and a rewrite that keeps the owner\'s words', () => {
    const content = `${note('Padel', '11111111').replace('what and why', 'what and why, merged')}`;
    expect(parseReview(JSON.stringify({ nudge: valid, rewrites: [{ id: '11111111', content }] }), digest())).toMatchObject({
      nudge: { id: '11111111', tier: 'low' }, rewrites: [{ id: '11111111' }],
    });
    expect(parseReview(JSON.stringify({ nudge: null }), digest())).toEqual({ nudge: null, rewrites: [] });
  });

  it('rejects the whole answer for anything unexpected', () => {
    const bad: unknown[] = [
      { nudge: { ...valid, id: '99999999' }, rewrites: [] },
      { nudge: { ...valid, tier: 'urgent' }, rewrites: [] },
      { nudge: { ...valid, title: 'x'.repeat(81) }, rewrites: [] },
      { nudge: { ...valid, body: 'see https://example.com' }, rewrites: [] },
      { nudge: { ...valid, extra: 1 }, rewrites: [] },
      { nudge: valid, rewrites: [], extra: true },
      { rewrites: [] },
      { nudge: null, rewrites: [{ id: '99999999', content: 'x' }] },
      { nudge: null, rewrites: [{ id: '11111111', content: '# Padel\n\nI dropped the quote\n' }] },
      { nudge: null, rewrites: [{ id: '11111111', content: 'x'.repeat(13_000) }] },
      { nudge: null, rewrites: new Array(4).fill({ id: '11111111', content: note('Padel', '11111111') }) },
    ];
    for (const value of bad) expect(parseReview(JSON.stringify(value), digest()), JSON.stringify(value).slice(0, 60)).toBeUndefined();
    expect(parseReview('not json', digest())).toBeUndefined();
    expect(parseReview(undefined, digest())).toBeUndefined();
  });

  it('refuses to nudge an item nudged in the last 48 hours', () => {
    const resting = buildDigest(items.map((item) => ({ ...item, closed: false, date: '2026-11-01', excerpt: '' })), [{
      itemId: '11111111', path: items[0]!.path, sha: items[0]!.sha, lastNudgedAt: new Date('2026-11-14T06:00:00Z'),
      lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: old,
    }], now);
    expect(resting.items[0]).toMatchObject({ canNudge: false, nudgedDaysAgo: 1 });
    expect(parseReview(JSON.stringify({ nudge: valid, rewrites: [] }), resting)).toBeUndefined();
  });

  it('protects quote and trail lines', () => {
    expect(preservesProtectedLines('> a\n- 14 Nov: nudged\nbody', '> a\n- 14 Nov: nudged\nnew body')).toBe(true);
    expect(preservesProtectedLines('> a\n- 14 Nov: nudged\nbody', '> a\nnew body')).toBe(false);
    expect(preservesProtectedLines('- 1 Sept: x', 'nothing')).toBe(false);
  });
});

describe('inbox digest robustness', () => {
  it('shows an oversized note as an excerpt, and skips what cannot fit, instead of emptying the digest', () => {
    const big = `# Huge\n\n${'word '.repeat(10_000)}\n`;
    const items = [
      { id: '11111111', title: 'Huge', path: 'Inbox/2026-11-01 Huge.md', sha: 'a'.repeat(40), content: big, closed: false, date: '2026-11-01', excerpt: 'word '.repeat(100) },
      { id: '22222222', title: 'Small', path: 'Inbox/2026-11-02 Small.md', sha: 'b'.repeat(40), content: '# Small\n\nx\n', closed: false, date: '2026-11-02', excerpt: 'x' },
    ];
    const digest = buildDigest(items, [], now);
    expect(digest.items.map((item) => item.id)).toEqual(['11111111', '22222222']);
    expect(digest.items[0]!.note).toBeUndefined();
    expect(digest.items[0]!.excerpt.length).toBeLessThanOrEqual(200);
    expect(digest.fullNotes.has('11111111')).toBe(false);
    expect(digest.fullNotes.has('22222222')).toBe(true);
  });
});

describe('inbox nudge pass', () => {
  const nudge = { id: '11111111', tier: 'medium', title: 'Padel night?', body: 'Shall I propose two weekends?', why: 'Floated twice, no date yet' };

  it('nudges at most one item, records it in the index and the trail, and hands the model only labelled data', async () => {
    const { pass, indexStore, files, prompts, delivered } = setup({ model: async () => JSON.stringify({ nudge, rewrites: [] }) });
    const outcome = await pass.run(signal);
    expect(outcome).toEqual({ status: 'done', nudged: { itemId: '11111111', tier: 'medium' }, rewrites: 0 });
    expect(delivered).toEqual([{ ...nudge, itemTitle: 'Padel night' }]);
    expect(indexStore.rows.get('11111111')).toMatchObject({ lastNudgedAt: now, lastNudgeItemId: 'aaaaaaaa-0000-4000-8000-000000000001' });
    expect(files.get('Inbox/2026-11-01 Padel night.md')).toContain('- 15 Nov: nudged (medium): Floated twice, no date yet');
    expect(prompts[0]!.system).toMatch(/untrusted data/u);
    const sent = JSON.parse(prompts[0]!.user) as { inbox: Array<{ id: string; canNudge: boolean }> };
    expect(sent.inbox.map((item) => item.id).sort()).toEqual(['11111111', '22222222']);
  });

  it('makes no model call when every item rested within 48 hours, and none when the inbox is empty', async () => {
    const resting = setup();
    await resting.index.sync(signal);
    for (const row of resting.indexStore.rows.values()) resting.indexStore.rows.set(row.itemId, { ...row, lastNudgedAt: new Date('2026-11-14T06:00:00Z') });
    expect(await resting.pass.run(signal)).toEqual({ status: 'skipped', reason: 'nothing_to_review' });
    expect(resting.prompts).toHaveLength(0);
    expect(await setup({ files: {} }).pass.run(signal)).toEqual({ status: 'skipped', reason: 'nothing_to_review' });
  });

  it('applies a rewrite with the stored id, and drops it when Dan edited the note meanwhile', async () => {
    const content = note('Padel night', '11111111', '\nLikely first step: pick two weekends.');
    const ok = setup({ model: async () => JSON.stringify({ nudge: null, rewrites: [{ id: '11111111', content }] }) });
    expect(await ok.pass.run(signal)).toMatchObject({ status: 'done', rewrites: 1 });
    expect(ok.files.get('Inbox/2026-11-01 Padel night.md')).toContain('pick two weekends');

    const hooks = { edited: () => {} };
    const conflict = setup({ model: async () => {
      hooks.edited();
      return JSON.stringify({ nudge, rewrites: [{ id: '11111111', content }] });
    } });
    hooks.edited = () => conflict.files.set('Inbox/2026-11-01 Padel night.md', `${note('Padel night', '11111111')}\nDan edited this in Obsidian\n`);
    expect(await conflict.pass.run(signal)).toMatchObject({ status: 'done', rewrites: 0, nudged: { itemId: '11111111' } });
    expect(conflict.files.get('Inbox/2026-11-01 Padel night.md')).toContain('Dan edited this in Obsidian');
    expect(conflict.files.get('Inbox/2026-11-01 Padel night.md')).not.toContain('pick two weekends');
  });

  it('writes nothing and sends nothing for an invalid answer or an unavailable model', async () => {
    for (const model of [async () => 'nope', async () => JSON.stringify({ nudge: { ...nudge, id: '99999999' }, rewrites: [] }), async () => undefined, async () => { throw new Error('down'); }]) {
      const setupResult = setup({ model });
      const before = JSON.stringify([...setupResult.files]);
      const outcome = await setupResult.pass.run(signal);
      expect(outcome.status).toBe('skipped');
      expect(setupResult.delivered).toHaveLength(0);
      expect(JSON.stringify([...setupResult.files])).toBe(before);
    }
  });

  it('does not mark an item nudged when delivery produced nothing', async () => {
    const { pass, indexStore } = setup({ model: async () => JSON.stringify({ nudge, rewrites: [] }), deliver: async () => null });
    expect(await pass.run(signal)).toMatchObject({ status: 'done', nudged: null });
    expect(indexStore.rows.get('11111111')?.lastNudgedAt).toBeNull();
  });

  it('follows a changed thumb on the same card, and keeps the identity of a note from another tool', async () => {
    const setupResult = setup({
      files: { 'Inbox/2026-11-01 From ChatGPT.md': '# From ChatGPT\n\nbody\n' },
      thumb: 'down',
    });
    await setupResult.index.sync(signal);
    const [row] = [...setupResult.indexStore.rows.values()];
    const itemId = row!.itemId;
    setupResult.indexStore.rows.set(itemId, {
      ...row!, lastNudgedAt: new Date('2026-11-10T06:00:00Z'), lastNudgeItemId: 'bbbbbbbb-0000-4000-8000-000000000002',
      lastFeedback: 'up', lastFeedbackAt: new Date('2026-11-11T06:00:00Z'),
    });
    await setupResult.pass.run(signal);
    expect(setupResult.indexStore.rows.get(itemId)).toMatchObject({ lastFeedback: 'down', lastNudgedAt: new Date('2026-11-10T06:00:00Z') });
    expect(setupResult.files.get('Inbox/2026-11-01 From ChatGPT.md')).toContain('changed the thumb to down on the nudge');
    // The trail edit added a marker equal to the id the index already uses: still exactly one row, nudge clock intact.
    await setupResult.index.sync(signal);
    expect([...setupResult.indexStore.rows.keys()]).toEqual([itemId]);
    expect(setupResult.indexStore.rows.get(itemId)?.lastNudgeItemId).toBe('bbbbbbbb-0000-4000-8000-000000000002');
  });

  it('brings a thumbs down on an earlier nudge into the index, the trail and the next prompt', async () => {
    const { pass, index, indexStore, files, prompts } = setup({ thumb: 'down' });
    await index.sync(signal);
    indexStore.rows.set('11111111', {
      ...indexStore.rows.get('11111111')!, lastNudgedAt: new Date('2026-11-10T06:00:00Z'), lastNudgeItemId: 'bbbbbbbb-0000-4000-8000-000000000002',
    });
    await pass.run(signal);
    expect(indexStore.rows.get('11111111')).toMatchObject({ lastFeedback: 'down' });
    expect(files.get('Inbox/2026-11-01 Padel night.md')).toContain('thumbs down on the nudge');
    const sent = JSON.parse(prompts[0]!.user) as { recentReactions: Array<{ reaction: string; title: string }>; inbox: Array<{ lastReaction: string | null }> };
    expect(sent.recentReactions).toMatchObject([{ reaction: 'down', title: 'Padel night' }]);
    expect(sent.inbox.find((item) => item.lastReaction === 'down')).toBeDefined();
  });
});

describe('inbox nudge hook', () => {
  function proactive(overrides: { paused?: boolean; spent?: number; budget?: number; notes?: boolean } = {}) {
    const findings: FindingInput[] = [];
    const spend: unknown[] = [];
    const store = {
      settings: { read: async () => ({ paused: overrides.paused ?? false, monthlyBudgetDkk: overrides.budget ?? 100, sources: { notes: overrides.notes ?? true } }) },
      spend: { monthTotal: async () => overrides.spent ?? 0, record: async (value: unknown) => { spend.push(value); } },
      items: { upsertFinding: async (input: FindingInput) => { findings.push(input); return { id: 'cccccccc-0000-4000-8000-000000000003' }; }, get: async () => undefined },
    };
    const context = { runId: 'run-1', trigger: 'scheduled', now, signal, findings: [{ itemId: 'existing' }], facts: [], sources: [] } as unknown as FindingsStoredContext;
    return { store, findings, spend, context };
  }

  it('runs once, records spend in the shared ledger, and delivers a medium nudge as a card plus the run\'s first insight candidate', async () => {
    const { store, findings, spend, context } = proactive();
    const usage: FoundryModelUsage[] = [];
    const run = vi.fn(async () => {
      usage.push({ role: 'chat', model: 'gpt-5.6-luna', inputTokens: 12_000, outputTokens: 1_000, eventId: 'e1' });
      await createProactiveNudgeDelivery(store as never, context, () => now).deliver({
        id: '11111111', tier: 'medium', title: 'Padel night?', body: 'Two weekends?', why: 'why', itemTitle: 'Padel night',
      }, signal);
      return { status: 'done' as const, nudged: null, rewrites: 0 };
    });
    const hook = createInboxNudgeHook({ pass: () => ({ run }) as never, store: store as never, takeUsage: () => usage.splice(0), now: () => now });
    await hook(context);
    expect(run).toHaveBeenCalledOnce();
    expect(findings).toMatchObject([{ dedupeKey: 'inbox:11111111:2026-11-15', category: 'suggestion', urgency: 'normal', runId: 'run-1' }]);
    expect(context.findings[0]).toMatchObject({ modelGenerated: true, itemId: 'cccccccc-0000-4000-8000-000000000003', urgency: 'normal' });
    expect(context.findings).toHaveLength(2);
    expect(context.facts).toMatchObject([{ source: 'notes', kind: 'note' }]);
    expect(spend).toMatchObject([{ runId: 'run-1', inputTokens: 12_000, outputTokens: 1_000 }]);
    expect((spend[0] as { estimatedDkk: number }).estimatedDkk).toBeGreaterThan(0);
  });

  it('delivers a low nudge as a card only: nothing joins the push candidates', async () => {
    const { store, findings, context } = proactive();
    await createProactiveNudgeDelivery(store as never, context, () => now).deliver({
      id: '11111111', tier: 'low', title: 'Padel night?', body: 'Two weekends?', why: 'why', itemTitle: 'Padel night',
    }, signal);
    expect(findings).toMatchObject([{ urgency: 'fyi' }]);
    expect(context.findings).toHaveLength(1);
    expect(context.facts).toHaveLength(0);
  });

  it('does not run when paused, when notes are off, when the budget is gone, or after the daily ceiling', async () => {
    for (const overrides of [{ paused: true }, { notes: false }, { budget: 0 }, { spent: 99.99 }]) {
      const { store, context } = proactive(overrides);
      const run = vi.fn();
      await createInboxNudgeHook({ pass: () => ({ run }) as never, store: store as never, takeUsage: () => [], now: () => now })(context);
      expect(run).not.toHaveBeenCalled();
    }
    const { store, context } = proactive();
    const usage: FoundryModelUsage[] = [];
    const run = vi.fn(async () => { usage.push({ role: 'chat', model: 'unpriced-model', inputTokens: 5_000_000, outputTokens: 2_000_000, eventId: 'e' }); });
    const hook = createInboxNudgeHook({ pass: () => ({ run }) as never, store: store as never, takeUsage: () => usage.splice(0), now: () => now });
    await hook(context);
    await hook(context);
    expect(run).toHaveBeenCalledOnce();
  });
});
