import { createGoogleModule } from '../../../google/tools.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/** Calendar and Gmail tools over a stubbed Google API client. */
export const googleGroup: GroupFactory = () => ({
  id: 'google',
  covers: ['google'],
  modules: [createGoogleModule(unstubbed('googleApiClient'), { timeZone: 'Europe/Copenhagen' })],
});
