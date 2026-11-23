import { expect } from 'vitest';
import { createProactiveMessageFeedbackTool } from '../../../proactive/feedback-tool.js';
import { createBrainTools } from '../../brain/tools.js';
import { createSituationTools } from '../../situation-tools.js';
import { createMemoryPiStore } from '../../store.js';
import { createWatchTools } from '../../watch/tools.js';
import { createStorageQueueTools } from '../../storage-queue-tools.js';
import { ownerMessageSource } from '../shared.testkit.js';
import type { ConformanceContext, ConformanceGroup, GroupFactory, ToolCase } from '../types.testkit.js';
import { createBrainFixture, seededInboxItemId, seededWatches } from './pi-brain.testkit.js';
import { createSituationFixture, piClock } from './pi-situation.testkit.js';

const clockIso = piClock.toISOString();
const inAnHour = new Date(piClock.getTime() + 60 * 60_000).toISOString();
const noActivationText = 'This tool needs a live PI activation. Nothing was done.';

/**
 * The PI-only tools: situation tools (an activation turn), the brain's tools (a background wake) and standing watches. The MCP
 * door itself is composed by the world; this group contributes the tools production adds to the `pi` module, built over the
 * production services with in-memory stores. Their turn authority comes from the same registry the door resolves turns in.
 *
 * `group.cases` are the successful calls: the suite reports a tool as `ok` only when every case of it is. `probes` are the
 * calls that must be refused or fail in plain English (pi-edges.test.ts runs them), and the fixtures come back so a test can
 * look at what a call left behind (a push, a note) or take a dependency down.
 */
export function createPiGroup(context: ConformanceContext) {
  const registry = context.registry;
  if (!registry) throw new Error('The PI conformance group needs the turn registry the MCP door uses (ConformanceContext.registry).');
  const situation = createSituationFixture(context);
  // The brain reads the situation too, but a wake and an activation never share state here: a commit must not change what a wake may cite.
  const wakeSituation = createSituationFixture(context);
  const brain = createBrainFixture(context);
  const now = () => piClock;
  const feedbackStore = createMemoryPiStore(now);
  const storageQueueService = {
    listQueues: () => ({ byPage: () => ({ [Symbol.asyncIterator]: async function* () {
      yield { queueItems: [{ name: 'events' }], continuationToken: undefined };
    } }) }),
    getQueueClient: () => ({
      getProperties: async () => ({ approximateMessagesCount: 1 }),
      createIfNotExists: async () => ({ succeeded: true }),
      delete: async () => ({}),
      deleteMessage: async () => ({}),
      sendMessage: async () => ({ messageId: 'queue-message-1' }),
      peekMessages: async () => ({ peekedMessageItems: [{ messageId: 'queue-message-1', messageText: 'status' }] }),
      receiveMessages: async () => ({ receivedMessageItems: [{ messageId: 'queue-message-1', popReceipt: 'receipt-1', messageText: 'status' }] }),
    }),
  };
  const proactiveMessageId = '43';
  void feedbackStore.recordMessage({
    ownerObjectId: context.owner, runId: 'fixture-wake', sessionId: context.ownerMessage.sessionId,
    messageId: proactiveMessageId, textHash: 'a'.repeat(64), text: 'The parcel is ready to collect.',
  }, piClock, new AbortController().signal);

  const locationEvidence = {
    source: 'location', ref: null, identity: 'location:device', label: 'Near Copenhagen', observedAt: clockIso, verifiedAt: clockIso,
  };
  const messageDan = (text: string, extra: Record<string, unknown> = {}) => ({
    text, category: 'status', suggestionScope: 'unknown', evidenceSources: ['location'], evidence: [locationEvidence], ...extra,
  });
  const patchLocation = () => situation.current({ get patch() { return situation.locationPatch(); } });
  const wakeRefused = (label: string, args: Record<string, unknown>): ToolCase => ({ label, arguments: args, turn: 'wake', expect: 'refused' });
  const noActivation = (label: string, args: Record<string, unknown>): ToolCase => ({
    label, arguments: args, turn: 'chat', expect: 'refused', check: (result) => expect(result).toMatchObject({ refused: noActivationText }),
  });

  const cases: Record<string, readonly ToolCase[]> = {
    azure_storage_queue_names: [{ label: 'one bounded page of Jarvis queues', arguments: {}, check: (result) => expect(result).toMatchObject({ queues: ['events'] }) }],
    azure_storage_queue_properties: [{ label: 'queue count', arguments: { queue: 'events' }, check: (result) => expect(result).toMatchObject({ approximateMessagesCount: 1 }) }],
    azure_storage_queue_create: [{ label: 'create a Jarvis queue', arguments: { queue: 'events' }, check: (result) => expect(result).toMatchObject({ created: true }) }],
    azure_storage_queue_send: [{ label: 'send a short message', arguments: { queue: 'events', message: 'status' }, check: (result) => expect(result).toMatchObject({ queued: true, messageId: expect.any(String) }) }],
    azure_storage_queue_peek: [{ label: 'peek without consuming', arguments: { queue: 'events' }, check: (result) => expect(result).toMatchObject({ messages: [{ messageText: 'status' }] }) }],
    azure_storage_queue_receive: [{ label: 'explicitly receive and temporarily hide a message', arguments: { queue: 'events' }, check: (result) => expect(result).toMatchObject({ messages: [{ messageId: 'queue-message-1', popReceipt: 'receipt-1' }] }) }],
    situation_read: [
      { label: 'the current situational state', arguments: {}, check: (result) => expect(result).toMatchObject({ revision: expect.any(Number), hash: expect.any(String), state: expect.objectContaining({ version: 1 }) }) },
    ],
    situation_lookup: [
      { label: 'one live location record', arguments: { source: 'location', ref: 'location:device' }, check: (result) => expect(result).toMatchObject({ source: 'location', verifiedRef: expect.objectContaining({ source: 'location' }) }) },
    ],
    situation_patch: [
      { label: 'record the location with a fact, a follow-up and a summary', arguments: patchLocation(), check: (result) => expect(result).toMatchObject({ committed: true, changed: true }) },
      { label: 'the same patch again changes nothing', arguments: patchLocation(), check: (result) => expect(result).toMatchObject({ committed: false, changed: false }) },
    ],
    situation_commit: [
      { label: 'replace the state with a complete bounded one', arguments: situation.current({ state: situation.bareState() }), check: (result) => expect(result).toMatchObject({ committed: true, revision: expect.any(Number) }) },
    ],
    message_dan: [
      {
        label: 'tell Dan, citing the evidence the situation holds', turn: 'wake',
        arguments: messageDan('You are near Copenhagen, and the parcel you were waiting for is ready to collect at the pick-up point.'),
        check: (result) => { expect(result).toMatchObject({ sent: true, messageId: expect.any(String) }); expect(brain.pushes.length).toBeGreaterThan(0); },
      },
    ],
    proactive_message_feedback: [{
      label: 'rate the exact notification from chat', ownerMessage: 'That parcel alert was useful.',
      arguments: { messageId: proactiveMessageId, rating: 'useful' },
      check: (result) => expect(result).toMatchObject({ saved: true, messageId: proactiveMessageId, rating: 'useful' }),
    }],
    pi_note: [
      { label: 'append a dated block to a new note', turn: 'wake', arguments: { name: 'Waiting for', text: 'The parcel from the post office, expected this week.' }, check: (result) => expect(result).toMatchObject({ path: 'PI/Notes/Waiting for.md', created: true }) },
      { label: 'append to the same note again', turn: 'wake', arguments: { name: 'Waiting for', text: 'The parcel arrived at the post office.', mode: 'append' }, check: (result) => expect(result).toMatchObject({ created: false }) },
      { label: 'replace the whole note', turn: 'wake', arguments: { name: 'Waiting for', text: 'Nothing is pending.', mode: 'replace' }, check: (result) => expect(result).toMatchObject({ path: 'PI/Notes/Waiting for.md' }) },
    ],
    inbox_trail: [
      { label: 'add a trail line to an open item', turn: 'wake', arguments: { id: seededInboxItemId, line: 'Nudged Dan about it this morning.' }, check: (result) => expect(result).toMatchObject({ path: expect.stringContaining('Inbox/') }) },
    ],
    watch_create: [
      {
        label: 'in chat, quoting Dan', ownerMessage: 'Please keep me updated on the deploy of main, every half hour.',
        arguments: { title: 'Deploy of main status', text: 'Tell me when the deploy of main is green. Look every half hour.', nextLook: inAnHour },
        check: (result) => {
          expect(result).toMatchObject({ created: true, name: 'Deploy of main status', nextLook: inAnHour });
          expect(brain.vault.files.get('PI/Watches/Deploy of main status.md')).toContain('Please keep me updated on the deploy of main');
        },
      },
      { label: 'in a wake, events only', turn: 'wake', arguments: { title: 'Price of the flight', text: 'Watch the price of the flight to Berlin.', nextLook: 'none' }, check: (result) => expect(result).toMatchObject({ created: true, nextLook: null }) },
    ],
    watch_list: [
      { label: 'the open watches', arguments: {}, check: (result) => expect(result).toMatchObject({ watches: expect.arrayContaining([expect.objectContaining({ name: seededWatches.lookInWake })]) }) },
      { label: 'the open watches in a wake', turn: 'wake', arguments: {}, check: (result) => expect(result).toMatchObject({ watches: expect.any(Array) }) },
    ],
    watch_update: [
      { label: 'in chat, a new cadence', ownerMessage: 'Check the flight price every hour instead.', arguments: { name: seededWatches.updateInChat, change: 'Look every hour instead.', nextLook: inAnHour }, check: (result) => expect(result).toMatchObject({ updated: true }) },
      { label: 'in a wake, events only', turn: 'wake', arguments: { name: seededWatches.updateInWake, change: 'The post office sends an event when it arrives.', nextLook: 'none' }, check: (result) => expect(result).toMatchObject({ updated: true }) },
    ],
    watch_stop: [
      { label: 'in chat, when Dan says stop', ownerMessage: 'Stop watching the train to Aarhus.', arguments: { name: seededWatches.stopInChat, reason: 'Dan said to stop.' }, check: (result) => expect(result).toMatchObject({ stopped: true, closedAs: seededWatches.stopInChat }) },
      { label: 'in a wake, when the stop condition is met', turn: 'wake', arguments: { name: seededWatches.stopInWake, reason: 'Saturday has passed.' }, check: (result) => expect(result).toMatchObject({ stopped: true }) },
    ],
    watch_look: [
      { label: 'record a look and the next one', turn: 'wake', arguments: { name: seededWatches.lookInWake, result: 'The deploy of main is still running.', nextLook: inAnHour }, check: (result) => expect(result).toMatchObject({ recorded: true, nextLook: inAnHour }) },
    ],
  };

  const probes: Record<string, readonly ToolCase[]> = {
    situation_read: [noActivation('a chat turn has no PI activation', {})],
    situation_lookup: [
      { label: 'a reference the provider no longer has', arguments: { source: 'location', ref: 'location:elsewhere' }, expect: 'refused' },
      { label: 'a source that is not connected', arguments: { source: 'todos', ref: 'todo:1' }, expect: 'error' },
      noActivation('a chat turn has no PI activation', { source: 'location', ref: 'location:device' }),
    ],
    situation_patch: [
      { label: 'a stale revision', arguments: situation.stale({ patch: { summary: null } }), expect: 'refused' },
      { label: 'a reference nobody observed', arguments: situation.current({ patch: { upsertRefs: [{ id: 'mail:invented', source: 'mail', identity: 'mail:invented', label: 'Invented mail', observedAt: clockIso, expiresAt: null, verifiedAt: clockIso }] } }), expect: 'refused' },
      noActivation('a chat turn has no PI activation', situation.current({ patch: { summary: null } })),
    ],
    situation_commit: [
      { label: 'a stale revision', arguments: situation.stale({ state: situation.bareState() }), expect: 'refused' },
      { label: 'a state that does not match the schema', arguments: situation.current({ state: { version: 1 } }), expect: 'refused' },
      noActivation('a chat turn has no PI activation', situation.current({ state: situation.bareState() })),
    ],
    message_dan: [
      wakeRefused('evidence the wake never had', messageDan('The 14:05 train to Aarhus is cancelled.', { evidenceSources: ['mail'], evidence: [{ ...locationEvidence, source: 'mail', identity: 'gmail-message:999' }] })),
      wakeRefused('no evidence at all', messageDan('The 14:05 train to Aarhus is cancelled.', { evidence: [] })),
    ],
    proactive_message_feedback: [
      { label: 'a message that is not a proactive receipt', arguments: { messageId: '999', rating: 'useful' }, expect: 'refused' },
      wakeRefused('a wake cannot rate its own message', { messageId: proactiveMessageId, rating: 'useful' }),
    ],
    pi_note: [
      wakeRefused('a name with a folder in it', { name: 'Folder/Waiting for', text: 'Nothing is pending.' }),
      {
        ...wakeRefused('a note name with a credential-like word', { name: 'Waiting for the API key', text: 'Anna will send it.' }),
        check: (result) => expect(result).toMatchObject({ refused: expect.stringContaining('includes the note name') }),
      },
    ],
    inbox_trail: [
      wakeRefused('an item that is not in the inbox', { id: 'ffffffffffff', line: 'Nudged Dan about it this morning.' }),
      wakeRefused('an id that is not an inbox id', { id: '1', line: 'Nudged Dan about it this morning.' }),
    ],
    watch_create: [{ label: 'a next look that is not a time', arguments: { title: 'Deploy of main status', text: 'Look every half hour.', nextLook: 'tomorrow' }, expect: 'refused' }],
    watch_update: [{ label: 'a watch that is not open', arguments: { name: 'Nothing like this', change: 'Look every hour.' }, expect: 'refused' }],
    watch_stop: [{ label: 'a watch that is not open', arguments: { name: 'Nothing like this', reason: 'Dan said to stop.' }, expect: 'refused' }],
    watch_look: [wakeRefused('a next look that is not a time', { name: seededWatches.lookInWake, result: 'Still running.', nextLook: 'soon' })],
  };

  const group: ConformanceGroup = {
    id: 'pi',
    covers: ['pi'],
    modules: [{
      id: 'pi',
      registerRoutes: async () => {},
      tools: [
        ...createSituationTools({ registry, service: situation.service, now }),
        ...createBrainTools({
          registry, comms: brain.comms, proactive: wakeSituation.proactive, area: brain.area, inbox: brain.inbox,
          situation: wakeSituation.service, now,
        }),
        createProactiveMessageFeedbackTool(feedbackStore, context.owner, now),
        ...createWatchTools({ watches: brain.watches, registry, memoryStore: ownerMessageSource(context) as never }),
        ...createStorageQueueTools(storageQueueService as never),
      ],
    }],
    cases,
    skipped: {
      azure_storage_queue_delete: 'Requires a live, owner-confirmed browser action.',
      azure_storage_queue_delete_message: 'Requires a live, owner-confirmed browser action.',
    },
  };
  return { group, probes, situation, wakeSituation, brain };
}

export const piGroup: GroupFactory = (context) => createPiGroup(context).group;
