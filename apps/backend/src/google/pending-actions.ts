import { randomInt } from 'node:crypto';
import type { ConversationMessage } from '../core/conversation-store.js';
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
    if (input.scope === 'calendar') {
      for (const [code, action] of this.actions) {
        if (action.scope === 'calendar') this.actions.delete(code);
      }
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
      instruction: input.scope === 'calendar'
        ? 'Nothing has changed. Reply yes, approve, go ahead or do it to approve; no or cancel to decline, in a new message within ten minutes.'
        : `Nothing has changed. To approve, say exactly "confirm ${code}".`,
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
    const reply = message?.text.trim().toLowerCase();
    const calendarReply = reply !== undefined && /^(?:yes|approve|go ahead|do it|no|cancel)[.!]?$/u.test(reply);
    if (!action || action.scope !== scope || !message || message.role !== 'dan' ||
        !/^[1-9]\d{0,18}$/u.test(message.id) ||
        !/^[1-9]\d{0,18}$/u.test(action.sourceMessageId) ||
        message.id === action.sourceMessageId ||
        BigInt(message.id) <= BigInt(action.sourceMessageId) ||
        !Number.isFinite(message.at.getTime()) || message.at.getTime() <= action.createdAt ||
        (scope === 'calendar' ? !calendarReply : reply !== `confirm ${code}`)) {
      throw new ToolRefusal(scope === 'calendar'
        ? 'No calendar change was made. Dan must reply yes, approve, go ahead or do it (or no/cancel to decline) in a later message for the latest pending action within ten minutes. Otherwise stage the action again.'
        : 'No Google change was made. Dan must send the exact confirmation phrase in a new message.');
    }
    this.actions.delete(code);
    if (scope === 'calendar' && /^(?:no|cancel)[.!]?$/u.test(reply!)) {
      return { status: 'cancelled', detail: 'The pending calendar change was discarded. No change was made.' };
    }
    return action.execute(signal);
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
