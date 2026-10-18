import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'overview',
  label: 'Overview',
  order: 10,
  usesPeriod: false,
  requiredSources: [],
  Component: lazy(() => import('./OverviewSection')),
};
