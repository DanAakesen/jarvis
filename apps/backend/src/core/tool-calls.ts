export type ToolCallOutcome = 'ok' | 'refused' | 'error';

export interface ToolCallRecord {
  readonly messageId: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly outcome: ToolCallOutcome;
}

export interface ToolCallStore {
  record(call: ToolCallRecord): Promise<void>;
}

/**
 * The confirmation Jarvis relays about an action (L16). It is derived only from the
 * recorded outcome and result, never from the model's own wording.
 */
export function confirmToolCall(tool: string, outcome: ToolCallOutcome, result: unknown): string {
  if (outcome === 'ok') return `Done: ${tool} succeeded.`;
  if (outcome === 'refused') {
    const reason = (result as { refused?: unknown } | null)?.refused;
    return `Not done: ${tool} was refused.${typeof reason === 'string' ? ` ${reason}` : ''}`;
  }
  return `Not done: ${tool} failed.`;
}
