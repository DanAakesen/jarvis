import { createContext, useContext } from 'react';
import type { WorkspaceController } from './Workspace';

export const WorkspaceCommandContext = createContext<WorkspaceController | null>(null);

export function useWorkspaceCommands() {
  const commands = useContext(WorkspaceCommandContext);
  if (!commands) throw new Error('useWorkspaceCommands must be used within WorkspaceCommandContext.');
  return commands;
}
