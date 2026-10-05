import { createContext, useContext } from 'react';

export type ConversationIntent =
  | { id: number; type: 'message'; text: string }
  | { id: number; type: 'focus-voice' };

export interface ConversationIntentController {
  pending: ConversationIntent[];
  sendMessage: (text: string) => void;
  focusVoiceStart: () => void;
  consume: (id: number) => void;
}

export const ConversationIntentContext = createContext<ConversationIntentController | null>(null);
const emptyController: ConversationIntentController = {
  pending: [],
  sendMessage: () => {},
  focusVoiceStart: () => {},
  consume: () => {},
};

export function useConversationIntents(): ConversationIntentController {
  return useContext(ConversationIntentContext) ?? emptyController;
}
