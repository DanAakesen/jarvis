import type { FastifyRequest } from 'fastify';
import type sql from 'mssql';
import { AuthenticationDenied } from '../auth/verify.js';
import { ConfigurationError } from '../configuration-error.js';
import type { BackendModule } from '../modules.js';
import { DailyHealthReadModel } from './health/read-model.js';
import { createDailyModules } from './index.js';
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import { NutritionTargetsStore, type NutritionTargetsAccess } from './nutrition/targets-store.js';
import { resolveDailyOwner } from './owner.js';
import { createDailyData } from './query.js';
import type { DailyFeedProviders } from './feeds/service.js';

export interface DailyCompositionOptions {
  /** The trusted server switch (JARVIS_DAILY_ENABLED). Anything other than true composes nothing. */
  readonly enabled: boolean;
  /** The existing backend pool. Daily never creates one. */
  readonly pool: sql.ConnectionPool | undefined;
  /** The configured owner; every Daily accessor also re-resolves the caller per request and fails closed. */
  readonly ownerObjectId: string;
  /** Separate default-off switch; an empty provider set reports not configured rather than empty coverage. */
  readonly feedsEnabled?: boolean;
  readonly feeds?: DailyFeedProviders;
}

const uuid = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/iu;

/**
 * The only production entry point to Daily. Off, it returns nothing and touches nothing, so Jarvis keeps its
 * route table, tool catalogue and startup exactly. On, it composes the owner-bound nutrition slice over the
 * existing pool: reads, owner-approved food and target writes, and the budget-aware suggestion. It adds no
 * timer, job, import, provider/device connector, Frida lookup or Google/Gmail feed.
 */
export function composeDaily(options: DailyCompositionOptions): BackendModule | undefined {
  if (options.enabled !== true) return undefined;
  if (!options.pool) throw new ConfigurationError('SQL is required for Daily');
  if (!uuid.test(options.ownerObjectId)) throw new ConfigurationError('The Daily owner must be a UUID');
  const { pool } = options;
  const data = createDailyData(pool, options.ownerObjectId, Date.now, undefined,
    options.feedsEnabled === true ? options.feeds ?? {} : undefined);
  // createDailyData applies this check to its own accessors; the two composed here get the same one.
  const owned = (request: FastifyRequest) => {
    if (resolveDailyOwner(request).toLowerCase() !== options.ownerObjectId.toLowerCase()) throw new AuthenticationDenied(403);
  };
  const targets: NutritionTargetsAccess = (request) => {
    owned(request);
    return NutritionTargetsStore.forRequest(pool, request);
  };
  const suggestions: NutritionSuggestionSources = {
    nutrition: data.nutrition,
    health: (request) => {
      owned(request);
      return DailyHealthReadModel.forRequest(pool, request);
    },
  };
  return createDailyModules(true, data, undefined, data.nutrition, data.nutrition, targets, suggestions)[0];
}
