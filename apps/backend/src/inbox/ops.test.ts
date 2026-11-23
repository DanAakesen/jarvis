import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { FoundryModelUsage } from '../core/usage.js';
import type { FindingsStoredContext } from '../proactive/types.js';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { VaultWriteConflictError, type VaultFile, type VaultTreeFile } from '../vault/github-client.js';
import { createMissedCaptureAudit, parseAudit, quotedWords } from './audit.js';
import { createInboxIndex, type InboxIndexRow, type InboxIndexStore } from './item-index.js';
import { createInboxModule } from './module.js';
import { createInboxNudgePass } from './nudge.js';
import { blobSha, captureItemId } from './note.js';
import { AUDIT_DAY_KEY, NUDGE_STYLE_KEY, WEEKLY_WEEK_KEY, type InboxOpsStore, type InboxSpendKind, type InboxSpendRow } from './ops.js';
import { createInboxNudgeHook } from './proactive-hook.js';
import { buildDigest, parseReview } from './review.js';
import { createInboxStatusRoute } from './status.js';
import { createInboxStore, type InboxVault } from './store.js';

const signal = new AbortController().signal;
const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const owner = config.auth.ownerObjectId;
// Sunday 15 Nov 2026, 18:05 Copenhagen.
const sundayEvening = new Date('2026-11-15T17:05:00Z');
const old = new Date('2026-11-01T06:00:00Z');

function memoryVault(initial: Record<string, string> = {}) {
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

function memoryOps() {
  const state = new Map<string, string>();
  const spend: Array<{ day: string; kind: InboxSpendKind; calls: number; inputTokens: number; outputTokens: number; estimatedDkk: number }> = [];
  const ops: InboxOpsStore = {
    async getState(key) { return state.get(key) ?? null; },
    async setState(key, value) { state.set(key, value); },
    async deleteState(key) { state.delete(key); },
    async addSpend(day, kind, usage) { spend.push({ day, kind, ...usage }); },
    async spendSince(from): Promise<InboxSpendRow[]> { return spend.filter((row) => row.day >= from); },
  };
  return { ops, state, spend };
}

function indexStoreFor(files: Map<string, string>) {
  const rows = new Map<string, InboxIndexRow>();
  const store: InboxIndexStore = {
    async all() { return [...rows.values()]; },
    async get(id) { return rows.get(id) ?? null; },
    async reserve(id) { const row = { itemId: id, path: null, sha: null, lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: old }; rows.set(id, row); return { row, inserted: true }; },
    async upsert(value) { rows.set(value.itemId, { ...(rows.get(value.itemId) ?? { lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: old }), itemId: value.itemId, path: value.path, sha: value.sha }); },
    async upsertMany(values, abort) { for (const value of values) await store.upsert(value, abort); },
    async remove(ids) { for (const id of ids) rows.delete(id); },
    async markNudged(id, at) { const row = rows.get(id); if (row) rows.set(id, { ...row, lastNudgedAt: at }); return Boolean(row); },
    async setFeedback() { return true; },
  };
  for (const [path, content] of files) {
    const itemId = /jarvis-inbox:([0-9a-f]+)/u.exec(content)?.[1];
    if (itemId && !path.includes('/Closed/')) rows.set(itemId, { itemId, path, sha: blobSha(content), lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: old });
  }
  return { rows, store };
}

const note = (title: string, id: string, quote = `original words about ${title}`) =>
  `# ${title}\n\n> Dan, 1 Nov 10:00: "${quote}"\n\nwhat and why\n\n<!-- jarvis-inbox:${id} -->\n`;

describe('missed-capture audit', () => {
  const messages = [
    { id: '1', text: 'we should look into a standing desk for the office' },
    { id: '2', text: 'what is the weather tomorrow' },
    { id: '3', text: 'my bank account number is 1234 and I need a loan' },
    { id: '4', text: 'ok' },
    { id: '5', text: 'maybe a newsletter for the team about the release?' },
  ];

  function setup(model: (prompt: { system: string; user: string }) => Promise<string | undefined>, initial: Record<string, string> = {}) {
    const memory = memoryVault(initial);
    const store = createInboxStore({ vault: memory.vault, now: () => sundayEvening });
    const prompts: Array<{ system: string; user: string }> = [];
    const audit = createMissedCaptureAudit({
      store, model: async (prompt) => { prompts.push(prompt); return model(prompt); },
      messages: async () => messages, now: () => sundayEvening,
    });
    return { ...memory, audit, prompts };
  }

  it('saves what the model picks from the owner\'s own message, verbatim, with the chat tool\'s id scheme', async () => {
    const { audit, files, prompts } = setup(async () => JSON.stringify({ captures: [{ messageId: '5', title: 'Release newsletter', note: 'What: a team newsletter.' }] }));
    expect(await audit.run(signal)).toEqual({ status: 'done', captured: 1 });
    const [path, content] = [...files][0]!;
    expect(path).toBe('Inbox/2026-11-15 Release newsletter.md');
    expect(content).toContain('> Dan, 15 Nov 18:05, catch-up: "maybe a newsletter for the team about the release?"');
    expect(content).toContain(`jarvis-inbox:${captureItemId('5', 'Release newsletter')}`);
    const sent = JSON.parse(prompts[0]!.user) as { messages: Array<{ id: string }> };
    // Sensitive money talk and one-word messages are never sent; the system prompt labels the rest untrusted.
    expect(sent.messages.map((message) => message.id)).toEqual(['1', '2', '5']);
    expect(prompts[0]!.system).toMatch(/untrusted data/u);
  });

  it('skips messages a note already quotes, including a passage captured in the moment, and calls no model when nothing is left', async () => {
    const quoted = setup(async () => JSON.stringify({ captures: [] }), {
      'Inbox/2026-11-14 Desk.md': note('Desk', '11111111', 'we should look into a standing desk for the office'),
      'Inbox/2026-11-14 Passage.md': note('Passage', '22222222', 'a newsletter for the team about the release'),
      'Inbox/2026-11-14 Weather.md': note('Weather', '33333333', 'what is the weather tomorrow'),
    });
    expect(await quoted.audit.run(signal)).toEqual({ status: 'done', captured: 0 });
    expect(quoted.prompts).toHaveLength(0);
  });

  it('saves nothing for an invalid answer, an unknown message id, too many captures or an unavailable model', async () => {
    for (const model of [
      async () => 'nope',
      async () => JSON.stringify({ captures: [{ messageId: '99', title: 'x', note: '' }] }),
      async () => JSON.stringify({ captures: [{ messageId: '1', title: 'x', note: '', extra: 1 }] }),
      async () => JSON.stringify({ captures: new Array(6).fill(0).map((_value, index) => ({ messageId: String(index), title: 'x', note: '' })) }),
      async () => undefined,
      async () => { throw new Error('down'); },
    ]) {
      const { audit, files } = setup(model);
      expect((await audit.run(signal)).captured).toBe(0);
      expect(files.size).toBe(0);
    }
    expect(parseAudit(JSON.stringify({ captures: [] }), [])).toEqual([]);
    expect(quotedWords('# T\n\n> Dan, 1 Nov 10:00, voice: "a\n> b"\n\nbody')).toBe('a b');
  });

  it('is idempotent: running again never saves the same thought twice', async () => {
    const memory = memoryVault();
    const store = createInboxStore({ vault: memory.vault, now: () => sundayEvening });
    const audit = createMissedCaptureAudit({
      store, model: async () => JSON.stringify({ captures: [{ messageId: '5', title: 'Release newsletter', note: '' }] }),
      messages: async () => messages, now: () => sundayEvening,
    });
    await audit.run(signal);
    expect(await audit.run(signal)).toMatchObject({ captured: 0 });
    expect(memory.files.size).toBe(1);
  });
});

describe('weekly review and nudge style', () => {
  function pass(model: () => Promise<string | undefined>, saved: string[] = []) {
    const memory = memoryVault({ 'Inbox/2026-11-01 Padel.md': note('Padel', '11111111'), 'Inbox/2026-11-02 Tax.md': note('Tax', '22222222') });
    const store = createInboxStore({ vault: memory.vault, now: () => sundayEvening });
    const { store: indexStore } = indexStoreFor(memory.files);
    const index = createInboxIndex({ store: indexStore, inbox: store, now: () => sundayEvening });
    const prompts: string[] = [];
    return {
      prompts,
      pass: createInboxNudgePass({
        store, index, now: () => sundayEvening,
        model: async (prompt) => { prompts.push(prompt.system); return model(); },
        delivery: { deliver: async () => null },
        reactions: { thumb: async () => null },
        nudgeStyle: async () => 'likes weekend suggestions in the morning',
        saveNudgeStyle: async (style) => { saved.push(style); },
      }),
    };
  }

  it('asks for the nudge style only in the weekly review and saves a valid rewrite', async () => {
    const saved: string[] = [];
    const weekly = pass(async () => JSON.stringify({ nudge: null, rewrites: [], nudgeStyle: 'Prefers short weekend suggestions in the morning; dislikes repeats.' }), saved);
    expect(await weekly.pass.run(signal, 'weekly')).toMatchObject({ status: 'done' });
    expect(saved).toEqual(['Prefers short weekend suggestions in the morning; dislikes repeats.']);
    expect(weekly.prompts[0]).toMatch(/weekly deep review/u);
    expect(weekly.prompts[0]).toContain('likes weekend suggestions in the morning');

    const slot = pass(async () => JSON.stringify({ nudge: null, rewrites: [], nudgeStyle: 'x' }), saved);
    expect(await slot.pass.run(signal, 'slot')).toEqual({ status: 'skipped', reason: 'invalid_model_output' });
    expect(slot.prompts[0]).not.toMatch(/weekly deep review/u);
    expect(saved).toHaveLength(1);
  });

  it('rejects an over-long or link-bearing style', () => {
    const digest = buildDigest([], [], sundayEvening);
    expect(parseReview(JSON.stringify({ nudge: null, nudgeStyle: 'x'.repeat(601) }), digest, 'weekly')).toBeUndefined();
    expect(parseReview(JSON.stringify({ nudge: null, nudgeStyle: 'see https://example.com' }), digest, 'weekly')).toBeUndefined();
    expect(parseReview(JSON.stringify({ nudge: null, nudgeStyle: 5 }), digest, 'weekly')).toBeUndefined();
  });
});

describe('inbox work in the proactive run', () => {
  function proactive(spent = 0) {
    const ledger = createMemoryProactiveStore(owner).spend;
    const store = {
      settings: { read: async () => ({ paused: false, monthlyBudgetDkk: 100, sources: { notes: true } }) },
      spend: { monthTotal: async (month: string) => spent + await ledger.monthTotal(month), record: ledger.record },
    };
    const context = { runId: 'run-1', trigger: 'scheduled', now: sundayEvening, signal, findings: [], facts: [], sources: [] } as unknown as FindingsStoredContext;
    return { store, ledger, context };
  }

  type PassOutcome = { status: 'done'; nudged: { itemId: string; tier: string } | null; rewrites: number } | { status: 'skipped'; reason: string };

  function harness(options: { spent?: number; at?: Date; slot?: PassOutcome; weekly?: PassOutcome; audit?: { status: 'done' | 'skipped'; captured: number } } = {}) {
    const { store, ledger, context } = proactive(options.spent);
    const { ops, state, spend } = memoryOps();
    const usage: FoundryModelUsage[] = [];
    const calls: string[] = [];
    const take = () => usage.splice(0);
    const used = () => usage.push({ role: 'chat', model: 'gpt-5.6-luna', inputTokens: 10_000, outputTokens: 1_000, eventId: randomUUID() });
    const hook = createInboxNudgeHook({
      store: store as never, ops, takeUsage: take, now: () => options.at ?? sundayEvening,
      pass: () => ({ run: async (_signal: AbortSignal, mode: string, allow?: { nudge?: boolean }) => {
        calls.push(`pass:${mode}${allow?.nudge === false ? ':no-nudge' : ''}`); used();
        return mode === 'weekly' ? options.weekly ?? { status: 'done', nudged: null, rewrites: 0 } : options.slot ?? { status: 'done', nudged: null, rewrites: 0 };
      } }) as never,
      audit: { run: async () => { calls.push('audit'); used(); return options.audit ?? { status: 'done', captured: 0 }; } } as never,
    });
    return { hook, context, calls, state, spend, ledger };
  }

  it('runs the review, then the daily audit at the evening run and the weekly review on Sunday, each once a day', async () => {
    const { hook, context, calls, state, spend, ledger } = harness();
    await ledger.record({ runId: context.runId, month: '2026-11', inputTokens: 100, outputTokens: 20,
      estimatedDkk: 0.2, createdAt: sundayEvening });
    await hook(context);
    expect(calls).toEqual(['pass:slot', 'audit', 'pass:weekly']);
    expect(state.get(AUDIT_DAY_KEY)).toBe('2026-11-15');
    expect(state.get(WEEKLY_WEEK_KEY)).toBe('2026-11-15');
    expect(spend.map((row) => [row.kind, row.calls])).toEqual([['review', 1], ['audit', 1], ['weekly', 1]]);
    expect(await ledger.monthTotal('2026-11')).toBeCloseTo(0.2 + spend.reduce((sum, row) => sum + row.estimatedDkk, 0), 8);
    calls.length = 0;
    await hook(context);
    expect(calls).toEqual(['pass:slot']);
  });

  it('lets the weekly review tidy and learn but not nudge when the slot review already nudged', async () => {
    const { hook, context, calls } = harness({ slot: { status: 'done', nudged: { itemId: '11111111', tier: 'medium' }, rewrites: 0 } });
    await hook(context);
    expect(calls).toEqual(['pass:slot', 'audit', 'pass:weekly:no-nudge']);
  });

  it('keeps a failed audit or weekly review due, and counts an empty one as finished', async () => {
    const failing = harness({ audit: { status: 'skipped', captured: 0 }, weekly: { status: 'skipped', reason: 'model_unavailable' } });
    await failing.hook(failing.context);
    expect(failing.state.has(AUDIT_DAY_KEY)).toBe(false);
    expect(failing.state.has(WEEKLY_WEEK_KEY)).toBe(false);
    failing.calls.length = 0;
    await failing.hook(failing.context);
    expect(failing.calls).toEqual(['pass:slot', 'audit', 'pass:weekly']);
    const empty = harness({ weekly: { status: 'skipped', reason: 'nothing_to_review' } });
    await empty.hook(empty.context);
    expect(empty.state.get(WEEKLY_WEEK_KEY)).toBe('2026-11-15');
  });

  it('runs only the review at the morning run on a weekday', async () => {
    const { hook, context, calls } = harness({ at: new Date('2026-11-17T06:05:00Z') });
    await hook(context);
    expect(calls).toEqual(['pass:slot']);
  });

  it('stops the audit and the weekly review first when the month passes the 80% warning', async () => {
    const { hook, context, calls } = harness({ spent: 85 });
    await hook(context);
    expect(calls).toEqual(['pass:slot']);
  });

  it('honours the inbox\'s own daily ceiling across replicas from the persisted ledger', async () => {
    const { store, context } = proactive();
    const { ops, spend } = memoryOps();
    spend.push({ day: '2026-11-15', kind: 'review', calls: 3, inputTokens: 1, outputTokens: 1, estimatedDkk: 1.2 });
    const run = vi.fn();
    await createInboxNudgeHook({ store: store as never, ops, takeUsage: () => [], now: () => sundayEvening, pass: () => ({ run }) as never })(context);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('inbox status and nudge-style tool', () => {
  it('shows the owner what is live, nudged and spent, and refuses everyone else', async () => {
    const { ops, state, spend } = memoryOps();
    state.set(NUDGE_STYLE_KEY, 'style');
    state.set(AUDIT_DAY_KEY, '2026-11-14');
    spend.push({ day: '2026-11-15', kind: 'review', calls: 2, inputTokens: 100, outputTokens: 10, estimatedDkk: 0.05 },
      { day: '2026-11-10', kind: 'triage', calls: 1, inputTokens: 10, outputTokens: 5, estimatedDkk: 0.02 });
    const files = new Map([
      ['Inbox/2026-11-01 Padel.md', note('Padel', '11111111')],
      ['Inbox/2026-11-15 Imported.md', note('Imported', '22222222')],
    ]);
    const { rows, store } = indexStoreFor(files);
    rows.set('11111111', { ...rows.get('11111111')!, lastNudgedAt: new Date('2026-11-14T06:00:00Z'), lastNudgeItemId: randomUUID(), lastFeedback: 'up' });
    // The initial vault import starts this item's cooldown before any proactive card has been issued.
    rows.set('22222222', { ...rows.get('22222222')!, lastNudgedAt: sundayEvening });
    const memory = memoryVault();
    const inbox = createInboxStore({ vault: memory.vault });
    const index = createInboxIndex({ store, inbox });
    const build = (objectId: string) => buildApp(config, undefined, {
      modules: [{ id: 'inbox-status', tools: [], registerRoutes: createInboxStatusRoute({ ownerObjectId: owner, index, ops, nudgesEnabled: true, now: () => sundayEvening }) }],
      auth: async () => ({ objectId, tenantId: config.auth.tenantId, displayName: 'x' }),
    });
    const app = build(owner);
    const other = build('someone-else');
    try {
      const headers = { authorization: `${['Bear', 'er'].join('')} a.b.c` };
      const response = await app.inject({ method: 'GET', url: '/inbox/status', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        nudgesEnabled: true,
        items: { live: 2, nudgedLast7Days: 1, thumbsUp: 1, thumbsDown: 0 },
        spend: { dailyCeiling: 1, today: 0.05, last30Days: 0.07, byKindLast30Days: { review: { calls: 2, dkk: 0.05 }, triage: { calls: 1, dkk: 0.02 } } },
        nudgeStyleSet: true, lastAuditDay: '2026-11-14', lastWeeklyReviewDay: null,
      });
      expect((await other.inject({ method: 'GET', url: '/inbox/status', headers })).statusCode).toBe(403);
    } finally {
      await app.close();
      await other.close();
    }
  });

  it('reads the ledger with Copenhagen dates, like the writers', async () => {
    const { ops, spend } = memoryOps();
    spend.push({ day: '2026-11-16', kind: 'review', calls: 1, inputTokens: 1, outputTokens: 1, estimatedDkk: 0.03 },
      { day: '2026-11-15', kind: 'review', calls: 1, inputTokens: 1, outputTokens: 1, estimatedDkk: 0.2 });
    const memory = memoryVault();
    const app = buildApp(config, undefined, {
      modules: [{ id: 'inbox-status', tools: [], registerRoutes: createInboxStatusRoute({
        ownerObjectId: owner, ops, nudgesEnabled: false, now: () => new Date('2026-11-15T23:30:00Z'),
      }) }],
      auth: async () => ({ objectId: owner, tenantId: config.auth.tenantId, displayName: 'x' }),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/inbox/status', headers: { authorization: `${['Bear', 'er'].join('')} a.b.c` } });
      // 23:30 UTC on the 15th is already the 16th in Copenhagen.
      expect(response.json().spend).toMatchObject({ today: 0.03, last30Days: 0.23 });
    } finally { await app.close(); }
    expect(memory.files.size).toBe(0);
  });

  it('reads, sets and resets the nudge style only on Dan\'s stored word', async () => {
    const { ops, state } = memoryOps();
    const memory = memoryVault();
    const module = createInboxModule({
      store: createInboxStore({ vault: memory.vault }), ops,
      memoryStore: { getSourceMessage: async (id) => id === '42' ? { messageId: id, text: 'reset it' } : null },
    });
    const tool = module.tools.find((entry) => entry.name === 'inbox_nudge_style')!;
    const request = (messageId: string | null = '42') => ({
      principal: { objectId: owner }, server: { ownerObjectId: owner },
      headers: messageId === null ? {} : { 'x-jarvis-message-id': messageId }, log: { warn: vi.fn() },
    }) as unknown as FastifyRequest;
    expect(await tool.execute({ operation: 'get' }, request(null), signal)).toEqual({ text: '' });
    await expect(tool.execute({ operation: 'set', text: 'mornings only' }, request(null), signal)).rejects.toThrow(/no stored Dan message/u);
    await tool.execute({ operation: 'set', text: 'mornings only' }, request(), signal);
    expect(state.get(NUDGE_STYLE_KEY)).toBe('mornings only');
    expect(await tool.execute({ operation: 'get' }, request(null), signal)).toEqual({ text: 'mornings only' });
    await expect(tool.execute({ operation: 'set', text: 'see https://x.example' }, request(), signal)).rejects.toThrow(/links/u);
    await tool.execute({ operation: 'reset' }, request(), signal);
    expect(state.has(NUDGE_STYLE_KEY)).toBe(false);
    expect(tool.validateInput?.({ operation: 'set' })).toBe(false);
    expect(createInboxModule({ store: createInboxStore({ vault: memory.vault }), memoryStore: { getSourceMessage: async () => null } })
      .tools.some((entry) => entry.name === 'inbox_nudge_style')).toBe(false);
  });
});
