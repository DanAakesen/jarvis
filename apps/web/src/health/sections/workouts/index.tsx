import { healthQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'workouts',
  label: 'Workouts',
  order: 20,
  usesPeriod: true,
  requiredSources: [sources.workouts],
  Component: lazy(() => import('./WorkoutsSection')),
};
