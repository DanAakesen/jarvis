import { dailyContractVersion, dailyModuleId, dailyViewIds, dailyQuerySources } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { resolveDailyOwner } from './owner.js';
import type { DailyData } from './query.js';
import { dailyQueryTool } from './tools/query.js';
import { dailyQueryRoutes } from './routes/query.js';

/** Trusted server composition flag. Not a request parameter or a production rollout. */
export function createDailyModules(enabled = false, data?: DailyData): readonly BackendModule[] {
  if (enabled !== true) return [];
  return [{
    id: dailyModuleId,
    tools: data ? [dailyQueryTool(data.query)] : [],
    registerRoutes: async (app) => {
      if (data) {
        await app.register(dailyQueryRoutes(data.query));
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
        return {
          module: dailyModuleId,
          version: dailyContractVersion,
          stage: data ? 'read-only' : 'contract-only',
          reservedViewIds: dailyViewIds,
          // Reserved view IDs do not advertise unfinished functionality as available.
          pages: [],
          tools: data ? ['daily_query'] : [],
          ...(data ? {
            sources: Object.values(dailyQuerySources),
            refresh: { event: 'now', refetchOn: ['connect', 'reconnect', 'refocus'], revision: 'query-content-sha256' },
          } : {}),
        };
      });
    },
  }];
}
