import { createContext, useContext } from 'react';
import type { JarvisActivityEvent } from '@jarvis/contracts';

export type JarvisActivity = {
  working: boolean;
  voiceActivity: JarvisActivityEvent | null;
  latestActivity: JarvisActivityEvent | null;
  applyRuntimeActivity: (event: JarvisActivityEvent) => void;
  clearRuntimeActivities: () => void;
};

const noActivity: JarvisActivity = {
  working: false,
  voiceActivity: null,
  latestActivity: null,
  applyRuntimeActivity: () => {},
  clearRuntimeActivities: () => {},
};
export const JarvisActivityContext = createContext<JarvisActivity>(noActivity);

export function useJarvisActivity(): JarvisActivity {
  return useContext(JarvisActivityContext);
}
