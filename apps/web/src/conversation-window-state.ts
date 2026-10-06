import { createContext, useContext } from 'react';

/** Workspace view id for the shell-hosted conversation history window; Jarvis targets it with workspace commands. */
export const conversationViewId = 'conversation';

export interface ConversationWindowHost {
  /** Content element of the workspace window, or null while the window is closed or not yet mounted. */
  element: HTMLElement | null;
  /** ConversationHistory reports whether there is history for the window to show. */
  setAvailable: (available: boolean) => void;
}

export const ConversationWindowContext = createContext<ConversationWindowHost | null>(null);

export function useConversationWindow() {
  return useContext(ConversationWindowContext);
}
