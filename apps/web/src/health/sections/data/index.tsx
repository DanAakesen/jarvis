import { lazy } from 'react';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'data',
  label: 'Data',
  order: 60,
  usesPeriod: true,
  requiredSources: [],
  Component: lazy(() => import('./DataSection')),
};
