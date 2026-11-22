import { randomBytes } from 'node:crypto';
import type { RemoteMcpStatus } from './remote-mcp.js';
import type { PiActivationType } from './situation.js';
import type { PiProactiveEvidence } from './store.js';

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
  /** Server-derived wake and fresh-state evidence the background tools may cite. */
  evidence?: PiProactiveEvidence[];
}

/** What one call of a tool gave the model: how it ended, the exact text, and whether that text was cut short. */
export interface PiToolAnswer {
  readonly outcome: 'ok' | 'refused' | 'error';
  readonly text: string;
  readonly isError: boolean;
  readonly truncated: boolean;
  /** An error whose own text says the call may or may not have done its work (or only part of it): see `ToolFailure.outcomeUnknown`. */
  readonly outcomeUnknown?: boolean;
}

/** One action call of a turn that went to its tool: what it asked for, which request carried it, and how it went. */
export interface PiActionRun {
  /** SHA-256 of the tool name and its canonical JSON arguments. */
  readonly asked: string;
  /** The call id the harness gave the request that carried it (see mcp.ts), when it gave one. */
  readonly identity: string | undefined;
  /** The first answer once the run succeeded or may have gone through; undefined when it did not (a refusal, or an error that says nothing happened). */
  readonly answer: Promise<PiToolAnswer | undefined>;
  /**
   * `running` until it settles. `unknown` is an error that says the call may have done its work: it is kept like a success, so a
   * replay is answered with it and the effect is not run a second time. A failed run is never replayed and does not count as having executed.
   */
  state: 'running' | 'ok' | 'unknown' | 'failed';
}

/**
 * Whether a repeated call id can be taken for a replay in this turn: not when the request carried no call id (`no_id`; the JSON-RPC
 * id does not count, see mcp.ts), nor once a call id has asked for something else (`id_reused`). A call id that asks for something
 * else is not unique to a request, so it proves nothing. A call id reused for the *same* thing cannot be told from a replay.
 */
export type PiReplayCheck = 'on' | 'no_id' | 'id_reused';

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
  /** Tools already returned by find_tools in this turn. */
  readonly discovered: Set<string>;
  /** What each tool this turn actually ran returned, recorded by the MCP server itself, never taken from model text. */
  readonly results: { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  /** Owner-facing confirmations from the dispatcher, once per actual call, for a reply the model could not finish. */
  readonly receipts: { readonly confirmation: string; readonly action: boolean }[];
  /** Bridge calls which might have changed something but did not return a trusted, local confirmation. */
  readonly remote: { unverified: number };
  /** Content-free diagnostics from the latest completed discovery and from authenticated Azure call attempts. */
  readonly azure: {
    catalogue: RemoteMcpStatus['state'] | 'empty' | 'not_configured' | 'not_searched';
    attempts: number;
    undiscoveredRefusals: number;
  };
  readonly signal: AbortSignal;
  /** One exact PI activation. It is server-created and shared by context, tools and ledger telemetry. */
  readonly activation?: {
    readonly id: string;
    readonly type: PiActivationType;
    readonly source: string | null;
    readonly slotKey: string | null;
    readonly stateRevision: number;
    readonly stateHash: string | null;
    readonly policyRevision: string;
    readonly staleSources: number;
    readonly disabledSources: readonly string[];
  } | undefined;
  /** Successful action calls recorded from the authenticated local tool catalogue. */
  readonly actions: { count: number };
  /** The action calls of this turn that went to their tool, in order. mcp.ts tells a replayed request from a repeated action with them. */
  readonly actionRuns: PiActionRun[];
  /**
   * What each door request of this turn asked for (SHA-256 of the tool name and canonical arguments), by the call id the harness
   * gave it. A call id that ever asks for something else does not identify requests: `reused` is set and from then on no request
   * of this turn is taken for a replay.
   */
  readonly identities: { readonly asked: Map<string, string>; reused: boolean };
  /** Successful chat pushes from message_dan, recorded by the wake itself. */
  readonly pushes: { count: number };
  /** MCP requests the model made in this turn, counted when a request ENTERS the server (results are written only after a tool returns). */
  readonly requests: { count: number };
}

export interface PiTurnRegistry {
  open(input: Omit<PiTurnGrant, 'turn' | 'discovered' | 'results' | 'receipts' | 'remote' | 'azure' | 'actions' | 'actionRuns' | 'identities' | 'pushes' | 'requests'>): PiTurnGrant;
  resolve(turn: unknown): PiTurnGrant | undefined;
  resolveActivation(id: unknown): PiTurnGrant | undefined;
  /** The live grant of a brain wake, by run id. Brain-only tools prove they run inside a real wake with it. */
  findBrain(runId: unknown): PiTurnGrant | undefined;
  close(turn: string): void;
  readonly size: number;
}

export const piTurnPattern = /^jt-[A-Za-z0-9_-]{22}$/u;
const maxOpenTurns = 8;

/**
 * Notes what a door request asks for under the call id the harness gave it, and says whether a repeat of that call id can be taken
 * for a replay in this turn. It cannot without a call id, and it cannot once a call id has asked for something else: then call ids do
 * not identify requests, and the safe answer is to run every request. This only catches a call id reused for different requests;
 * one reused for identical requests looks exactly like a replay, so recognition rests on the harness's call ids being unique.
 */
export function noteRequest(grant: PiTurnGrant, identity: string | undefined, asked: string): PiReplayCheck {
  if (identity === undefined) return 'no_id';
  const earlier = grant.identities.asked.get(identity);
  if (earlier === undefined) grant.identities.asked.set(identity, asked);
  else if (earlier !== asked) grant.identities.reused = true;
  return grant.identities.reused ? 'id_reused' : 'on';
}

export function createPiTurnRegistry(): PiTurnRegistry {
  const grants = new Map<string, PiTurnGrant>();
  return {
    open(input) {
      // One owner, one live conversation: a runaway caller cannot pile up authority.
      if (grants.size >= maxOpenTurns) throw new Error('Too many open PI turns');
      const turn = `jt-${randomBytes(16).toString('base64url')}`;
      const grant: PiTurnGrant = {
        ...input, turn, discovered: new Set(), results: [], receipts: [], remote: { unverified: 0 },
        azure: { catalogue: 'not_searched', attempts: 0, undiscoveredRefusals: 0 },
        actions: { count: 0 }, actionRuns: [], identities: { asked: new Map(), reused: false },
        pushes: { count: 0 }, requests: { count: 0 },
      };
      grants.set(turn, grant);
      return grant;
    },
    resolve(turn) {
      if (typeof turn !== 'string' || !piTurnPattern.test(turn)) return undefined;
      const grant = grants.get(turn);
      return grant && !grant.signal.aborted ? grant : undefined;
    },
    resolveActivation(id) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/iu.test(id)) return undefined;
      for (const grant of grants.values()) {
        if (grant.activation?.id === id && !grant.signal.aborted) return grant;
      }
      return undefined;
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
