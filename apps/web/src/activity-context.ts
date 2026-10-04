import { createContext, useContext } from 'react';

export type ActivitySource = 'chat-turn' | 'voice-turn';
export type JarvisActivity = {
  working: boolean;
  setWorking: (source: ActivitySource, active: boolean) => void;
};

const noActivity: JarvisActivity = { working: false, setWorking: () => {} };
export const JarvisActivityContext = createContext<JarvisActivity>(noActivity);

export function useJarvisActivity(): JarvisActivity {
  return useContext(JarvisActivityContext);
}
