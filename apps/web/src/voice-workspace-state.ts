import { createContext, useContext } from 'react';

export const VoiceWorkspaceContext = createContext({
  onVoiceActiveChange: (active: boolean) => { void active; },
});

export function useVoiceWorkspace() {
  return useContext(VoiceWorkspaceContext);
}
