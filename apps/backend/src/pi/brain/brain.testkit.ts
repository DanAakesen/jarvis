import { createHash } from 'node:crypto';
import type {
  ConversationMessage, ConversationSession, ConversationStore, ProactiveConversationEvidence,
} from '../../core/conversation-store.js';
import { VaultWriteConflictError } from '../../vault/github-client.js';
import type { PiVault } from '../area.js';
import type { PiBrainRunResult, PiGateway } from '../gateway.js';
import { piCostDkk } from '../pricing.js';
import type { PiBrainRun } from '../turns.js';

/** A vault in memory with the same version rules as the real one: a write needs the current sha, a creation needs none. */
export function memoryVault(options: { failWrites?: () => boolean } = {}): PiVault & { readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  const sha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
  return {
    files,
    async read(path) {
      const content = files.get(path);
      return content === undefined ? null : { path, sha: sha(content), content };
    },
    async write(path, content, _message, expected) {
      if (options.failWrites?.()) throw new Error('vault unavailable');
      const current = files.get(path);
      if ((current === undefined) !== (expected === undefined) || (current !== undefined && sha(current) !== expected)) throw new VaultWriteConflictError();
      files.set(path, content);
      return sha(content);
    },
    async tree() { return [...files].map(([path, content]) => ({ path, sha: sha(content) })); },
    async move(from, to, content, expected) {
      if (files.get(from) === undefined || sha(files.get(from)!) !== expected || files.has(to)) throw new VaultWriteConflictError();
      files.delete(from);
      files.set(to, content);
      return sha(content);
    },
  };
}

/** A conversation store with one chat feed, enough for the brain's messages. */
export function memoryConversations(options: { empty?: boolean } = {}) {
  const messages: ConversationMessage[] = [];
  const addMessageInputs: Parameters<ConversationStore['addMessage']>[0][] = [];
  const proactiveReceipts = new Map<string, {
    ownerObjectId: string;
    runId: string;
    sessionId: string;
    messageId: string;
    textHash: string;
    text: string;
    evidence: readonly ProactiveConversationEvidence[];
    followUpIds: readonly string[];
    at: Date;
  }>();
  const sessions: ConversationSession[] = options.empty ? [] : [{ id: '7', channel: 'chat', language: 'en', startedAt: new Date('2026-11-01T00:00:00Z'), endedAt: new Date('2026-11-02T00:00:00Z') }];
  if (!options.empty) messages.push({ id: '1', sessionId: '7', role: 'dan', text: 'hi', model: null, at: new Date('2026-11-01T00:00:01Z') });
  const store = {
    getHistory: async () => ({
      messages: messages.slice(-1).map(message => ({ ...message, channel: 'chat', language: 'en', interrupted: false, voiceMinutes: null, toolCalls: [], attachments: [] })),
      nextCursor: null,
    }),
    getSession: async (id: string) => sessions.find(session => session.id === id) ?? null,
    createSession: async () => {
      const session: ConversationSession = { id: String(100 + sessions.length), channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null };
      sessions.push(session);
      return session;
    },
    addMessage: async (input: Parameters<ConversationStore['addMessage']>[0]) => {
      addMessageInputs.push(input);
      const session = sessions.find(candidate => candidate.id === input.sessionId);
      if (!session || (session.endedAt && !input.allowEndedSession)) return null;
      const message: ConversationMessage = { id: String(messages.length + 1), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, at: new Date() };
      messages.push(message);
      return message;
    },
  } as unknown as Pick<ConversationStore, 'getHistory' | 'getSession' | 'createSession' | 'addMessage'> & {
    addProactiveMessage: NonNullable<ConversationStore['addProactiveMessage']>;
  };
  const atomic = async (input: Parameters<NonNullable<ConversationStore['addProactiveMessage']>>[0]) => {
    const key = `${input.ownerObjectId.toLowerCase()}:${input.runId}:${input.textHash}`;
    const existing = proactiveReceipts.get(key);
    if (existing) {
      const message = messages.find((candidate) => candidate.id === existing.messageId);
      return message ? { status: 'existing' as const, message } : { status: 'session_missing' as const, message: null };
    }
    const today = [...proactiveReceipts.values()].filter((receipt) =>
      receipt.ownerObjectId.toLowerCase() === input.ownerObjectId.toLowerCase() &&
      receipt.at >= input.dayStart);
    if (today.some((receipt) => receipt.textHash === input.textHash)) {
      return { status: 'duplicate' as const, message: null };
    }
    if (today.length >= input.maxMessages) return { status: 'daily_limit' as const, message: null };
    const session = sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) return { status: 'session_missing' as const, message: null };
    if (input.replyNotification) {
      addMessageInputs.push({
        sessionId: input.sessionId,
        role: 'jarvis',
        text: input.text,
        model: input.model,
        language: input.language,
        allowEndedSession: true,
        replyNotification: input.replyNotification,
      });
    }
    const message = {
      id: String(messages.length + 1),
      sessionId: input.sessionId,
      role: 'jarvis' as const,
      text: input.text,
      model: input.model,
      at: input.at,
    };
    messages.push(message);
    proactiveReceipts.set(key, {
      ownerObjectId: input.ownerObjectId,
      runId: input.runId,
      sessionId: input.sessionId,
      messageId: message.id,
      textHash: input.textHash,
      text: input.text,
      evidence: input.evidence,
      followUpIds: input.followUpIds,
      at: input.at,
    });
    return { status: 'stored' as const, message };
  };
  Object.assign(store, { addProactiveMessage: atomic });
  return { store, messages, sessions, addMessageInputs, proactiveReceipts };
}

export interface ScriptedWake {
  readonly runId: string;
  readonly body: string;
  readonly run: PiBrainRun;
  readonly estimatedInputTokens: number;
}

/**
 * A stand-in for the model. `decide` plays the agent: it sees the wake text, may use the brain's tools through `run`, and
 * returns its closing statement. Tests use it to prove what the loop does with a decision, not what a real model decides.
 */
export function scriptedGateway(
  decide: (wake: ScriptedWake) => Promise<{
    text: string; tools?: PiBrainRunResult['toolResults']; fail?: boolean; inputTokens?: number; cachedTokens?: number; outputTokens?: number;
  }>,
): Pick<PiGateway, 'runBrain'> & { readonly wakes: ScriptedWake[] } {
  const wakes: ScriptedWake[] = [];
  return {
    wakes,
    async runBrain(input) {
      const run: PiBrainRun = {
        runId: input.runId, sent: [], wrote: [], looked: [],
        evidence: input.evidence ? [...input.evidence] : [],
      };
      // Offline proxy: ~16.5k for the harness envelope, plus a conservative 3 UTF-8 bytes per token for replay text.
      const estimatedInputTokens = 16_500 + Math.ceil(Buffer.byteLength(input.body, 'utf8') / 3);
      const wake = { runId: input.runId, body: input.body, run, estimatedInputTokens };
      wakes.push(wake);
      const decision = await decide(wake);
      const usage = { inputTokens: decision.inputTokens ?? estimatedInputTokens, cachedTokens: decision.cachedTokens ?? 0, outputTokens: decision.outputTokens ?? 300 };
      return {
        ok: decision.fail !== true, text: decision.text, usage, costDkk: piCostDkk(usage), estimated: false, outcome: decision.fail ? 'failed' : 'ok',
        firstTextMs: 900, totalMs: 4_000, toolResults: decision.tools ?? [], run,
        ...(decision.fail ? { error: new (class extends Error { code = 'pi_failed'; })('x') as never } : {}),
      } as PiBrainRunResult;
    },
  };
}
