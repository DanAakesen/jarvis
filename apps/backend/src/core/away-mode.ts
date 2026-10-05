import type { FastifyRequest } from 'fastify';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

export type AwayModeSource = 'manual' | 'teams_presence' | 'browser';

export interface AwayModeState {
  away: boolean;
  source: AwayModeSource | null;
  changedAt: string | null;
  presenceAwaySince: string | null;
}

export interface AwayModeStore {
  read(): Promise<AwayModeState>;
  set(away: boolean, at?: Date): Promise<AwayModeState>;
  markPresent(at?: Date): Promise<AwayModeState>;
  observePresence(away: boolean | null, at?: Date): Promise<AwayModeState>;
}

export const defaultAwayModeState: AwayModeState = {
  away: false,
  source: null,
  changedAt: null,
  presenceAwaySince: null,
};

export const presenceAwayThresholdMs = 10 * 60_000;

export function parseAwayModeState(value: unknown): AwayModeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...defaultAwayModeState };
  const state = value as Record<string, unknown>;
  const validDate = (candidate: unknown): candidate is string =>
    candidate === null || (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate)));
  if (typeof state.away !== 'boolean' ||
    (state.source !== null && state.source !== 'manual' && state.source !== 'teams_presence' && state.source !== 'browser') ||
    !validDate(state.changedAt) || !validDate(state.presenceAwaySince)) {
    return { ...defaultAwayModeState };
  }
  return {
    away: state.away,
    source: state.source,
    changedAt: state.changedAt,
    presenceAwaySince: state.presenceAwaySince,
  };
}

function iso(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Invalid away-mode time');
  return at.toISOString();
}

export function setAwayMode(
  previous: AwayModeState,
  away: boolean,
  source: Exclude<AwayModeSource, 'teams_presence'>,
  at: Date,
): AwayModeState {
  const changed = previous.away !== away;
  return {
    away,
    source: changed ? source : previous.source,
    changedAt: changed ? iso(at) : previous.changedAt,
    presenceAwaySince: null,
  };
}

export function observeAwayPresence(
  previous: AwayModeState,
  away: boolean | null,
  at: Date,
): AwayModeState {
  if (away === null) return previous;
  if (!away) {
    return previous.presenceAwaySince === null
      ? previous
      : { ...previous, presenceAwaySince: null };
  }

  const presenceAwaySince = previous.presenceAwaySince ?? iso(at);
  if (previous.away || at.getTime() - Date.parse(presenceAwaySince) < presenceAwayThresholdMs) {
    return presenceAwaySince === previous.presenceAwaySince
      ? previous
      : { ...previous, presenceAwaySince };
  }
  return {
    away: true,
    source: 'teams_presence',
    changedAt: iso(at),
    presenceAwaySince,
  };
}

interface SetAwayModeInput {
  mode: 'on' | 'off';
}

function validInput(value: unknown): value is SetAwayModeInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && (input.mode === 'on' || input.mode === 'off');
}

export const setAwayModeTool: JarvisTool = {
  name: 'set_away_mode',
  description: 'Set away mode when Dan says he is leaving or back. Away mode sends task updates to Teams and keeps spoken replies brief.',
  inputSchema: {
    type: 'object',
    properties: { mode: { type: 'string', enum: ['on', 'off'] } },
    required: ['mode'],
    additionalProperties: false,
  },
  async execute(input: unknown, request: FastifyRequest) {
    if (!validInput(input)) throw new ToolRefusal('Choose away mode on or off.');
    if (!request.principal && !request.agentPrincipal) {
      throw new ToolRefusal('Dan’s identity could not be verified.');
    }
    const store = request.server.awayModeStore;
    if (!store) throw new ToolRefusal('Away mode is unavailable.');
    const state = await store.set(input.mode === 'on');
    return {
      away: state.away,
      message: state.away
        ? 'Away mode is on. Updates will go to Teams and spoken replies will be brief.'
        : 'Away mode is off. Updates will appear in the browser.',
    };
  },
};
