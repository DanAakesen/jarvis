import { factoryModule } from '../../../factory/index.js';
import type { GroupFactory } from '../types.testkit.js';

/**
 * Factory projects, tasks, issues, releases, the GitHub App read/write tools and pull requests: golden scenario 1.
 * The Factory tools read their stores through app decorators, so this group supplies them through `appOptions`.
 */
export const factoryGroup: GroupFactory = () => ({
  id: 'factory',
  covers: ['factory'],
  modules: [factoryModule],
});
