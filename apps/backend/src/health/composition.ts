import type { FastifyRequest } from 'fastify';
import type sql from 'mssql';
import { AuthenticationDenied } from '../auth/verify.js';
import { ConfigurationError } from '../configuration-error.js';
import type { BackendModule } from '../modules.js';
import type { ApprovalModelPort } from '../core/approval-interpreter.js';
import { HealthReadModel } from './health/read-model.js';
import { createHealthModules } from './index.js';
import { FridaLookupAdapter } from './nutrition/frida.js';
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import { NutritionTargetsStore, type NutritionTargetsAccess } from './nutrition/targets-store.js';
import { resolveHealthOwner } from './owner.js';
import { createHealthData } from './query.js';
import type { HealthGymVault } from './query.js';

export interface HealthCompositionOptions {
  /** The trusted server switch (JARVIS_HEALTH_ENABLED). Anything other than true composes nothing. */
  readonly enabled: boolean;
  /** The existing backend pool. Health never creates one. */
  readonly pool: sql.ConnectionPool | undefined;
  /** The configured owner; every Health accessor also re-resolves the caller per request and fails closed. */
  readonly ownerObjectId: string;
  /** The vault client for the Gym log copy. Without it saved entries stay pending and are never reported as copied. */
  readonly gymVault?: HealthGymVault;
  readonly liftCaptureModel?: ApprovalModelPort;
}

const uuid = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/iu;

/**
 * The only production entry point to Health. Off, it returns nothing and touches nothing, so Jarvis keeps its
 * route table, tool catalogue and startup exactly. On, it composes the owner-bound nutrition slice over the
 * existing pool: reads, owner-approved food writes, owner-only Settings target routes and the budget-aware suggestion.
 * Frida lookup is lazy and owner-bound; it adds no timer, job or provider/device connector; Calendar and Gmail live only in the Google module.
 */
export function composeHealth(options: HealthCompositionOptions): BackendModule | undefined {
  if (options.enabled !== true) return undefined;
  if (!options.pool) throw new ConfigurationError('SQL is required for Health');
  if (!uuid.test(options.ownerObjectId)) throw new ConfigurationError('The Health owner must be a UUID');
  const { pool } = options;
  const data = { ...createHealthData(pool, options.ownerObjectId, Date.now, new FridaLookupAdapter(),
    options.gymVault), ...(options.liftCaptureModel ? { liftCaptureModel: options.liftCaptureModel } : {}) };
  // createHealthData applies this check to its own accessors; the two composed here get the same one.
  const owned = (request: FastifyRequest) => {
    if (resolveHealthOwner(request).toLowerCase() !== options.ownerObjectId.toLowerCase()) throw new AuthenticationDenied(403);
  };
  const targets: NutritionTargetsAccess = (request) => {
    owned(request);
    return NutritionTargetsStore.forRequest(pool, request);
  };
  const suggestions: NutritionSuggestionSources = {
    nutrition: data.nutrition,
    health: (request) => {
      owned(request);
      return HealthReadModel.forRequest(pool, request);
    },
  };
  return createHealthModules(true, data, undefined, data.nutrition, data.nutrition, targets, suggestions, data.trainingTargets)[0];
}
