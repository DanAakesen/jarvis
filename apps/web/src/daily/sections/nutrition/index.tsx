import { lazy } from 'react';
import { dailyQuerySources } from '@jarvis/contracts';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'nutrition',
  label: 'Nutrition',
  order: 30,
  usesPeriod: true,
  requiredSources: [dailyQuerySources.meals],
  Component: lazy(() => import('./NutritionSection')),
};
