import { readFileSync } from 'node:fs';
import type { AwayModeState, PresenceMode } from './away-mode.js';

export const builtInModeInstructions = JSON.parse(readFileSync(
  new URL('../../../../agents/jarvis/presence-instructions.json', import.meta.url), 'utf8',
)) as Record<PresenceMode, string>;

export function modeContext(presence: AwayModeState): string {
  const label = presence.mode === 'on_the_move' ? 'On the move' : presence.mode === 'present' ? 'Present' : 'Away';
  return `Dan's current mode: ${label} since ${presence.changedAt ?? 'an unknown time'}. ${builtInModeInstructions[presence.mode]}`;
}
