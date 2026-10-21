import { createContext } from 'react';
import type { OverviewPresetId } from '../overview-window';

export const OverviewPeriodContext = createContext<{
  preset: OverviewPresetId;
  setPreset: (preset: OverviewPresetId) => void;
} | null>(null);
