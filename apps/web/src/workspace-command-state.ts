import { createContext, useContext } from 'react';
import type { WorkspaceCommand } from '@jarvis/contracts';
import type { WorkspaceController } from './Workspace';

export interface WorkspaceCommandController extends WorkspaceController {
  dispatch: (command: WorkspaceCommand, trustedBlobHost?: string) => boolean;
}

export const WorkspaceCommandContext = createContext<WorkspaceCommandController | null>(null);

export function useWorkspaceCommands() {
  const commands = useContext(WorkspaceCommandContext);
  if (!commands) throw new Error('useWorkspaceCommands must be used within WorkspaceCommandContext.');
  return commands;
}
