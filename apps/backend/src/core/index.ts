import type { BackendModule } from '../modules.js';

export const coreModule: BackendModule = {
  id: 'core',
  tools: [],
  registerRoutes: async (app) => {
    app.get('/health', {
      schema: { response: { 200: { type: 'object', properties: { status: { type: 'string', const: 'ok' } }, required: ['status'], additionalProperties: false } } },
    }, async () => ({ status: 'ok' }));
    app.get('/me', {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
            required: ['name'],
            additionalProperties: false,
          },
          401: {
            type: 'object',
            properties: { error: { type: 'string', const: 'Unauthorized' } },
            required: ['error'],
            additionalProperties: false,
          },
        },
      },
    }, async (request, reply) => {
      if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
      return { name: request.principal.displayName };
    });
  },
};
