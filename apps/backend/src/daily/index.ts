import { dailyContractVersion, dailyCapabilitiesVersion, dailyModuleId, dailyViewIds, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3, dailyQuerySourcesV4, dailyQuerySourcesV5, dailyQuerySourcesV5WithoutFeeds, dailyQuerySourcesV6, dailyQuerySourcesV6WithoutFeeds, dailyQuerySourcesV6WithoutTrainingTargets, dailyQuerySourcesV6WithoutFeedsOrTrainingTargets } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { resolveDailyOwner } from './owner.js';
import type { DailyData } from './query.js';
import { dailyQueryTool } from './tools/query.js';
import { dailyShowTool } from './tools/show.js';
import { dailyQueryRoutes } from './routes/query.js';
import { dailyMcpRoutes, type DailyMcpOptions } from './mcp/routes.js';
import { dailyFoodTool, type InternalNutrition } from './tools/food.js';
import { dailyFoodReviewTool } from './tools/food-review.js';
import { dailySavedFoodTool, type InternalSavedNutrition } from './tools/saved-food.js';
import { dailyNutritionTargetsTool } from './tools/nutrition-targets.js';
import { dailyNutritionSuggestTool } from './tools/nutrition-suggest.js';
import { nutritionTargetsRoutes } from './routes/nutrition-targets.js';
import { trainingTargetsRoutes } from './routes/training-targets.js';
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from './nutrition/targets-store.js';
import type { TrainingTargetsAccess } from './training/targets-store.js';
import { dailyFeedTool } from './tools/feed.js';
import { dailySourceTools } from './tools/source-tools.js';
import { dailyFeedRoutes } from './feeds/routes.js';
import { liftRoutes } from './routes/lifts.js';

/** Trusted server composition flag. Not a request parameter or a production rollout. */
export function createDailyModules(enabled = false, data?: DailyData, connector?: DailyMcpOptions, internalNutrition?: InternalNutrition, savedNutrition?: InternalSavedNutrition, nutritionTargets?: NutritionTargetsAccess, nutritionSuggestions?: NutritionSuggestionSources, trainingTargets?: TrainingTargetsAccess): readonly BackendModule[] {
  if (enabled !== true) return [];
  if (connector && !data) throw new TypeError('Daily MCP requires the shared Daily query service');
  if (internalNutrition && !data) throw new TypeError('Daily food writes require shared Daily data');
  if (savedNutrition && !data) throw new TypeError('Daily saved food requires shared Daily data');
  if (nutritionTargets && !data) throw new TypeError('Daily nutrition targets require shared Daily data');
  if (nutritionSuggestions && !data) throw new TypeError('Daily nutrition suggestions require shared Daily data');
  if (trainingTargets && !data) throw new TypeError('Daily training targets require shared Daily data');
  if (nutritionSuggestions && !nutritionTargets) throw new TypeError('Daily nutrition suggestions require nutrition targets');
  const tools = data ? [dailyQueryTool(data.query), dailyShowTool(data.query),
    ...(data.feeds ? [dailyFeedTool(data.feeds)] : []),
    ...(internalNutrition ? [dailyFoodTool(internalNutrition), dailyFoodReviewTool(internalNutrition, Date.now, data.foodLookup)] : []),
    ...(savedNutrition ? [dailySavedFoodTool(savedNutrition)] : []),
    ...(nutritionTargets ? [dailyNutritionTargetsTool(nutritionTargets)] : []),
    ...(nutritionTargets && nutritionSuggestions ? [dailyNutritionSuggestTool(nutritionTargets, nutritionSuggestions)] : []),
    ...(data.health && data.nutrition && data.coach ? dailySourceTools(data, data.nutrition, data.coach) : []),
  ] : [];
  return [{
    id: dailyModuleId,
    tools,
    registerRoutes: async (app) => {
      if (data) {
        await app.register(dailyQueryRoutes(data.query));
        if (data.feeds) await app.register(dailyFeedRoutes(data.feeds));
        if (nutritionTargets) await app.register(nutritionTargetsRoutes(nutritionTargets));
        if (trainingTargets) await app.register(trainingTargetsRoutes(trainingTargets));
        if (data.lifts) await app.register(liftRoutes(data.lifts));
        if (connector) await app.register(dailyMcpRoutes(data.query, connector));
        const unsubscribe = data.changes.subscribe(change => {
          if (change.owner.toLowerCase() === app.ownerObjectId.toLowerCase()) app.nowEventHub.publish({ type: 'refresh' });
        });
        app.addHook('onClose', async () => { unsubscribe(); });
      }
      app.get('/daily/capabilities', {
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
        resolveDailyOwner(request);
        reply.header('Cache-Control', 'no-store');
        const accepted = request.headers.accept?.split(',').map(media => {
          const value = media.toLowerCase().replace(/\s/gu, '');
          return value;
        }) ?? [];
        const hasVersion = (version: number) => accepted.includes(`application/json;version=${version}`) ||
          accepted.includes(`application/json;version="${version}"`);
        const version = hasVersion(dailyCapabilitiesVersion) ? dailyCapabilitiesVersion
          : hasVersion(5) ? 5 : hasVersion(4) ? 4 : hasVersion(3) ? 3 : hasVersion(2) ? 2 : dailyContractVersion;
        const vary = reply.getHeader('Vary');
        reply.header('Vary', [...(Array.isArray(vary) ? vary : vary ? [String(vary)] : []), 'Accept'].join(', '));
        reply.type(version > dailyContractVersion ? `application/json;version=${version}` : 'application/json');
        return {
          module: dailyModuleId,
          version,
          stage: internalNutrition || savedNutrition || nutritionTargets ? 'internal-nutrition-rehearsal'
            : data?.lifts ? 'lift-log-rehearsal' : data?.feeds ? 'feed-rehearsal' : connector ? 'connector-rehearsal' : data ? 'read-only' : 'contract-only',
          reservedViewIds: dailyViewIds,
          // Reserved view IDs do not advertise unfinished functionality as available.
          pages: [],
          tools: tools.map(tool => tool.name),
          ...(connector ? { connector: { transport: 'streamable-http', path: '/daily/mcp', writes: connector.writesEnabled === true } } : {}),
          ...(data ? {
            sources: version === 1 ? dailyQuerySourcesV1 : version === 2 ? dailyQuerySourcesV2
              : version === 3 ? dailyQuerySourcesV3
                : version === 4
                  ? data.feeds && request.principal && !request.agentPrincipal && !request.dailyConnectorPrincipal
                    ? dailyQuerySourcesV4 : dailyQuerySourcesV3
                  : version === 5
                    ? data.trainingTargets
                    ? data.feeds && request.principal && !request.agentPrincipal && !request.dailyConnectorPrincipal
                      ? dailyQuerySourcesV5 : dailyQuerySourcesV5WithoutFeeds
                    : data.feeds && request.principal && !request.agentPrincipal && !request.dailyConnectorPrincipal
                      ? dailyQuerySourcesV4 : dailyQuerySourcesV3
                    : data.lifts
                    ? request.principal && !request.agentPrincipal && !request.dailyConnectorPrincipal
                      ? data.trainingTargets
                        ? data.feeds ? dailyQuerySourcesV6 : dailyQuerySourcesV6WithoutFeeds
                        : data.feeds ? dailyQuerySourcesV6WithoutTrainingTargets : dailyQuerySourcesV6WithoutFeedsOrTrainingTargets
                      : data.trainingTargets ? dailyQuerySourcesV5WithoutFeeds : dailyQuerySourcesV3
                    : data.trainingTargets
                    ? data.feeds && request.principal && !request.agentPrincipal && !request.dailyConnectorPrincipal
                      ? dailyQuerySourcesV5 : dailyQuerySourcesV5WithoutFeeds
                    : data.feeds && request.principal && !request.agentPrincipal && !request.dailyConnectorPrincipal
                      ? dailyQuerySourcesV4 : dailyQuerySourcesV3,
            refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'], revision: 'query-content-sha256' },
          } : {}),
        };
      });
    },
  }];
}
