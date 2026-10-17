import { randomInt } from 'node:crypto';
import type { ConversationMessage } from '../core/conversation-store.js';
import { approvalInstruction, classifyApprovalReply } from '../core/approval.js';
import { ToolRefusal } from '../core/tool-registry.js';

const ACTION_TTL_MS = 10 * 60_000;
const MAX_PENDING_ACTIONS = 50;
const COMPLETED_ACTION_REPLY_INSTRUCTION =
  'The action is done. Confirm it in one short sentence without reading the details aloud; they are on screen.';

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

  async confirm(
    scope: GoogleActionScope,
    code: string,
    message: ConversationMessage | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.removeExpired();
    const action = this.actions.get(code);
    const reply = classifyApprovalReply(message?.text);
    if (!action || action.scope !== scope || !message || message.role !== 'dan' ||
        !/^[1-9]\d{0,18}$/u.test(message.id) ||
        !/^[1-9]\d{0,18}$/u.test(action.sourceMessageId) ||
        message.id === action.sourceMessageId ||
        BigInt(message.id) <= BigInt(action.sourceMessageId) ||
        (action.sourceSessionId !== undefined && message.sessionId !== action.sourceSessionId) ||
        !Number.isFinite(message.at.getTime()) || message.at.getTime() <= action.createdAt ||
        reply === undefined) {
      throw new ToolRefusal(`No ${scope === 'calendar' ? 'calendar' : 'Google'} change was made. Dan must reply yes, approved, confirmed or go ahead (or no/cancel to decline) in a later message for the latest pending action within ten minutes. Otherwise stage the action again.`);
    }
    this.actions.delete(code);
    const remember = (result: Record<string, unknown>) => {
      if (scope === 'calendar' && this.calendarProposal === action) {
        this.calendarReceipt = {
          sourceSessionId: action.sourceSessionId ?? message.sessionId,
          expiresAt: action.createdAt + ACTION_TTL_MS,
          result: structuredClone({
            ...result, ...(action.items ? { sourceMessageId: action.sourceMessageId } : {}),
          }),
        };
      }
      return result;
    };
    if (reply === 'decline') {
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
