import { healthQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'track-workout',
  label: 'Track workout',
  order: 25,
  usesPeriod: false,
  requiredSources: [sources.lifts],
  Component: lazy(() => import('./TrackWorkoutSection')),
};
