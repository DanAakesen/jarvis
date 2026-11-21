import { createInboxIndex, type InboxIndexRow, type InboxIndexStore } from '../../../inbox/item-index.js';
import { createInboxModule } from '../../../inbox/module.js';
import { appendTrail, composeNote, inboxPath, closedPathFor } from '../../../inbox/note.js';
import { createInboxStore } from '../../../inbox/store.js';
import { createMemoryModule } from '../../../core/memory.js';
import type { BackendModule } from '../../../modules.js';
import { createMemoryOwnerReminderStore } from '../../../proactive/owner-reminder-store.js';
import { createMemoryProactiveStore } from '../../../proactive/store.js';
import { dayKey, localTimeLabel } from '../../../proactive/time.js';
import { parseTodosWithContext } from '../../../proactive/todo-file.js';
import { createProactiveToolsModule } from '../../../proactive/tools.js';
import { createVaultModule } from '../../../vault/index.js';
import { ownerMessageSource } from '../shared.testkit.js';
import type { ConformanceContext } from '../types.testkit.js';
import { createHashEmbedder, createMemoryStoreFake, type ConformanceMemoryStore, type MemorySeed } from './notes-memory.testkit.js';
import { createMemoryVault, createVaultIndexFake, type MemoryVault } from './notes-vault.testkit.js';

/**
 * Everything the notes group runs on: the stores (vault, vault index, memory, inbox, proactive findings, owner reminders), their
 * seeded data, and the production modules composed over them the way index.ts composes them.
 */

const dayMs = 86_400_000;

/** A Copenhagen calendar day counted from today (negative for the past), as YYYY-MM-DD. */
export function calendarDay(offset: number, from = new Date()): string {
  const [year, month, day] = dayKey(from).split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + offset)).toISOString().slice(0, 10);
}

/** The next date (after today) that falls on a weekday: 0 is Sunday, 5 is Friday. */
export function nextWeekday(weekday: number): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = calendarDay(offset);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === weekday) return day;
  }
  throw new Error('Every weekday occurs within seven days.');
}

export const personalTasks = 'Personal/Task inbox.md';
export const workTasks = 'Work/Task inbox.md';

/** The id of the inbox notes the group seeds, so cases can name them. */
export const inboxIds = { standingDesk: 'a1b2c3d4', gardenBeds: 'b2c3d4e5', bikeLight: 'c3d4e5f6' } as const;

const memorySeeds: readonly MemorySeed[] = [
  { category: 'preference', key: 'coffee', content: 'Dan prefers his coffee black.', sourceMessageId: '31', sourceText: 'Remember that I prefer my coffee black' },
  { category: 'project_fact', key: 'jarvis-hosting', content: 'The Jarvis backend runs on Azure Container Apps in Denmark.', sourceMessageId: '32', sourceText: 'Remember that the Jarvis backend runs on Azure Container Apps in Denmark' },
  {
    category: 'decision', key: 'notes-home', content: 'Notes live in the DanAakesen vault repository on GitHub.', sourceMessageId: '33',
    sourceText: 'Remember that my notes live in the vault repository on GitHub', earlier: ['Notes live in a OneNote notebook.'],
  },
  { category: 'unfinished_task', key: 'bike-service', content: 'Book the bike in for a service before spring.', sourceMessageId: '34', sourceText: 'Remember that I need to service the bike before spring' },
];

function inboxIndexFake(): InboxIndexStore {
  const rows = new Map<string, InboxIndexRow>();
  const row = (value: Partial<InboxIndexRow> & { itemId: string }): InboxIndexRow => ({
    path: null, sha: null, lastNudgedAt: null, lastNudgeItemId: null, lastFeedback: null, lastFeedbackAt: null, createdAt: new Date(), ...value,
  });
  const store: InboxIndexStore = {
    async all() { return [...rows.values()]; },
    async get(itemId) { return rows.get(itemId) ?? null; },
    async reserve(itemId) {
      const existing = rows.get(itemId);
      if (existing) return { row: existing, inserted: false };
      const created = row({ itemId });
      rows.set(itemId, created);
      return { row: created, inserted: true };
    },
    async upsert(value) {
      const existing = rows.get(value.itemId);
      rows.set(value.itemId, existing ? { ...existing, path: value.path, sha: value.sha } : row({ itemId: value.itemId, path: value.path, sha: value.sha, lastNudgedAt: value.lastNudgedAt ?? null }));
    },
    async upsertMany(values, signal) { for (const value of values) await store.upsert(value, signal); },
    async remove(ids) { for (const id of ids) rows.delete(id); },
    async markNudged(itemId, at, _signal, nudgeItemId) {
      const existing = rows.get(itemId);
      if (existing) rows.set(itemId, { ...existing, lastNudgedAt: at, lastNudgeItemId: nudgeItemId ?? null });
      return existing !== undefined;
    },
    async setFeedback(itemId, feedback, at) {
      const existing = rows.get(itemId);
      if (existing) rows.set(itemId, { ...existing, lastFeedback: feedback, lastFeedbackAt: at });
      return existing !== undefined;
    },
  };
  return store;
}

function seedVault(vault: MemoryVault, today: string): void {
  vault.seed('Personal/Reading list.md', '# Reading list\n\n- The Pragmatic Programmer\n- Designing Data-Intensive Applications\n- A Philosophy of Software Design\n\nFinish one book a month.\n');
  vault.seed('Personal/Garden beds.md', '# Garden beds\n\nThe south bed gets tomatoes and basil in May. The north bed stays shaded, so lettuce and spinach go there.\n');
  vault.seed('Work/Meeting notes.md', '# Meeting notes\n\n## Jarvis weekly sync\n\nDecided to ship the notes search on Friday and read the release notes before the demo.\n');
  vault.seed('Work/Jarvis roadmap.md', '# Jarvis roadmap\n\nNext up: better note search, reminders that follow tasks and a calmer inbox. Ask [[Anna]] for the demo agenda.\n');
  vault.seed('People/Anna.md', '# Anna\n\nColleague on the Jarvis project. Prefers short written updates over calls.\n');
  vault.seed('General/Old shopping list.md', '# Old shopping list\n\nMilk, bread and coffee filters.\n');
  vault.seed(personalTasks, [
    '# Inbox', '',
    `- [ ] Call the dentist 📅 ${today} ⏫`,
    `- [ ] Renew the library books 📅 ${calendarDay(2)} 🔼`,
    `- [ ] Send the quarterly report 📅 ${calendarDay(3)}`,
    `- [ ] Pay the electricity bill 📅 ${calendarDay(7)}`,
    '- [x] Renew the bike lock', '',
  ].join('\n'));
  vault.seed(workTasks, [
    '# Inbox', '',
    `- [ ] Review the Jarvis release notes 📅 ${calendarDay(2)} ⏫`,
    '- [ ] Book a room for the demo', '',
  ].join('\n'));
}

function seedInbox(vault: MemoryVault): void {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * dayMs);
  const note = (id: string, title: string, text: string, quote: string, daysAgo: number) => ({
    path: inboxPath(calendarDay(-daysAgo), title), content: composeNote({ title, note: text, quote, source: 'chat' }, id, at(daysAgo)),
  });
  for (const item of [
    note(inboxIds.standingDesk, 'Look into a standing desk', 'Compare a few models for the home office and check the price.', 'I should look into a standing desk for the office', 2),
    note(inboxIds.gardenBeds, 'Plan the garden beds', 'Decide what goes in the south and north beds before May.', 'I need to plan the garden beds', 1),
  ]) vault.seed(item.path, item.content);
  const closed = note(inboxIds.bikeLight, 'Fix the bike light', 'The front light flickers on bumps.', 'The front bike light flickers', 9);
  vault.seed(closedPathFor(closed.path), appendTrail(closed.content, 'closed: done, fixed with a new bulb', at(8), inboxIds.bikeLight));
}

export interface NotesFixtures {
  readonly vault: MemoryVault;
  readonly memory: ConformanceMemoryStore;
  readonly proactive: ReturnType<typeof createMemoryProactiveStore>;
  readonly reminders: ReturnType<typeof createMemoryOwnerReminderStore>;
  /** The ids of the seeded proactive findings, in the order they were seeded (known once the seeding settled). */
  readonly findingIds: string[];
  /** What the production vault module reports each time it records a knowledge graph. */
  readonly recordedGraphs: { query: string; highlight: readonly string[] }[];
  readonly today: string;
  readonly modules: readonly BackendModule[];
}

export function createNotesFixtures(context: ConformanceContext): NotesFixtures {
  const today = calendarDay(0);
  const source = ownerMessageSource(context);
  // The memory store answers with the stored message id too (`MemorySource.messageId`), which memory tools save as provenance.
  const sourceMessages = {
    getSourceMessage: async (id: string) => {
      const found = await source.getSourceMessage(id);
      return found ? { messageId: found.id, text: found.text } : null;
    },
  };

  const vault = createMemoryVault();
  seedVault(vault, today);
  seedInbox(vault);
  const memory = createMemoryStoreFake({ getSourceMessage: sourceMessages.getSourceMessage, seeds: memorySeeds });
  const embedder = createHashEmbedder();
  const recordedGraphs: NotesFixtures['recordedGraphs'] = [];

  const vaultModule = createVaultModule({
    client: vault, indexStore: createVaultIndexFake(), memoryStore: sourceMessages, apiMemoryStore: memory, embedder,
    recordWorkspaceGraph: async (query, highlight) => { recordedGraphs.push({ query, highlight }); },
  });
  // Production synchronizes the vault index at startup and after every write. Every vault tool here first waits for the one in
  // flight, so a search sees the notes the call before it wrote (the real race, a search a moment after a write, is a product matter).
  const firstSync = vaultModule.synchronize(AbortSignal.timeout(60_000));
  void firstSync.catch(() => {});
  const syncSettled = async () => {
    await firstSync;
    while (vaultModule.syncStatus().outcome === 'pending') await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const vaultTools = vaultModule.tools.map((tool) => ({
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => { await syncSettled(); return tool.execute(...args); },
  }));

  const inboxStore = createInboxStore({ vault });
  const inboxIndex = createInboxIndex({ store: inboxIndexFake(), inbox: inboxStore });
  void inboxIndex.sync(AbortSignal.timeout(60_000)).catch(() => {});

  const proactive = createMemoryProactiveStore(context.owner);
  const findingIds: string[] = [];
  const observedAt = new Date().toISOString();
  for (const finding of [
    { dedupeKey: 'seed-dentist', title: 'Dentist appointment tomorrow at 09:00', body: 'Your calendar has a dentist appointment tomorrow at 09:00. Leave by 08:30.', category: 'prep', source: 'calendar' },
    { dedupeKey: 'seed-report', title: 'The quarterly report is due in three days', body: 'The task "Send the quarterly report" is due in three days.', category: 'deadline', source: 'todos' },
    { dedupeKey: 'seed-umbrella', title: 'Rain this afternoon', body: 'Rain is expected from 15:00 in Aarhus. Bring an umbrella for the bike ride home.', category: 'weather', source: 'weather' },
  ] as const) {
    void proactive.items.upsertFinding({
      dedupeKey: finding.dedupeKey, title: finding.title, body: finding.body, category: finding.category, urgency: 'normal', dueAt: null, runId: null,
      evidence: [{ source: finding.source, label: finding.source, observedAt }],
    }).then((item) => { findingIds.push(item.id); });
  }

  const reminders = createMemoryOwnerReminderStore();
  const todos = parseTodosWithContext(vault.files.get(personalTasks) ?? '', personalTasks);
  for (const [text, hours] of [['Send the quarterly report', 30], ['Pay the electricity bill', 72]] as const) {
    const todo = todos.find((candidate) => candidate.text === text);
    const fireAt = new Date(Date.now() + hours * 3_600_000);
    if (todo) {
      void reminders.create({
        idempotencyKey: `seed-${todo.taskIdentity}`, taskIdentity: todo.taskIdentity, taskTitle: todo.text, fireAt, localTime: localTimeLabel(fireAt),
        anchorDate: null, cadence: null, untilTaskDone: false,
      }, new Date());
    }
  }

  const proactiveModule = createProactiveToolsModule({
    enabled: true, ownerObjectId: context.owner, store: proactive, ownerReminders: reminders, vault,
  });
  if (!proactiveModule) throw new Error('The proactive tools module is enabled in the notes group.');

  return {
    vault, memory, proactive, reminders, findingIds, recordedGraphs, today,
    modules: [
      createMemoryModule({ store: memory, embedder, automaticCapture: async () => true }),
      { ...vaultModule, tools: vaultTools },
      createInboxModule({ store: inboxStore, index: inboxIndex, memoryStore: sourceMessages }),
      proactiveModule,
    ],
  };
}
