import { createContext, useContext } from 'react';
import type { JarvisActivityEvent } from '@jarvis/contracts';

export type JarvisActivity = {
  working: boolean;
  /** Jarvis's own words for the work in progress (P9-41), such as "Searching your vault for Ignite". */
  workText: string | null;
  voiceActivity: JarvisActivityEvent | null;
  latestActivity: JarvisActivityEvent | null;
  applyRuntimeActivity: (event: JarvisActivityEvent) => void;
  clearRuntimeActivities: () => void;
};

const noActivity: JarvisActivity = {
  working: false,
  workText: null,
  voiceActivity: null,
  latestActivity: null,
  applyRuntimeActivity: () => {},
  clearRuntimeActivities: () => {},
};
export const JarvisActivityContext = createContext<JarvisActivity>(noActivity);

export function useJarvisActivity(): JarvisActivity {
  return useContext(JarvisActivityContext);
}
