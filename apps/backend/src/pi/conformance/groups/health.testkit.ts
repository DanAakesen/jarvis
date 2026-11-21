import { createHealthModules } from '../../../health/index.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/** Health query, workouts (lifts and sessions), nutrition (food, saved food, targets, suggestions): golden scenarios 4 and 5. */
export const healthGroup: GroupFactory = () => ({
  id: 'health',
  covers: ['health'],
  modules: createHealthModules(true, unstubbed('healthData'), undefined, unstubbed('nutrition'), unstubbed('nutrition'),
    unstubbed('nutritionTargets'), unstubbed('nutritionSuggestions'), unstubbed('trainingTargets')),
});
