import { createContext } from 'react';
import type { HealthSourceId } from '@jarvis/contracts';

export interface HealthSectionNavigation {
  openSource: (source: HealthSourceId) => void;
  backToOverview: () => void;
  initialSource?: HealthSourceId | undefined;
  onSourceChange: (source: HealthSourceId) => void;
  availabilityError?: string | undefined;
  availabilityPending?: boolean | undefined;
  retryAvailability: () => void;
}

export const HealthSectionNavigationContext = createContext<HealthSectionNavigation>({
  openSource: () => {},
  backToOverview: () => {},
  onSourceChange: () => {},
  retryAvailability: () => {},
  availabilityPending: false,
});
