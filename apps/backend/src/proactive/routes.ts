import type {
  FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest,
  FastifyTypeProviderDefault,
} from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { budgetState, canRunWithinBudget, estimateCost } from './budget.js';
import { copenhagenDayStart, monthKey, nextSlotAfter, isQuietHour } from './time.js';
import { itemFeedback, itemIdPattern as uuidPattern } from './feedback.js';
import {
  findingCategories, sourceIds, type Item, type RunSummary, type SourceId, type SourceStatus,
} from './types.js';
import {
  sourceLabels,
  type ProactiveSettingsPatch,
  type ProactiveStore,
} from './store.js';
import {
  explicitProactivePreferenceIntent, patchForProactivePreference, proactivePreferenceHelp,
  proactiveSettingsRevision, understoodProactivePreferences, ProactiveSettingsConflictError,
} from './preferences.js';

const statusLabels = sourceLabels;

export interface ProactiveRouteOptions {
  store: ProactiveStore;
  ownerObjectId: string;
  todoWritesEnabled: boolean;
  alertsEnabled: boolean;
  pushEnabled: boolean;
  databaseAvailable: boolean;
  registerItemDetail: boolean;
  now: () => Date;
  run?: (claim: { run: RunSummary; generation: number }, signal?: AbortSignal) => Promise<void>;
  worstCaseDkk?: () => number | Promise<number>;
}

function validUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function parseSettingsPatch(value: unknown):
  | { patch: ProactiveSettingsPatch; expectedRevision?: string }
  | { error: 'unsupported_preference' }
  | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.hasOwn(body, 'instruction')) {
    if (Object.keys(body).some((key) => key !== 'instruction' && key !== 'expectedRevision') ||
        typeof body.instruction !== 'string' || body.instruction.length > 500 ||
        typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(body.expectedRevision)) return undefined;
    const intent = explicitProactivePreferenceIntent(body.instruction);
    return intent
      ? { patch: patchForProactivePreference(intent), expectedRevision: body.expectedRevision }
      : { error: 'unsupported_preference' };
  }
  if (Object.keys(body).some((key) =>
    !['paused', 'monthlyBudgetDkk', 'sources', 'categories', 'suggestionScope', 'newsFeeds', 'guidance',
      'expectedRevision'].includes(key))) {
    return undefined;
  }
  if (Object.hasOwn(body, 'expectedRevision') &&
      (typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(body.expectedRevision))) return undefined;
  const patch: ProactiveSettingsPatch = {};
  if (Object.hasOwn(body, 'paused')) {
    if (typeof body.paused !== 'boolean') return undefined;
    patch.paused = body.paused;
  }
  if (Object.hasOwn(body, 'monthlyBudgetDkk')) {
    if (!Number.isInteger(body.monthlyBudgetDkk) || (body.monthlyBudgetDkk as number) < 0 || (body.monthlyBudgetDkk as number) > 1000) {
      return undefined;
    }
    patch.monthlyBudgetDkk = body.monthlyBudgetDkk as number;
  }
  if (Object.hasOwn(body, 'sources')) {
    if (!Array.isArray(body.sources)) return undefined;
    const selected: Partial<Record<SourceId, boolean>> = {};
    for (const entry of body.sources) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
      const source = entry as Record<string, unknown>;
      if (Object.keys(source).length !== 2 || Object.keys(source).some((key) => !['id', 'enabled'].includes(key)) ||
          typeof source.id !== 'string' || typeof source.enabled !== 'boolean') return undefined;
      const id = sourceIds.find((candidate) => candidate === source.id);
      if (id === undefined || Object.hasOwn(selected, id)) return undefined;
      selected[id] = source.enabled;
    }
    patch.sources = selected;
  }
  if (Object.hasOwn(body, 'categories')) {
    if (!Array.isArray(body.categories)) return undefined;
    const selected: Partial<ProactiveSettingsPatch['categories']> = {};
    for (const entry of body.categories) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
      const category = entry as Record<string, unknown>;
      if (Object.keys(category).length !== 2 ||
          Object.keys(category).some((key) => !['id', 'enabled'].includes(key)) ||
          typeof category.id !== 'string' || typeof category.enabled !== 'boolean') return undefined;
      const id = findingCategories.find((candidate) => candidate === category.id);
      if (id === undefined || Object.hasOwn(selected, id)) return undefined;
      selected[id] = category.enabled;
    }
    patch.categories = selected;
  }
  if (Object.hasOwn(body, 'suggestionScope')) {
    if (body.suggestionScope !== 'all' && body.suggestionScope !== 'personal' && body.suggestionScope !== 'work') {
      return undefined;
    }
    patch.suggestionScope = body.suggestionScope;
  }
  if (Object.hasOwn(body, 'newsFeeds')) {
    if (!Array.isArray(body.newsFeeds) || body.newsFeeds.length > 10 || !body.newsFeeds.every(validUrl)) return undefined;
    patch.newsFeeds = body.newsFeeds as string[];
  }
  if (Object.hasOwn(body, 'guidance')) {
    if (typeof body.guidance !== 'string' || body.guidance.length > 1000) return undefined;
    patch.guidance = body.guidance;
  }
  return {
    patch,
    ...(typeof body.expectedRevision === 'string' ? { expectedRevision: body.expectedRevision } : {}),
  };
}

function responseSettings(settings: Awaited<ReturnType<ProactiveStore['settings']['read']>>) {
  return {
    paused: settings.paused,
    monthlyBudgetDkk: settings.monthlyBudgetDkk,
    sources: sourceIds.map((id) => ({ id, enabled: settings.sources[id] })),
    categories: findingCategories.map((id) => ({ id, enabled: settings.categories[id] })),
    suggestionScope: settings.suggestionScope,
    newsFeeds: settings.newsFeeds,
    guidance: settings.guidance,
    revision: proactiveSettingsRevision(settings),
    preferences: understoodProactivePreferences(settings),
    capabilities: proactivePreferenceHelp,
  };
}

function registerRoutes<Logger extends FastifyBaseLogger>(
  options: ProactiveRouteOptions,
): FastifyPluginAsync<Record<never, never>, Server, FastifyTypeProviderDefault, Logger> {
  return async (app) => {
    let manualAdmission: Promise<void> = Promise.resolve();
    const pendingRuns = new Map<Promise<void>, AbortController>();
    app.addHook('onClose', async () => {
      for (const controller of pendingRuns.values()) controller.abort('interrupted_by_restart');
      await Promise.all(pendingRuns.keys());
    });
    function owner(request: FastifyRequest, reply: FastifyReply): boolean {
      const caller = request.principal?.objectId;
      if (!caller) {
        void reply.code(401).send({ error: 'Unauthorized' });
        return false;
      }
      if (caller.toLowerCase() !== options.ownerObjectId.toLowerCase()) {
        void reply.code(403).send({ error: 'forbidden' });
        return false;
      }
      return true;
    }

    app.get('/proactive/status', async (request, reply) => {
      if (!owner(request, reply)) return;
      const now = options.now();
      const [settings, lastRun, estimatedSpendDkk, storedStatuses] = await Promise.all([
        options.store.settings.read(),
        options.store.runs.latest(),
        options.store.spend.monthTotal(monthKey(now)),
        options.store.sources.list(),
      ]);
      const byId = new Map(storedStatuses.map((entry) => [entry.id, entry]));
      const sources: SourceStatus[] = sourceIds.map((id) => {
        const status = byId.get(id);
        const enabled = settings.sources[id];
        const unavailableReason = id === 'x' ? 'no_provider' : !options.databaseAvailable ? 'not_connected' : null;
        return {
          id,
          label: statusLabels[id],
          enabled,
          state: !enabled ? 'disabled' : status?.state ?? (!options.databaseAvailable ? 'unavailable' : id === 'x' ? 'unavailable' : 'not_run'),
          reason: !enabled ? null : status?.reason ?? unavailableReason,
          observedAt: status?.observedAt ?? null,
        };
      });
      return {
        paused: settings.paused,
        quietNow: isQuietHour(now),
        nextSlotAt: settings.paused ? null : nextSlotAfter(now).at.toISOString(),
        lastRun,
        budget: {
          month: monthKey(now),
          monthlyLimitDkk: settings.monthlyBudgetDkk,
          estimatedSpendDkk,
          state: budgetState(settings.monthlyBudgetDkk, estimatedSpendDkk),
        },
        sources,
        capabilities: {
          todoWrites: options.todoWritesEnabled,
          alerts: options.alertsEnabled && options.pushEnabled,
        },
      };
    });

    app.get('/proactive/runs', async (request, reply) => {
      if (!owner(request, reply)) return;
      const query = request.query as Record<string, unknown>;
      const value = query.limit ?? '20';
      const limit = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
      if (Object.keys(query).some((key) => key !== 'limit') ||
          !Number.isInteger(limit) || limit < 1 || limit > 50) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      return { runs: await options.store.runs.list(limit) };
    });

    app.post('/proactive/runs', async (request, reply) => {
      if (!owner(request, reply)) return;
      const previous = manualAdmission;
      let release!: () => void;
      manualAdmission = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const now = options.now();
        const settings = await options.store.settings.read();
        if (settings.paused) return reply.code(409).send({ error: 'paused' });
        if (!Object.values(settings.sources).some(Boolean)) {
          return reply.code(409).send({ error: 'no_sources' });
        }
        const spent = await options.store.spend.monthTotal(monthKey(now));
        const worstCase = await (options.worstCaseDkk?.() ?? estimateCost('unknown', 100_000, 8_000).estimatedDkk);
        if (settings.monthlyBudgetDkk === 0 ||
            !canRunWithinBudget(settings.monthlyBudgetDkk, spent, worstCase)) {
          return reply.code(409).send({ error: 'budget_exhausted' });
        }
        const latest = await options.store.runs.running(now);
        if (latest?.status === 'running') return reply.code(409).send({ error: 'already_running', run: latest });
        const [recent, today] = await Promise.all([
          options.store.runs.countManualSince(new Date(now.getTime() - 5 * 60_000 + 1)),
          options.store.runs.countManualSince(copenhagenDayStart(now)),
        ]);
        if (recent > 0 || today >= 6) return reply.code(429).send({ error: 'rate_limited' });
        if (!options.run) return reply.code(503).send({ error: 'not_available' });
        const claim = await options.store.runs.claim({ trigger: 'manual', slot: null, now });
        if (!claim) {
          const latest = await options.store.runs.running(now);
          if (latest?.status !== 'running') {
            const [recent, today] = await Promise.all([
              options.store.runs.countManualSince(new Date(now.getTime() - 5 * 60_000 + 1)),
              options.store.runs.countManualSince(copenhagenDayStart(now)),
            ]);
            if (recent > 0 || today >= 6) return reply.code(429).send({ error: 'rate_limited' });
          }
          return reply.code(409).send({ error: 'already_running', run: latest });
        }
        void reply.code(202).send({ run: claim.run });
        const controller = new AbortController();
        const task = Promise.resolve().then(() => options.run!(claim, controller.signal)).catch(async () => {
          await options.store.runs.finish(claim.run.id, claim.generation, 'failed', 'internal_error', 0, options.now());
        }).catch(() => {
          app.log.warn({ reason: 'internal_error' }, 'proactive.failed');
        }).finally(() => { pendingRuns.delete(task); });
        pendingRuns.set(task, controller);
        return reply;
      } finally {
        release();
      }
    });

    app.get('/proactive/settings', async (request, reply) => {
      if (!owner(request, reply)) return;
      return responseSettings(await options.store.settings.read());
    });

    app.patch('/proactive/settings', async (request, reply) => {
      if (!owner(request, reply)) return;
      const parsed = parseSettingsPatch(request.body);
      if (!parsed) return reply.code(400).send({ error: 'invalid_request' });
      if ('error' in parsed) return reply.code(422).send({ error: parsed.error });
      try {
        await options.store.settings.patch(parsed.patch, parsed.expectedRevision);
        return responseSettings(await options.store.settings.read());
      } catch (error) {
        if (error instanceof ProactiveSettingsConflictError) {
          return reply.code(409).send({ error: 'settings_changed' });
        }
        throw error;
      }
    });

    app.get('/proactive/items', async (request, reply) => {
      if (!owner(request, reply)) return;
      const query = request.query as Record<string, unknown>;
      if (Object.keys(query).some((key) => !['state', 'limit'].includes(key))) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const state = query.state ?? 'open';
      const limitValue = query.limit ?? '50';
      const limit = typeof limitValue === 'number' ? limitValue
        : typeof limitValue === 'string' && /^\d+$/u.test(limitValue) ? Number(limitValue) : Number.NaN;
      if ((state !== 'open' && state !== 'all') || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const items: Item[] = await options.store.items.list(state, limit, options.now());
      return { items };
    });

    if (options.registerItemDetail) {
      app.get<{ Params: { id: string } }>('/proactive/items/:id', async (request, reply) => {
        if (!owner(request, reply)) return;
        if (!uuidPattern.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
        const item = await options.store.items.get(request.params.id, true);
        if (!item) return reply.code(404).send({ error: 'not_found' });
        return item;
      });
    }

    app.post<{ Params: { id: string } }>('/proactive/items/:id/feedback', async (request, reply) => {
      if (!owner(request, reply)) return;
      if (!uuidPattern.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
      const feedback = itemFeedback(request.body, options.now());
      if (!feedback) return reply.code(400).send({ error: 'invalid_request' });
      const item = await options.store.items.applyFeedback(request.params.id, feedback.action, feedback.snoozeUntil);
      if (!item) return reply.code(404).send({ error: 'not_found' });
      return item;
    });
  };
}

export function registerProactiveRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  options: ProactiveRouteOptions,
): void {
  app.register(registerRoutes<Logger>(options));
}
