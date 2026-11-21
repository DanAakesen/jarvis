import { composeNote, inboxDate, inboxPath } from '../../../inbox/note.js';
import { createInboxStore } from '../../../inbox/store.js';
import { createPiArea } from '../../area.js';
import { memoryConversations, memoryVault } from '../../brain/brain.testkit.js';
import { createBrainComms } from '../../brain/comms.js';
import { createMemoryPiStore } from '../../store.js';
import type { PiTurnRegistry } from '../../turns.js';
import { composeWatch } from '../../watch/note.js';
import { createWatches } from '../../watch/store.js';
import type { ConformanceContext } from '../types.testkit.js';
import { piClock } from './pi-situation.testkit.js';

const hour = 60 * 60_000;

/** Open watches the cases act on. Each tool case has its own, so the result never depends on which case ran before. */
export const seededWatches = {
  lookInWake: 'Deploy of main',
  updateInChat: 'Flight price',
  updateInWake: 'Parcel from the post office',
  stopInChat: 'Train to Aarhus',
  stopInWake: 'Weather on Saturday',
} as const;

/** The inbox item `inbox_trail` writes to (the hidden id a real item carries). */
export const seededInboxItemId = '0a1b2c3d4e5f';

/**
 * What a background wake and the standing watches run on: a vault in memory (PI's own corner and the inbox live in it, as in
 * production), the brain's chat voice over a conversation with its proactive ledger, and the watch ledger in memory.
 */
export function createBrainFixture(context: ConformanceContext, registry: PiTurnRegistry) {
  const vault = memoryVault();
  const conversations = memoryConversations();
  /** Chat messages the brain pushed to Dan's phone, as the push hook received them. */
  const pushes: { sessionId: string; messageId: string; text: string }[] = [];
  const comms = createBrainComms({
    conversations: conversations.store, ownerObjectId: context.owner, pushEnabled: true,
    push: (message) => { pushes.push(message); }, announce: () => {}, now: () => piClock,
  });
  const area = createPiArea({ vault });
  const inbox = createInboxStore({ vault, now: () => piClock });
  const watches = createWatches({ area, store: createMemoryPiStore(() => piClock), now: () => piClock });

  vault.files.set(inboxPath(inboxDate(piClock), 'Garden plan'), composeNote({ title: 'Garden plan', note: 'Decide where the raised beds go.' }, seededInboxItemId, piClock));
  for (const [index, title] of Object.values(seededWatches).entries()) {
    vault.files.set(`PI/Watches/${title}.md`, composeWatch({ title, text: `Keep an eye on: ${title.toLowerCase()}.`, at: piClock, nextLook: new Date(piClock.getTime() + (index + 1) * hour) }));
  }
  return { registry, vault, conversations, pushes, comms, area, inbox, watches };
}

export type BrainFixture = ReturnType<typeof createBrainFixture>;
