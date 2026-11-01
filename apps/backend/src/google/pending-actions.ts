import { randomBytes, randomInt } from 'node:crypto';
import type { BrowserConfirmation } from '../core/owner-interactions.js';
import type { ConfirmationDecision } from '../database/confirmation-store.js';
import type { ConversationMessage } from '../core/conversation-store.js';
import { approvalNotPending } from '../core/approval.js';
import {
  fastApprovalDecider, type ApprovalDecider, type ApprovalVerdict,
} from '../core/approval-interpreter.js';
import { ToolRefusal } from '../core/tool-registry.js';
import { PendingAction as Confirmation } from '../core/pending-action.js';

const ACTION_TTL_MS = 10 * 60_000;
const MAX_PENDING_ACTIONS = 50;
const COMPLETED_ACTION_REPLY_INSTRUCTION =
  'The action is done. Confirm it in one short sentence without reading the details aloud; they are on screen.';

export type GoogleActionScope = 'calendar' | 'mail';

interface PendingAction {
  readonly browserId: string;
  readonly code: string;
  readonly scope: GoogleActionScope;
  readonly sourceMessageId: string;
  /** Only a later Dan message in this same session can decide the action. Required, so no stage is ever unbound. */
  readonly sourceSessionId: string;
  readonly createdAt: number;
  readonly summary: string;
  readonly items?: readonly string[];
  readonly execute: (signal: AbortSignal) => Promise<unknown>;
  readonly confirmation: Confirmation;
}

export class PendingGoogleActions {
  onChanged: () => void = () => {};
  onConfirmationPending: (confirmation: BrowserConfirmation) => void = () => {};
  private readonly actions = new Map<string, PendingAction>();
  private calendarProposal: PendingAction | undefined;
  private calendarReceipt: {
    readonly sourceSessionId: string;
    readonly expiresAt: number;
    readonly result: Record<string, unknown>;
  } | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  stage(input: Omit<PendingAction, 'code' | 'browserId' | 'createdAt' | 'confirmation'>): {
    readonly status: 'awaiting_confirmation';
    readonly summary: string;
    readonly confirmationCode: string;
    readonly instruction: string;
    readonly items?: readonly { readonly summary: string }[];
  } {
    this.removeExpired();
    if (typeof input.sourceSessionId !== 'string' || input.sourceSessionId.length === 0) {
      throw new TypeError('A pending Google action must be bound to the session that staged it');
    }
    if (input.scope === 'calendar' && input.summary.length > 40_000) {
      throw new ToolRefusal('The calendar proposal is too large to review. Prepare a smaller proposal.');
    }
    if (this.actions.size >= MAX_PENDING_ACTIONS) {
      throw new Error('Too many pending Google actions');
    }
    for (const [code, action] of this.actions) {
      if (action.scope === input.scope) {
        action.confirmation.cancel();
        this.actions.delete(code);
      }
    }
    let code: string;
    do {
      code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    } while (this.actions.has(code));
    const createdAt = this.now();
    const confirmation = new Confirmation({
      key: code, summary: input.summary, family: input.scope,
      sourceMessageId: input.sourceMessageId, sourceSessionId: input.sourceSessionId,
      createdAt, lifetimeMs: ACTION_TTL_MS, now: this.now,
    });
    const action: PendingAction = {
      ...input, ...(input.items ? { items: Object.freeze([...input.items]) } : {}),
      code, browserId: randomBytes(32).toString('base64url'), createdAt, confirmation,
    };
    this.actions.set(code, action);
    if (input.scope === 'calendar') {
      this.calendarProposal = action;
      this.calendarReceipt = undefined;
    }
    this.onChanged();
    if (input.scope === 'calendar') {
      this.onConfirmationPending({
        id: action.browserId,
        actionKind: 'calendar_change',
        summary: action.summary,
        expiresAt: action.confirmation.presentation.expiresAt,
      });
    }
    return {
      ...confirmation.presentation,
      confirmationCode: code,
      ...(input.items ? { items: input.items.map((summary) => ({ summary })) } : {}),
    };
  }

  /**
   * Provenance only: the action exists in this scope and the message is a verified, later, Dan-authored message in the
   * same session and window. Nothing here looks at what the message says.
   */
  private eligible(
    scope: GoogleActionScope,
    code: string,
    message: ConversationMessage | undefined,
  ): { readonly action: PendingAction; readonly message: ConversationMessage } | undefined {
    this.removeExpired();
    const action = this.actions.get(code);
    if (!action || action.scope !== scope || !action.confirmation.eligible(message)) {
      return undefined;
    }
    return { action, message };
  }

  /** What Dan's later message means for this pending action, or undefined when it may not decide it at all. */
  async decision(
    scope: GoogleActionScope,
    code: string,
    message: ConversationMessage | undefined,
    decide: ApprovalDecider,
    signal: AbortSignal,
  ): Promise<ApprovalVerdict | undefined> {
    const eligible = this.eligible(scope, code, message);
    if (!eligible) return undefined;
    return eligible.action.confirmation.decision(eligible.message, decide, signal);
  }

  async confirm(
    scope: GoogleActionScope,
    code: string,
    message: ConversationMessage | undefined,
    signal: AbortSignal,
    decide: ApprovalDecider = fastApprovalDecider,
  ): Promise<unknown> {
    const eligible = this.eligible(scope, code, message);
    if (!eligible) throw new ToolRefusal(approvalNotPending);
    const { action } = eligible;
    const verdict = await action.confirmation.decision(eligible.message, decide, signal);
    // The interpreter awaited: another confirmation may have consumed, replaced or expired this action meanwhile.
    // Nothing below this check awaits before the action is consumed, so exactly one confirmation can proceed.
    this.removeExpired();
    if (signal.aborted || this.actions.get(code) !== action) throw new ToolRefusal(approvalNotPending);
    return this.complete(action, verdict, signal);
  }

  pendingBrowserConfirmations(): readonly BrowserConfirmation[] {
    this.removeExpired();
    return [...this.actions.values()].filter((action) => action.scope === 'calendar').map((action) => ({
      id: action.browserId, actionKind: 'calendar_change', summary: action.summary,
      expiresAt: action.confirmation.presentation.expiresAt,
    }));
  }

  async resolveBrowserConfirmation(
    id: string, decision: ConfirmationDecision, signal: AbortSignal,
  ): Promise<false | { readonly result: unknown }> {
    this.removeExpired();
    const action = [...this.actions.values()].find((candidate) =>
      candidate.scope === 'calendar' && candidate.browserId === id);
    if (!action || (decision !== 'approve' && decision !== 'reject')) return false;
    return { result: await this.complete(action, decision === 'approve' ? 'approve' : 'decline', signal) };
  }

  private async complete(action: PendingAction, verdict: ApprovalVerdict | undefined, signal: AbortSignal) {
    const { scope, code } = action;
    const decision = action.confirmation.consume(verdict, signal);
    this.actions.delete(code);
    this.onChanged();
    const remember = (result: Record<string, unknown>) => {
      if (scope === 'calendar' && this.calendarProposal === action) {
        this.calendarReceipt = {
          sourceSessionId: action.sourceSessionId,
          expiresAt: action.createdAt + ACTION_TTL_MS,
          result: structuredClone({
            ...result, ...(action.items ? { sourceMessageId: action.sourceMessageId } : {}),
          }),
        };
      }
      return result;
    };
    if (decision === 'decline') {
      return remember({
        status: 'cancelled', summary: action.summary,
        detail: `The pending ${scope === 'calendar' ? 'calendar' : 'Google'} change was discarded. No change was made.`,
        ...(action.items ? { items: action.items.map((summary) => ({ summary, status: 'cancelled' })) } : {}),
      });
    }
    // Keep an honest receipt even if execution is interrupted before a result returns.
    remember({
      status: 'unverified', summary: action.summary,
      detail: 'The approval was consumed, but the calendar result is unverified. Check the calendar before proposing a retry; do not repeat the write.',
    });
    const result = await action.confirmation.execute(() => action.execute(signal), signal);
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return result;
    const resultObject = result as Record<string, unknown>;
    const completed = resultObject.status === 'completed' &&
      (!Array.isArray(resultObject.items) || (resultObject.items.length > 0 &&
        resultObject.items.every((item) => typeof item === 'object' && item !== null &&
          !Array.isArray(item) && (item as Record<string, unknown>).status === 'completed')));
    return remember({
      ...resultObject,
      summary: action.summary,
      ...(completed ? { instruction: COMPLETED_ACTION_REPLY_INSTRUCTION } : {}),
    });
  }

  /** Recover the real process-local stage after private tool results leave turn history. */
  pendingCalendarChange(message?: ConversationMessage) {
    this.removeExpired();
    const visible = (sourceSessionId: string) =>
      message?.role === 'dan' && Boolean(message.sessionId) && message.sessionId === sourceSessionId;
    const action = [...this.actions.values()].find((candidate) =>
      candidate.scope === 'calendar' && visible(candidate.sourceSessionId));
    return action ? {
      ...action.confirmation.presentation,
      confirmationCode: action.code,
      ...(action.items ? { sourceMessageId: action.sourceMessageId } : {}),
      ...(action.items ? { items: action.items.map((summary) => ({ summary })) } : {}),
    } : {
      status: 'none' as const,
      detail: 'No calendar change is pending. Pending state does not establish whether an event exists.',
      ...(this.calendarReceipt && visible(this.calendarReceipt.sourceSessionId)
        ? { lastChange: structuredClone(this.calendarReceipt.result) } : {}),
    };
  }

  get size(): number {
    this.removeExpired();
    return this.actions.size;
  }

  private removeExpired(): void {
    const cutoff = this.now() - ACTION_TTL_MS;
    for (const [code, action] of this.actions) {
      if (!action.confirmation.pending) {
        this.actions.delete(code);
        this.onChanged();
      }
    }
    if (this.calendarProposal && this.calendarProposal.createdAt <= cutoff) {
      this.calendarProposal = undefined;
    }
    if (this.calendarReceipt && this.calendarReceipt.expiresAt <= this.now()) {
      this.calendarReceipt = undefined;
    }
  }
}
