import { dailyQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { DailySectionDefinition } from '../types';

export const section: DailySectionDefinition = {
  id: 'briefs',
  label: 'Briefs',
  order: 50,
  usesPeriod: false,
  requiredSources: [sources.briefs, sources.brief],
  Component: lazy(() => import('./BriefsSection')),
};
