import { createContext } from 'react';
import type { DailySourceId } from '@jarvis/contracts';

export interface DailySectionNavigation {
  openSource: (source: DailySourceId) => void;
  backToOverview: () => void;
  initialSource?: DailySourceId | undefined;
  onSourceChange: (source: DailySourceId) => void;
  availabilityError?: string | undefined;
  availabilityPending?: boolean | undefined;
  retryAvailability: () => void;
}

export const DailySectionNavigationContext = createContext<DailySectionNavigation>({
  openSource: () => {},
  backToOverview: () => {},
  onSourceChange: () => {},
  retryAvailability: () => {},
  availabilityPending: false,
});
