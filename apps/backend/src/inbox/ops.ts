export type InboxSpendKind = 'review' | 'audit' | 'weekly' | 'triage';

export interface InboxSpendRow {
  readonly day: string;
  readonly kind: InboxSpendKind;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedDkk: number;
}

/** The only operational facts the inbox keeps besides the index: tiny key-value state and the spend it caused. */
export interface InboxOpsStore {
  getState(key: string, signal: AbortSignal): Promise<string | null>;
  setState(key: string, value: string, signal: AbortSignal): Promise<void>;
  deleteState(key: string, signal: AbortSignal): Promise<void>;
  addSpend(
    day: string,
    kind: InboxSpendKind,
    usage: { readonly calls: number; readonly inputTokens: number; readonly outputTokens: number; readonly estimatedDkk: number },
    signal: AbortSignal,
  ): Promise<void>;
  /** Spend rows from a day (inclusive, YYYY-MM-DD) onward. */
  spendSince(fromDay: string, signal: AbortSignal): Promise<InboxSpendRow[]>;
}

export const NUDGE_STYLE_KEY = 'nudge_style';
export const AUDIT_DAY_KEY = 'audit_day';
export const WEEKLY_WEEK_KEY = 'weekly_week';
export const MAX_NUDGE_STYLE_CHARACTERS = 600;
