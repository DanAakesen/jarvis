import type { ConversationMessage } from './conversation-store.js';
import { approvalInstruction, approvalNotPending, approvalUnclear } from './approval.js';
import { safeDecision, type ApprovalDecider, type ApprovalFamily, type ApprovalVerdict } from './approval-interpreter.js';
import { ToolRefusal } from './tool-registry.js';

export interface PendingActionOptions {
  readonly key: string;
  readonly summary: string;
  readonly family?: ApprovalFamily;
  readonly sourceMessageId?: string;
  readonly sourceSessionId?: string;
  readonly createdAt: number;
  readonly lifetimeMs: number;
  readonly now?: () => number;
}

/** Owns the approval boundary; adapters retain routing, persistence and tool permissions. */
export class PendingAction {
  private state: 'pending' | 'cancelled' | 'expired' | 'consumed' | 'executing' = 'pending';
  private readonly now: () => number;
  readonly expiresAt: number;

  constructor(readonly proposal: PendingActionOptions) {
    if (!proposal.key || !proposal.summary.trim() || !Number.isFinite(proposal.createdAt) ||
        !Number.isFinite(proposal.lifetimeMs) || proposal.lifetimeMs <= 0 ||
        (proposal.sourceMessageId !== undefined || proposal.sourceSessionId !== undefined) &&
        (!validId(proposal.sourceMessageId) || !proposal.sourceSessionId || !proposal.family)) {
      throw new TypeError('A valid, bound confirmation proposal is required');
    }
    this.proposal = Object.freeze({ ...proposal });
    this.now = proposal.now ?? Date.now;
    this.expiresAt = proposal.createdAt + proposal.lifetimeMs;
  }

  get pending(): boolean {
    if (this.state === 'pending' && this.now() >= this.expiresAt) this.state = 'expired';
    return this.state === 'pending';
  }

  get presentation() {
    return {
      status: 'awaiting_confirmation' as const,
      summary: this.proposal.summary,
      expiresAt: new Date(this.expiresAt).toISOString(),
      instruction: `Nothing has changed. ${approvalInstruction}`,
    };
  }

  eligible(message: ConversationMessage | undefined): message is ConversationMessage {
    return this.pending && message?.role === 'dan' && validId(message.id) &&
      validId(this.proposal.sourceMessageId) && Boolean(this.proposal.sourceSessionId) &&
      message.sessionId === this.proposal.sourceSessionId &&
      BigInt(message.id) > BigInt(this.proposal.sourceMessageId) &&
      message.at instanceof Date && Number.isFinite(message.at.getTime()) &&
      (this.proposal.family === 'food'
        ? message.at.getTime() >= this.proposal.createdAt && message.at.getTime() < this.expiresAt
        : message.at.getTime() > this.proposal.createdAt);
  }

  async decision(
    message: ConversationMessage | undefined,
    decide: ApprovalDecider,
    signal: AbortSignal,
  ): Promise<ApprovalVerdict | undefined> {
    if (signal.aborted || !this.eligible(message) || !this.proposal.family) return undefined;
    const verdict = await safeDecision(decide, {
      reply: message.text, summary: this.proposal.summary, family: this.proposal.family,
      messageId: message.id, sessionId: message.sessionId, actionKey: this.proposal.key,
    }, signal);
    return !signal.aborted && this.eligible(message) ? verdict : undefined;
  }

  cancel(): void {
    if (this.pending || this.state === 'consumed') this.state = 'cancelled';
  }

  /** Synchronous: no other reply, cancellation or expiry can slip between the check and consumption. */
  consume(verdict: ApprovalVerdict | undefined, signal?: AbortSignal): 'approve' | 'decline' {
    if (signal?.aborted || !this.pending || verdict === undefined) throw new ToolRefusal(approvalNotPending);
    if (verdict === 'neither') throw new ToolRefusal(approvalUnclear);
    this.state = verdict === 'approve' ? 'consumed' : 'cancelled';
    return verdict;
  }

  async execute<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.state === 'consumed' && this.now() >= this.expiresAt) this.state = 'expired';
    if (signal?.aborted || this.state !== 'consumed') {
      throw new ToolRefusal(approvalNotPending);
    }
    this.state = 'executing';
    return action();
  }
}

function validId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/u.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n;
}
