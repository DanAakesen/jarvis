import type { BackendModule } from '../modules.js';

export const coreModule: BackendModule = {
  id: 'core',
  tools: [],
  registerRoutes: async (app) => {
    app.get('/health', {
      schema: { response: { 200: { type: 'object', properties: { status: { type: 'string', const: 'ok' } }, required: ['status'], additionalProperties: false } } },
    }, async () => ({ status: 'ok' }));
  },
};
