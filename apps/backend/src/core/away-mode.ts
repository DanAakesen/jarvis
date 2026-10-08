import type { FastifyRequest } from 'fastify';
import { presenceModes, type PresenceMode, type PresenceSource } from '@jarvis/contracts';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

export { presenceModes };
export type { PresenceMode };
export type AwayModeSource = PresenceSource;

export interface AwayModeState {
  mode: PresenceMode;
  source: AwayModeSource;
  changedAt: string | null;
}

export type AwayModeSetResult = AwayModeState & { ignored?: 'recent_manual' };

export interface AwayModeStore {
  read(): Promise<AwayModeState>;
  set(mode: PresenceMode, source?: AwayModeSource, at?: Date): Promise<AwayModeSetResult>;
  markPresent(at?: Date): Promise<AwayModeState>;
}

export const defaultAwayModeState: AwayModeState = {
  mode: 'present',
  source: 'manual',
  changedAt: null,
};

function validDate(candidate: unknown): candidate is string | null {
  return candidate === null || (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate)));
}

function isPresenceMode(value: unknown): value is PresenceMode {
  return typeof value === 'string' && (presenceModes as readonly string[]).includes(value);
}

function isAwayModeSource(value: unknown): value is AwayModeSource {
  return value === 'manual' || value === 'device' || value === 'jarvis' || value === 'browser';
}

export function parseAwayModeState(value: unknown): AwayModeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...defaultAwayModeState };
  const state = value as Record<string, unknown>;
  if (isPresenceMode(state.mode) && isAwayModeSource(state.source) && validDate(state.changedAt)) {
    return { mode: state.mode, source: state.source, changedAt: state.changedAt };
  }
  if (typeof state.away === 'boolean' && validDate(state.changedAt)) {
    const source = state.source === 'browser' ? 'browser' : state.source === 'jarvis' ? 'jarvis' : 'manual';
    return { mode: state.away ? 'away' : 'present', source, changedAt: state.changedAt };
  }
  return { ...defaultAwayModeState };
}

export function isLegacyAwayModeState(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.away === 'boolean' && validDate(state.changedAt) &&
    (state.source === undefined || state.source === null || state.source === 'manual' ||
      state.source === 'teams_presence' || state.source === 'browser') &&
    (!Object.hasOwn(state, 'presenceAwaySince') || validDate(state.presenceAwaySince)) &&
    Object.keys(state).every((key) => ['away', 'source', 'changedAt', 'presenceAwaySince'].includes(key));
}

function iso(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Invalid presence-mode time');
  return at.toISOString();
}

export function setPresenceMode(
  previous: AwayModeState,
  mode: PresenceMode,
  source: AwayModeSource,
  at: Date,
): AwayModeState {
  if (!isPresenceMode(mode)) throw new TypeError('Presence mode is invalid');
  const changed = previous.mode !== mode;
  const refreshSource = source === 'manual' || source === 'device';
  return {
    mode,
    source: changed || refreshSource ? source : previous.source,
    changedAt: changed || refreshSource ? iso(at) : previous.changedAt,
  };
}

export function updatePresenceMode(
  previous: AwayModeState,
  mode: PresenceMode,
  source: AwayModeSource,
  at: Date,
): { state: AwayModeState; ignored?: 'recent_manual' } {
  const manualChangedAt = previous.source === 'manual' && previous.changedAt !== null
    ? Date.parse(previous.changedAt)
    : Number.NaN;
  if (source === 'device' && Number.isFinite(manualChangedAt) &&
      at.getTime() - manualChangedAt < 2 * 60 * 60 * 1000) {
    return { state: previous, ignored: 'recent_manual' };
  }
  return { state: setPresenceMode(previous, mode, source, at) };
}

interface SetPresenceModeInput {
  mode: PresenceMode;
}

function validPresenceModeInput(value: unknown): value is SetPresenceModeInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && isPresenceMode(input.mode);
}

interface SetAwayModeInput {
  mode: 'on' | 'off';
}

function validAwayModeInput(value: unknown): value is SetAwayModeInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && (input.mode === 'on' || input.mode === 'off');
}

function presenceModeTool(name: string, legacy = false): JarvisTool {
  const modes = legacy ? ['on', 'off'] : presenceModes;
  return {
    name,
    description: legacy
      ? 'Compatibility alias for set_presence_mode. Use it only to set away or present.'
      : 'Use away for heading out, on_the_move for driving, and present when Dan is back. The change is reversible, needs no confirmation, and should be announced.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: [...modes] } },
      required: ['mode'],
      additionalProperties: false,
    },
    async execute(input: unknown, request: FastifyRequest) {
      if (legacy ? !validAwayModeInput(input) : !validPresenceModeInput(input)) {
        throw new ToolRefusal(legacy ? 'Choose away mode on or off.' : 'Choose present, away, or on the move.');
      }
      if (!request.principal && !request.agentPrincipal) {
        throw new ToolRefusal('Dan’s identity could not be verified.');
      }
      const store = request.server.awayModeStore;
      if (!store) throw new ToolRefusal('Presence mode is unavailable.');
      const mode = legacy
        ? (input as SetAwayModeInput).mode === 'on' ? 'away' : 'present'
        : (input as SetPresenceModeInput).mode;
      const state = await store.set(mode, 'manual');
      const label = mode === 'on_the_move' ? 'On the move' : mode === 'present' ? 'Present' : 'Away';
      return {
        mode: state.mode,
        away: state.mode !== 'present',
        message: `Dan is now ${label.toLowerCase()}.`,
      };
    },
  };
}

export const setPresenceModeTool = presenceModeTool('set_presence_mode');
export const setAwayModeTool = presenceModeTool('set_away_mode', true);
