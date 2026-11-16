import { createHash, randomUUID } from 'node:crypto';
import type { ConversationStore } from '../../core/conversation-store.js';
import type { PiStore } from '../store.js';
import { copenhagenDayStart } from '../../proactive/time.js';
import { shouldRedact } from '../../vault/index.js';
import type { PiBrainRun } from '../turns.js';

/** An exact guard on how often the brain may speak on its own. A chat message always pushes, so the limit is on messages. */
export const MAX_BRAIN_MESSAGES_PER_DAY = 8;
export const MAX_BRAIN_MESSAGE_CHARACTERS = 1_500;

export class BrainCommsRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainCommsRefusal';
  }
}

export interface BrainCommsOptions {
  readonly conversations: Pick<ConversationStore, 'getHistory' | 'getSession' | 'createSession' | 'addMessage'>;
  readonly store: Pick<PiStore, 'recordMessage' | 'messagesSince'>;
  readonly ownerObjectId: string;
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
  return {
    async send(input: { readonly text: string }, run: PiBrainRun, signal: AbortSignal): Promise<{ messageId: string; sessionId: string }> {
      const text = input.text.trim();
      if (!text) throw new BrainCommsRefusal('The message is empty. Nothing was sent.');
      if (Array.from(text).length > MAX_BRAIN_MESSAGE_CHARACTERS) {
        throw new BrainCommsRefusal(`The message is longer than ${MAX_BRAIN_MESSAGE_CHARACTERS} characters. Say less. Nothing was sent.`);
      }
      if (shouldRedact(text)) throw new BrainCommsRefusal('Secrets and credentials are never sent. Nothing was sent.');
      const day = await options.store.messagesSince(copenhagenDayStart(options.now()), signal);
      if (day.count >= MAX_BRAIN_MESSAGES_PER_DAY) {
        throw new BrainCommsRefusal(`I have already messaged Dan ${MAX_BRAIN_MESSAGES_PER_DAY} times today, which is the limit. Nothing was sent; put it in a note for tomorrow.`);
      }
      const textHash = hash(text);
      if (day.textHashes.includes(textHash)) throw new BrainCommsRefusal('Dan was already told exactly this today. Nothing was sent.');

      // The owner has one chat feed: the message goes into the session of the latest message, or into a new one when there is none.
      const latest = (await options.conversations.getHistory({ limit: 1, excludeRuntimeTests: true })).messages[0];
      const session = latest
        ? await options.conversations.getSession(latest.sessionId)
        : await options.conversations.createSession({ channel: 'chat', language: 'en', ownerObjectId: options.ownerObjectId });
      if (!session) throw new BrainCommsRefusal('The chat session could not be found. Nothing was sent.');
      const message = await options.conversations.addMessage({
        signal, sessionId: session.id, role: 'jarvis', text, model: 'pi', language: session.language, allowEndedSession: true,
      });
      if (!message) throw new BrainCommsRefusal('The chat could not store the message. Nothing was sent.');
      run.sent.push({ title: null, text, messageId: message.id });
      // The message is Dan's now; bookkeeping must not make the brain send it again.
      await options.store.recordMessage({ runId: run.runId, sessionId: session.id, messageId: message.id, textHash }, options.now(), AbortSignal.timeout(10_000))
        .catch(() => undefined);
      options.announce();
      options.push({ sessionId: session.id, messageId: message.id, text });
      return { messageId: message.id, sessionId: session.id };
    },
  };
}

export type BrainComms = ReturnType<typeof createBrainComms>;
export const newRunId = () => randomUUID();
