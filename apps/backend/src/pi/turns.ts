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
/** What the brain did in one wake, recorded by the tools themselves (never taken from model text). */
export interface PiBrainRun {
  readonly runId: string;
  /** Chat messages sent to Dan in this run. */
  readonly sent: { readonly title: string | null; readonly text: string; readonly messageId: string }[];
  /** Notes written to the vault area in this run: path only, never content. */
  readonly wrote: string[];
  /** Standing watches this run recorded a look at. */
  readonly looked: string[];
}

export interface PiTurnGrant {
  readonly turn: string;
  readonly ownerObjectId: string;
  readonly sessionId: string;
  /** The stored owner message every tool call of this turn is attributed to. */
  readonly messageId: string;
  /** The deploy smoke: tools run under the existing read-only smoke role, with no owner message. */
  readonly smoke?: boolean;
  /** A brain wake: there is no owner message. It has the chat tools plus the brain's own (message to Dan, notes, trail, looks). */
  readonly brain?: PiBrainRun;
  /** Tools find_tools returned in this turn; call_tool refuses anything else, as the current agent does. */
  readonly discovered: Set<string>;
  /** What each tool this turn actually ran returned, recorded by the MCP server itself, never taken from model text. */
  readonly results: { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  readonly signal: AbortSignal;
}

export interface PiTurnRegistry {
  open(input: Omit<PiTurnGrant, 'turn' | 'discovered' | 'results'>): PiTurnGrant;
  resolve(turn: unknown): PiTurnGrant | undefined;
  /** The live grant of a brain wake, by run id. Brain-only tools prove they run inside a real wake with it. */
  findBrain(runId: unknown): PiTurnGrant | undefined;
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
    findBrain(runId) {
      if (typeof runId !== 'string') return undefined;
      for (const grant of grants.values()) if (grant.brain?.runId === runId && !grant.signal.aborted) return grant;
      return undefined;
    },
    close(turn) { grants.delete(turn); },
    get size() { return grants.size; },
  };
}
