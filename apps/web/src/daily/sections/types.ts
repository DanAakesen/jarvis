import type { ComponentType } from 'react';
import type { DailySourceId } from '@jarvis/contracts';

export interface DailyPeriod {
  startDate: string;
  endDate: string;
}

export interface DailySectionProps {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  sources: readonly DailySourceId[];
  period: DailyPeriod;
  onPeriodChange: (period: DailyPeriod) => void;
  refreshVersion: number;
}

export interface DailySectionDefinition {
  id: string;
  label: string;
  order: number;
  usesPeriod: boolean;
  requiredSources: readonly DailySourceId[];
  isAvailable?: (sources: readonly DailySourceId[]) => boolean;
  Component: ComponentType<DailySectionProps>;
}
