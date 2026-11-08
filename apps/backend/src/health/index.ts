import { healthContractVersion, healthCapabilitiesVersion, healthModuleId, healthViewIds, healthQuerySourcesV1, healthQuerySourcesV2, healthQuerySourcesV3, healthQuerySourcesV5, healthQuerySourcesV6, healthQuerySourcesV6WithoutTrainingTargets } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { resolveHealthOwner } from './owner.js';
import type { HealthData } from './query.js';
import { healthQueryTool } from './tools/query.js';
import { healthShowTool } from './tools/show.js';
import { healthQueryRoutes } from './routes/query.js';
import { healthMcpRoutes, type HealthMcpOptions } from './mcp/routes.js';
import { healthFoodTool, type InternalNutrition } from './tools/food.js';
import { healthFoodReviewTool } from './tools/food-review.js';
import { healthSavedFoodTool, type InternalSavedNutrition } from './tools/saved-food.js';
import { healthNutritionTargetsTool } from './tools/nutrition-targets.js';
import { healthNutritionSuggestTool } from './tools/nutrition-suggest.js';
import { nutritionTargetsRoutes } from './routes/nutrition-targets.js';
import { trainingTargetsRoutes } from './routes/training-targets.js';
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from './nutrition/targets-store.js';
import type { TrainingTargetsAccess } from './training/targets-store.js';
import { healthSourceTools } from './tools/source-tools.js';
import { isLegacyDailyRequest, serveLegacyDailyAlias } from './legacy-alias.js';
import { gymTools } from './tools/gym.js';
import { liftRoutes } from './routes/lifts.js';
import { workoutRoutes } from './routes/workouts.js';
import { deviceSyncRoutes } from './routes/sync.js';

/** Trusted server composition flag. Not a request parameter or a production rollout. */
export function createHealthModules(enabled = false, data?: HealthData, connector?: HealthMcpOptions, internalNutrition?: InternalNutrition, savedNutrition?: InternalSavedNutrition, nutritionTargets?: NutritionTargetsAccess, nutritionSuggestions?: NutritionSuggestionSources, trainingTargets?: TrainingTargetsAccess): readonly BackendModule[] {
  if (enabled !== true) return [];
  if (connector && !data) throw new TypeError('Health MCP requires the shared Health query service');
  if (internalNutrition && !data) throw new TypeError('Health food writes require shared Health data');
  if (savedNutrition && !data) throw new TypeError('Health saved food requires shared Health data');
  if (nutritionTargets && !data) throw new TypeError('Health nutrition targets require shared Health data');
  if (nutritionSuggestions && !data) throw new TypeError('Health nutrition suggestions require shared Health data');
  if (trainingTargets && !data) throw new TypeError('Health training targets require shared Health data');
  if (nutritionSuggestions && !nutritionTargets) throw new TypeError('Health nutrition suggestions require nutrition targets');
  const tools = data ? [healthQueryTool(data.query), healthShowTool(data.query),
    ...(data.gymTools ? gymTools(data.gymTools) : []),
    ...(internalNutrition ? [healthFoodTool(internalNutrition), healthFoodReviewTool(internalNutrition, Date.now, data.foodLookup)] : []),
    ...(savedNutrition ? [healthSavedFoodTool(savedNutrition)] : []),
    ...(nutritionTargets ? [healthNutritionTargetsTool(nutritionTargets)] : []),
    ...(nutritionTargets && nutritionSuggestions ? [healthNutritionSuggestTool(nutritionTargets, nutritionSuggestions)] : []),
    ...(data.health && data.nutrition && data.coach ? healthSourceTools(data, data.nutrition, data.coach) : []),
  ] : [];
  return [{
    id: healthModuleId,
    tools,
    registerRoutes: async (app) => {
      serveLegacyDailyAlias(app);
      if (data) {
        await app.register(healthQueryRoutes(data.query));
        if (nutritionTargets) await app.register(nutritionTargetsRoutes(nutritionTargets));
        if (trainingTargets) await app.register(trainingTargetsRoutes(trainingTargets));
        if (data.lifts) await app.register(liftRoutes(data.lifts));
        if (data.workouts) await app.register(workoutRoutes(data.workouts));
        if (data.deviceSync) await app.register(deviceSyncRoutes(data.deviceSync));
        if (data.retryGymVault) {
          const retry = data.retryGymVault;
          const lifetime = new AbortController();
          let timer: NodeJS.Timeout | undefined;
          let running = false;
          const tick = () => {
            if (running) return;
            running = true;
            void retry(AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)])).catch(() => undefined)
              .finally(() => { running = false; });
          };
          app.addHook('onReady', async () => { timer = setInterval(tick, 5 * 60_000); timer.unref(); setTimeout(tick, 30_000).unref(); });
          app.addHook('onClose', async () => { clearInterval(timer); lifetime.abort(); });
        }
        if (connector) await app.register(healthMcpRoutes(data.query, connector));
        const unsubscribe = data.changes.subscribe(change => {
          if (change.owner.toLowerCase() === app.ownerObjectId.toLowerCase()) app.nowEventHub.publish({ type: 'refresh' });
        });
        app.addHook('onClose', async () => { unsubscribe(); });
      }
      app.get('/health/capabilities', {
        config: { jarvisAgent: true },
        // Fastify's default Ajv removes additional properties during validation.
        // Reject caller-supplied selectors before they can be silently stripped.
        onRequest: async (request, reply) => {
          if (Object.keys(request.query as Record<string, unknown>).length !== 0) {
            return reply.code(400).send({ error: 'Invalid request' });
          }
        },
        schema: { querystring: { type: 'object', properties: {}, additionalProperties: false } },
      }, async (request, reply) => {
        resolveHealthOwner(request);
        reply.header('Cache-Control', 'no-store');
        const accepted = request.headers.accept?.split(',').map(media => {
          const value = media.toLowerCase().replace(/\s/gu, '');
          return value;
        }) ?? [];
        const hasVersion = (version: number) => accepted.includes(`application/json;version=${version}`) ||
          accepted.includes(`application/json;version="${version}"`);
        const version = hasVersion(healthCapabilitiesVersion) ? healthCapabilitiesVersion
          : hasVersion(5) ? 5 : hasVersion(4) ? 4 : hasVersion(3) ? 3 : hasVersion(2) ? 2 : healthContractVersion;
        const vary = reply.getHeader('Vary');
        reply.header('Vary', [...(Array.isArray(vary) ? vary : vary ? [String(vary)] : []), 'Accept'].join(', '));
        reply.type(version > healthContractVersion ? `application/json;version=${version}` : 'application/json');
        return {
          module: isLegacyDailyRequest(request.routeOptions.url) ? 'daily' : healthModuleId,
          version,
          stage: internalNutrition || savedNutrition || nutritionTargets ? 'internal-nutrition-rehearsal'
            : data?.lifts ? 'lift-log-rehearsal' : connector ? 'connector-rehearsal' : data ? 'read-only' : 'contract-only',
          reservedViewIds: healthViewIds,
          // Reserved view IDs do not advertise unfinished functionality as available.
          pages: [],
          tools: tools.map(tool => tool.name),
          ...(connector ? { connector: { transport: 'streamable-http', path: '/health/mcp', writes: connector.writesEnabled === true } } : {}),
          ...(data ? {
            sources: version === 1 ? healthQuerySourcesV1 : version === 2 ? healthQuerySourcesV2
              : version <= 4 ? healthQuerySourcesV3
                : version === 5 ? data.trainingTargets ? healthQuerySourcesV5 : healthQuerySourcesV3
                : data.lifts
                  ? request.principal && !request.agentPrincipal && !request.healthConnectorPrincipal
                    ? data.trainingTargets ? healthQuerySourcesV6 : healthQuerySourcesV6WithoutTrainingTargets
                    : data.trainingTargets ? healthQuerySourcesV5 : healthQuerySourcesV3
                  : data.trainingTargets ? healthQuerySourcesV5 : healthQuerySourcesV3,
            refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'], revision: 'query-content-sha256' },
          } : {}),
        };
      });
    },
  }];
}
