import { failureCopy } from '@jarvis/contracts';
import { PiGatewayError } from '../pi/errors.js';
import type { PiGateway } from '../pi/gateway.js';

/** A voice turn that has run this long is stopped and said so; the gateway's own deadline is longer than anyone waits on a call. */
export const PI_VOICE_TURN_DEADLINE_MS = 90_000;
const superseded = new DOMException('Voice turn superseded', 'AbortError');

/** The PI agent as the voice relay uses it: a turn, and an optional warm-up that primes the shared conversation. */
export interface PiVoiceAgent {
  stream: PiGateway['stream'];
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
  readonly log: (turn: PiVoiceTurnLog) => void;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface PiVoiceTurns {
  /** Starts a turn. A turn still in flight is cancelled first: the newest utterance wins. */
  start(turn: PiVoiceTurn): void;
  /** Stops the turn in flight and says nothing more. Speech never calls this; only the session ending does, as the relay's explicit stop. */
  cancel(): void;
  /** Primes the shared conversation when the voice session opens, so the first turn does not pay the cold start alone. */
  warm(): void;
}

/**
 * Every voice turn goes to the one PI agent, in its one long conversation. GPT-Live is only the ears and the voice: this
 * runs the turn, speaks PI's own short note before a tool call (if it wrote one) and then its answer, and says failures
 * plainly. Nothing here answers for PI and nothing falls back to another engine.
 */
export function createPiVoiceTurns(options: PiVoiceTurnsOptions): PiVoiceTurns {
  const now = options.now ?? (() => performance.now());
  const deadlineMs = options.deadlineMs ?? PI_VOICE_TURN_DEADLINE_MS;
  let current: AbortController | undefined;
  let running = 0;

  async function run(turn: PiVoiceTurn, controller: AbortController): Promise<void> {
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = AbortSignal.any([options.signal, controller.signal, deadline]);
    let outcome: PiVoiceTurnLog['outcome'];
    let firstTextMs: number | null = null;
    let acknowledged = false;
    let timeoutSpoken = false;
    let reply: string | undefined;
    try {
      signal.throwIfAborted();
      let partial = '';
      for await (const chunk of options.agent.stream({
        messageId: turn.messageId, sessionId: turn.sessionId, text: turn.text, channel: 'voice',
        ...(turn.proactiveContext ? { proactiveContext: turn.proactiveContext } : {}),
        onTurnDeadline(text) {
          if (timeoutSpoken || options.signal.aborted || controller.signal.aborted) return;
          timeoutSpoken = true;
          options.speak(text, turn.delegationId);
        },
      }, '', signal)) {
        signal.throwIfAborted();
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
        if (chunk.type === 'acknowledgment' && !acknowledged && chunk.text.trim() && at >= 0) {
          acknowledged = true;
          options.speak(chunk.text.trim(), turn.delegationId);
        }
      }
      signal.throwIfAborted();
      reply = partial.trim();
      outcome = 'ok';
    } catch (error) {
      if (options.signal.aborted) outcome = 'cancelled';
      else if (controller.signal.aborted) outcome = controller.signal.reason === superseded ? 'superseded' : 'cancelled';
      else {
        const gatewayFailure = error instanceof PiGatewayError ? error : undefined;
        outcome = deadline.aborted || gatewayFailure?.code === 'pi_timeout' ? 'timeout' : 'failed';
        reply = gatewayFailure?.spokenMessage ?? (outcome === 'timeout' ? failureCopy.took_too_long.voice : failureCopy.cut_off.voice);
      }
    }
    if (outcome === 'ok' && !reply) { outcome = 'failed'; reply = failureCopy.no_reply.voice; }
    // A cancelled or superseded turn says nothing: the session ended, or Dan has already moved on.
    if (reply && !timeoutSpoken && !options.signal.aborted && !controller.signal.aborted) options.speak(reply, turn.delegationId);
    options.log({ outcome, transcriptToFirstTextMs: firstTextMs, transcriptToDoneMs: Math.round(now() - turn.startedAt), acknowledged });
  }

  return {
    start(turn) {
      current?.abort(superseded);
      const controller = new AbortController();
      current = controller;
      running += 1;
      options.busy(true);
      void run(turn, controller).catch(() => undefined).finally(() => {
        running -= 1;
        if (current === controller) current = undefined;
        if (running === 0) options.busy(false);
      });
    },
    cancel() { current?.abort(); },
    warm() {
      const warm = options.agent.warm;
      if (!warm) return;
      // Spends nothing when the conversation is fresh or the cap is reached; a failure here is not Dan's to hear about, his turn will say it.
      void warm.call(options.agent, options.signal).catch(() => undefined);
    },
  };
}
