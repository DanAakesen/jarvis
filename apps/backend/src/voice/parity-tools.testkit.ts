import { createHash } from 'node:crypto';
import type { VaultIndexStore } from '../database/memory-store.js';
import { readAttachedOwnerMessage } from '../core/owner-message.js';
import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import { gymTools } from '../health/tools/gym.js';
import type { BackendModule } from '../modules.js';
import { createVaultModule } from '../vault/index.js';
import { VaultWriteConflictError, type createGitHubVaultClient } from '../vault/github-client.js';
import type { MemoryConversationStore } from './parity-memory-store.testkit.js';

/**
 * The daily-core tools Dan uses most: Jarvis work (Factory/GitHub), notes, tasks, gym lifts and nutrition. Notes, tasks and gym are
 * the production tool code on in-memory vault, index and lift stores. Factory and nutrition are contract fixtures with the real tool
 * names and result shapes, because their stores are SQL- or GitHub-backed: they read the owner message the same way the real ones do,
 * so they carry the same channel facts, but they say nothing about the real tools' own logic.
 */

export interface FakeVault {
  readonly files: Map<string, { content: string; sha: string }>;
  readonly writes: Array<{ path: string; expectedSha: string | undefined }>;
}

const shaOf = (content: string) => createHash('sha1').update(content).digest('hex');

function createFakeVault(today: string): { vault: FakeVault; client: unknown; indexStore: VaultIndexStore } {
  const files: FakeVault['files'] = new Map();
  const writes: FakeVault['writes'] = [];
  const put = (path: string, content: string) => { const sha = shaOf(content); files.set(path, { content, sha }); return sha; };
  put('Personal/Task inbox.md', `# Task inbox\n\n- [ ] Pay rent 📅 ${today}\n`);
  put('Personal/Ideas.md', '# Ideas\n\nA reading list for the winter.\n');
  const client = {
    async read(path: string) { const file = files.get(path); return file ? { path, sha: file.sha, content: file.content } : null; },
    async write(path: string, content: string, _message: string, expectedSha: string | undefined) {
      writes.push({ path, expectedSha });
      if (files.get(path)?.sha !== expectedSha) throw new VaultWriteConflictError();
      return put(path, content);
    },
    async tree() { return [...files].map(([path, file]) => ({ path, sha: file.sha, size: Buffer.byteLength(file.content) })); },
  };
  const hits = (terms: readonly string[], limit: number) => [...files].filter(([path]) => !path.endsWith('Task inbox.md'))
    .filter(([, file]) => terms.some(term => file.content.toLowerCase().includes(term.toLowerCase())))
    .slice(0, limit).map(([path, file]) => ({ path, heading: path.replace(/\.md$/u, ''), content: file.content, score: 1 }));
  const indexStore = {
    async initialize() {},
    supportsVectorSearch: () => false,
    async summary() { return { notes: files.size, chunks: files.size, embeddedChunks: 0, latestIndexedAt: null }; },
    async files() { return []; },
    async replaceFile() {},
    async deleteFiles() {},
    async graphFiles() { return []; },
    async graphData() { return { links: [], similarities: [], embeddings: [] }; },
    async searchByVector() { return []; },
    // Reads the vault directly, so a note saved a moment ago is found without waiting for the background index.
    async searchByTerms(terms: readonly string[], limit: number) { return hits(terms, limit); },
  } as unknown as VaultIndexStore;
  return { vault: { files, writes }, client, indexStore };
}

export interface FakeGym {
  readonly lifts: Array<Record<string, unknown>>;
}

function createFakeGym(): { gym: FakeGym; access: Parameters<typeof gymTools>[0] } {
  const lifts: FakeGym['lifts'] = [
    { id: '00000000-0000-4000-8000-0000000000a1', exerciseName: 'Squat', weightKg: 100, reps: 5, sets: 1, performedAt: '2026-11-16T17:00:00.000Z', deletedAt: null, updatedAt: '2026-11-16T17:00:00.000Z', revision: 1, workoutId: null, vault: 'synced', idempotencyKey: 'seed-1' },
    { id: '00000000-0000-4000-8000-0000000000a2', exerciseName: 'Deadlift', weightKg: 120, reps: 3, sets: 1, performedAt: '2026-11-17T17:30:00.000Z', deletedAt: null, updatedAt: '2026-11-17T17:30:00.000Z', revision: 1, workoutId: null, vault: 'synced', idempotencyKey: 'seed-2' },
  ];
  const present = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'idempotencyKey'));
  const store = {
    async history({ limit }: { limit: number }) {
      return { items: [...lifts].sort((a, b) => String(b.performedAt).localeCompare(String(a.performedAt))).slice(0, limit).map(present), next: null };
    },
    async create(value: Record<string, unknown>) {
      const existing = lifts.find(entry => entry.idempotencyKey === value.idempotencyKey);
      if (existing) return { entry: present(existing), replayed: true };
      const entry = {
        id: `00000000-0000-4000-8000-${String(lifts.length + 1).padStart(12, '0')}`, exerciseName: value.exerciseName, weightKg: value.weightKg,
        reps: value.reps, sets: value.sets, performedAt: value.performedAt, deletedAt: null, updatedAt: value.performedAt, revision: 1,
        workoutId: value.workoutId ?? null, vault: 'pending', idempotencyKey: value.idempotencyKey,
      };
      lifts.push(entry);
      return { entry: present(entry), replayed: false };
    },
    async update() { return null; },
    async delete() { return null; },
  };
  return { gym: { lifts }, access: { lifts: () => store, workouts: () => ({ ...store, history: async () => ({ items: [] }) }) } as never };
}

export interface FactoryFixture { readonly issues: Array<{ title: string; body: string; executor: string; ownerMessage: string }> }
export interface NutritionFixture {
  readonly meals: Array<{ name: string; kcal: number; proteinGrams: number; fatGrams: number; captureMethod: string; ownerMessage: string }>;
}

const targets = { energyKcal: 2400, proteinGrams: 160 };

function fixtureTools(store: MemoryConversationStore): { tools: JarvisTool[]; factory: FactoryFixture; nutrition: NutritionFixture } {
  const factory: FactoryFixture = { issues: [] };
  const nutrition: NutritionFixture = { meals: [] };
  const owner = async (request: Parameters<JarvisTool['execute']>[1], signal: AbortSignal) => {
    const message = await readAttachedOwnerMessage(request, signal);
    if (!message) throw new ToolRefusal('A verified Dan message is required for this change.');
    return message;
  };
  const tools: JarvisTool[] = [
    {
      name: 'get_work_status',
      description: 'Status of Jarvis work: the project, its Factory tasks, pull requests and deployments. Read-only. Fixture with the real tool name and result shape.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 100 }, project: { type: 'string', maxLength: 80 } }, additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async () => ({
        verdict: 'in_progress', project: 'jarvis', issue: null,
        tasks: [{ id: '412', title: 'Keep chat and voice behaving the same', state: 'running' }],
        pullRequests: [{ number: 2004, title: 'Let native harness calls finish', state: 'merged' }], deployments: [], warnings: [], partial: false,
      }),
    },
    {
      name: 'create_issue',
      description: 'Create a GitHub issue for the work Dan describes in Jarvis\'s own repository, without another approval. Fixture with the real tool name and result shape.',
      inputSchema: {
        type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 4000 }, executor: { type: 'string', enum: ['jarvis', 'copilot', 'none'] }, project: { type: 'string', maxLength: 80 } },
        required: ['title', 'body'], additionalProperties: false,
      },
      execution: { defaultEffect: 'action' },
      execute: async (input, request, signal) => {
        const source = await owner(request, signal);
        const { title, body, executor } = input as { title: string; body: string; executor?: string };
        if (!factory.issues.some(issue => issue.ownerMessage === source.id && issue.title === title)) {
          factory.issues.push({ title, body, executor: executor ?? 'jarvis', ownerMessage: source.id });
        }
        return { status: 'created', repository: 'DanAakesen/jarvis', taskCode: 'P11-211', title: `P11-211: ${title}`, issue: 2011 };
      },
    },
    {
      name: 'health_food_review',
      description: 'Log an estimated meal Dan describes (change.operation log_estimate) from food, portion and preparation, without another approval. Fixture with the real tool name and result shape.',
      inputSchema: {
        type: 'object',
        properties: { change: { type: 'object', properties: { operation: { type: 'string', enum: ['log_estimate', 'correct', 'delete'] }, food: { type: 'object' } }, required: ['operation'], additionalProperties: false } },
        required: ['change'], additionalProperties: false,
      },
      execution: { defaultEffect: 'action' },
      execute: async (input, request, signal) => {
        const source = await owner(request, signal);
        // The real tool records how the meal was captured from the session it was said in: typed text or voice.
        const captureMethod = (await store.getSession(source.sessionId))?.channel === 'voice' ? 'voice' : 'text';
        const food = (input as { change: { food: { mealName: string } } }).change.food;
        const meal = { name: food.mealName, kcal: 330, proteinGrams: 40, fatGrams: 4, captureMethod, ownerMessage: source.id };
        if (!nutrition.meals.some(existing => existing.ownerMessage === source.id)) nutrition.meals.push(meal);
        const presentation = `Estimated nutrition (not measured):\n- Protein: ${meal.proteinGrams} g\n- Calories: ${meal.kcal} kcal\n- Fat: ${meal.fatGrams} g`;
        request.server.nowEventHub.publish({ type: 'food_estimate_result', sessionId: source.sessionId, sourceMessageId: source.id, summary: presentation });
        return { status: 'committed', record: { id: 'meal-1', mealName: meal.name, energyKcal: meal.kcal, proteinGrams: meal.proteinGrams, captureMethod }, presentation };
      },
    },
    {
      name: 'health_query',
      description: 'Read the logged nutrition totals for a day. Read-only. Fixture with the real tool name and result shape.',
      inputSchema: { type: 'object', properties: { source: { type: 'string', enum: ['nutrition'] }, date: { type: 'string', maxLength: 10 } }, required: ['source'], additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async () => ({
        date: 'today', energyKcal: nutrition.meals.reduce((sum, meal) => sum + meal.kcal, 0), proteinGrams: nutrition.meals.reduce((sum, meal) => sum + meal.proteinGrams, 0),
        meals: nutrition.meals.length,
      }),
    },
    {
      name: 'health_nutrition_targets',
      description: 'Read Dan\'s daily nutrition targets. Read-only. Fixture with the real tool name and result shape.',
      inputSchema: { type: 'object', properties: { operation: { type: 'string', enum: ['read'] } }, required: ['operation'], additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async () => ({ targets }),
    },
  ];
  return { tools, factory, nutrition };
}

export interface DailyCore {
  readonly modules: BackendModule[];
  readonly vault: FakeVault;
  readonly gym: FakeGym;
  readonly factory: FactoryFixture;
  readonly nutrition: NutritionFixture;
}

export function createDailyCore(store: MemoryConversationStore, today: string): DailyCore {
  const { vault, client, indexStore } = createFakeVault(today);
  const { gym, access } = createFakeGym();
  const { tools, factory, nutrition } = fixtureTools(store);
  const vaultModule = createVaultModule({
    client: client as ReturnType<typeof createGitHubVaultClient>, indexStore,
    memoryStore: {
      getSourceMessage: async (messageId: string) => {
        const message = store.messages.find(candidate => candidate.id === messageId && candidate.role === 'dan');
        return message ? { messageId, text: message.text } : null;
      },
    } as never,
  });
  return {
    modules: [vaultModule, { id: 'gym', tools: gymTools(access), registerRoutes: async () => {} }, { id: 'factory-fixture', tools, registerRoutes: async () => {} }],
    vault, gym, factory, nutrition,
  };
}
