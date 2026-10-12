import { dailyContractVersion, dailyModuleId, dailyViewIds } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { resolveDailyOwner } from './owner.js';

/** Trusted server composition flag. Not a request parameter or a production rollout. */
export function createDailyModules(enabled = false): readonly BackendModule[] {
  if (enabled !== true) return [];
  return [{
    id: dailyModuleId,
    tools: [],
    registerRoutes: async (app) => {
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
          stage: 'contract-only',
          reservedViewIds: dailyViewIds,
          // Reserved view IDs do not advertise unfinished functionality as available.
          pages: [],
          tools: [],
        };
      });
    },
  }];
}
