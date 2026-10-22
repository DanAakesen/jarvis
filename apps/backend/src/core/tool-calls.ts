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

export interface DailyMcpAuditRecord {
  readonly requestId: string;
  readonly tool: 'read_nutrition' | 'lookup_food' | 'log_food' | 'correct_food' | 'delete_food' | 'read_food_preferences' | 'manage_saved_food';
  readonly phase: 'awaiting_confirmation' | ToolCallOutcome;
  readonly outcome: ToolCallOutcome;
}

export interface ToolCallStore {
  record(call: ToolCallRecord): Promise<void>;
  recordDailyMcp?(call: DailyMcpAuditRecord): Promise<void>;
  listCodexToolCalls?(from: Date, to: Date): Promise<CodexToolUsageCount[]>;
}

/**
 * The confirmation Jarvis relays about an action (L16). It is derived only from the
 * recorded outcome and result, never from the model's own wording.
 */
export function confirmToolCall(tool: string, outcome: ToolCallOutcome, result: unknown): string {
  if (outcome === 'ok') {
    if (tool === 'calendar_confirm_change') {
      const change = result as { status?: unknown; detail?: unknown; items?: unknown } | null;
      if (change?.status === 'completed') {
        return Array.isArray(change.items) && change.items.length > 1
          ? change.items.length === 2
            ? 'Both are in your calendar.'
            : `All ${change.items.length} are in your calendar.`
          : 'The calendar change is done.';
      }
      if (['completed', 'cancelled', 'partial', 'unverified'].includes(String(change?.status)) &&
          typeof change?.detail === 'string' && change.detail.length <= 1_000) {
        return change.detail;
      }
    }
    const confirmation = (result as { confirmation?: unknown } | null)?.confirmation;
    if (tool === 'image_generation' && typeof confirmation === 'string' &&
        confirmation.length > 0 && confirmation.length <= 300 &&
        !Array.from(confirmation).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })) {
      return confirmation;
    }
    if ((tool.startsWith('memory_') || tool.startsWith('vault_') || tool === 'renew_credential' ||
      tool === 'daily_feed' || tool === 'proactive_preferences') && typeof confirmation === 'string' &&
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
