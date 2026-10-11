import { createContext, useContext } from 'react';
import type { WorkspaceCommand } from '@jarvis/contracts';
import type { CameraController } from './screen-sharing';
import type { VoiceLanguage } from './voice-client';

export type SessionCommand = Extract<WorkspaceCommand, { operation: 'session' }>;
export type SessionCommandResult = { applied: true } | { applied: false; reason: string };

/** What the mounted conversation can do for a current-session command. Each owner registers only its own part. */
export interface SessionCommandHandlers {
  setLanguage: (language: VoiceLanguage) => void;
  /** Ends the running voice session and resolves once it has stopped; false when none is running. */
  endVoice: () => Promise<boolean>;
}

export interface SessionCommandRegistry {
  readonly handlers: Partial<SessionCommandHandlers>;
  register(handlers: Partial<SessionCommandHandlers>): () => void;
}

export function createSessionCommandRegistry(): SessionCommandRegistry {
  const handlers: Partial<SessionCommandHandlers> = {};
  return {
    handlers,
    register(next) {
      Object.assign(handlers, next);
      return () => {
        for (const [key, handler] of Object.entries(next)) {
          if (handlers[key as keyof SessionCommandHandlers] === handler) delete handlers[key as keyof SessionCommandHandlers];
        }
      };
    },
  };
}

export const SessionCommandRegistryContext = createContext<SessionCommandRegistry | null>(null);

export function useSessionCommandRegistry(): SessionCommandRegistry | null {
  return useContext(SessionCommandRegistryContext);
}

const refuse = (reason: string): SessionCommandResult => ({ applied: false, reason });
const applied: SessionCommandResult = { applied: true };

/** Reads the permission without asking: a command must never open a browser prompt. */
async function cameraPermitted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

async function applyCamera(value: SessionCommand['value'], camera: CameraController | undefined): Promise<SessionCommandResult> {
  if (!camera) return refuse('The camera is not available in this window.');
  if (value === 'off') {
    camera.stop();
    return applied;
  }
  if (value !== 'front' && value !== 'rear') return refuse('The camera option is not supported.');
  if (!camera.selectFacing) return refuse('The camera cannot switch direction here.');
  if (camera.starting) return refuse('The camera is still starting. Try again in a moment.');
  if (!camera.sharing && !(await cameraPermitted())) {
    return refuse('Camera access has not been allowed in this browser. Dan needs to turn the camera on himself first.');
  }
  let failure = '';
  const ok = await camera.selectFacing(value === 'front' ? 'user' : 'environment', (message) => { failure = message; });
  return ok ? applied : refuse(failure || 'The camera did not start.');
}

/** Applies one `session` workspace command and resolves only after the UI action has finished. */
export async function applySessionCommand(
  command: SessionCommand,
  registry: SessionCommandRegistry | null,
  camera: CameraController | undefined,
): Promise<SessionCommandResult> {
  switch (command.action) {
    case 'language': {
      if (command.value !== 'da' && command.value !== 'en') return refuse('That language is not supported. Use Danish or English.');
      if (!registry?.handlers.setLanguage) return refuse('The conversation is not open, so the language cannot be changed.');
      registry.handlers.setLanguage(command.value);
      return applied;
    }
    case 'voice': {
      if (command.value !== 'end') return refuse('That voice option is not supported.');
      if (!registry?.handlers.endVoice) return refuse('There is no voice session to end.');
      return await registry.handlers.endVoice() ? applied : refuse('There is no voice session to end.');
    }
    case 'camera':
      return applyCamera(command.value, camera);
    default:
      return refuse('That session action is not supported.');
  }
}
