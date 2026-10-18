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
import type { PushRouteDependencies } from '../push/routes.js';
import { ConfigurationError } from '../configuration-error.js';
import { createProactiveStore } from '../database/proactive-store.js';
import { createMemoryProactiveStore } from './store.js';
import { buildSourceRegistry } from './sources/registry.js';
import { registerProactiveRoutes } from './routes.js';

const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
type GitHubVaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface ProactiveCompositionOptions {
  enabled: boolean;
  ownerObjectId: string;
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
  conversationStore?: Pick<ConversationStore, 'getHistory'>;
  pushSender?: PushRouteDependencies['send'];
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
  void sources;
  const store = options.pool
    ? createProactiveStore(options.pool, options.ownerObjectId)
    : createMemoryProactiveStore(options.ownerObjectId);
  if (options.pool) {
    app.addHook('onReady', async () => {
      await store.runs.markInterruptedOnStartup();
    });
  }
  registerProactiveRoutes(app, {
    store,
    ownerObjectId: options.ownerObjectId,
    todoWritesEnabled: options.todoWritesEnabled === true,
    alertsEnabled: options.alertsEnabled === true,
    pushEnabled: options.pushEnabled === true,
    databaseAvailable: options.pool !== undefined,
    registerItemDetail: options.pushEnabled !== true,
    now: options.now ?? (() => new Date()),
  });
}
