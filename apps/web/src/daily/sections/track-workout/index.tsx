import { dailyQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'track-workout',
  label: 'Track workout',
  order: 25,
  usesPeriod: false,
  requiredSources: [sources.lifts],
  Component: lazy(() => import('./TrackWorkoutSection')),
};
