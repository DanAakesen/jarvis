import { expect } from 'vitest';
import { ToolFailure, ToolRefusal, type RegisteredTool } from '../../core/tool-registry.js';
import { UnstubbedDependencyError } from './stub.testkit.js';
import { sampleArgumentSets } from './schema.testkit.js';
import type { ConformanceTurn } from './mcp-client.testkit.js';
import { defaultOwnerMessage, type ConformanceWorld } from './world.testkit.js';
import type { ConformanceGroup, ToolCase } from './types.testkit.js';
import { isCurrentAssistantTool, isSituationActivationTool, isWakeTool } from '../../core/tool-registry.js';

export type CallableStatus =
  | { readonly kind: 'ok'; readonly variants: number }
  | { readonly kind: 'refusal'; readonly variants: number; readonly note: string }
  | { readonly kind: 'failure'; readonly variants: number; readonly note: string }
  | { readonly kind: 'requiresExternal'; readonly reason: string }
  | { readonly kind: 'legacy' }
  | { readonly kind: 'skipped'; readonly reason: string };

/** A call must come back within this, whatever the stub does. */
export const callTimeoutMs = 10_000;

const genericFailure = 'Tool execution failed';
const doorFailure = 'The tool could not run. Nothing is confirmed as done.';

/** A message Dan can read: a sentence, no stack, no provider internals, not the dispatcher's catch-all. */
export function plainEnglishProblems(message: unknown): string[] {
  if (typeof message !== 'string' || message.trim().length === 0) return ['the message is empty'];
  const found: string[] = [];
  const text = message.trim();
  if (text === genericFailure || text === doorFailure) found.push(`the message is the generic "${text}" (an unhandled error, not a typed refusal or failure)`);
  if (text.length < 12) found.push('the message is shorter than 12 characters');
  if (!/\s/u.test(text)) found.push('the message is a single token');
  if (/\b(TypeError|ReferenceError|RangeError|SyntaxError|AssertionError)\b|\[object |\bundefined\b|\bNaN\b|ECONN|ENOTFOUND|ETIMEDOUT|\bat \S+ \(|node_modules|\.ts:\d+/u.test(text)) found.push('the message leaks an internal error');
  return found;
}

const isTyped = (error: unknown) => error instanceof ToolRefusal || error instanceof ToolFailure;
const isAbort = (error: unknown) => error instanceof Error && (error.name === 'AbortError' || /aborted/iu.test(error.message));

function errorLine(error: unknown): string {
  if (error instanceof UnstubbedDependencyError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}

export function turnKindFor(name: string): 'chat' | 'wake' | 'activation' {
  if (isSituationActivationTool(name)) return 'activation';
  return isCurrentAssistantTool(name) ? 'chat' : 'wake';
}

const activation = {
  id: '00000000-0000-4000-8000-0000000000aa', type: 'chat' as const, source: null, slotKey: null, stateRevision: 0, stateHash: null,
  policyRevision: 'conformance', staleSources: 0, disabledSources: [] as string[],
};

export function openTurn(world: ConformanceWorld, kind: 'chat' | 'wake' | 'activation'): ConformanceTurn {
  return world.client.openTurn(kind === 'wake' ? { wake: true } : kind === 'activation' ? { activation } : {});
}

/** Every call is its own Dan message (ids start high so they never collide with a store's seeded rows). */
let messageCounter = 5_000;
let lastMessageId = '5000';

export interface ExecutedCase {
  readonly outcome: 'ok' | 'refused' | 'error';
  readonly result: unknown;
  readonly message: string | undefined;
}

/**
 * One call through the real `call_tool`, preceded by the `find_tools` that made the tool callable (the exact name ranks first).
 * Everything that must never happen is asserted here: an unhandled throw, a non-200, a hang, a truncated result, a generic
 * failure text, a call the model could not make because the search did not return the tool.
 */
export async function executeCase(
  world: ConformanceWorld, tool: RegisteredTool, turnKind: 'chat' | 'wake' | 'activation', testCase: Pick<ToolCase, 'label' | 'arguments' | 'ownerMessage' | 'sameMessageAsPrevious'>,
): Promise<ExecutedCase> {
  if (testCase.sameMessageAsPrevious !== true) { messageCounter += 1; lastMessageId = String(messageCounter); }
  world.context.ownerMessage.id = lastMessageId;
  const turn = openTurn(world, turnKind);
  const label = `${tool.name} [${testCase.label}]`;
  try {
    world.context.ownerMessage.text = testCase.ownerMessage ?? defaultOwnerMessage;
    const found = await world.client.find(turn, tool.name);
    expect(found.tools.map((entry) => entry.name), `${label}: find_tools by exact name must return the tool in full`).toContain(tool.name);
    world.thrown.length = 0;
    const call = await world.client.call(turn, tool.name, testCase.arguments, callTimeoutMs);
    expect(call.timedOut, `${label}: the call did not return within ${callTimeoutMs} ms`).toBe(false);
    expect(call.status, `${label}: the MCP door answered HTTP ${call.status}`).toBe(200);
    expect(call.outcome, `${label}: call_tool did not answer with a tool envelope: ${call.raw.slice(0, 200)}`).not.toBe('unknown');
    expect(call.truncated, `${label}: the result exceeded the call_tool size limit and was truncated`).toBe(false);
    const own = world.thrown.filter((entry) => entry.tool === tool.name);
    const untyped = own.filter((entry) => !isTyped(entry.error) && !isAbort(entry.error));
    const untypedLines = untyped.map((entry) => errorLine(entry.error));
    expect(untypedLines, `${label}: the tool threw an unhandled error: ${untypedLines.join(' | ')}`).toEqual([]);
    const result = call.result as Record<string, unknown> | undefined;
    const message = call.outcome === 'refused' ? (result as { refused?: string } | undefined)?.refused
      : call.outcome === 'error' ? (result as { error?: string } | undefined)?.error : undefined;
    if (call.outcome !== 'ok') {
      expect(plainEnglishProblems(message), `${label}: the ${call.outcome === 'refused' ? 'refusal' : 'failure'} text is not plain English ("${String(message).slice(0, 160)}")`).toEqual([]);
    }
    return { outcome: call.outcome as 'ok' | 'refused' | 'error', result: call.result, message };
  } finally {
    turn.close();
  }
}

const isReadTool = (tool: RegisteredTool) => tool.execution?.defaultEffect === 'read';

/** A schema refusal for a case that is meant to be valid means the generator or the schema is wrong. */
const schemaRefusal = (message: string | undefined) => typeof message === 'string' && /^Invalid arguments:/u.test(message);

/**
 * Run a tool in the world: the group's explicit cases, or minimal valid arguments generated from the schema the model reads.
 * READ tools must answer `ok` with a structured result. WRITE tools may answer `ok`, or refuse/fail with a typed, plain-English
 * message (the status says which). Returns what the report shows.
 */
export async function exerciseTool(world: ConformanceWorld, tool: RegisteredTool, group: ConformanceGroup | undefined): Promise<CallableStatus> {
  const name = tool.name;
  if (!isWakeTool(name)) {
    // Legacy confirmation endpoints are not advertised: the door must treat them as unknown.
    const turn = openTurn(world, 'chat');
    try {
      const call = await world.client.call(turn, name, {}, callTimeoutMs);
      expect(call.outcome, `${name}: a legacy tool must not be callable through the door`).toBe('refused');
    } finally { turn.close(); }
    return { kind: 'legacy' };
  }
  const skipped = group?.skipped?.[name];
  if (skipped) return { kind: 'skipped', reason: skipped };

  const external = group?.requiresExternal?.[name];
  const turnKind = turnKindFor(name);
  if (external) {
    world.context.down.add(external.dependency);
    try {
      let args = external.arguments;
      if (!args) {
        const turn = openTurn(world, external.turn ?? turnKind);
        try {
          const found = await world.client.find(turn, name);
          args = sampleArgumentSets(found.tools.find((entry) => entry.name === name)?.parameters ?? (tool.inputSchema as Record<string, unknown>))[0]!.arguments;
        } finally { turn.close(); }
      }
      const done = await executeCase(world, tool, external.turn ?? turnKind, { label: 'dependency down', arguments: args, ...(external.ownerMessage ? { ownerMessage: external.ownerMessage } : {}) });
      expect(['refused', 'error'], `${name}: with ${external.dependency} down the tool must refuse or fail cleanly, not answer ok`).toContain(done.outcome);
    } finally {
      world.context.down.delete(external.dependency);
    }
    return { kind: 'requiresExternal', reason: external.reason };
  }

  let cases: readonly ToolCase[] | undefined = group?.cases?.[name];
  const explicit = cases !== undefined;
  if (!cases) {
    const turn = openTurn(world, turnKind);
    try {
      const found = await world.client.find(turn, name);
      const schema = found.tools.find((entry) => entry.name === name)?.parameters ?? (tool.inputSchema as Record<string, unknown>);
      cases = sampleArgumentSets(schema).map((set) => ({ label: set.label, arguments: set.arguments }));
    } finally { turn.close(); }
  }
  const outcomes: ExecutedCase[] = [];
  for (const testCase of cases) {
    const done = await executeCase(world, tool, testCase.turn ?? turnKind, testCase);
    outcomes.push(done);
    const label = `${name} [${testCase.label}]`;
    const wanted = testCase.expect ?? 'ok';
    if (explicit) {
      expect(done.outcome, `${label}: expected ${wanted}, got ${done.outcome}${done.message ? ` ("${done.message}")` : ''}`).toBe(wanted);
    } else {
      expect(schemaRefusal(done.message), `${label}: arguments generated from the schema were refused by the schema validator ("${done.message}")`).toBe(false);
      if (isReadTool(tool)) expect(done.outcome, `${label}: a read tool must answer ok with generated arguments, got ${done.outcome} ("${done.message}")`).toBe('ok');
    }
    if (done.outcome === 'ok') {
      expect(done.result, `${label}: an ok result must be structured, not empty`).not.toBeNull();
      expect(typeof done.result === 'object' || typeof done.result === 'string' || typeof done.result === 'number' || typeof done.result === 'boolean', `${label}: an ok result must be a value`).toBe(true);
      if (isReadTool(tool)) expect(typeof done.result === 'object', `${label}: a read tool returns a structured result`).toBe(true);
    }
    testCase.check?.(done.result);
  }
  const worst = outcomes.find((entry) => entry.outcome === 'error') ?? outcomes.find((entry) => entry.outcome === 'refused');
  if (!worst) return { kind: 'ok', variants: outcomes.length };
  return worst.outcome === 'error'
    ? { kind: 'failure', variants: outcomes.length, note: worst.message ?? '' }
    : { kind: 'refusal', variants: outcomes.length, note: worst.message ?? '' };
}
