import type sql from 'mssql';
import type { ContextDependencies } from './sources/context.js';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { GoogleApiClient } from '../google/api-client.js';
import type { SettingsStore } from '../core/settings.js';
import type { ModelCatalogueReader } from '../core/model-catalog.js';
import type { UsageStore } from '../core/usage.js';
import type { TaskStore } from '../factory/task-store.js';
import type { createGitHubVaultClient } from '../vault/github-client.js';
import type { PushStore } from '../database/push-store.js';
import { ConfigurationError } from '../configuration-error.js';
import { createProactiveStore } from '../database/proactive-store.js';
import { createProactiveAlertStore } from '../database/proactive-alert-store.js';
import { createProactiveReminderStore } from '../database/proactive-reminder-store.js';
import type { OwnerReminderStore } from './owner-reminder-store.js';
import { createMemoryProactiveStore } from './store.js';
import type { ProactiveStore } from './store.js';
import { createMemoryAlertLedgerStore, type AlertLedgerStore } from './alert-ledger.js';
import { createMemoryProactiveReminderStore, type ProactiveReminderStore } from './reminder-store.js';
import { buildSourceRegistry } from './sources/registry.js';
import { registerProactiveRoutes } from './routes.js';
import { createProactiveScheduler } from './scheduler.js';
import { createReminderTicker } from './reminder-ticker.js';
import { createVaultPushReminderPass } from './vault-push-reminders.js';
import type { SystemPushOutcome, SystemPushRequest } from './push-delivery.js';
import type { ActivityAlert } from '../alerts.js';
import { createEventPath, type EventConsumer } from './events/wiring.js';
import type { EventQueueStore } from './events/event-queue.js';
import type { ProactiveEventSink } from './events/types.js';
import type { BrainControl } from '../pi/brain/control.js';
import type { FindingsStoredContext } from './types.js';
import { PI_WAKE_PREFLIGHT_DKK } from '../pi/pricing.js';
import { createProactiveAlertHook } from './alerts.js';
import { readSettings } from '../core/settings.js';
import type { PiSituationService } from '../pi/situation.js';

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
  xSource?: import('./types.js').ProactiveSource;
  modelCatalogue?: ModelCatalogueReader;
  getCredentialToken?: (scope: string, signal?: AbortSignal) => Promise<string | undefined>;
  foundryProjectEndpoint?: string;
  usageStore?: UsageStore;
  taskStore?: TaskStore;
  registerVaultPushHandler?: (handler: () => void) => void;
  pushStore?: PushStore;
  alertLedgerStore?: AlertLedgerStore;
  reminderStore?: ProactiveReminderStore;
  ownerReminderStore?: OwnerReminderStore;
  registerReminderWakeHandler?: (handler: (fireAt: Date) => void) => void;
  systemPushSender?: (request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>;
  pushEnabled?: boolean;
  alertsEnabled?: boolean;
  hasNativeRecipients?: () => Promise<boolean>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
  /** The old one-shot event pipeline (#1858), switched off in production. It cannot run together with the PI brain. */
  eventsEnabled?: boolean;
  /** The PI brain as the reader of the event queue, built once the queue exists. Cannot be combined with `eventsEnabled`. */
  brain?: (queue: EventQueueStore, afterScheduledWake?: (context: FindingsStoredContext) => Promise<void>) => EventConsumer;
  reviewInbox?: (context: FindingsStoredContext) => Promise<void>;
  /** Writes a card to the Now feed; the low tier needs it. */
  nowCardFeed?: { record(alert: ActivityAlert): Promise<boolean> };
  /** Hands producers outside this module (webhook, alerts) the queue's entrance. */
  registerEventSink?: (sink: ProactiveEventSink) => void;
  background?: BrainControl;
  situation?: PiSituationService;
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
  const reminderStore = reminderReady
    ? options.reminderStore ?? (options.pool
      ? createProactiveReminderStore(options.pool, options.ownerObjectId)
      : createMemoryProactiveReminderStore(options.ownerObjectId))
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
  const { brain, reviewInbox } = options;
  const afterScheduledWake = reviewInbox && (async (context: FindingsStoredContext) => {
    await reviewInbox(context);
    if (context.findings.length) await alertHook?.(context);
  });
  const events = createEventPath({
    enabled: options.eventsEnabled === true,
    brain: brain && ((queue) => brain(queue, afterScheduledWake)),
    ownerObjectId: options.ownerObjectId,
    pool: options.pool,
    store,
    sources,
    ...(options.situation ? { situation: options.situation } : {}),
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
      ...(events ? { events: events.sink } : {}),
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  options.registerReminderWakeHandler?.(reminderTicker?.considerFireAt ?? (() => {}));
  const vaultPushReminderPass = reminderTicker && reminderStore && alertLedger
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
  // The 07:00 and 18:00 sweeps, Check now and the event tick are the PI brain's. Without it there is nothing to claim a slot for.
  const scheduler = events
    ? createProactiveScheduler({
      store, now, run: events.runScheduled, onTick: events.tick, ...(options.logger ? { logger: options.logger } : {}),
    })
    : undefined;
  app.addHook('onReady', async () => {
    await events?.start();
    await scheduler?.start();
    await reminderTicker?.start();
  });
  app.addHook('onClose', async () => {
    await vaultPushReminderPass?.stop();
    await reminderTicker?.stop();
    await scheduler?.stop();
    await events?.stop();
  });
  registerProactiveRoutes(app, {
    store,
    ownerObjectId: options.ownerObjectId,
    todoWritesEnabled: false,
    alertsEnabled: alertsReady,
    pushEnabled: options.pushEnabled === true,
    databaseAvailable: options.pool !== undefined,
    registerItemDetail: options.pushEnabled !== true,
    now,
    ...(events?.runScheduled ? { run: events.runScheduled, worstCaseDkk: () => options.brain ? PI_WAKE_PREFLIGHT_DKK : 0.79 } : {}),
    ...(events?.outreach ? { outreach: events.outreach } : {}),
    ...(options.background ? { background: options.background } : {}),
    ...(options.settingsStore ? {
      locationStatus: async () => {
        const location = (await readSettings(options.settingsStore!)).location;
        if (location.permission !== 'granted') {
          return {
            state: 'unavailable' as const,
            reason: `location_permission_${location.permission}`,
            observedAt: location.observedAt,
          };
        }
        if (!location.observedAt || !location.city || location.latitude === null || location.longitude === null) {
          return {
            state: 'unavailable' as const,
            reason: 'no_location',
            observedAt: location.observedAt,
          };
        }
        return { state: 'ok' as const, reason: null, observedAt: location.observedAt };
      },
    } : {}),
  });
}
