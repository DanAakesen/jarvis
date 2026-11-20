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
  /** Hand speakable PI output to the voice transport. */
  readonly speak: (text: string) => void;
  /** True while a PI turn is in flight, so the relay keeps the session open and shows that Jarvis is thinking. */
  readonly busy: (active: boolean) => void;
  readonly log: (turn: PiVoiceTurnLog) => void;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface PiVoiceTurns {
  /** Queues a turn behind any active work; a stale transcript can run without speaking. */
  start(turn: PiVoiceTurn, muted?: boolean): void;
  /** Suppresses future speech from already admitted turns without aborting them. */
  suppressSpeech(): void;
  /** Explicitly cancels active and queued PI work. */
  cancel(): void;
  /** Primes the shared conversation when the voice session opens, so the first turn does not pay the cold start alone. */
  warm(): void;
}

/**
 * Voice turns share one PI conversation. The output generation controls speech
 * independently of the signals that bound PI work.
 */
export function createPiVoiceTurns(options: PiVoiceTurnsOptions): PiVoiceTurns {
  const now = options.now ?? (() => performance.now());
  const deadlineMs = options.deadlineMs ?? PI_VOICE_TURN_DEADLINE_MS;
  let tail: Promise<void> | undefined;
  let speechGeneration = 0;
  const pending = new Set<AbortController>();

  async function run(turn: PiVoiceTurn, previous: Promise<void> | undefined, controller: AbortController, output: number): Promise<void> {
    await previous;
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = AbortSignal.any([options.signal, controller.signal, deadline]);
    const canSpeak = () => output === speechGeneration && !options.signal.aborted && !controller.signal.aborted;
    let outcome: PiVoiceTurnLog['outcome'];
    let firstTextMs: number | null = null;
    let acknowledged = false;
    let quiet = false;
    let reply: string | undefined;
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
        if (chunk.type === 'quiet') quiet = true;
        if (chunk.type === 'progress' && !acknowledged && chunk.text.trim() && !signal.aborted && canSpeak()) {
          acknowledged = true;
          options.speak(chunk.text.trim());
        }
      }
      signal.throwIfAborted();
      reply = partial.trim();
      outcome = 'ok';
    } catch (error) {
      outcome = options.signal.aborted || controller.signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'failed';
      if (outcome === 'timeout') reply = timeoutReply;
      else if (outcome === 'failed') reply = error instanceof PiGatewayError ? error.userMessage : failedReply;
    }
    if (outcome === 'ok' && !reply && !quiet) { outcome = 'failed'; reply = emptyReply; }
    if (reply && canSpeak()) options.speak(reply);
    options.log({ outcome, transcriptToFirstTextMs: firstTextMs, transcriptToDoneMs: Math.round(now() - turn.startedAt), acknowledged });
  }

  return {
    start(turn, muted = false) {
      if (options.signal.aborted) return;
      const controller = new AbortController();
      const output = muted ? -1 : ++speechGeneration;
      const wasIdle = pending.size === 0;
      pending.add(controller);
      const done = run(turn, tail, controller, output).catch(() => undefined).finally(() => {
        pending.delete(controller);
        if (tail === done) tail = undefined;
        if (pending.size === 0) options.busy(false);
      });
      tail = done;
      if (wasIdle) options.busy(true);
    },
    suppressSpeech() { speechGeneration += 1; },
    cancel() {
      for (const controller of pending) controller.abort();
    },
    warm() {
      const warm = options.agent.warm;
      if (!warm) return;
      // Spends nothing when the conversation is fresh or the cap is reached; a failure here is not Dan's to hear about, his turn will say it.
      void warm.call(options.agent, options.signal).catch(() => undefined);
    },
  };
}
