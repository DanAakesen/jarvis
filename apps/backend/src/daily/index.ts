import { dailyContractVersion, dailyCapabilitiesVersion, dailyModuleId, dailyViewIds, dailyQuerySourcesV1, dailyQuerySourcesV2, dailyQuerySourcesV3 } from '@jarvis/contracts';
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
import type { NutritionSuggestionSources } from './nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from './nutrition/targets-store.js';
import { dailyFoodLookupTool } from './tools/food-lookup.js';
import { dailyFeedTool } from './tools/feed.js';

/** Trusted server composition flag. Not a request parameter or a production rollout. */
export function createDailyModules(enabled = false, data?: DailyData, connector?: DailyMcpOptions, internalNutrition?: InternalNutrition, savedNutrition?: InternalSavedNutrition, nutritionTargets?: NutritionTargetsAccess, nutritionSuggestions?: NutritionSuggestionSources): readonly BackendModule[] {
  if (enabled !== true) return [];
  if (connector && !data) throw new TypeError('Daily MCP requires the shared Daily query service');
  if (internalNutrition && !data) throw new TypeError('Daily food writes require shared Daily data');
  if (savedNutrition && !data) throw new TypeError('Daily saved food requires shared Daily data');
  if (nutritionTargets && !data) throw new TypeError('Daily nutrition targets require shared Daily data');
  if (nutritionSuggestions && !data) throw new TypeError('Daily nutrition suggestions require shared Daily data');
  if (nutritionSuggestions && !nutritionTargets) throw new TypeError('Daily nutrition suggestions require nutrition targets');
  const tools = data ? [dailyQueryTool(data.query), dailyShowTool(data.query),
    ...(data.foodLookup ? [dailyFoodLookupTool(data.foodLookup)] : []),
    ...(data.feeds ? [dailyFeedTool(data.feeds)] : []),
    ...(internalNutrition ? [dailyFoodTool(internalNutrition), dailyFoodReviewTool(internalNutrition)] : []),
    ...(savedNutrition ? [dailySavedFoodTool(savedNutrition)] : []),
    ...(nutritionTargets ? [dailyNutritionTargetsTool(nutritionTargets)] : []),
    ...(nutritionTargets && nutritionSuggestions ? [dailyNutritionSuggestTool(nutritionTargets, nutritionSuggestions)] : []),
  ] : [];
  return [{
    id: dailyModuleId,
    tools,
    registerRoutes: async (app) => {
      if (data) {
        await app.register(dailyQueryRoutes(data.query));
        if (nutritionTargets) await app.register(nutritionTargetsRoutes(nutritionTargets));
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
        const version = hasVersion(dailyCapabilitiesVersion) ? dailyCapabilitiesVersion : hasVersion(2) ? 2 : dailyContractVersion;
        const vary = reply.getHeader('Vary');
        reply.header('Vary', [...(Array.isArray(vary) ? vary : vary ? [String(vary)] : []), 'Accept'].join(', '));
        reply.type(version > dailyContractVersion ? `application/json;version=${version}` : 'application/json');
        return {
          module: dailyModuleId,
          version,
          stage: internalNutrition || savedNutrition || nutritionTargets ? 'internal-nutrition-rehearsal' : data?.feeds ? 'feed-rehearsal' : connector ? 'connector-rehearsal' : data ? 'read-only' : 'contract-only',
          reservedViewIds: dailyViewIds,
          // Reserved view IDs do not advertise unfinished functionality as available.
          pages: [],
          tools: tools.map(tool => tool.name),
          ...(connector ? { connector: { transport: 'streamable-http', path: '/daily/mcp', writes: connector.writesEnabled === true } } : {}),
          ...(data ? {
            sources: version === 1 ? dailyQuerySourcesV1 : version === 2 ? dailyQuerySourcesV2 : dailyQuerySourcesV3,
            refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'], revision: 'query-content-sha256' },
          } : {}),
        };
      });
    },
  }];
}
