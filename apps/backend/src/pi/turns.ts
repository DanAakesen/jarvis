import { randomBytes } from 'node:crypto';

/**
 * Per-turn authority for the PI agent.
 *
 * The harness reaches Jarvis tools over MCP with one static credential, so that credential only proves the caller is
 * our PI agent. What a tool call may do is decided here: the gateway opens a grant for exactly one owner message,
 * hands the model an unguessable reference, and every MCP call must present it. The grant names the stored owner
 * message and session server-side; nothing the model sends can change either. A grant ends with its turn, so a
 * reference replayed later, forged, or lifted from another session resolves to nothing.
 */
export interface PiTurnGrant {
  readonly turn: string;
  readonly ownerObjectId: string;
  readonly sessionId: string;
  /** The stored owner message every tool call of this turn is attributed to. */
  readonly messageId: string;
  /** The deploy smoke: tools run under the existing read-only smoke role, with no owner message. */
  readonly smoke?: boolean;
  /** Tools find_tools returned in this turn; call_tool refuses anything else, as the current agent does. */
  readonly discovered: Set<string>;
  /** What each tool this turn actually ran returned, recorded by the MCP server itself, never taken from model text. */
  readonly results: { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  readonly signal: AbortSignal;
}

export interface PiTurnRegistry {
  open(input: Omit<PiTurnGrant, 'turn' | 'discovered' | 'results'>): PiTurnGrant;
  resolve(turn: unknown): PiTurnGrant | undefined;
  close(turn: string): void;
  readonly size: number;
}

export const piTurnPattern = /^jt-[A-Za-z0-9_-]{22}$/u;
const maxOpenTurns = 8;

export function createPiTurnRegistry(): PiTurnRegistry {
  const grants = new Map<string, PiTurnGrant>();
  return {
    open(input) {
      // One owner, one live conversation: a runaway caller cannot pile up authority.
      if (grants.size >= maxOpenTurns) throw new Error('Too many open PI turns');
      const turn = `jt-${randomBytes(16).toString('base64url')}`;
      const grant: PiTurnGrant = { ...input, turn, discovered: new Set(), results: [] };
      grants.set(turn, grant);
      return grant;
    },
    resolve(turn) {
      if (typeof turn !== 'string' || !piTurnPattern.test(turn)) return undefined;
      const grant = grants.get(turn);
      return grant && !grant.signal.aborted ? grant : undefined;
    },
    close(turn) { grants.delete(turn); },
    get size() { return grants.size; },
  };
}
