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

export interface HealthMcpAuditRecord {
  readonly requestId: string;
  readonly tool: 'read_nutrition' | 'lookup_food' | 'log_food' | 'correct_food' | 'delete_food' | 'read_food_preferences' | 'manage_saved_food';
  readonly phase: 'awaiting_confirmation' | ToolCallOutcome;
  readonly outcome: ToolCallOutcome;
}

export interface ToolCallStore {
  record(call: ToolCallRecord): Promise<void>;
  recordHealthMcp?(call: HealthMcpAuditRecord): Promise<void>;
  listCodexToolCalls?(from: Date, to: Date): Promise<CodexToolUsageCount[]>;
}

/**
 * The confirmation Jarvis relays about an action (L16). It is derived only from the
 * recorded outcome and result, never from the model's own wording.
 */
export function confirmToolCall(tool: string, outcome: ToolCallOutcome, result: unknown): string {
  if (outcome === 'ok') {
    if (tool === 'gym_lifts') {
      const saved = result as { entry?: unknown; replayed?: unknown } | null;
      if (saved && typeof saved === 'object' && 'entry' in saved) {
        const entry = saved.entry as {
          exerciseName?: unknown; weightKg?: unknown; reps?: unknown; sets?: unknown; deletedAt?: unknown; vault?: unknown;
        } | null;
        if (typeof entry?.exerciseName !== 'string' || entry.exerciseName.trim().length === 0 || entry.exerciseName.length > 80 ||
            /[\p{Cc}\p{Cf}]/u.test(entry.exerciseName) || typeof entry.weightKg !== 'number' ||
            !Number.isFinite(entry.weightKg) || entry.weightKg < 0 || entry.weightKg > 1000 ||
            typeof entry.reps !== 'number' || !Number.isSafeInteger(entry.reps) || entry.reps < 1 || entry.reps > 1000 ||
            typeof entry.sets !== 'number' || !Number.isSafeInteger(entry.sets) || entry.sets < 1 || entry.sets > 100) {
          return 'The lift result could not be verified. Check history before retrying.';
        }
        if (entry.deletedAt !== null && entry.deletedAt !== undefined) {
          return saved.replayed === true
            ? 'This lift was deleted; it was not saved again.'
            : `Deleted lift: ${entry.exerciseName}.`;
        }
        return `${saved.replayed === true ? 'Already saved lift' : 'Saved lift'}: ${entry.exerciseName}, ${entry.weightKg} kg, ` +
          `${entry.reps} ${entry.reps === 1 ? 'rep' : 'reps'}, ${entry.sets} ${entry.sets === 1 ? 'set' : 'sets'}.` +
          (entry.vault === 'pending' ? ' Vault copy is pending.' : '');
      }
    }
    if (tool === 'health_food' || tool === 'health_food_review' || tool === 'health_food_lookup') {
      const presentation = (result as { presentation?: unknown } | null)?.presentation;
      if (typeof presentation === 'string' && presentation.length <= 2000) return presentation;
    }
    if (tool.startsWith('mail_')) {
      const action = result as { status?: unknown; summary?: unknown; detail?: unknown } | null;
      if (action?.status === 'awaiting_confirmation') {
        return 'Awaiting your approval; no Gmail change has been made.';
      }
      if (action?.status === 'unverified' || action?.status === 'partial') {
        return typeof action.detail === 'string' && action.detail.length <= 1_000
          ? action.detail : 'The Gmail outcome is unverified. Check Gmail before trying again.';
      }
      if (action?.status === 'cancelled') return 'Cancelled. No Gmail change was made.';
    }
    if (tool.startsWith('calendar_')) {
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
      tool === 'proactive_preferences' || tool === 'proactive_item_feedback') && typeof confirmation === 'string' &&
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
    (tool === 'image_generation' || tool.startsWith('mail_') ? (result as { error?: unknown } | null)?.error : undefined);
  if (typeof failure === 'string') return `Not done: ${tool} failed. ${failure}`;
  return `Not done: ${tool} failed.`;
}
