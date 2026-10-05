import { createContext, useContext } from 'react';
import type { WorkspaceController } from './Workspace';

export interface VoiceWorkspaceCommands {
  dispatch: WorkspaceController['dispatch'];
  minimiseAll: WorkspaceController['minimiseAll'];
  hasVisibleViews: WorkspaceController['hasVisibleViews'];
}

export const WorkspaceCommandContext = createContext<VoiceWorkspaceCommands | null>(null);

export function useWorkspaceCommands() {
  const commands = useContext(WorkspaceCommandContext);
  if (!commands) throw new Error('useWorkspaceCommands must be used within WorkspaceCommandContext.');
  return commands;
}
