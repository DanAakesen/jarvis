import type { ComponentType } from 'react';
import type { HealthSourceId } from '@jarvis/contracts';

export interface HealthPeriod {
  startDate: string;
  endDate: string;
}

export interface HealthSectionProps {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  sources: readonly HealthSourceId[];
  period: HealthPeriod;
  onPeriodChange: (period: HealthPeriod) => void;
  refreshVersion: number;
}

export interface HealthSectionDefinition {
  id: string;
  label: string;
  order: number;
  usesPeriod: boolean;
  requiredSources: readonly HealthSourceId[];
  isAvailable?: (sources: readonly HealthSourceId[]) => boolean;
  Component: ComponentType<HealthSectionProps>;
}
