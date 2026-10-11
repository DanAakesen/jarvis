import type { WorkspaceCommand, WorkspaceDevice, WorkspaceDeviceKind } from '@jarvis/contracts';
import { PHONE_LAYOUT_MEDIA_QUERY } from './Workspace';

const TABLET_MEDIA_QUERY = '(pointer: coarse) and (hover: none)';

/** What this tab runs on: the phone shell layout is a phone, other touch-first screens are tablets, the rest desktops. */
export function readWorkspaceDeviceKind(): WorkspaceDeviceKind {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(PHONE_LAYOUT_MEDIA_QUERY).matches) return 'phone';
  return window.matchMedia(TABLET_MEDIA_QUERY).matches ? 'tablet' : 'desktop';
}

export function readWorkspaceDevice(): WorkspaceDevice {
  return { kind: readWorkspaceDeviceKind() };
}

/**
 * Whether a command is meant for this tab. Commands without a target, or addressed to "active" or "all", are routed
 * by the broker and apply wherever they arrive; a command named for a device kind only applies on that kind.
 */
export function isCommandForThisDevice(command: WorkspaceCommand, kind: WorkspaceDeviceKind = readWorkspaceDeviceKind()): boolean {
  const target = command.target;
  return target === undefined || target === 'active' || target === 'all' || target === kind;
}
