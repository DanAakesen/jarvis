import { healthQuerySources as sources } from '@jarvis/contracts';
import { lazy } from 'react';
import type { HealthSectionDefinition } from '../types';

export const section: HealthSectionDefinition = {
  id: 'briefs',
  label: 'Briefs',
  order: 50,
  usesPeriod: false,
  requiredSources: [sources.briefs, sources.brief],
  Component: lazy(() => import('./BriefsSection')),
};
