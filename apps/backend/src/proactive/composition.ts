import type sql from 'mssql';
import type { ContextDependencies } from './sources/context.js';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { GoogleApiClient } from '../google/api-client.js';
import type { SettingsStore } from '../core/settings.js';
import type { ModelCatalogueReader } from '../core/model-catalog.js';
import type { UsageStore } from '../core/usage.js';
import type { TaskStore } from '../factory/task-store.js';
import type { BackgroundJobRegistry } from '../core/jobs.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import type { PushStore } from '../database/push-store.js';
import { ConfigurationError } from '../configuration-error.js';
import { createProactiveStore } from '../database/proactive-store.js';
import { createProactiveAlertStore } from '../database/proactive-alert-store.js';
import { createProactiveTodoReceiptStore } from '../database/proactive-todo-store.js';
import { createProactiveReminderStore } from '../database/proactive-reminder-store.js';
import type { OwnerReminderStore } from './owner-reminder-store.js';
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
import { createVaultPushReminderPass } from './vault-push-reminders.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';
import type { ActivityAlert } from '../alerts.js';
import { createEventPath, type EventConsumer } from './events/wiring.js';
import type { EventQueueStore } from './events/event-queue.js';
import type { ProactiveEventSink } from './events/types.js';
import type { BrainControl } from '../pi/brain/control.js';
import { readSettings } from '../core/settings.js';

const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
type GitHubVaultClient = ReturnType<typeof createGitHubVaultClient>;

export interface ProactiveCompositionOptions extends ContextDependencies {
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
  onFindingsStored?: NonNullable<ProactiveEngineOptions['onFindingsStored']>;
  registerVaultPushHandler?: (handler: () => void) => void;
  pushStore?: PushStore;
  alertLedgerStore?: AlertLedgerStore;
  reminderStore?: ProactiveReminderStore;
  ownerReminderStore?: OwnerReminderStore;
  registerReminderWakeHandler?: (handler: (fireAt: Date) => void) => void;
  systemPushSender?: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  pushEnabled?: boolean;
  todoWritesEnabled?: boolean;
  alertsEnabled?: boolean;
  hasNativeRecipients?: () => Promise<boolean>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
  vaultMirrorStatusReader?: NonNullable<ProactiveEngineOptions['vaultMirrorStatusReader']>;
  /** The event-driven path (#1858). Off until the owner turns it on; the 07:00 and 18:00 checks run either way. */
  eventsEnabled?: boolean;
  /** The PI brain as the reader of the event queue, built once the queue exists. Cannot be combined with `eventsEnabled`. */
  brain?: (queue: EventQueueStore) => EventConsumer;
  /** Writes a card to the Now feed; the low tier needs it. */
  nowCardFeed?: { record(alert: ActivityAlert): Promise<boolean> };
  /** Hands producers outside this module (webhook, alerts) the queue's entrance. */
  registerEventSink?: (sink: ProactiveEventSink) => void;
  background?: BrainControl;
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
      ...(options.logger ? { logger: options.logger } : {}),
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
  const ownerReminderReady = options.ownerReminderStore !== undefined && options.pushEnabled === true &&
    options.vaultClient !== undefined && options.pushStore !== undefined && options.systemPushSender !== undefined;
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
      ...(options.hasNativeRecipients ? { hasNativeRecipients: options.hasNativeRecipients } : {}),
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
  const reminderTicker = (reminderReady || ownerReminderReady) && options.vaultClient &&
    options.pushStore && options.systemPushSender
    ? createReminderTicker({
      store,
      reminders: reminderStore ?? createMemoryProactiveReminderStore(options.ownerObjectId),
      ...(ownerReminderReady ? { ownerReminders: options.ownerReminderStore } : {}),
      vault: options.vaultClient,
      pushStore: options.pushStore,
      ...(options.hasNativeRecipients ? { hasNativeRecipients: options.hasNativeRecipients } : {}),
      ...(alertLedger ? { ledger: alertLedger } : {}),
      ownerObjectId: options.ownerObjectId,
      send: options.systemPushSender,
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  options.registerReminderWakeHandler?.(reminderTicker?.considerFireAt ?? (() => {}));
  const reminderPlanner = reminderTicker && reminderStore && alertLedger
    ? createTodoReminderPlanner({
      store,
      reminders: reminderStore,
      now,
      onPlanned: reminderTicker.considerFireAt,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  const vaultPushReminderPass = reminderPlanner && reminderTicker && reminderStore
    ? createVaultPushReminderPass({
      store,
      reminders: reminderStore,
      todos: sources.find(({ id }) => id === 'todos')!,
      now,
      onPlanned: reminderTicker.considerFireAt,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  options.registerVaultPushHandler?.(vaultPushReminderPass?.trigger ?? (() => {
    try {
      options.logger?.info({
        runId: null, durationMs: 0, reason: 'vault_push_planner_unconfigured',
      }, 'proactive.reminder_plan');
    } catch { /* Logging cannot change webhook handling. */ }
  }));
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
  const events = createEventPath({
    enabled: options.eventsEnabled === true,
    brain: options.brain,
    ownerObjectId: options.ownerObjectId,
    pool: options.pool,
    store,
    sources,
    modelCatalogue: options.modelCatalogue,
    getCredentialToken: options.getCredentialToken,
    foundryProjectEndpoint: options.foundryProjectEndpoint,
    systemPushSender: alertsReady ? options.systemPushSender : undefined,
    nowCardFeed: options.nowCardFeed,
    usageStore: options.usageStore,
    now,
    logger: options.logger,
  });
  if (events) options.registerEventSink?.(events.sink);
  const scheduledRun = events?.runScheduled ?? run;
  const scheduler = createProactiveScheduler({
    store, now, run: scheduledRun, ...(options.logger ? { logger: options.logger } : {}),
    ...(events ? { onTick: events.tick } : {}),
  });
  app.addHook('onReady', async () => {
    await events?.start();
    await scheduler.start();
    await reminderTicker?.start();
  });
  app.addHook('onClose', async () => {
    await vaultPushReminderPass?.stop();
    await reminderTicker?.stop();
    await scheduler.stop();
    await events?.stop();
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
    run: scheduledRun,
    worstCaseDkk: () => events?.runScheduled
      ? 0.79
      : model.worstCaseDkk(),
    ...(events?.outreach ? { outreach: events.outreach } : {}),
    ...(options.background ? { background: options.background } : {}),
    ...(options.settingsStore ? {
      locationStatus: async () => {
        const location = (await readSettings(options.settingsStore!)).location;
        if (location.permission === 'denied' || location.permission === 'restricted') {
          return {
            state: 'unavailable' as const,
            reason: `location_permission_${location.permission}`,
            observedAt: location.observedAt,
          };
        }
        if (!location.observedAt || !location.city || location.latitude === null || location.longitude === null) {
          return {
            state: 'unavailable' as const,
            reason: location.permission === 'granted' ? 'no_location' : 'location_permission_not_granted',
            observedAt: location.observedAt,
          };
        }
        return { state: 'ok' as const, reason: null, observedAt: location.observedAt };
      },
    } : {}),
  });
}
