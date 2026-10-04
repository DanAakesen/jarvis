import { createContext, useContext } from 'react';

export type ContextPanelContent =
  | { title: string; status: 'empty'; message?: string }
  | { title: string; status: 'loading'; message?: string }
  | { title: string; status: 'ready'; message: string }
  | { title: string; status: 'error'; message: string };

export interface ContextPanelController {
  content: ContextPanelContent;
  isOpen: boolean;
  close: () => void;
  show: (content: ContextPanelContent) => void;
  toggle: () => void;
}

export const ContextPanelContext = createContext<ContextPanelController | null>(null);

export function useContextPanel() {
  const context = useContext(ContextPanelContext);
  if (!context) throw new Error('useContextPanel must be used within ContextPanelProvider.');
  return context;
}
