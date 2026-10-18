import type sql from 'mssql';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { GoogleApiClient } from '../google/api-client.js';
import type { SettingsStore } from '../core/settings.js';
import type { ModelCatalogueReader } from '../core/model-catalog.js';
import type { UsageStore } from '../core/usage.js';
import type { TaskStore } from '../factory/task-store.js';
import type { BackgroundJobRegistry } from '../core/jobs.js';
import type { ConversationStore } from '../core/conversation-store.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import type { PushStore } from '../database/push-store.js';
import { ConfigurationError } from '../configuration-error.js';
import { createProactiveStore } from '../database/proactive-store.js';
import { createProactiveAlertStore } from '../database/proactive-alert-store.js';
import { createProactiveTodoReceiptStore } from '../database/proactive-todo-store.js';
import { createProactiveReminderStore } from '../database/proactive-reminder-store.js';
import { createMemoryProactiveStore } from './store.js';
import type { ProactiveStore } from './store.js';
import { createProactiveTodoWriter } from './todo-writer.js';
import { createMemoryAlertLedgerStore, type AlertLedgerStore } from './alert-ledger.js';
import { createMemoryProactiveReminderStore, type ProactiveReminderStore } from './reminder-store.js';
import { buildSourceRegistry } from './sources/registry.js';
import { registerProactiveRoutes } from './routes.js';
import { createProactiveEngine, type ProactiveEngineOptions } from './engine.js';
import { createFoundryProactiveModel, MAX_PROACTIVE_COMPLETION_TOKENS, MAX_PROACTIVE_REQUEST_BYTES, type ProactiveModel } from './model.js';
import { createProactiveScheduler } from './scheduler.js';
import { estimateCost } from './budget.js';
import { createProactiveAlertHook } from './alerts.js';
import { createTodoReminderPlanner } from './reminders.js';
import { createReminderTicker } from './reminder-ticker.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';

const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
type GitHubVaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface ProactiveCompositionOptions {
  enabled: boolean;
  ownerObjectId: string;
  store?: ProactiveStore;
  pool?: sql.ConnectionPool;
  googleApiClient?: GoogleApiClient;
  vaultClient?: GitHubVaultClient;
  settingsStore?: SettingsStore;
  modelCatalogue?: ModelCatalogueReader;
  getCredentialToken?: (scope: string, signal?: AbortSignal) => Promise<string | undefined>;
  foundryProjectEndpoint?: string;
  usageStore?: UsageStore;
  taskStore?: TaskStore;
  backgroundJobs?: BackgroundJobRegistry;
  conversationStore?: Pick<ConversationStore, 'readRecentUserMessages'>;
  onFindingsStored?: NonNullable<ProactiveEngineOptions['onFindingsStored']>;
  pushStore?: PushStore;
  alertLedgerStore?: AlertLedgerStore;
  reminderStore?: ProactiveReminderStore;
  systemPushSender?: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  pushEnabled?: boolean;
  todoWritesEnabled?: boolean;
  alertsEnabled?: boolean;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export function registerProactive<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  options: ProactiveCompositionOptions,
): void {
  if (options.enabled !== true) return;
  if (!uuidPattern.test(options.ownerObjectId)) {
    throw new ConfigurationError('The proactive owner must be a UUID');
  }
  const sources = buildSourceRegistry(options);
  const store = options.store ?? (options.pool
    ? createProactiveStore(options.pool, options.ownerObjectId)
    : createMemoryProactiveStore(options.ownerObjectId));
  const now = options.now ?? (() => new Date());
  let model: ProactiveModel = {
    async worstCaseDkk() {
      return estimateCost('unknown', MAX_PROACTIVE_REQUEST_BYTES, MAX_PROACTIVE_COMPLETION_TOKENS).estimatedDkk;
    },
    async summarize() { return { reason: 'model_unavailable', findings: [] }; },
  };
  if (options.settingsStore && options.modelCatalogue && options.getCredentialToken && options.foundryProjectEndpoint) {
    const getToken = options.getCredentialToken;
    model = createFoundryProactiveModel({
      settingsStore: options.settingsStore,
      modelCatalogue: options.modelCatalogue,
      foundryProjectEndpoint: options.foundryProjectEndpoint,
      getCredentialToken: async (scope, signal) => {
        const token = await getToken(scope, signal);
        if (!token) throw new Error('Model unavailable');
        return token;
      },
    });
  }
  const todoWriter = options.todoWritesEnabled === true && options.vaultClient && options.pool
    ? createProactiveTodoWriter({
      vault: options.vaultClient,
      store,
      receipts: createProactiveTodoReceiptStore(options.pool, options.ownerObjectId),
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  const alertsReady = options.alertsEnabled === true && options.pushEnabled === true &&
    options.pushStore !== undefined && options.systemPushSender !== undefined;
  const reminderReady = alertsReady && options.vaultClient !== undefined;
  const alertLedger = alertsReady
    ? options.alertLedgerStore ?? (options.pool
      ? createProactiveAlertStore(options.pool, options.ownerObjectId)
      : createMemoryAlertLedgerStore(now))
    : undefined;
  const alertHook = alertsReady && alertLedger
    ? createProactiveAlertHook({
      store,
      pushStore: options.pushStore!,
      ownerObjectId: options.ownerObjectId,
      ledger: alertLedger,
      send: options.systemPushSender!,
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  const reminderStore = reminderReady
    ? options.reminderStore ?? (options.pool
      ? createProactiveReminderStore(options.pool, options.ownerObjectId)
      : createMemoryProactiveReminderStore(options.ownerObjectId))
    : undefined;
  const reminderTicker = reminderReady && reminderStore && alertLedger && options.pushStore && options.systemPushSender
    ? createReminderTicker({
      store,
      reminders: reminderStore,
      vault: options.vaultClient!,
      pushStore: options.pushStore,
      ledger: alertLedger,
      ownerObjectId: options.ownerObjectId,
      send: options.systemPushSender,
      ...(options.conversationStore ? { conversationStore: options.conversationStore } : {}),
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  const reminderPlanner = reminderTicker && reminderStore && alertLedger
    ? createTodoReminderPlanner({
      store,
      reminders: reminderStore,
      now,
      onPlanned: reminderTicker.considerFireAt,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  // Hooks run in order: the time-critical alert goes first, then the database-only reminder planner, so a slow vault write never delays either.
  const run = createProactiveEngine({
    ...options,
    store,
    sources,
    model,
    now,
    onFindingsStored: [
      ...(options.onFindingsStored ?? []),
      ...(alertHook ? [alertHook] : []),
      ...(reminderPlanner ? [reminderPlanner] : []),
      ...(todoWriter ? [todoWriter] : []),
    ],
  });
  const scheduler = createProactiveScheduler({
    store, now, run, ...(options.logger ? { logger: options.logger } : {}),
  });
  app.addHook('onReady', async () => {
    await scheduler.start();
    await reminderTicker?.start();
  });
  app.addHook('onClose', async () => {
    await reminderTicker?.stop();
    await scheduler.stop();
  });
  registerProactiveRoutes(app, {
    store,
    ownerObjectId: options.ownerObjectId,
    todoWritesEnabled: options.todoWritesEnabled === true,
    alertsEnabled: options.alertsEnabled === true,
    pushEnabled: options.pushEnabled === true,
    databaseAvailable: options.pool !== undefined,
    registerItemDetail: options.pushEnabled !== true,
    now,
    run,
    worstCaseDkk: () => model.worstCaseDkk(),
  });
}
