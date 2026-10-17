import { randomInt } from 'node:crypto';
import type { ConversationMessage } from '../core/conversation-store.js';
import { approvalInstruction, approvalNotPending, approvalUnclear } from '../core/approval.js';
import {
  fastApprovalDecider, safeDecision, type ApprovalDecider, type ApprovalVerdict,
} from '../core/approval-interpreter.js';
import { ToolRefusal } from '../core/tool-registry.js';

const ACTION_TTL_MS = 10 * 60_000;
const MAX_PENDING_ACTIONS = 50;

export type GoogleActionScope = 'calendar' | 'mail';

interface PendingAction {
  readonly code: string;
  readonly scope: GoogleActionScope;
  readonly sourceMessageId: string;
  readonly createdAt: number;
  readonly summary: string;
  readonly sourceSessionId?: string;
  readonly items?: readonly string[];
  readonly execute: (signal: AbortSignal) => Promise<unknown>;
}

export class PendingGoogleActions {
  private readonly actions = new Map<string, PendingAction>();
  private calendarProposal: PendingAction | undefined;
  private calendarReceipt: {
    readonly sourceSessionId?: string;
    readonly expiresAt: number;
    readonly result: Record<string, unknown>;
  } | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  stage(input: Omit<PendingAction, 'code' | 'createdAt'>): {
    readonly status: 'awaiting_confirmation';
    readonly summary: string;
    readonly confirmationCode: string;
    readonly instruction: string;
    readonly items?: readonly { readonly summary: string }[];
  } {
    this.removeExpired();
    if (this.actions.size >= MAX_PENDING_ACTIONS) {
      throw new Error('Too many pending Google actions');
    }
    for (const [code, action] of this.actions) {
      if (action.scope === input.scope) this.actions.delete(code);
    }
    let code: string;
    do {
      code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    } while (this.actions.has(code));
    const action: PendingAction = {
      ...input, ...(input.items ? { items: Object.freeze([...input.items]) } : {}),
      code, createdAt: this.now(),
    };
    this.actions.set(code, action);
    if (input.scope === 'calendar') {
      this.calendarProposal = action;
      this.calendarReceipt = undefined;
    }
    return {
      status: 'awaiting_confirmation',
      summary: input.summary,
      confirmationCode: code,
      instruction: `Nothing has changed. ${approvalInstruction}`,
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
    if (!action || action.scope !== scope || !message || message.role !== 'dan' ||
        !/^[1-9]\d{0,18}$/u.test(message.id) ||
        !/^[1-9]\d{0,18}$/u.test(action.sourceMessageId) ||
        message.id === action.sourceMessageId ||
        BigInt(message.id) <= BigInt(action.sourceMessageId) ||
        (action.sourceSessionId !== undefined && message.sessionId !== action.sourceSessionId) ||
        !Number.isFinite(message.at.getTime()) || message.at.getTime() <= action.createdAt) {
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
    return safeDecision(decide, {
      reply: eligible.message.text, summary: eligible.action.summary, family: scope,
      messageId: eligible.message.id, sessionId: eligible.message.sessionId, actionKey: code,
    }, signal);
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
    const verdict = await safeDecision(decide, {
      reply: eligible.message.text, summary: action.summary, family: scope,
      messageId: eligible.message.id, sessionId: eligible.message.sessionId, actionKey: code,
    }, signal);
    // The interpreter awaited: another confirmation may have consumed, replaced or expired this action meanwhile.
    // Nothing below this check awaits before the action is consumed, so exactly one confirmation can proceed.
    this.removeExpired();
    if (signal.aborted || this.actions.get(code) !== action) throw new ToolRefusal(approvalNotPending);
    if (verdict === 'neither') throw new ToolRefusal(approvalUnclear);
    this.actions.delete(code);
    const remember = (result: Record<string, unknown>) => {
      if (scope === 'calendar' && this.calendarProposal === action) {
        this.calendarReceipt = {
          sourceSessionId: action.sourceSessionId ?? eligible.message.sessionId,
          expiresAt: action.createdAt + ACTION_TTL_MS,
          result: structuredClone({
            ...result, ...(action.items ? { sourceMessageId: action.sourceMessageId } : {}),
          }),
        };
      }
      return result;
    };
    if (verdict === 'decline') {
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
    const result = await action.execute(signal);
    return typeof result === 'object' && result !== null
      ? remember({ ...result, summary: action.summary })
      : result;
  }

  /** Recover the real process-local stage after private tool results leave turn history. */
  pendingCalendarChange(message?: ConversationMessage) {
    this.removeExpired();
    const visible = (sourceSessionId?: string) =>
      sourceSessionId === undefined || (message?.role === 'dan' && message.sessionId === sourceSessionId);
    const action = [...this.actions.values()].find((candidate) =>
      candidate.scope === 'calendar' && visible(candidate.sourceSessionId));
    return action ? {
      status: 'awaiting_confirmation' as const,
      summary: action.summary,
      confirmationCode: action.code,
      ...(action.items ? { sourceMessageId: action.sourceMessageId } : {}),
      expiresAt: new Date(action.createdAt + ACTION_TTL_MS).toISOString(),
      instruction: `Nothing has changed. ${approvalInstruction}`,
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
      if (action.createdAt <= cutoff) this.actions.delete(code);
    }
    if (this.calendarProposal && this.calendarProposal.createdAt <= cutoff) {
      this.calendarProposal = undefined;
    }
    if (this.calendarReceipt && this.calendarReceipt.expiresAt <= this.now()) {
      this.calendarReceipt = undefined;
    }
  }
}
