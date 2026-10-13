import { createContext, useContext } from 'react';
import type { ConversationPosition } from './conversation-layout';

/** Workspace view id for the shell-hosted conversation history window; Jarvis targets it with workspace commands. */
export const conversationViewId = 'conversation';

export interface ConversationWindowHost {
  position?: ConversationPosition | null;
  setComposerHeight?: (height: number) => void;
  /** Content element of the workspace window, or null while the window is closed or not yet mounted. */
  element: HTMLElement | null;
  /** ConversationHistory reports whether there is history for the window to show. */
  setAvailable: (available: boolean) => void;
  /** Whether the conversation window is currently shown above the composer. */
  open: boolean;
  /** Shows (restoring a minimised or closed window) or collapses the conversation; false when the workspace refuses. */
  setOpen: (open: boolean) => boolean;
}

export const ConversationWindowContext = createContext<ConversationWindowHost | null>(null);

export function useConversationWindow() {
  return useContext(ConversationWindowContext);
}
