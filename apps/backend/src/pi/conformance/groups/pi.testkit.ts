import { createBrainTools } from '../../brain/tools.js';
import { createSituationTools } from '../../situation-tools.js';
import { createWatchTools } from '../../watch/tools.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/**
 * The PI-only tools: situation tools (an activation turn), the brain's tools (a background wake) and standing watches. The MCP
 * door itself is composed by the world; this group only contributes the tools production adds to the `pi` module.
 */
export const piGroup: GroupFactory = () => ({
  id: 'pi',
  covers: ['pi'],
  modules: [{
    id: 'pi',
    registerRoutes: async () => {},
    tools: [
      ...createSituationTools({ registry: unstubbed('piRegistry'), service: unstubbed('situationService'), now: () => new Date() }),
      ...createBrainTools({
        registry: unstubbed('piRegistry'), comms: unstubbed('brainComms'), proactive: unstubbed('proactiveStore'),
        area: unstubbed('piArea'), inbox: unstubbed('inboxStore'), situation: unstubbed('situationService'), now: () => new Date(),
      }),
      ...createWatchTools({ watches: unstubbed('watches'), registry: unstubbed('piRegistry'), memoryStore: unstubbed('memoryStore') }),
    ],
  }],
});
