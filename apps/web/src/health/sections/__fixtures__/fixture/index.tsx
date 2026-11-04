import type { HealthSectionDefinition } from '../../types';

export const section: HealthSectionDefinition = {
  id: 'fixture',
  label: 'Fixture',
  order: 25,
  usesPeriod: false,
  requiredSources: [],
  Component: () => null,
};
