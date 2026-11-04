import { lazy } from 'react';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'rules',
  label: 'Rules & sources',
  order: 70,
  usesPeriod: false,
  requiredSources: [],
  Component: lazy(() => import('./RulesSection')),
};
