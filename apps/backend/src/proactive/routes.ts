import type {
  FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest,
  FastifyTypeProviderDefault,
} from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { budgetState } from './budget.js';
import { monthKey, nextSlotAfter, isQuietHour } from './time.js';
import { sourceIds, type Item, type SourceId, type SourceStatus } from './types.js';
import {
  sourceLabels,
  type ProactiveSettingsPatch,
  type ProactiveStore,
} from './store.js';

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
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
}

function validUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function parseSettingsPatch(value: unknown): ProactiveSettingsPatch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['paused', 'monthlyBudgetDkk', 'sources', 'newsFeeds', 'guidance'].includes(key))) {
    return undefined;
  }
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
          typeof source.id !== 'string' || !sourceIds.includes(source.id as SourceId) || typeof source.enabled !== 'boolean' ||
          Object.hasOwn(selected, source.id)) return undefined;
      selected[source.id as SourceId] = source.enabled;
    }
    patch.sources = selected;
  }
  if (Object.hasOwn(body, 'newsFeeds')) {
    if (!Array.isArray(body.newsFeeds) || body.newsFeeds.length > 10 || !body.newsFeeds.every(validUrl)) return undefined;
    patch.newsFeeds = body.newsFeeds as string[];
  }
  if (Object.hasOwn(body, 'guidance')) {
    if (typeof body.guidance !== 'string' || body.guidance.length > 1000) return undefined;
    patch.guidance = body.guidance;
  }
  return patch;
}

function itemFeedback(value: unknown, now: Date): { action: 'seen' | 'dismiss' | 'snooze' | 'useful' | 'wrong'; snoozeUntil?: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['action', 'snoozeUntil'].includes(key)) ||
      !['seen', 'dismiss', 'snooze', 'useful', 'wrong'].includes(String(body.action))) return undefined;
  if (body.action !== 'snooze') {
    if (Object.hasOwn(body, 'snoozeUntil')) return undefined;
    return { action: body.action as 'seen' | 'dismiss' | 'useful' | 'wrong' };
  }
  if (typeof body.snoozeUntil !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/u.test(body.snoozeUntil)) return undefined;
  const until = new Date(body.snoozeUntil);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(body.snoozeUntil);
  if (!parts || !Number.isFinite(until.getTime()) ||
      until.getUTCFullYear() !== Number(parts[1]) || until.getUTCMonth() + 1 !== Number(parts[2]) ||
      until.getUTCDate() !== Number(parts[3]) || until.getUTCHours() !== Number(parts[4]) ||
      until.getUTCMinutes() !== Number(parts[5]) || until.getUTCSeconds() !== Number(parts[6]) ||
      until.getTime() <= now.getTime() ||
      until.getTime() > now.getTime() + 7 * 24 * 60 * 60_000) return undefined;
  return { action: 'snooze', snoozeUntil: until.toISOString() };
}

function responseSettings(settings: Awaited<ReturnType<ProactiveStore['settings']['read']>>) {
  return {
    paused: settings.paused,
    monthlyBudgetDkk: settings.monthlyBudgetDkk,
    sources: sourceIds.map((id) => ({ id, enabled: settings.sources[id] })),
    newsFeeds: settings.newsFeeds,
    guidance: settings.guidance,
  };
}

function registerRoutes<Logger extends FastifyBaseLogger>(
  options: ProactiveRouteOptions,
): FastifyPluginAsync<Record<never, never>, Server, FastifyTypeProviderDefault, Logger> {
  return async (app) => {
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

    app.get('/proactive/settings', async (request, reply) => {
      if (!owner(request, reply)) return;
      return responseSettings(await options.store.settings.read());
    });

    app.patch('/proactive/settings', async (request, reply) => {
      if (!owner(request, reply)) return;
      const patch = parseSettingsPatch(request.body);
      if (!patch) return reply.code(400).send({ error: 'invalid_request' });
      return responseSettings(await options.store.settings.patch(patch));
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
