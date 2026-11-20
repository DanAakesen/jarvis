import { createHash, randomUUID } from 'node:crypto';
import type { ConversationStore } from '../../core/conversation-store.js';
import type { PiProactiveEvidence } from '../store.js';
import { copenhagenDayStart } from '../../proactive/time.js';
import { shouldRedact } from '../../vault/index.js';
import type { PiBrainRun } from '../turns.js';

/** An exact guard on how often the brain may speak on its own. A chat message always pushes, so the limit is on messages. */
export const MAX_BRAIN_MESSAGES_PER_DAY = 8;
export const MAX_BRAIN_MESSAGE_CHARACTERS = 1_500;

export class BrainCommsRefusal extends Error {
  /** `duplicate`: Dan already has exactly this today. Anything else is a refusal that may pass later. */
  constructor(message: string, readonly reason: 'duplicate' | 'other' = 'other') {
    super(message);
    this.name = 'BrainCommsRefusal';
  }
}

export interface BrainCommsOptions {
  readonly conversations: Pick<ConversationStore, 'getHistory' | 'getSession' | 'createSession' | 'addMessage'> & {
    readonly addProactiveMessage?: ConversationStore['addProactiveMessage'];
  };
  readonly ownerObjectId: string;
  readonly pushEnabled?: boolean;
  /** The one push path of a finished chat message (iOS push, mirrored to the Watch by the phone). Called exactly once per message. */
  readonly push: (message: { sessionId: string; messageId: string; text: string }) => void;
  /** Tells an open app to refresh its chat history. */
  readonly announce: () => void;
  readonly now: () => Date;
}

const hash = (text: string) => createHash('sha256').update(text.trim().replace(/\s+/gu, ' ').toLowerCase()).digest('hex');

/**
 * The brain's voice: a chat message from Jarvis, stored in the owner's conversation and pushed. There are no tiers and no
 * second channel: what the brain decides to say is a chat message, and a chat message always pushes. A message that cannot be
 * stored is not pushed, and a failure is reported, never swallowed.
 */
export function createBrainComms(options: BrainCommsOptions) {
  // Admission (the daily count and the repeat check) and recording must not interleave, or parallel sends would all pass.
  let admission: Promise<unknown> = Promise.resolve();
  async function admit(input: {
    readonly text: string;
    readonly evidence?: readonly PiProactiveEvidence[] | Readonly<Record<string, unknown>>;
    readonly followUpIds?: readonly string[];
    readonly notificationEvidence?: Readonly<Record<string, unknown>>;
  }, run: PiBrainRun, signal: AbortSignal): Promise<{ messageId: string; sessionId: string }> {
    const at = options.now();
    const text = input.text.trim();
    if (!text) throw new BrainCommsRefusal('The message is empty. Nothing was sent.');
    if (Array.from(text).length > MAX_BRAIN_MESSAGE_CHARACTERS) {
      throw new BrainCommsRefusal(`The message is longer than ${MAX_BRAIN_MESSAGE_CHARACTERS} characters. Say less. Nothing was sent.`);
    }
    if (shouldRedact(text)) throw new BrainCommsRefusal('Secrets and credentials are never sent. Nothing was sent.');
    const textHash = hash(text);
    const evidence = (Array.isArray(input.evidence) ? input.evidence : []).map((entry) => ({
      ...entry,
      origin: entry.origin ?? 'event',
      materialHash: entry.materialHash ?? null,
    }));
    if (!options.conversations.addProactiveMessage) {
      throw new BrainCommsRefusal('The chat continuation ledger is unavailable, so nothing was sent.');
    }

    // The owner has one chat feed: the message goes into the session of the latest message, or into a new one when there is none.
    const latest = (await options.conversations.getHistory({ limit: 1, excludeRuntimeTests: true })).messages[0];
    const session = latest
      ? await options.conversations.getSession(latest.sessionId)
      : await options.conversations.createSession({ channel: 'chat', language: 'en', ownerObjectId: options.ownerObjectId });
    if (!session) throw new BrainCommsRefusal('The chat session could not be found. Nothing was sent.');
    let message: Awaited<ReturnType<ConversationStore['addMessage']>>;
    let newlyStored: boolean;
    const notificationEvidence: Readonly<Record<string, unknown>> | undefined =
      input.notificationEvidence ??
      (input.evidence !== undefined && !Array.isArray(input.evidence)
        ? input.evidence as Readonly<Record<string, unknown>>
        : undefined);
    {
      const atomic = await options.conversations.addProactiveMessage({
        signal,
        sessionId: session.id,
        text,
        model: 'pi',
        language: session.language,
        ownerObjectId: options.ownerObjectId,
        runId: run.runId,
        textHash,
        evidence,
        followUpIds: input.followUpIds ?? [],
        ...(options.pushEnabled === false ? {} : {
          replyNotification: {
            ownerObjectId: options.ownerObjectId,
            ...(notificationEvidence === undefined ? {} : { evidence: notificationEvidence }),
          },
        }),
        at,
        dayStart: copenhagenDayStart(at),
        maxMessages: MAX_BRAIN_MESSAGES_PER_DAY,
      });
      if (atomic.status === 'daily_limit') {
        throw new BrainCommsRefusal(`I have already messaged Dan ${MAX_BRAIN_MESSAGES_PER_DAY} times today, which is the limit. Nothing was sent; put it in a note for tomorrow.`);
      }
      if (atomic.status === 'duplicate') {
        throw new BrainCommsRefusal('Dan was already told exactly this today. Nothing was sent.', 'duplicate');
      }
      if (atomic.status === 'session_missing') {
        throw new BrainCommsRefusal('The chat session could not be found. Nothing was sent.');
      }
      message = atomic.message;
      newlyStored = atomic.status === 'stored';
    }
    if (!message) throw new BrainCommsRefusal('The chat could not store the message. Nothing was sent.');
    if (newlyStored) {
      run.sent.push({ title: null, text, messageId: message.id });
      options.announce();
      if (options.pushEnabled !== false) {
        options.push({ sessionId: session.id, messageId: message.id, text });
      }
    }
    return { messageId: message.id, sessionId: session.id };
  }
  return {
    send(input: {
      readonly text: string;
      readonly evidence?: readonly PiProactiveEvidence[] | Readonly<Record<string, unknown>>;
      readonly followUpIds?: readonly string[];
      readonly notificationEvidence?: Readonly<Record<string, unknown>>;
    }, run: PiBrainRun, signal: AbortSignal): Promise<{ messageId: string; sessionId: string }> {
      const turn = admission.then(() => admit(input, run, signal), () => admit(input, run, signal));
      admission = turn.catch(() => undefined);
      return turn;
    },
  };
}

export type BrainComms = ReturnType<typeof createBrainComms>;
export const newRunId = () => randomUUID();
