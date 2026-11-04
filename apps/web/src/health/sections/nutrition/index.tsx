import { lazy } from 'react';
import { healthQuerySources } from '@jarvis/contracts';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'nutrition',
  label: 'Nutrition',
  order: 30,
  usesPeriod: true,
  requiredSources: [healthQuerySources.meals],
  Component: lazy(() => import('./NutritionSection')),
};
