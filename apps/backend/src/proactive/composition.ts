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
import { createMemoryProactiveStore } from './store.js';
import type { ProactiveStore } from './store.js';
import { createMemoryAlertLedgerStore, type AlertLedgerStore } from './alert-ledger.js';
import { buildSourceRegistry } from './sources/registry.js';
import { registerProactiveRoutes } from './routes.js';
import { createProactiveEngine, type ProactiveEngineOptions } from './engine.js';
import { createFoundryProactiveModel, MAX_PROACTIVE_COMPLETION_TOKENS, MAX_PROACTIVE_REQUEST_BYTES, type ProactiveModel } from './model.js';
import { createProactiveScheduler } from './scheduler.js';
import { estimateCost } from './budget.js';
import { createProactiveAlertHook } from './alerts.js';
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
  const alertHook = options.alertsEnabled === true && options.pushEnabled === true &&
    options.pushStore !== undefined && options.systemPushSender !== undefined
    ? createProactiveAlertHook({
      store,
      pushStore: options.pushStore,
      ownerObjectId: options.ownerObjectId,
      ledger: options.alertLedgerStore ?? (options.pool
        ? createProactiveAlertStore(options.pool, options.ownerObjectId)
        : createMemoryAlertLedgerStore()),
      send: options.systemPushSender,
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  const run = createProactiveEngine({
    ...options,
    store,
    sources,
    model,
    now,
    onFindingsStored: [
      ...(options.onFindingsStored ?? []),
      ...(alertHook ? [alertHook] : []),
    ],
  });
  const scheduler = createProactiveScheduler({
    store, now, run, ...(options.logger ? { logger: options.logger } : {}),
  });
  app.addHook('onReady', async () => {
    await scheduler.start();
  });
  app.addHook('onClose', async () => {
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
