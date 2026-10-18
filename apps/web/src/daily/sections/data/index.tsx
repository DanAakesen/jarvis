import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'data',
  label: 'Data',
  order: 60,
  usesPeriod: true,
  requiredSources: [],
  Component: lazy(() => import('./DataSection')),
};
