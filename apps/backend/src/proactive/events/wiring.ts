import type sql from 'mssql';
import type { FastifyBaseLogger } from 'fastify';
import type { ActivityAlert } from '../../alerts.js';
import type { ModelCatalogueReader } from '../../core/model-catalog.js';
import type { UsageStore } from '../../core/usage.js';
import { createProactiveEventStore } from '../../database/proactive-event-store.js';
import { createProactiveOutreachStore } from '../../database/proactive-outreach-store.js';
import type { SystemPushOutcome, SystemPushRequest } from '../push-delivery.js';
import type { ProactiveStore } from '../store.js';
import type { ProactiveSource } from '../types.js';
import { createNowCardChannel, createPushChannel } from './channels.js';
import { createMemoryEventQueueStore } from './event-queue.js';
import { createMemoryOutreachStore, type OutreachStore } from './outreach-store.js';
import { createEventPipeline } from './pipeline.js';
import { createFoundryEventReasoner } from './reasoner.js';
import { createSourceChangePoller, createTimerProducer } from './scheduled-producers.js';
import { ConfigurationError } from '../../configuration-error.js';
import type { EventQueueStore } from './event-queue.js';
import type { OutreachChannel, ProactiveEventSink } from './types.js';

/** What reads the queue: the old one-shot pipeline, or the PI brain. */
export interface EventConsumer {
  wake(): void;
  start(): Promise<void>;
  tick(signal: AbortSignal): Promise<unknown>;
}

export interface EventPathOptions {
  /** The old one-shot pipeline (switched off in production, deleted with #1887). */
  enabled: boolean;
  /** The PI brain reads the queue instead. It cannot run together with the old pipeline: two readers would split the events. */
  brain?: ((queue: EventQueueStore) => EventConsumer) | undefined;
  ownerObjectId: string;
  pool?: sql.ConnectionPool | undefined;
  store: ProactiveStore;
  sources: readonly ProactiveSource[];
  modelCatalogue?: ModelCatalogueReader | undefined;
  getCredentialToken?: ((scope: string, signal?: AbortSignal) => Promise<string | undefined>) | undefined;
  foundryProjectEndpoint?: string | undefined;
  systemPushSender?: ((request: SystemPushRequest, signal: AbortSignal) => Promise<SystemPushOutcome>) | undefined;
  nowCardFeed?: { record(alert: ActivityAlert): Promise<boolean> } | undefined;
  usageStore?: UsageStore | undefined;
  now: () => Date;
  logger?: FastifyBaseLogger | undefined;
}

export interface EventPath {
  sink: ProactiveEventSink;
  /** Only the old pipeline records outreach. */
  outreach?: OutreachStore | undefined;
  tick(signal: AbortSignal): Promise<unknown>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The queue, rules, reasoner, tiers and producers, assembled. Undefined when switched off or not configured. */
export function createEventPath(options: EventPathOptions): EventPath | undefined {
  if (options.enabled && options.brain) {
    throw new ConfigurationError('JARVIS_PROACTIVE_EVENTS_ENABLED (the old one-shot pipeline) and the PI brain both read the event queue; turn the old pipeline off.');
  }
  if (!options.enabled && !options.brain) return undefined;
  const queue = options.pool
    ? createProactiveEventStore(options.pool, options.ownerObjectId) : createMemoryEventQueueStore();
  let outreach: OutreachStore | undefined;
  let pipeline: EventConsumer;
  if (options.brain) {
    pipeline = options.brain(queue);
  } else {
    if (!options.modelCatalogue || !options.getCredentialToken || !options.foundryProjectEndpoint) {
      options.logger?.warn({ reason: 'model_not_configured' }, 'proactive.events_disabled');
      return undefined;
    }
    const getToken = options.getCredentialToken;
    outreach = options.pool
      ? createProactiveOutreachStore(options.pool, options.ownerObjectId) : createMemoryOutreachStore();
    const channels: OutreachChannel[] = [
      ...(options.nowCardFeed ? [createNowCardChannel(options.nowCardFeed)] : []),
      ...(options.systemPushSender ? [createPushChannel(options.systemPushSender)] : []),
    ];
    pipeline = createEventPipeline({
      queue, outreach, store: options.store,
      reasoner: createFoundryEventReasoner({
        modelCatalogue: options.modelCatalogue,
        foundryProjectEndpoint: options.foundryProjectEndpoint,
        getCredentialToken: async (scope, signal) => {
          const token = await getToken(scope, signal);
          if (!token) throw new Error('Model unavailable');
          return token;
        },
        ...(options.logger ? { logger: options.logger } : {}),
      }),
      contextSources: options.sources, channels,
      ...(options.usageStore ? { usageStore: options.usageStore } : {}),
      now: options.now,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  const sink: ProactiveEventSink = {
    async enqueue(event) {
      const result = await queue.enqueue(event, options.now());
      if (result.inserted && event.baseline !== true) pipeline.wake();
    },
  };
  const timer = createTimerProducer({
    sink, now: options.now, ...(options.usageStore ? { usageStore: options.usageStore } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const poller = createSourceChangePoller({
    sources: options.sources.filter(({ id }) => id === 'mail' || id === 'calendar'),
    sink, queue, now: options.now, ...(options.logger ? { logger: options.logger } : {}),
  });
  const unsubscribe = options.store.settings.subscribePreferencesChanged(() => pipeline.wake());
  return {
    sink, outreach,
    tick: (signal) => pipeline.tick(signal),
    async start() {
      await pipeline.start();
      timer.start();
      poller.start();
    },
    async stop() {
      unsubscribe();
      timer.stop();
      await poller.stop();
    },
  };
}
