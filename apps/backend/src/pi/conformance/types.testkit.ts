import type { BuildAppOptions } from '../../app.js';
import type { BackendConfig } from '../../config.js';
import type { BackendModule } from '../../modules.js';
import type { PiTurnRegistry } from '../turns.js';

/**
 * The tool conformance suite (see ../tool-conformance.test.ts) composes every production backend module with in-memory or
 * stubbed dependencies, then drives the registry through the real PI MCP door (`find_tools` / `call_tool`).
 * One group owns the stubs of one area; a group can be developed and run alone:
 *   CONFORMANCE_GROUP=google npx vitest run src/pi/tool-conformance.test.ts
 */

/** What the stubs of every group share. */
export interface ConformanceContext {
  readonly config: BackendConfig;
  /** The configured owner (Dan). */
  readonly owner: string;
  /**
   * The stored Dan message the current turn is attributed to. Stubbed message stores answer `getSourceMessage(...)` with
   * `text`, so a case can say what Dan "asked" (a tool that needs explicit intent reads it). The suite sets `text` before
   * every call from `ToolCase.ownerMessage` (default: a plain imperative request), and gives every call a fresh message `id`, so
   * per-message state (a Gmail turn, an idempotent write) never leaks from one tool's case into another's.
   */
  readonly ownerMessage: { text: string; id: string; readonly sessionId: string };
  /** Dependency tokens the stubs must fail (network down, bridge offline) while they are in the set. */
  readonly down: Set<string>;
  /** The turn registry the MCP door uses. Tools that prove the turn they run in (a PI activation, a brain wake) must be built with this one. */
  readonly registry?: PiTurnRegistry;
}

/** One call through `call_tool`, with arguments that are valid for the schema the model sees. */
export interface ToolCase {
  readonly label: string;
  readonly arguments: Record<string, unknown>;
  /** What Dan said in the stored message of this turn. Default: a plain imperative request. */
  readonly ownerMessage?: string;
  /**
   * The kind of PI turn the call is made in. Default: `chat` for chat and voice tools, `wake` for wake-only tools, and
   * `activation` for the situation tools.
   */
  readonly turn?: 'chat' | 'wake' | 'activation';
  /** Attribute this call to the same stored Dan message as the previous call of this tool (to prove a repeat is idempotent). */
  readonly sameMessageAsPrevious?: true;
  /** Default `ok`. `refused`/`error` are for cases that prove a typed, plain-English refusal or failure. */
  readonly expect?: 'ok' | 'refused' | 'error';
  /** Extra assertions on the structured result (the `result` field of the call_tool answer). Throw to fail. */
  readonly check?: (result: unknown) => void;
}

/** A step of a daily-core golden scenario: the phrase Dan says, the tool that must be found first, and the call. */
export interface ScenarioStep {
  readonly say: { readonly en: string; readonly da: string };
  /** The tool the first `find_tools` search for either phrase must return in its top 3. */
  readonly tool: string;
  readonly call: ToolCase;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly ScenarioStep[];
}

/** A tool that cannot be exercised offline. It still has to fail cleanly when its dependency is down. */
export interface ExternalTool {
  readonly reason: string;
  /** The token in `ConformanceContext.down` that makes this group's stubs fail the dependency. */
  readonly dependency: string;
  /** Arguments for the clean-failure call; omitted means generated from the schema. */
  readonly arguments?: Record<string, unknown>;
  readonly ownerMessage?: string;
  readonly turn?: 'chat' | 'wake' | 'activation';
}

export interface ConformanceGroup {
  readonly id: string;
  /** The `ProductionModules` keys (production-modules.ts) this group composes. A drift test checks every key is claimed. */
  readonly covers: readonly string[];
  readonly modules: readonly BackendModule[];
  /** Stores that tools read through app decorators (buildApp options). Merged across groups. */
  readonly appOptions?: Partial<BuildAppOptions>;
  /** Explicit calls for tools whose schema-generated arguments cannot be meaningful (ids that must exist, cross-field rules). */
  readonly cases?: Readonly<Record<string, readonly ToolCase[]>>;
  readonly requiresExternal?: Readonly<Record<string, ExternalTool>>;
  readonly scenarios?: readonly Scenario[];
  /** Tools that the generic run skips, with the reason (for example a wake-only tool exercised by its own test). */
  readonly skipped?: Readonly<Record<string, string>>;
  readonly close?: () => Promise<void> | void;
}

export type GroupFactory = (context: ConformanceContext) => ConformanceGroup;
