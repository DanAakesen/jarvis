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
  /** Hand a finished sentence to Voice Live, which only reads it out. */
  readonly speak: (text: string) => void;
  /** True while a PI turn is in flight, so the relay keeps the session open and shows that Jarvis is thinking. */
  readonly busy: (active: boolean) => void;
  readonly log: (turn: PiVoiceTurnLog) => void;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface PiVoiceTurns {
  /** Starts a turn. A turn still in flight is cancelled first: the newest utterance wins. */
  start(turn: PiVoiceTurn): void;
  /** Dan started speaking: the turn in flight is cancelled and says nothing more, so no stale answer lands on top of him. */
  cancel(): void;
  /** Primes the shared conversation when the voice session opens, so the first turn does not pay the cold start alone. */
  warm(): void;
}

/**
 * Every voice turn goes to the one PI agent, in its one long conversation. Voice Live is only the ears and the voice: this
 * runs the turn, speaks PI's own short note before a tool call (if it wrote one) and then its answer, and says failures
 * plainly. Nothing here answers for PI and nothing falls back to another engine.
 */
export function createPiVoiceTurns(options: PiVoiceTurnsOptions): PiVoiceTurns {
  const now = options.now ?? (() => performance.now());
  const deadlineMs = options.deadlineMs ?? PI_VOICE_TURN_DEADLINE_MS;
  let current: { readonly cancel: () => void; readonly done: Promise<void> } | undefined;
  let running = 0;

  async function run(turn: PiVoiceTurn, previous: Promise<void> | undefined, controller: AbortController): Promise<void> {
    // The gateway allows one request at a time on the conversation: let the cancelled turn finish closing first.
    await previous;
    const superseded = () => controller.signal.aborted && !options.signal.aborted;
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = AbortSignal.any([options.signal, controller.signal, deadline]);
    let outcome: PiVoiceTurnLog['outcome'];
    let firstTextMs: number | null = null;
    let acknowledged = false;
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
        // The note before a tool call is also part of the streamed text; take it out of the answer either way.
        const interim = partial.trimStart();
        if (!interim.startsWith(chunk.text.trimStart())) throw new Error('PI progress note did not match the streamed reply');
        partial = interim.slice(chunk.text.trimStart().length);
        if (chunk.type === 'acknowledgment' && !acknowledged && chunk.text.trim() && !signal.aborted) {
          acknowledged = true;
          options.speak(chunk.text.trim());
        }
      }
      reply = partial.trim();
      outcome = 'ok';
    } catch (error) {
      outcome = options.signal.aborted ? 'cancelled' : superseded() ? 'superseded' : deadline.aborted ? 'timeout' : 'failed';
      if (outcome === 'timeout') reply = timeoutReply;
      else if (outcome === 'failed') reply = error instanceof PiGatewayError ? error.userMessage : failedReply;
    }
    if (outcome === 'ok' && !reply) { outcome = 'failed'; reply = emptyReply; }
    // A cancelled or superseded turn says nothing: the session ended, or Dan has already moved on.
    if (reply && !options.signal.aborted && !superseded()) options.speak(reply);
    options.log({ outcome, transcriptToFirstTextMs: firstTextMs, transcriptToDoneMs: Math.round(now() - turn.startedAt), acknowledged });
  }

  return {
    start(turn) {
      const previous = current;
      previous?.cancel();
      const controller = new AbortController();
      running += 1;
      options.busy(true);
      const done = run(turn, previous?.done, controller).catch(() => undefined).finally(() => {
        running -= 1;
        if (current?.done === done) current = undefined;
        if (running === 0) options.busy(false);
      });
      current = { cancel: () => controller.abort(), done };
    },
    cancel() { current?.cancel(); },
    warm() {
      const warm = options.agent.warm;
      if (!warm) return;
      // Spends nothing when the conversation is fresh or the cap is reached; a failure here is not Dan's to hear about, his turn will say it.
      void warm.call(options.agent, options.signal).catch(() => undefined);
    },
  };
}
