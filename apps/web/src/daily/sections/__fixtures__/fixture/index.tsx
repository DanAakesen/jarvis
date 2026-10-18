import type { DailySectionDefinition } from '../../types';

export const section: DailySectionDefinition = {
  id: 'fixture',
  label: 'Fixture',
  order: 25,
  usesPeriod: false,
  requiredSources: [],
  Component: () => null,
};
