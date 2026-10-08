import { createContext, useContext } from 'react';

/** Lets windows Jarvis opens (the knowledge-graph view) reach the backend without new renderer props. */
export const KnowledgeBackendContext = createContext<{ backendUrl: string | null; getAccessToken: () => Promise<string> } | null>(null);

export function useKnowledgeBackend() {
  return useContext(KnowledgeBackendContext);
}
