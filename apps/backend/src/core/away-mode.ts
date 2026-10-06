import type { FastifyRequest } from 'fastify';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

export type AwayModeSource = 'manual' | 'browser';

export interface AwayModeState {
  away: boolean;
  source: AwayModeSource | null;
  changedAt: string | null;
}

export interface AwayModeStore {
  read(): Promise<AwayModeState>;
  set(away: boolean, at?: Date): Promise<AwayModeState>;
  markPresent(at?: Date): Promise<AwayModeState>;
}

export const defaultAwayModeState: AwayModeState = {
  away: false,
  source: null,
  changedAt: null,
};

export function parseAwayModeState(value: unknown): AwayModeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...defaultAwayModeState };
  const state = value as Record<string, unknown>;
  const validDate = (candidate: unknown): candidate is string =>
    candidate === null || (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate)));
  if (typeof state.away !== 'boolean' ||
    (state.source !== null && state.source !== 'manual' && state.source !== 'teams_presence' && state.source !== 'browser') ||
    !validDate(state.changedAt) ||
    (Object.hasOwn(state, 'presenceAwaySince') && !validDate(state.presenceAwaySince))) {
    return { ...defaultAwayModeState };
  }
  return {
    away: state.away,
    source: state.source === 'teams_presence' ? null : state.source,
    changedAt: state.changedAt,
  };
}

function iso(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new TypeError('Invalid away-mode time');
  return at.toISOString();
}

export function setAwayMode(
  previous: AwayModeState,
  away: boolean,
  source: AwayModeSource,
  at: Date,
): AwayModeState {
  const changed = previous.away !== away;
  return {
    away,
    source: changed ? source : previous.source,
    changedAt: changed ? iso(at) : previous.changedAt,
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
  description: 'Set away mode when Dan says he is leaving or back. Away mode keeps task updates in the Now feed and spoken replies brief.',
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
        ? 'Away mode is on. Updates will appear in Now and spoken replies will be brief.'
        : 'Away mode is off. Updates will appear in the browser.',
    };
  },
};
