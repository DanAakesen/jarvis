import type { ConversationAgent } from '../core/chat-agent.js';
import { PiGatewayError } from '../pi/errors.js';

/** A voice turn that has run this long is stopped and said so; the gateway's own deadline is longer than anyone waits on a call. */
export const PI_VOICE_TURN_DEADLINE_MS = 90_000;

const timeoutReply = 'PI took too long and was stopped. An action may already have completed; check its status before trying again.';
const failedReply = 'PI could not answer that. No other engine was used.';
const emptyReply = 'PI sent no answer. No other engine was used.';

/** The PI agent as the voice relay uses it: a turn, and an optional warm-up that primes the shared conversation. */
export interface PiVoiceAgent extends ConversationAgent {
  warm?(signal: AbortSignal): Promise<unknown>;
}

export interface PiVoiceTurn {
  readonly text: string;
  /** The stored owner message of this utterance; PI's tools attribute their writes to it. */
  readonly messageId: string;
  readonly sessionId: string;
  /** Native GPT-Live client-delegation identifier returned with any commentary for this turn. */
  readonly delegationId?: string;
  readonly proactiveContext?: string | undefined;
  /** `performance.now()` when the final transcript arrived, so the log can say how long Dan waited. */
  readonly startedAt: number;
}

export interface PiVoiceTurnLog {
  readonly outcome: 'ok' | 'failed' | 'timeout' | 'cancelled' | 'superseded';
  readonly transcriptToFirstTextMs: number | null;
  readonly transcriptToDoneMs: number;
  readonly acknowledged: boolean;
}

export interface PiVoiceTurnsOptions {
  readonly agent: PiVoiceAgent;
  /** Ends with the voice session. */
  readonly signal: AbortSignal;
  /** Hand a finished sentence to GPT-Live for the matching client delegation. */
  readonly speak: (text: string, delegationId?: string) => void;
  /** True while a PI turn is in flight, so the relay keeps the session open and shows that Jarvis is thinking. */
  readonly busy: (active: boolean) => void;
  /** End the live session when PI cannot produce an authoritative answer; never make GPT-Live invent a fallback. */
  readonly fail?: (reason: string) => void;
  readonly log: (turn: PiVoiceTurnLog) => void;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface PiVoiceTurns {
  /** Starts a turn. Earlier valid work may finish, but its answer is silenced when a newer utterance arrives. */
  start(turn: PiVoiceTurn): void;
  /** Dan started speaking: stop stale speech delivery without cancelling committed PI work. */
  cancel(): void;
  /** Primes the shared conversation when the voice session opens, so the first turn does not pay the cold start alone. */
  warm(): void;
}

/**
 * Every voice turn goes to the one PI agent, in its one long conversation. GPT-Live is only the ears and the voice: this
 * runs the turn and speaks PI's own short note before a tool call (if it wrote one), then its exact answer. PI failure ends
 * the voice session instead of manufacturing a spoken fallback.
 */
export function createPiVoiceTurns(options: PiVoiceTurnsOptions): PiVoiceTurns {
  const now = options.now ?? (() => performance.now());
  const deadlineMs = options.deadlineMs ?? PI_VOICE_TURN_DEADLINE_MS;
  let current: { readonly silence: () => void; readonly done: Promise<void> } | undefined;
  let running = 0;

  async function run(
    turn: PiVoiceTurn,
    previous: Promise<void> | undefined,
    delivery: { silenced: boolean },
  ): Promise<void> {
    // The gateway allows one request at a time. Earlier work is allowed to reach a durable result, then this turn runs.
    await previous;
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = AbortSignal.any([options.signal, deadline]);
    let outcome: PiVoiceTurnLog['outcome'];
    let firstTextMs: number | null = null;
    let acknowledged = false;
    let reply: string | undefined;
    let failureReason: string | undefined;
    try {
      if (signal.aborted) throw signal.reason;
      let partial = '';
      for await (const chunk of options.agent.stream({
        messageId: turn.messageId, sessionId: turn.sessionId, text: turn.text, channel: 'voice',
        ...(turn.proactiveContext ? { proactiveContext: turn.proactiveContext } : {}),
      }, '', signal)) {
        if (typeof chunk === 'string') {
          firstTextMs ??= Math.round(now() - turn.startedAt);
          partial += chunk;
          continue;
        }
        // The note before a tool call is also part of the streamed text; take it out of the answer wherever it sits. A note is
        // sent only for a short segment, so text before it may be an unannounced longer one that stays in the answer.
        const note = chunk.text.trimStart();
        const at = partial.indexOf(note);
        if (at >= 0) partial = partial.slice(0, at) + partial.slice(at + note.length);
        if (chunk.type === 'acknowledgment' && !acknowledged && chunk.text.trim() &&
            !signal.aborted && !delivery.silenced) {
          acknowledged = true;
          options.speak(chunk.text.trim(), turn.delegationId);
        }
      }
      reply = partial.trim();
      outcome = 'ok';
    } catch (error) {
      outcome = options.signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'failed';
      if (outcome === 'timeout') failureReason = timeoutReply;
      else if (outcome === 'failed') failureReason = error instanceof PiGatewayError ? error.userMessage : failedReply;
    }
    if (outcome === 'ok' && delivery.silenced) outcome = 'superseded';
    else if (outcome === 'ok' && !reply) { outcome = 'failed'; failureReason = emptyReply; }
    // Silencing interrupts playback only. The request and any committed work keep their own authority and receipt.
    if (reply && !options.signal.aborted && !delivery.silenced) {
      options.speak(reply, turn.delegationId);
    } else if (outcome === 'failed' || outcome === 'timeout') {
      options.fail?.(failureReason ?? failedReply);
    }
    options.log({ outcome, transcriptToFirstTextMs: firstTextMs, transcriptToDoneMs: Math.round(now() - turn.startedAt), acknowledged });
  }

  return {
    start(turn) {
      const previous = current;
      previous?.silence();
      const delivery = { silenced: false };
      running += 1;
      options.busy(true);
      const done = run(turn, previous?.done, delivery).catch(() => undefined).finally(() => {
        running -= 1;
        if (current?.done === done) current = undefined;
        if (running === 0) options.busy(false);
      });
      current = { silence: () => { delivery.silenced = true; }, done };
    },
    cancel() { current?.silence(); },
    warm() {
      const warm = options.agent.warm;
      if (!warm) return;
      // Spends nothing when the conversation is fresh or the cap is reached; a failure here is not Dan's to hear about, his turn will say it.
      void warm.call(options.agent, options.signal).catch(() => undefined);
    },
  };
}
