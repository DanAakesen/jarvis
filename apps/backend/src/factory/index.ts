import type { BackendModule } from '../modules.js';
import { projectRoutes } from './projects.js';

/** Projects and tasks routes and tools are added here by their domain API tasks. */
export const factoryModule: BackendModule = {
  id: 'factory',
  tools: [],
  registerRoutes: async (app) => {
    await app.register(projectRoutes, { prefix: '/factory/projects' });
  },
};
