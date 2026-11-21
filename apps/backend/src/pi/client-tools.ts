/**
 * Client-side tools of the managed Microsoft Copilot harness. The harness emits a `function_call` item for its built-in
 * tools (shell, filesystem, web, `task` for sub-agents) and waits for the client to answer it with a `function_call_output`
 * on the same conversation. The gateway answers each call here and never executes anything the harness asks for: a handler
 * returns an output string for the model, nothing more.
 */

export type ClientToolOutcome = 'answered_default' | 'answered_task_stub';

export interface ClientToolCall {
  readonly name: string;
  /** The raw arguments string the harness sent. Handlers may read it; the gateway never logs it. */
  readonly arguments: string;
  readonly signal: AbortSignal;
}

export interface ClientToolAnswer {
  readonly output: string;
  readonly outcome: ClientToolOutcome;
}

export type ClientToolHandler = (call: ClientToolCall) => Promise<ClientToolAnswer>;

/** The name goes back to the model, so only a short plain token is repeated. */
const plainName = (name: string): string => /^[A-Za-z0-9_.-]{1,64}$/u.test(name) ? name : 'requested';

const unavailable = (name: string): string =>
  `The ${plainName(name)} tool is not available in this environment. Continue without it and use the Jarvis tools through find_tools and call_tool.`;

const defaultHandler: ClientToolHandler = async (call) => ({ output: unavailable(call.name), outcome: 'answered_default' });

/** The harness's built-in sub-agent tool. The real sub-agent run is implemented here next; until then it answers honestly that it is unavailable. */
const taskHandler: ClientToolHandler = async (call) => ({ output: unavailable(call.name), outcome: 'answered_task_stub' });

/** Handlers keyed by the harness's function name; an unknown name gets the default handler. */
export const clientToolHandlers: ReadonlyMap<string, ClientToolHandler> = new Map([['task', taskHandler]]);

export function answerClientTool(call: ClientToolCall): Promise<ClientToolAnswer> {
  return (clientToolHandlers.get(call.name) ?? defaultHandler)(call);
}

const maxArgumentKeys = 12;
/** Arguments larger than this are not parsed for key names; the length is still logged. */
const maxParsedArgumentsLength = 262_144;

/** The key names of a JSON-object arguments string, for the log only: plain lowercase keys, at most 12, never a value. */
export function argumentKeyNames(argumentsText: string): string[] {
  if (argumentsText.length === 0 || argumentsText.length > maxParsedArgumentsLength) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(argumentsText); } catch { return []; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  return Object.keys(parsed).filter(key => /^[a-z0-9_.-]{1,32}$/u.test(key)).slice(0, maxArgumentKeys);
}
