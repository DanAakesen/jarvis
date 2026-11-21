/**
 * A `function_call` the managed Microsoft Copilot harness leaves for the client to answer. Most harness calls are native:
 * the harness runs them itself (a sub-agent `task`, a shell or file tool) and streams the result, so they are never answered
 * here. Only a call the response ends with, unanswered, is client-owned (see `classifyHarnessCall` in `gateway.ts`). Nothing
 * the harness asks for is ever executed by the gateway: the answer is a string for the model, nothing more.
 */

/** `answered_task_client_owned` is a `task` that the harness did not run itself, which is not expected and logged apart. */
export type ClientToolOutcome = 'answered_default' | 'answered_task_client_owned';

export interface ClientToolAnswer {
  readonly output: string;
  readonly outcome: ClientToolOutcome;
}

/** The name goes back to the model, so only a short plain token is repeated. */
const plainName = (name: string): string => /^[A-Za-z0-9_.-]{1,64}$/u.test(name) ? name : 'requested';

/** The honest answer to a client-owned call: this environment has no client-side tool behind it. */
export function answerClientTool(name: string): ClientToolAnswer {
  return {
    output: `The ${plainName(name)} tool is not available in this environment. Continue without it and use the Jarvis tools through find_tools and call_tool.`,
    outcome: name === 'task' ? 'answered_task_client_owned' : 'answered_default',
  };
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
