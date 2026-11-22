import type { ToolEffect } from './tool-registry.js';

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
    return typeof reason === 'string' ? `Not done. ${reason}` : 'Not done. It was refused.';
  }
  // The cause is the tool's own plain sentence (a `ToolFailure` message) or the dispatcher's class sentence, never provider text.
  // A failure marked `outcomeUnknown` already says the tool may have done its work, so it must not also say "Not done."
  const failed = result as { failure?: unknown; error?: unknown; outcomeUnknown?: unknown } | null;
  const failure = failed?.failure ?? failed?.error;
  if (typeof failure !== 'string') return "Not done. It didn't work, and no reason came back.";
  return failed?.outcomeUnknown === true ? failure : `Not done. ${failure}`;
}

export type ToolFailureClass = 'stopped' | 'timeout' | 'dropped' | 'not_sent' | 'unexpected';

export interface UnexpectedToolFailure {
  /** Stored and returned to the model. `outcomeUnknown` means the tool may have done its work, so "Not done." is not claimed. */
  readonly result: { readonly error: string; readonly outcomeUnknown?: true };
  /** Fixed-vocabulary fields for the `tool.execution_failed` log: error class tokens only, never error text. */
  readonly log: {
    readonly failureClass: ToolFailureClass;
    readonly effect: ToolEffect;
    readonly errorName?: string;
    readonly errorCode?: string;
    readonly causeName?: string;
    readonly causeCode?: string;
  };
}

// The connection was never made, so the request cannot have been delivered.
const notSentCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
// The request was, or may have been, delivered before the call ended, so the other side may have acted on it.
const timeoutCodes = new Set(['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const droppedCodes = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_ABORTED', 'UND_ERR_DESTROYED']);

const causeSentences: Record<ToolFailureClass, string> = {
  stopped: 'It was stopped before it finished',
  timeout: 'It did not finish in time',
  dropped: 'The connection dropped before it finished',
  not_sent: 'It could not reach the service it needs',
  unexpected: 'It hit an unexpected problem',
};

const nameToken = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(value) ? value : undefined;
const codeToken = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : undefined;

/**
 * The plain result for a tool that threw something that is not a `ToolFailure`, chosen by error class (name and code only, so no
 * provider text reaches Dan or the model). `effect` is what this call does (`effectOf`: the operation named, or the tool's default,
 * and `unclassified` when the tool does not say). Only a call that reads can say plainly that nothing changed. Any other call that
 * may have been delivered (a timeout, a dropped connection, a stop, an unknown error) says its outcome is unknown, and only a call
 * that provably never left says so, because a retry of a write that already happened would do it twice.
 */
export function unexpectedToolFailure(error: unknown, aborted: boolean, effect: ToolEffect): UnexpectedToolFailure {
  const read = (value: unknown) => {
    const fields = value !== null && typeof value === 'object' ? value as { name?: unknown; code?: unknown } : {};
    return { name: nameToken(fields.name), code: codeToken(fields.code) };
  };
  const outer = read(error);
  const inner = read(error !== null && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined);
  const codes = [outer.code, inner.code].filter((code): code is string => code !== undefined);
  // Any sign the request left wins over a sign it did not.
  const failureClass: ToolFailureClass = aborted ? 'stopped'
    : outer.name === 'TimeoutError' || inner.name === 'TimeoutError' || codes.some((code) => timeoutCodes.has(code)) ? 'timeout'
      : codes.some((code) => droppedCodes.has(code)) ? 'dropped'
        : codes.some((code) => notSentCodes.has(code)) ? 'not_sent' : 'unexpected';
  const what = causeSentences[failureClass];
  const readOnly = effect === 'read';
  const sentence = readOnly ? `${what}.` : failureClass === 'not_sent'
    ? `${what}, so that request was not sent.`
    : `${what}, so it may or may not have gone through. Check before trying again.`;
  return {
    result: readOnly ? { error: sentence } : { error: sentence, outcomeUnknown: true },
    log: {
      failureClass,
      effect,
      ...(outer.name ? { errorName: outer.name } : {}),
      ...(outer.code ? { errorCode: outer.code } : {}),
      ...(inner.name ? { causeName: inner.name } : {}),
      ...(inner.code ? { causeCode: inner.code } : {}),
    },
  };
}
