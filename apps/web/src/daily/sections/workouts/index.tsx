import { dailyQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'workouts',
  label: 'Workouts',
  order: 20,
  usesPeriod: true,
  requiredSources: [sources.workouts],
  Component: lazy(() => import('./WorkoutsSection')),
};
