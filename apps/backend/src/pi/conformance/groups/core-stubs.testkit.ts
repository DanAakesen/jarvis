import type {
  BackgroundJob, BackgroundJobDetails, BackgroundJobStep, ModelDeployment, UsageEntry, WorkspaceSnapshot,
} from '@jarvis/contracts';
import type { FastifyInstance } from 'fastify';
import { defaultAwayModeState, setPresenceMode, updatePresenceMode, type AwayModeState, type AwayModeStore } from '../../../core/away-mode.js';
import type { ConversationStore } from '../../../core/conversation-store.js';
import { fallbackModelCatalogue, type ModelCatalogueReader } from '../../../core/model-catalog.js';
import { createModelDeploymentWorkflow, type ModelDeploymentClient, type ModelDeploymentWorkflow } from '../../../core/model-deployments.js';
import type { NowFeedStore } from '../../../core/now.js';
import { createOwnerInteractionService, type OwnerInteractionService } from '../../../core/owner-interactions.js';
import { recipeId, type RecipeDraft, type RecipeStore, type TaskRecipe } from '../../../core/task-recipes.js';
import { flattenSettings, type SettingsStore } from '../../../core/settings.js';
import type { UsageStore } from '../../../core/usage.js';
import { WorkspaceCommandBroker } from '../../../core/workspace-commands.js';
import type { CredentialStatus, CredentialStatusStore } from '../../../credentials/credential-status.js';
import type {
  BackgroundJobStore, ResearchJobRetryInput, StoredBackgroundJobDetails,
} from '../../../database/background-job-store.js';
import type { ConversationAttachmentStore } from '../../../database/conversation-attachment-store.js';
import type { ConversationSummaryRecord, ConversationSummaryStore } from '../../../database/conversation-summary-store.js';
import type { PhoneCallSession, PhoneSessionStore } from '../../../database/phone-session-store.js';
import type { TaskStatusNotificationStore } from '../../../database/task-status-notification-store.js';
import type { WebhookDeliveryStore } from '../../../github/webhook-delivery.js';
import type { ContainerAppScaler, MinimumReplicas } from '../../../operations/container-app-scale.js';
import { createSystemStatusReader, type SystemStatusProbe, type SystemStatusReader } from '../../../system-status.js';
import type { NotesFolderOrder, NotesFolderOrderStore } from '../../../vault/folder-order.js';
import type { ConformanceContext } from '../types.testkit.js';

/**
 * In-memory stand-ins for everything the core group's tools read and write: settings, usage, jobs, presence, the Now feed, the
 * model catalogue and deployments, credential status, attachments, routines, the logs query and a fake browser tab. They behave
 * like the production stores with healthy dependencies and keep the state a tool changes, so a later call sees it.
 */

const day = 24 * 60 * 60_000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * day).toISOString();

// ---- Settings, model catalogue and deployments ------------------------------------------------------------------------------

/** The settings table: JSON text per flattened key, exactly what the SQL store keeps. Dan has a saved home location, as the weather tool needs. */
export function createSettingsFake(): SettingsStore {
  const values = new Map<string, string>();
  const store: SettingsStore = {
    async read() { return Object.fromEntries(values); },
    async write(patch) { for (const { key, value } of flattenSettings(patch)) values.set(key, value); },
  };
  for (const { key, value } of flattenSettings({
    identity: { description: 'Dan lives in Aarhus, Denmark, and likes short answers.' },
    location: { city: 'Aarhus', latitude: 56.1629, longitude: 10.2039, observedAt: new Date().toISOString(), permission: 'granted' },
  })) values.set(key, value);
  return store;
}

const liveDeployments: readonly ModelDeployment[] = [
  ...fallbackModelCatalogue().deployments,
  {
    name: 'gpt-6.1-terra', model: 'gpt-6.1-terra', version: '2026-10-01', sku: 'GlobalStandard', capacity: 50,
    capabilities: ['chat', 'responses', 'image'], reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  },
];

/** The live Foundry catalogue (source `arm`), which the deployment tool changes. */
export function createModelCatalogueFake(): ModelCatalogueReader {
  const deployments: ModelDeployment[] = structuredClone([...liveDeployments]);
  return {
    read: async () => ({ source: 'arm', deployments: structuredClone(deployments) }),
    invalidate() {},
    // The deployment client below reads and writes this list.
    deployments,
  } as ModelCatalogueReader & { deployments: ModelDeployment[] };
}

export function createModelDeploymentFake(catalogue: ModelCatalogueReader, settings: SettingsStore, interactions: OwnerInteractionService): ModelDeploymentWorkflow {
  const { deployments } = catalogue as unknown as { deployments: ModelDeployment[] };
  const client: ModelDeploymentClient = {
    async create(deployment) {
      deployments.push({
        name: deployment.name, model: deployment.model, version: deployment.version, sku: deployment.sku, capacity: deployment.capacity,
        capabilities: ['chat', 'responses'], reasoningEfforts: ['none', 'low', 'medium', 'high'],
      });
    },
    async delete(name) {
      const index = deployments.findIndex((deployment) => deployment.name === name);
      if (index >= 0) deployments.splice(index, 1);
    },
  };
  return createModelDeploymentWorkflow({
    catalogue, settings, client,
    confirm: (kind, summary, action, signal) => interactions.runRequested(kind, summary, action, signal),
  });
}

// ---- Owner interactions ------------------------------------------------------------------------------------------------------

/** The production service over an in-memory confirmation table: outside a phone call it runs the action at once, as in production. */
export function createOwnerInteractionsFake(owner: string): OwnerInteractionService & { readonly notifications: { kind: string; text: string }[] } {
  const notifications: { kind: string; text: string }[] = [];
  const service = createOwnerInteractionService({
    ownerObjectId: owner,
    store: {
      async createConfirmation() {},
      async resolveConfirmation() { return null; },
      async expireConfirmation() { return false; },
      async expirePendingConfirmations() {},
      async cancelConfirmation() {},
      async consumeApproval() { return false; },
    },
    onWebNotification: async (kind, text) => { notifications.push({ kind, text }); },
  });
  return Object.assign(service, { notifications });
}

// ---- Presence ---------------------------------------------------------------------------------------------------------------

export function createAwayModeFake(): AwayModeStore {
  let state: AwayModeState = { ...defaultAwayModeState };
  return {
    async read() { return { ...state }; },
    async set(mode, source = 'manual', at = new Date()) {
      const update = updatePresenceMode(state, mode, source, at);
      state = update.state;
      return { ...state, ...(update.ignored ? { ignored: update.ignored } : {}) };
    },
    async markPresent(at = new Date()) {
      state = setPresenceMode(state, 'present', 'manual', at);
      return { ...state };
    },
  };
}

// ---- Usage ------------------------------------------------------------------------------------------------------------------

export function createUsageFake(): UsageStore {
  const entry = (at: string, fields: Partial<UsageEntry>): UsageEntry => ({
    taskId: null, taskTitle: null, projectId: null, projectName: null, agent: 'jarvis', source: 'jarvis_model', metric: 'input_tokens',
    quantity: 0, costUsd: null, costDkk: null, costStatus: 'estimated', role: null, model: null, at, estimated: true, ...fields,
  });
  const entries = (): UsageEntry[] => [
    entry(minutesAgo(5), { quantity: 18_400, costUsd: 0.046, costDkk: 0.32, role: 'chat', model: 'gpt-6.1-terra' }),
    entry(minutesAgo(5), { metric: 'output_tokens', quantity: 2_100, costUsd: 0.025, costDkk: 0.17, role: 'chat', model: 'gpt-6.1-terra' }),
    entry(daysAgo(2), { source: 'voice', metric: 'minutes', quantity: 4.5, costUsd: 0.18, costDkk: 1.25, role: 'voice', model: 'gpt-live-1' }),
    entry(daysAgo(9), { quantity: 96_000, costUsd: 0.012, costDkk: 0.08, costStatus: 'unverified', role: 'embeddings', model: 'text-embedding-3-small' }),
    entry(daysAgo(20), { source: 'codex', agent: 'codex', metric: 'turns', quantity: 14, role: 'research', costStatus: 'unverified' }),
    entry(daysAgo(60), { quantity: 41_000, costUsd: 0.1, costDkk: 0.7, role: 'chat', model: 'gpt-6-luna' }),
  ];
  return {
    async list(from, to) {
      const inRange = entries().filter((item) => {
        const at = Date.parse(item.at);
        return (from === null || at >= from.getTime()) && at <= to.getTime();
      });
      return {
        entries: inRange, totalEntries: String(inRange.length), healthToolCounts: [], healthCostTotals: [], monthlyCostTotals: [],
        toolCalls: [{ tool: 'research', count: '3', costStatus: 'unverified' }],
      };
    },
    async recordFoundryUsage() {},
  };
}

// ---- Background jobs --------------------------------------------------------------------------------------------------------

export const seededJobIds = {
  done: '00000000-0000-4000-8000-000000000001',
  failed: '00000000-0000-4000-8000-000000000002',
} as const;

/** The jobs table: durable job rows, their step history and dismissals. */
export function createBackgroundJobFake(): BackgroundJobStore {
  const jobs = new Map<string, BackgroundJob>();
  const steps = new Map<string, BackgroundJobStep[]>();
  const retry = new Map<string, ResearchJobRetryInput>();
  const retried = new Set<string>();
  const dismissed = new Set<string>();
  const stepOf = (job: BackgroundJob): BackgroundJobStep => ({
    status: job.status, step: job.step, ...(job.detail ? { detail: job.detail } : {}), ...(job.viewId ? { viewId: job.viewId } : {}), updatedAt: job.updatedAt,
  });
  const sorted = () => [...jobs.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const store: BackgroundJobStore = {
    async create(job, retryInput, retryOf) {
      if (retryOf) {
        if (!retry.has(retryOf) || retried.has(retryOf) || jobs.get(retryOf)?.status !== 'failed') return false;
        retried.add(retryOf);
      }
      jobs.set(job.jobId, job);
      steps.set(job.jobId, [stepOf(job)]);
      if (retryInput) retry.set(job.jobId, retryInput);
      return true;
    },
    async update(job) {
      if (!jobs.has(job.jobId)) return null;
      jobs.set(job.jobId, job);
      steps.get(job.jobId)!.push(stepOf(job));
      return job;
    },
    async updateResultDelivery(jobId, resultDelivery) {
      const job = jobs.get(jobId);
      if (!job) return null;
      const next = { ...job, resultDelivery };
      jobs.set(jobId, next);
      return next;
    },
    async list() { return sorted(); },
    async listVisible() { return sorted().filter((job) => !dismissed.has(job.jobId)); },
    async listDismissed() { return [...dismissed]; },
    async dismiss(_owner, jobIds, skipRunning = false) {
      const dismissedJobIds: string[] = [];
      const runningJobIds: string[] = [];
      for (const job of sorted()) {
        if (jobIds && !jobIds.includes(job.jobId)) continue;
        if (job.status === 'running') { if (!skipRunning) runningJobIds.push(job.jobId); continue; }
        dismissed.add(job.jobId);
        dismissedJobIds.push(job.jobId);
      }
      return { dismissedJobIds, runningJobIds };
    },
    async recentFailures(from, to) {
      const failed = sorted().filter((job) => job.status === 'failed' && Date.parse(job.updatedAt) >= from.getTime() && Date.parse(job.updatedAt) <= to.getTime());
      return { count: failed.length, retryable: failed.some((job) => retry.has(job.jobId) && !retried.has(job.jobId)) };
    },
    async get(jobId): Promise<StoredBackgroundJobDetails | null> {
      const job = jobs.get(jobId.toLowerCase());
      if (!job) return null;
      const retryInput = retry.get(job.jobId);
      const details: BackgroundJobDetails = {
        job, steps: steps.get(job.jobId)!.slice(-100),
        ...(job.status === 'failed' && job.detail ? { error: job.detail } : {}),
        ...(job.viewId ? { resultWindow: job.viewId } : {}),
        retryable: job.kind === 'research' && job.status === 'failed' && retryInput !== undefined && !retried.has(job.jobId),
      };
      return { details, ...(retryInput ? { retryInput } : {}) };
    },
    // Production marks jobs a restart interrupted; the fake world never restarts mid-job.
    async reconcileInterrupted() { return []; },
    async prune() {},
  };
  const seed = (job: BackgroundJob, history: BackgroundJobStep[], retryInput?: ResearchJobRetryInput) => {
    jobs.set(job.jobId, job);
    steps.set(job.jobId, history);
    if (retryInput) retry.set(job.jobId, retryInput);
  };
  const started = daysAgo(3);
  seed({
    jobId: seededJobIds.done, kind: 'research', title: 'Ignite keynote research', status: 'done', step: 4, steps: 4,
    detail: 'Report ready', viewId: 'research-ignite', startedAt: started, updatedAt: daysAgo(3),
  }, [
    { status: 'running', step: 0, updatedAt: started }, { status: 'running', step: 2, detail: 'Reading sources', updatedAt: started },
    { status: 'done', step: 4, detail: 'Report ready', viewId: 'research-ignite', updatedAt: started },
  ]);
  seed({
    jobId: seededJobIds.failed, kind: 'research', title: 'Compare noise cancelling headphones', status: 'failed', step: 1, steps: 4,
    detail: 'The research provider timed out', startedAt: daysAgo(2), updatedAt: daysAgo(2),
  }, [
    { status: 'running', step: 0, updatedAt: daysAgo(2) }, { status: 'failed', step: 1, detail: 'The research provider timed out', updatedAt: daysAgo(2) },
  ], { topic: 'Best noise cancelling headphones for flights', depth: 'quick' });
  return store;
}

/**
 * Running, cancellable jobs started through the registry, as the research and image tools start theirs. A job id is random, so the
 * id of the one a case cancels by id is returned; the other cancellable job is found by words from its title, and the image job
 * stays running for the job list.
 */
export async function startRunningJobs(app: Pick<FastifyInstance, 'backgroundJobs'>): Promise<{ readonly cancellableJobId: string }> {
  const gardenPlan = await app.backgroundJobs.start('research', 'Garden plan research', 4, () => {}, 'Reading sources');
  await app.backgroundJobs.start('research', 'Cheap flights to Lisbon', 4, () => {}, 'Comparing prices');
  const image = await app.backgroundJobs.start('image', 'Red bicycle illustration', 2, () => {}, 'Drawing');
  await image.progress(1, 'Drawing the frame');
  return { cancellableJobId: gardenPlan.jobId };
}

// ---- The Now feed and system status -----------------------------------------------------------------------------------------

export function createNowFeedFake(): NowFeedStore {
  return {
    async read() {
      return {
        running: [{
          id: '7', title: 'Fix the login redirect', project: 'DanAakesen/jarvis', agent: 'copilot', activity: 'Running the checks', startedAt: minutesAgo(12),
        }],
        items: [
          { id: 'n-1', category: 'release', title: 'Production deployment succeeded', link: null, at: minutesAgo(90) },
          { id: 'n-2', category: 'attention', title: 'Task 5 needs a decision', link: null, at: minutesAgo(30) },
        ],
        updatedAt: new Date().toISOString(),
      };
    },
    async dismiss() { return true; },
    async dismissGroup() { return 0; },
    async dismissAll() { return 0; },
    async recordNotification() {},
  };
}

const healthy: SystemStatusProbe = async () => ({ status: 'ok', details: { configured: true } });

/** The production status reader over probes that all answer healthy. */
export function createSystemStatusFake(): SystemStatusReader {
  return createSystemStatusReader({
    database: healthy, 'foundry.chat': healthy, 'foundry.voice': healthy, 'foundry.embeddings': healthy, vault_index: healthy,
    github_app: healthy, google: healthy, pc_bridge: async () => ({ status: 'ok', details: { configured: true, connected: true } }), runner: healthy,
  }, '0123456789abcdef0123456789abcdef01234567');
}

/** Every deploy smoke check answers healthy. */
export const systemSmokeProbesFake = Object.fromEntries([
  'google', 'github_app', 'vault', 'foundry.embeddings', 'research', 'pc_bridge', 'agent_contract', 'chat_canary', 'chat_identity',
  'chat_capabilities', 'chat_github_read', 'chat_jobs', 'chat_navigation', 'chat_no_timestamp', 'chat_plain_approval',
].map((id) => [id, healthy])) as Record<string, SystemStatusProbe>;

// ---- Credentials ------------------------------------------------------------------------------------------------------------

export function createCredentialStatusFake(): CredentialStatusStore & { readonly renewals: number[] } {
  const rows: CredentialStatus[] = [
    { name: 'codex-login', expiresAt: new Date(Date.now() + 20 * day).toISOString(), lastRenewedAt: daysAgo(8), lastCheckedAt: minutesAgo(3), status: 'ok' },
    { name: 'copilot-token', expiresAt: new Date(Date.now() + 25 * day).toISOString(), lastRenewedAt: daysAgo(5), lastCheckedAt: minutesAgo(3), status: 'ok' },
    { name: 'github-app', expiresAt: null, lastRenewedAt: null, lastCheckedAt: minutesAgo(3), status: 'ok' },
    { name: 'github-app-key', expiresAt: new Date(Date.now() + 200 * day).toISOString(), lastRenewedAt: daysAgo(160), lastCheckedAt: minutesAgo(3), status: 'ok' },
  ];
  const renewals: number[] = [];
  return {
    renewals,
    async list() { return structuredClone(rows); },
    async updateGitHubAppStatus() {},
    async acquireCodexRenewalLease() { return true; },
    async refreshCodexRenewalLease() { return true; },
    async updateCopilotStatus() {},
    async completeCodexRenewal(_owner, status, expiresAt, lastRenewedAt) {
      const row = rows.find((candidate) => candidate.name === 'codex-login')!;
      Object.assign(row, { status, expiresAt, lastRenewedAt });
      renewals.push(Date.now());
    },
  };
}

/** The Codex renewal the tool starts: it renews against the fake credential table and reports `renewed`. */
export function createCodexRenewalFake(credentials: CredentialStatusStore): () => Promise<'renewed'> {
  return async () => {
    await credentials.completeCodexRenewal('conformance', 'ok', new Date(Date.now() + 30 * day).toISOString(), new Date().toISOString(), true);
    return 'renewed';
  };
}

// ---- Attachments ------------------------------------------------------------------------------------------------------------

export const attachmentIds = {
  budget: '3f2b8c1e-7a4d-4e9b-8c21-5d6e7f8a9b0c',
  receipt: '9a1c5e72-4b3d-4f60-9e8a-1c2d3e4f5a6b',
} as const;

const attachmentRows = [
  {
    id: attachmentIds.budget, name: 'household-budget.txt', contentType: 'text/plain', status: 'ready' as const, createdAt: daysAgo(4),
    text: 'Household budget 2026\nRent: 9,800 DKK\nGroceries: 3,200 DKK\nTransport: 650 DKK\nSavings goal: 2,000 DKK per month.',
    description: null,
  },
  {
    id: attachmentIds.receipt, name: 'receipt.jpg', contentType: 'image/jpeg', status: 'ready' as const, createdAt: daysAgo(1),
    text: null, description: 'A photo of a grocery receipt from Netto: milk, bread, apples, total 87.50 DKK.',
  },
];

/** The attachment table: Dan's two files with their extracted text and image description. */
export function createAttachmentsFake(): ConversationAttachmentStore {
  const store = {
    retentionDays: 30,
    async saveUpload(input: { fileName: string; contentType: string; bytes: Buffer }) {
      return { id: '5c7e9a10-2b4d-4c6e-8a0f-1b2c3d4e5f60', name: input.fileName, contentType: input.contentType, size: input.bytes.length };
    },
    async complete() {},
    async getModelContext(_owner: string, ids: readonly string[]) {
      return attachmentRows.filter((row) => ids.includes(row.id)).map((row) => ({
        id: row.id, name: row.name, contentType: row.contentType, size: (row.text ?? row.description ?? '').length, status: row.status,
        context: (row.description ?? row.text ?? '').slice(0, 2_000),
      }));
    },
    async list() {
      return attachmentRows.map((row) => ({
        id: row.id, name: row.name, contentType: row.contentType, size: (row.text ?? row.description ?? '').length, status: row.status, createdAt: row.createdAt,
      }));
    },
    async read(_owner: string, id: string, offset = 0, query?: string) {
      const row = attachmentRows.find((candidate) => candidate.id === id);
      if (!row) return null;
      const full = row.description ?? row.text ?? '';
      const start = query === undefined ? offset : Math.max(0, full.toLowerCase().indexOf(query.toLowerCase()));
      const content = query !== undefined && !full.toLowerCase().includes(query.toLowerCase())
        ? 'No matching text was found in this file.' : full.slice(start, start + 4_000);
      return {
        id: row.id, name: row.name, contentType: row.contentType, size: full.length, status: row.status, content, offset: start,
        nextOffset: query === undefined && start + content.length < full.length ? start + content.length : null,
      };
    },
    async readUrl() { return null; },
    async readImageBytes() { return null; },
    async delete() { return false; },
    async cleanupExpired() { return 0; },
  };
  return store as unknown as ConversationAttachmentStore;
}

export const attachmentVisionFake = async (_image: Buffer, contentType: string): Promise<string> => `A ${contentType} image as described by the vision model.`;

export function createConversationSummaryFake(): ConversationSummaryStore {
  const records: ConversationSummaryRecord[] = [];
  return {
    async latest() { return records.at(-1) ?? null; },
    async usedSince() { return records.length; },
    async append(input) {
      const latest = records.at(-1)?.version ?? 0;
      if (input.baseVersion !== latest) return { status: 'conflict', latestVersion: latest };
      const record: ConversationSummaryRecord = {
        version: latest + 1, fromMessageId: input.fromMessageId, throughMessageId: input.throughMessageId, messageCount: input.messageCount,
        summary: input.summary, openItems: input.openItems, model: input.model, createdAt: new Date().toISOString(),
      };
      records.push(record);
      return { status: 'saved', record, usedLast24h: records.length };
    },
  };
}

// ---- Conversation search over the shared conversation fake ------------------------------------------------------------------

const searchable = [
  { id: '101', sessionId: '5', source: 'chat' as const, role: 'dan' as const, at: '2026-11-20T09:15:00.000Z', text: 'Remind me to book the dentist in Aarhus next week.' },
  { id: '102', sessionId: '5', source: 'chat' as const, role: 'jarvis' as const, at: '2026-11-20T09:15:20.000Z', text: 'Done. I will remind you on Monday morning to book the dentist.' },
  { id: '103', sessionId: '6', source: 'voice' as const, role: 'dan' as const, at: '2026-11-19T07:40:00.000Z', text: 'What is the weather in Aarhus tomorrow?' },
  { id: '104', sessionId: '6', source: 'voice' as const, role: 'jarvis' as const, at: '2026-11-19T07:40:12.000Z', text: 'Tomorrow in Aarhus it is cloudy with a high of 9 degrees.' },
];

/**
 * The shared conversation fake has no keyword search; this gives it the one the SQL store has (all keywords, UTC date bounds, source
 * filter, newest first) over a short history, without replacing the store the world installs.
 */
export function installConversationSearch(store: ConversationStore | null): void {
  if (!store || store.searchMessages) return;
  store.searchMessages = async (input) => {
    const words = input.query.toLowerCase().split(/\s+/u).filter(Boolean);
    const found = searchable
      .filter((message) => words.every((word) => message.text.toLowerCase().includes(word)))
      .filter((message) => input.source === undefined || message.source === input.source)
      .filter((message) => (input.from === undefined || Date.parse(message.at) >= input.from.getTime())
        && (input.toExclusive === undefined || Date.parse(message.at) < input.toExclusive.getTime()))
      .sort((left, right) => right.at.localeCompare(left.at));
    return {
      results: found.slice(0, input.limit).map(({ id, text, ...message }) => ({ messageId: id, ...message, snippet: text.slice(0, 240) })),
      hasMore: found.length > input.limit,
    };
  };
}

// ---- Phone, notifications, scaling ---------------------------------------------------------------------------------------------

export function createPhoneSessionFake(): PhoneSessionStore {
  const sessions: (PhoneCallSession & { startedAt: string })[] = [
    { sessionId: '31', callId: 'call-1', callerId: 'dan', callConnectionId: 'connection-1', status: 'ended', startedAt: daysAgo(1) },
  ];
  return {
    async create(input) {
      const session = { sessionId: String(31 + sessions.length), callId: input.callId, callerId: input.callerId, callConnectionId: null, status: 'answering' as const, startedAt: new Date().toISOString() };
      sessions.push(session);
      return session;
    },
    async isActive(sessionId, callerId) { return sessions.some((session) => session.sessionId === sessionId && session.callerId === callerId && session.status === 'active'); },
    async activate(sessionId, callConnectionId) {
      const session = sessions.find((candidate) => candidate.sessionId === sessionId);
      if (!session) return false;
      Object.assign(session, { status: 'active', callConnectionId });
      return true;
    },
    async finish(sessionId, status) {
      const session = sessions.find((candidate) => candidate.sessionId === sessionId);
      if (session) Object.assign(session, { status });
    },
    async active() { return sessions.filter((session) => session.status === 'active' || session.status === 'answering'); },
    async recent() {
      return sessions.map((session) => ({
        startedAt: session.startedAt, durationSeconds: 95, outcome: session.status === 'active' || session.status === 'answering' ? 'in_progress' as const : session.status,
      }));
    },
  };
}

export function createTaskStatusNotificationFake(): TaskStatusNotificationStore {
  const delivered = new Set<string>();
  return {
    async deliver(taskId, state) {
      const key = `${taskId}:${state}`;
      if (delivered.has(key)) return false;
      delivered.add(key);
      return true;
    },
  };
}

export function createContainerAppScalerFake(): ContainerAppScaler {
  let minimum: MinimumReplicas = 1;
  return { async getMinimumReplicas() { return minimum; }, async setMinimumReplicas(value) { minimum = value; } };
}

export function createWebhookDeliveryFake(): WebhookDeliveryStore {
  const seen = new Set<string>();
  return {
    async hasDelivery(deliveryId) { return seen.has(deliveryId); },
    async record(input) {
      if (seen.has(input.deliveryId)) return false;
      seen.add(input.deliveryId);
      return true;
    },
    async recordPullRequest() {},
  };
}

export function createNotesFolderOrderFake(): NotesFolderOrderStore {
  const orders = new Map<string, NotesFolderOrder>([['', { parent: '', folders: ['Personal', 'Work', 'Projects'] }]]);
  return {
    async read() { return structuredClone([...orders.values()]); },
    async replace(_owner, parent, folders) { orders.set(parent, { parent, folders: [...folders] }); },
  };
}

// ---- Routines ---------------------------------------------------------------------------------------------------------------

export const routineIds = (() => {
  const make = (kind: 'pc' | 'browser', key: string, goal: string) => recipeId({ kind, key, goal });
  return {
    pcRename: make('pc', 'spotify', 'play my daily mix'),
    pcDelete: make('pc', 'notepad', 'open a new note'),
    legacyRename: make('browser', 'https://www.dr.dk', 'open the weather forecast'),
    legacyDelete: make('browser', 'https://www.bilka.dk', 'open my shopping list'),
  };
})();

/** The saved PC and browser routines: ids are the content hash the real store uses. */
export function createRecipeFake(): RecipeStore {
  const draft = (id: string, kind: 'pc' | 'browser', key: string, goal: string, name: string): TaskRecipe => ({
    id, name, kind, key, goal,
    steps: [{ operation: 'click', target: { role: 'button', name: 'Play' } }, { operation: 'done' }],
  });
  const routines: TaskRecipe[] = [
    draft(routineIds.pcRename, 'pc', 'spotify', 'play my daily mix', 'Daily mix'),
    draft(routineIds.pcDelete, 'pc', 'notepad', 'open a new note', 'New note'),
    draft(routineIds.legacyRename, 'browser', 'https://www.dr.dk', 'open the weather forecast', 'Weather forecast'),
    draft(routineIds.legacyDelete, 'browser', 'https://www.bilka.dk', 'open my shopping list', 'Shopping list'),
  ];
  return {
    async list(filter) { return structuredClone(routines.filter((routine) => !filter || (routine.kind === filter.kind && routine.key === filter.key))); },
    async save(recipe: RecipeDraft) {
      const id = recipeId(recipe);
      const index = routines.findIndex((routine) => routine.id === id);
      if (index >= 0) routines[index] = { ...recipe, id };
      else routines.push({ ...recipe, id });
    },
    async rename(id, name) {
      const routine = routines.find((candidate) => candidate.id === id);
      if (!routine) return false;
      routines[routines.indexOf(routine)] = { ...routine, name };
      return true;
    },
    async delete(id) {
      const index = routines.findIndex((candidate) => candidate.id === id);
      if (index < 0) return false;
      routines.splice(index, 1);
      return true;
    },
  };
}

// ---- Dan's browser tab ------------------------------------------------------------------------------------------------------

export const tabWindows = { chart: 'spending-chart', notes: 'weekly-notes' } as const;

/**
 * One signed-in browser tab, attached the way the production WebSocket attaches one. It reports a layout snapshot and
 * acknowledges every command as applied, as the page does, so a command succeeds only because a tab said so.
 */
export function createWorkspaceTabFake(context: ConformanceContext): WorkspaceCommandBroker {
  const broker = new WorkspaceCommandBroker();
  const connection = broker.connect(context.owner, (event, data) => {
    if (event === 'workspace-command') {
      const { commandId } = data.command;
      queueMicrotask(() => { broker.acknowledge(context.owner, connection.sessionId, commandId, true); });
    }
    return true;
  });
  const snapshot: WorkspaceSnapshot = {
    windows: [
      { viewId: tabWindows.chart, title: 'Spending this month', state: 'open', placement: 'auto', front: true, content: 'Groceries 3,200 DKK; Transport 650 DKK; Dining out 1,150 DKK.' },
      { viewId: tabWindows.notes, title: 'Weekly notes', state: 'open', placement: 'region', region: 'right', front: false, selection: 'Book the dentist' },
    ],
    contextPanelOpen: false,
    device: { kind: 'desktop', label: 'Dan’s desktop' },
  };
  broker.updateSnapshot(context.owner, connection.sessionId, snapshot);
  return broker;
}

// ---- Log Analytics ----------------------------------------------------------------------------------------------------------

/**
 * The Log Analytics query endpoint: answers with the retained console lines of the backend app, newest inside the window the
 * request asked for, in the table shape the real service returns. Never reaches a network.
 */
export function createLogAnalyticsFetch(appName: string): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { timespan: string };
    const [, end] = body.timespan.split('/');
    const endMs = Date.parse(end!);
    const row = (secondsBack: number, fields: Record<string, unknown>) => {
      const at = new Date(endMs - secondsBack * 1_000).toISOString();
      return [at, new Date(endMs - secondsBack * 1_000 + 90_000).toISOString(), appName, JSON.stringify({ service: 'jarvis-backend', time: at, ...fields })];
    };
    return new Response(JSON.stringify({
      tables: [{
        name: 'PrimaryResult',
        columns: [
          { name: 'TimeGenerated', type: 'datetime' }, { name: 'IngestedAt', type: 'datetime' },
          { name: 'ContainerAppName_s', type: 'string' }, { name: 'Log_s', type: 'string' },
        ],
        rows: [
          row(60, { level: 30, msg: 'request.completed', method: 'POST', statusCode: 200, responseTime: 41 }),
          row(120, { level: 30, msg: 'request.started', method: 'GET' }),
        ],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
