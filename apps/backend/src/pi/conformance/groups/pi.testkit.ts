import { expect } from 'vitest';
import { createBrainTools } from '../../brain/tools.js';
import { createSituationTools } from '../../situation-tools.js';
import { createWatchTools } from '../../watch/tools.js';
import { ownerMessageSource } from '../shared.testkit.js';
import type { ConformanceGroup, GroupFactory, ToolCase } from '../types.testkit.js';
import { createBrainFixture, seededInboxItemId, seededWatches } from './pi-brain.testkit.js';
import { createSituationFixture, piClock } from './pi-situation.testkit.js';

const clockIso = piClock.toISOString();
const inAnHour = new Date(piClock.getTime() + 60 * 60_000).toISOString();
const noActivation = 'This tool needs a live PI activation. Nothing was done.';

/**
 * The PI-only tools: situation tools (an activation turn), the brain's tools (a background wake) and standing watches. The MCP
 * door itself is composed by the world; this group contributes the tools production adds to the `pi` module, built over the
 * production services with in-memory stores. Their turn authority comes from the same registry the door resolves turns in.
 */
export const piGroup: GroupFactory = (context): ConformanceGroup => {
  const registry = context.registry;
  if (!registry) throw new Error('The PI conformance group needs the turn registry the MCP door uses (ConformanceContext.registry).');
  const situationFixture = createSituationFixture(context.owner);
  // The brain reads the situation too, but a wake and an activation never share state here: a commit must not change what a wake may cite.
  const wakeSituation = createSituationFixture(context.owner);
  const brain = createBrainFixture(context, registry);
  const now = () => piClock;

  const locationEvidence = {
    source: 'location', ref: null, identity: 'location:device', label: 'Near Copenhagen', observedAt: clockIso, verifiedAt: clockIso,
  };
  const messageDan = (text: string, extra: Record<string, unknown> = {}) => ({
    text, category: 'status', suggestionScope: 'unknown', evidenceSources: ['location'], evidence: [locationEvidence], ...extra,
  });
  const noActivationCase = (label: string, args: Record<string, unknown>): ToolCase => ({ label, arguments: args, turn: 'chat', expect: 'refused', check: (result) => expect(result).toMatchObject({ refused: noActivation }) });

  const situation = situationFixture;
  const cases: Record<string, readonly ToolCase[]> = {
    situation_read: [
      { label: 'the current situational state', arguments: {}, check: (result) => expect(result).toMatchObject({ revision: expect.any(Number), hash: expect.any(String), state: expect.objectContaining({ version: 1 }) }) },
      noActivationCase('a chat turn has no PI activation', {}),
    ],
    situation_lookup: [
      { label: 'one live location record', arguments: { source: 'location', ref: 'location:device' }, check: (result) => expect(result).toMatchObject({ source: 'location', verifiedRef: expect.objectContaining({ source: 'location' }) }) },
      { label: 'a reference the provider no longer has', arguments: { source: 'location', ref: 'location:elsewhere' }, expect: 'refused' },
      { label: 'a source that is not connected', arguments: { source: 'todos', ref: 'todo:1' }, expect: 'error' },
      noActivationCase('a chat turn has no PI activation', { source: 'location', ref: 'location:device' }),
    ],
    situation_patch: [
      { label: 'record the location with a fact, a follow-up and a summary', arguments: situation.current({ get patch() { return situation.locationPatch(); } }), check: (result) => expect(result).toMatchObject({ committed: true, changed: true }) },
      { label: 'the same patch again changes nothing', arguments: situation.current({ get patch() { return situation.locationPatch(); } }), check: (result) => expect(result).toMatchObject({ committed: false, changed: false }) },
      { label: 'a stale revision', arguments: situation.stale({ patch: { summary: null } }), expect: 'refused' },
      { label: 'a reference nobody observed', arguments: situation.current({ patch: { upsertRefs: [{ id: 'mail:invented', source: 'mail', identity: 'mail:invented', label: 'Invented mail', observedAt: clockIso, expiresAt: null, verifiedAt: clockIso }] } }), expect: 'refused' },
      noActivationCase('a chat turn has no PI activation', situation.current({ patch: { summary: null } })),
    ],
    situation_commit: [
      { label: 'replace the state with a complete bounded one', arguments: situation.current({ state: situation.bareState() }), check: (result) => expect(result).toMatchObject({ committed: true, revision: expect.any(Number) }) },
      { label: 'a stale revision', arguments: situation.stale({ state: situation.bareState() }), expect: 'refused' },
      { label: 'a state that does not match the schema', arguments: situation.current({ state: { version: 1 } }), expect: 'refused' },
      noActivationCase('a chat turn has no PI activation', situation.current({ state: situation.bareState() })),
    ],
    message_dan: [
      {
        label: 'tell Dan, citing the evidence the situation holds', turn: 'wake',
        arguments: messageDan('You are near Copenhagen, and the parcel you were waiting for is ready to collect at the pick-up point.'),
        check: (result) => { expect(result).toMatchObject({ sent: true, messageId: expect.any(String) }); expect(brain.pushes.length).toBeGreaterThan(0); },
      },
      { label: 'evidence the wake never had', turn: 'wake', arguments: messageDan('The 14:05 train to Aarhus is cancelled.', { evidenceSources: ['mail'], evidence: [{ ...locationEvidence, source: 'mail', identity: 'gmail-message:999' }] }), expect: 'refused' },
      { label: 'no evidence at all', turn: 'wake', arguments: messageDan('The 14:05 train to Aarhus is cancelled.', { evidence: [] }), expect: 'refused' },
    ],
    pi_note: [
      { label: 'append a dated block to a new note', turn: 'wake', arguments: { name: 'Waiting for', text: 'The parcel from the post office, expected this week.' }, check: (result) => expect(result).toMatchObject({ path: 'PI/Notes/Waiting for.md', created: true }) },
      { label: 'append to the same note again', turn: 'wake', arguments: { name: 'Waiting for', text: 'The parcel arrived at the post office.', mode: 'append' }, check: (result) => expect(result).toMatchObject({ created: false }) },
      { label: 'replace the whole note', turn: 'wake', arguments: { name: 'Waiting for', text: 'Nothing is pending.', mode: 'replace' }, check: (result) => expect(result).toMatchObject({ path: 'PI/Notes/Waiting for.md' }) },
      { label: 'a name with a folder in it', turn: 'wake', arguments: { name: 'Folder/Waiting for', text: 'Nothing is pending.' }, expect: 'refused' },
    ],
    inbox_trail: [
      { label: 'add a trail line to an open item', turn: 'wake', arguments: { id: seededInboxItemId, line: 'Nudged Dan about it this morning.' }, check: (result) => expect(result).toMatchObject({ path: expect.stringContaining('Inbox/') }) },
      { label: 'an item that is not in the inbox', turn: 'wake', arguments: { id: 'ffffffffffff', line: 'Nudged Dan about it this morning.' }, expect: 'refused' },
      { label: 'an id that is not an inbox id', turn: 'wake', arguments: { id: '1', line: 'Nudged Dan about it this morning.' }, expect: 'refused' },
    ],
    watch_create: [
      { label: 'in chat, quoting Dan', ownerMessage: 'Please keep me updated on the deploy of main, every half hour.', arguments: { title: 'Deploy of main status', text: 'Tell me when the deploy of main is green. Look every half hour.', nextLook: inAnHour }, check: (result) => expect(result).toMatchObject({ created: true, name: 'Deploy of main status', nextLook: inAnHour }) },
      { label: 'in a wake, events only', turn: 'wake', arguments: { title: 'Price of the flight', text: 'Watch the price of the flight to Berlin.', nextLook: 'none' }, check: (result) => expect(result).toMatchObject({ created: true, nextLook: null }) },
      { label: 'a next look that is not a time', arguments: { title: 'Deploy of main status', text: 'Look every half hour.', nextLook: 'tomorrow' }, expect: 'refused' },
    ],
    watch_list: [
      { label: 'the open watches', arguments: {}, check: (result) => expect(result).toMatchObject({ watches: expect.arrayContaining([expect.objectContaining({ name: seededWatches.lookInWake })]) }) },
      { label: 'the open watches in a wake', turn: 'wake', arguments: {}, check: (result) => expect(result).toMatchObject({ watches: expect.any(Array) }) },
    ],
    watch_update: [
      { label: 'in chat, a new cadence', ownerMessage: 'Check the flight price every hour instead.', arguments: { name: seededWatches.updateInChat, change: 'Look every hour instead.', nextLook: inAnHour }, check: (result) => expect(result).toMatchObject({ updated: true }) },
      { label: 'in a wake, events only', turn: 'wake', arguments: { name: seededWatches.updateInWake, change: 'The post office sends an event when it arrives.', nextLook: 'none' }, check: (result) => expect(result).toMatchObject({ updated: true }) },
      { label: 'a watch that is not open', arguments: { name: 'Nothing like this', change: 'Look every hour.' }, expect: 'refused' },
    ],
    watch_stop: [
      { label: 'in chat, when Dan says stop', ownerMessage: 'Stop watching the train to Aarhus.', arguments: { name: seededWatches.stopInChat, reason: 'Dan said to stop.' }, check: (result) => expect(result).toMatchObject({ stopped: true, closedAs: seededWatches.stopInChat }) },
      { label: 'in a wake, when the stop condition is met', turn: 'wake', arguments: { name: seededWatches.stopInWake, reason: 'Saturday has passed.' }, check: (result) => expect(result).toMatchObject({ stopped: true }) },
      { label: 'a watch that is not open', arguments: { name: 'Nothing like this', reason: 'Dan said to stop.' }, expect: 'refused' },
    ],
    watch_look: [
      { label: 'record a look and the next one', turn: 'wake', arguments: { name: seededWatches.lookInWake, result: 'The deploy of main is still running.', nextLook: inAnHour }, check: (result) => expect(result).toMatchObject({ recorded: true, nextLook: inAnHour }) },
      { label: 'a next look that is not a time', turn: 'wake', arguments: { name: seededWatches.lookInWake, result: 'Still running.', nextLook: 'soon' }, expect: 'refused' },
    ],
  };

  return {
    id: 'pi',
    covers: ['pi'],
    modules: [{
      id: 'pi',
      registerRoutes: async () => {},
      tools: [
        ...createSituationTools({ registry, service: situationFixture.service, now }),
        ...createBrainTools({
          registry, comms: brain.comms, proactive: wakeSituation.proactive, area: brain.area, inbox: brain.inbox,
          situation: wakeSituation.service, now,
        }),
        ...createWatchTools({ watches: brain.watches, registry, memoryStore: ownerMessageSource(context) as never }),
      ],
    }],
    cases,
  };
};
