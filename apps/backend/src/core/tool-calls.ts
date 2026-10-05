export type ToolCallOutcome = 'ok' | 'refused' | 'error';

export interface ToolCallRecord {
  readonly messageId: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly outcome: ToolCallOutcome;
}

export interface CodexToolUsageCount {
  readonly tool: 'web_research';
  readonly count: string;
}

export interface ToolCallStore {
  record(call: ToolCallRecord): Promise<void>;
  listCodexToolCalls?(from: Date, to: Date): Promise<CodexToolUsageCount[]>;
}

/**
 * The confirmation Jarvis relays about an action (L16). It is derived only from the
 * recorded outcome and result, never from the model's own wording.
 */
export function confirmToolCall(tool: string, outcome: ToolCallOutcome, result: unknown): string {
  if (outcome === 'ok') {
    const confirmation = (result as { confirmation?: unknown } | null)?.confirmation;
    if (tool === 'image_generation' && typeof confirmation === 'string' &&
        confirmation.length > 0 && confirmation.length <= 300 &&
        !Array.from(confirmation).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })) {
      return confirmation;
    }
    if (tool.startsWith('memory_') && typeof confirmation === 'string' &&
        confirmation.length > 0 && confirmation.length <= 300 &&
        !Array.from(confirmation).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })) {
      return confirmation;
    }
    return `Done: ${tool} succeeded.`;
  }
  if (outcome === 'refused') {
    const reason = (result as { refused?: unknown } | null)?.refused;
    return `Not done: ${tool} was refused.${typeof reason === 'string' ? ` ${reason}` : ''}`;
  }
  const failure = (result as { failure?: unknown; error?: unknown } | null)?.failure ??
    (tool === 'image_generation' ? (result as { error?: unknown } | null)?.error : undefined);
  if (typeof failure === 'string') return `Not done: ${tool} failed. ${failure}`;
  return `Not done: ${tool} failed.`;
}
