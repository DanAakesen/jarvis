import type { PhoneStatus } from '@jarvis/contracts';
import type { PhoneSessionStore } from '../database/phone-session-store.js';
import type { BackendModule } from '../modules.js';

export function createPhoneStatusModule(options: {
  readonly configured: boolean;
  readonly store: PhoneSessionStore | null;
}): BackendModule {
  return {
    id: 'phone-status',
    tools: [],
    registerRoutes: async (app) => {
      app.get('/phone/status', async (request, reply) => {
        try {
          const recentCalls = options.store ? await options.store.recent() : [];
          const status: PhoneStatus = {
            configured: options.configured,
            historyAvailable: options.store !== null,
            recentCalls,
          };
          return status;
        } catch {
          request.log.warn('phone.status_unavailable');
          return reply.code(503).send({ error: 'Phone status unavailable' });
        }
      });
    },
  };
}
