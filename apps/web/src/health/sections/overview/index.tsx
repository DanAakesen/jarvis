import { lazy } from 'react';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'overview',
  label: 'Overview',
  order: 10,
  usesPeriod: false,
  requiredSources: [],
  Component: lazy(() => import('./OverviewSection')),
};
