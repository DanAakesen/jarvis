import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'rules',
  label: 'Rules & sources',
  order: 70,
  usesPeriod: false,
  requiredSources: [],
  Component: lazy(() => import('./RulesSection')),
};
