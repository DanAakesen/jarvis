export interface PiConversationRow {
  readonly agentName: string;
  readonly conversationId: string;
  readonly warmedAt: Date | null;
  readonly contextHash: string | null;
}

export interface PiTurnRecord {
  readonly kind: 'chat' | 'warm' | 'smoke';
  readonly messageId: string | null;
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly costDkk: number;
  readonly firstTextMs: number | null;
  readonly totalMs: number;
  readonly outcome: 'ok' | 'failed' | 'cancelled' | 'timeout';
}

export interface PiStoredTurn extends PiTurnRecord { readonly at: Date }

export interface PiStore {
  getConversation(owner: string, signal: AbortSignal): Promise<PiConversationRow | null>;
  /** Keeps the stored conversation when it already belongs to this agent; otherwise binds the new one and clears its warm state. */
  bindConversation(owner: string, agentName: string, conversationId: string, signal: AbortSignal): Promise<PiConversationRow>;
  /** Forgets a conversation the provider no longer has, so the next turn starts a fresh one. */
  dropConversation(owner: string, signal: AbortSignal): Promise<void>;
  markWarm(owner: string, contextHash: string, at: Date, signal: AbortSignal): Promise<void>;
  recordTurn(turn: PiTurnRecord, signal: AbortSignal): Promise<void>;
  /** Spend of turns at or after `from` (UTC month start); failed and cancelled turns count at an estimate when the model had started. */
  spendSince(from: Date, signal: AbortSignal): Promise<{ readonly costDkk: number; readonly turns: number }>;
  lastTurn(signal: AbortSignal): Promise<PiStoredTurn | null>;
}

export function createMemoryPiStore(now: () => Date = () => new Date()): PiStore & { readonly turns: PiStoredTurn[] } {
  const conversations = new Map<string, PiConversationRow>();
  const turns: PiStoredTurn[] = [];
  return {
    turns,
    async getConversation(owner) { return conversations.get(owner) ?? null; },
    async bindConversation(owner, agentName, conversationId) {
      const existing = conversations.get(owner);
      if (existing?.agentName === agentName) return existing;
      const row = { agentName, conversationId, warmedAt: null, contextHash: null };
      conversations.set(owner, row);
      return row;
    },
    async dropConversation(owner) { conversations.delete(owner); },
    async markWarm(owner, contextHash, at) {
      const row = conversations.get(owner);
      if (row) conversations.set(owner, { ...row, warmedAt: at, contextHash });
    },
    async recordTurn(turn) { turns.push({ ...turn, at: now() }); },
    async spendSince(from) {
      const inRange = turns.filter(turn => turn.at >= from);
      return { costDkk: inRange.reduce((sum, turn) => sum + turn.costDkk, 0), turns: inRange.length };
    },
    async lastTurn() { return turns.at(-1) ?? null; },
  };
}
