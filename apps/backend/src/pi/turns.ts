import { randomBytes } from 'node:crypto';
import type { RegisteredTool } from '../core/tool-registry.js';
import type { PiCompletionEvidence, PiCompletionPlan } from './completion.js';
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
  /** Tools find_tools showed in this turn, including compact other matches; call_tool refuses anything else. */
  readonly discovered: Set<string>;
  /** What each tool this turn actually ran returned, recorded by the MCP server itself, never taken from model text. */
  readonly results: { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  /** Content-free hashes and terminal kind proving a tool/arguments/target binding for this exact turn. */
  readonly evidence: PiCompletionEvidence[];
  /** Server-created read observations available only to bind later contextual operations in this turn. */
  readonly bindings: PiCompletionEvidence[];
  /** Registry-compiled remote tools actually returned to this exact turn. */
  readonly remoteTools: Map<string, RegisteredTool>;
  /** Server-classified completion contract for the exact owner request attached to this grant. */
  completion: PiCompletionPlan;
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
  /** Successful chat pushes from message_dan, recorded by the wake itself. */
  readonly pushes: { count: number };
  /** Successful tool calls that did not yield terminal, request-bound evidence. */
  readonly unverified: { count: number };
}

export interface PiTurnRegistry {
  open(input: Omit<PiTurnGrant, 'turn' | 'discovered' | 'results' | 'evidence' | 'bindings' | 'remoteTools' | 'completion' | 'azure' | 'actions' | 'pushes' | 'unverified'>): PiTurnGrant;
  resolve(turn: unknown): PiTurnGrant | undefined;
  resolveActivation(id: unknown): PiTurnGrant | undefined;
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
      const grant: PiTurnGrant = {
        ...input, turn, discovered: new Set(), results: [], evidence: [], bindings: [], remoteTools: new Map(),
        completion: { kind: 'conversation', requirements: [] },
        azure: { catalogue: 'not_searched', attempts: 0, undiscoveredRefusals: 0 },
        actions: { count: 0 }, pushes: { count: 0 }, unverified: { count: 0 },
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
