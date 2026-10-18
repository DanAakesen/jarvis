import { dailyQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'body-sleep',
  label: 'Body & sleep',
  order: 40,
  usesPeriod: true,
  requiredSources: [],
  isAvailable: available => available.includes(sources.sleep) ||
    available.includes(sources.metrics) && available.includes(sources.metricCatalog),
  Component: lazy(() => import('./BodySleepSection')),
};
