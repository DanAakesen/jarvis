export interface PiConversationRow {
  readonly agentName: string;
  readonly conversationId: string;
  readonly warmedAt: Date | null;
  readonly contextHash: string | null;
}

export interface PiTurnRecord {
  readonly kind: 'chat' | 'warm' | 'smoke' | 'brain';
  readonly messageId: string | null;
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly costDkk: number;
  readonly firstTextMs: number | null;
  readonly totalMs: number;
  readonly outcome: 'ok' | 'failed' | 'cancelled' | 'timeout';
  readonly activationId?: string | undefined;
  readonly activationType?: 'chat' | 'voice' | 'scheduled' | 'event' | undefined;
  readonly activationSource?: string | null | undefined;
  readonly slotKey?: string | null | undefined;
  readonly stateRevision?: number | null | undefined;
  readonly staleSourceCount?: number | undefined;
  readonly toolCount?: number | undefined;
  readonly actionCount?: number | undefined;
  readonly pushCount?: number | undefined;
  readonly activationResult?: 'action' | 'push' | 'silence' | 'failed' | undefined;
}

export interface PiStoredTurn extends PiTurnRecord { readonly at: Date }

export type PiTurnKind = PiTurnRecord['kind'];
/** The chat engine's own turns. The brain's wakes are a separate budget and never count against the chat cap. */
export const chatTurnKinds: readonly PiTurnKind[] = ['chat', 'warm', 'smoke'];
export const brainTurnKinds: readonly PiTurnKind[] = ['brain'];

export interface PiMessageRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly messageId: string;
  /** SHA-256 of the text, so a repeat can be refused without keeping a second copy of Dan's chat. */
  readonly textHash: string;
}

export interface PiStore {
  getConversation(owner: string, signal: AbortSignal): Promise<PiConversationRow | null>;
  /** Keeps the stored conversation when it already belongs to this agent; otherwise binds the new one and clears its warm state. */
  bindConversation(owner: string, agentName: string, conversationId: string, signal: AbortSignal): Promise<PiConversationRow>;
  /** Forgets a conversation the provider no longer has, so the next turn starts a fresh one. */
  dropConversation(owner: string, signal: AbortSignal): Promise<void>;
  markWarm(owner: string, contextHash: string, at: Date, signal: AbortSignal): Promise<void>;
  recordTurn(turn: PiTurnRecord, signal: AbortSignal): Promise<void>;
  /** Spend of the given kinds at or after `from` (UTC month start); failed and cancelled turns count at an estimate when the model had started. */
  spendSince(from: Date, kinds: readonly PiTurnKind[], signal: AbortSignal): Promise<{ readonly costDkk: number; readonly turns: number }>;
  /** The newest turn of the given kinds. */
  lastTurn(kinds: readonly PiTurnKind[], signal: AbortSignal): Promise<PiStoredTurn | null>;
  /** Newest first; used to pause background warm-ups after repeated failures, so the pause survives a restart. */
  recentTurns(limit: number, kinds: readonly PiTurnKind[], signal: AbortSignal): Promise<readonly PiStoredTurn[]>;
  /** The owner's Background PI switch: it wakes only while this is on. Off until the owner turns it on. */
  readBrainSwitch(owner: string, signal: AbortSignal): Promise<{ readonly enabled: boolean; readonly updatedAt: Date | null }>;
  writeBrainSwitch(owner: string, enabled: boolean, at: Date, signal: AbortSignal): Promise<void>;
  /** A chat message the brain sent: the daily limit and the repeat check read these. */
  recordMessage(message: PiMessageRecord, at: Date, signal: AbortSignal): Promise<void>;
  messagesSince(from: Date, signal: AbortSignal): Promise<{ readonly count: number; readonly textHashes: readonly string[] }>;
  /** One look at a standing watch, recorded when the wake records it. The cost is filled in when the wake ends. */
  recordLook(watch: string, runId: string, at: Date, signal: AbortSignal): Promise<void>;
  /** Gives every look of a wake its share of what the wake cost. */
  allocateRunCost(runId: string, perLookDkk: number, signal: AbortSignal): Promise<void>;
  /** Looks and cost per watch since `from`, with the time of the latest look. */
  watchActivity(from: Date, signal: AbortSignal): Promise<readonly { readonly watch: string; readonly looks: number; readonly costDkk: number; readonly lastLookAt: Date }[]>;
}

export function createMemoryPiStore(now: () => Date = () => new Date()): PiStore & { readonly turns: PiStoredTurn[]; readonly messages: (PiMessageRecord & { readonly at: Date })[] } {
  const conversations = new Map<string, PiConversationRow>();
  const turns: PiStoredTurn[] = [];
  const messages: (PiMessageRecord & { at: Date })[] = [];
  const switches = new Map<string, { enabled: boolean; updatedAt: Date }>();
  const looks: { watch: string; runId: string; at: Date; costDkk: number }[] = [];
  return {
    turns, messages,
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
    async spendSince(from, kinds) {
      const inRange = turns.filter(turn => turn.at >= from && kinds.includes(turn.kind));
      return { costDkk: inRange.reduce((sum, turn) => sum + turn.costDkk, 0), turns: inRange.length };
    },
    async lastTurn(kinds) { return [...turns].reverse().find(turn => kinds.includes(turn.kind)) ?? null; },
    async recentTurns(limit, kinds) { return [...turns].reverse().filter(turn => kinds.includes(turn.kind)).slice(0, limit); },
    async readBrainSwitch(owner) {
      const row = switches.get(owner);
      return { enabled: row?.enabled ?? false, updatedAt: row?.updatedAt ?? null };
    },
    async writeBrainSwitch(owner, enabled, at) { switches.set(owner, { enabled, updatedAt: at }); },
    async recordMessage(message, at) { messages.push({ ...message, at }); },
    async messagesSince(from) {
      const inRange = messages.filter(message => message.at >= from);
      return { count: inRange.length, textHashes: inRange.map(message => message.textHash) };
    },
    async recordLook(watch, runId, at) { looks.push({ watch, runId, at, costDkk: 0 }); },
    async allocateRunCost(runId, perLookDkk) { for (const look of looks) if (look.runId === runId) look.costDkk = perLookDkk; },
    async watchActivity(from) {
      const byWatch = new Map<string, { looks: number; costDkk: number; lastLookAt: Date }>();
      for (const look of looks.filter(entry => entry.at >= from)) {
        const row = byWatch.get(look.watch) ?? { looks: 0, costDkk: 0, lastLookAt: look.at };
        row.looks += 1;
        row.costDkk += look.costDkk;
        if (look.at > row.lastLookAt) row.lastLookAt = look.at;
        byWatch.set(look.watch, row);
      }
      return [...byWatch].map(([watch, row]) => ({ watch, ...row }));
    },
  };
}
