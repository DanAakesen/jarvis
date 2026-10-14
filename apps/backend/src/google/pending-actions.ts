import { randomInt } from 'node:crypto';
import type { ConversationMessage } from '../core/conversation-store.js';
import { approvalInstruction, classifyApprovalReply } from '../core/approval.js';
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
  readonly execute: (signal: AbortSignal) => Promise<unknown>;
}

export class PendingGoogleActions {
  private readonly actions = new Map<string, PendingAction>();

  constructor(private readonly now: () => number = Date.now) {}

  stage(input: Omit<PendingAction, 'code' | 'createdAt'>): {
    readonly status: 'awaiting_confirmation';
    readonly summary: string;
    readonly confirmationCode: string;
    readonly instruction: string;
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
    this.actions.set(code, { ...input, code, createdAt: this.now() });
    return {
      status: 'awaiting_confirmation',
      summary: input.summary,
      confirmationCode: code,
      instruction: `Nothing has changed. ${approvalInstruction}`,
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
        !Number.isFinite(message.at.getTime()) || message.at.getTime() <= action.createdAt ||
        reply === undefined) {
      throw new ToolRefusal(`No ${scope === 'calendar' ? 'calendar' : 'Google'} change was made. Dan must reply yes, approved, confirmed or go ahead (or no/cancel to decline) in a later message for the latest pending action within ten minutes. Otherwise stage the action again.`);
    }
    this.actions.delete(code);
    if (reply === 'decline') {
      return { status: 'cancelled', detail: `The pending ${scope === 'calendar' ? 'calendar' : 'Google'} change was discarded. No change was made.` };
    }
    return action.execute(signal);
  }

  /** Recover the real process-local stage after private tool results leave turn history. */
  pendingCalendarChange() {
    this.removeExpired();
    const action = [...this.actions.values()].find((candidate) => candidate.scope === 'calendar');
    return action ? {
      status: 'awaiting_confirmation' as const,
      summary: action.summary,
      confirmationCode: action.code,
      expiresAt: new Date(action.createdAt + ACTION_TTL_MS).toISOString(),
      instruction: `Nothing has changed. ${approvalInstruction}`,
    } : { status: 'none' as const, detail: 'No calendar change is staged. Nothing has changed.' };
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
  }
}
