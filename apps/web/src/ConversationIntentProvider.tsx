import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConversationIntentContext } from './conversation-intents';
import type { ConversationIntent } from './conversation-intents';

export function ConversationIntentProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConversationIntent[]>([]);
  const nextId = useRef(0);
  const sendMessage = useCallback((text: string) => {
    const message = text.trim();
    if (!message || message.length > 20_000) return;
    setPending((current) => [...current, { id: ++nextId.current, type: 'message', text: message }]);
  }, []);
  const focusVoiceStart = useCallback(() => {
    setPending((current) => [...current, { id: ++nextId.current, type: 'focus-voice' }]);
  }, []);
  const consume = useCallback((id: number) => {
    setPending((current) => current.filter((intent) => intent.id !== id));
  }, []);
  const value = useMemo(() => ({ pending, sendMessage, focusVoiceStart, consume }), [
    consume, focusVoiceStart, pending, sendMessage,
  ]);
  return <ConversationIntentContext.Provider value={value}>{children}</ConversationIntentContext.Provider>;
}
