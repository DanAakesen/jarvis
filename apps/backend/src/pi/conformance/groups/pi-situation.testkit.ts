import { proactiveSettingsRevision } from '../../../proactive/preferences.js';
import { createMemoryProactiveStore, defaultProactiveSettings } from '../../../proactive/store.js';
import type { ProactiveSource, SourceResult } from '../../../proactive/types.js';
import { sourceIds } from '../../../proactive/types.js';
import { createMemoryPiSituationStore, createPiSituationService, PiSituationError, type PiSituationService } from '../../situation.js';
import type { ConformanceContext } from '../types.testkit.js';

/** The clock of every PI fake: evidence and situational state are judged against it, so the cases never go stale. */
export const piClock = new Date('2026-11-21T08:00:00.000Z');
const clockIso = piClock.toISOString();

/** What the location provider reads: one coarse position, as the device would report it. */
const locationResult: SourceResult = {
  source: 'location', state: 'ok', reason: null, observedAt: clockIso,
  facts: [{
    ref: 'location:device', identity: 'location:device', kind: 'location', label: 'Near Copenhagen',
    text: 'Coarse position near Copenhagen.', observedAt: clockIso,
  }],
};
const locationSource: ProactiveSource = { id: 'location', label: 'Location', read: async () => locationResult };

const bareState = () => ({
  version: 1, asOf: clockIso, summary: '', summaryRefIds: [],
  sources: sourceIds.map((id) => ({ id, state: 'missing', observedAt: null, expiresAt: null, reason: 'not_observed', refIds: [] })),
  refs: [], facts: [], followUps: [],
});

/** Dependency token: the stored situational state cannot be read (the real store's answer to a corrupt row). */
export const situationDown = 'pi-situation';

/**
 * The PI situation service over in-memory stores, with one location observation recorded the way a source refresh records it.
 * The service is the production one; only its stores and its one connected source are fakes.
 */
export function createSituationFixture(context: Pick<ConformanceContext, 'owner' | 'down'>) {
  const owner = context.owner;
  const store = createMemoryPiSituationStore();
  const proactive = createMemoryProactiveStore(owner, () => piClock);
  const service = createPiSituationService({ owner, store, proactive, sources: [locationSource], now: () => piClock });
  // The stores answer without real I/O, so this settles long before the first tool call. A failure is surfaced by that call.
  const seeded = service.observe('location', locationResult, new AbortController().signal);
  seeded.catch(() => {});
  const ready = new Proxy(service, {
    get: (target, property) => {
      const member = (target as unknown as Record<string | symbol, unknown>)[property];
      if (typeof member !== 'function') return member;
      return async (...args: unknown[]) => {
        await seeded;
        if (context.down.has(situationDown)) throw new PiSituationError('unavailable', 'The stored PI situational state is invalid. No replacement was invented.');
        return (member as (...values: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as PiSituationService;

  const policyRevision = proactiveSettingsRevision(defaultProactiveSettings());
  const head = () => store.records.get(owner);
  /** The location reference as a provider observation recorded it (the receipt a lookup would also leave). */
  const locationRef = () => {
    const receipt = store.authorities.get(owner)?.find(({ source }) => source === 'location');
    if (!receipt) throw new Error('The location observation was not recorded in the situation fixture.');
    return {
      id: receipt.id, source: receipt.source, identity: receipt.identity, label: receipt.label, observedAt: receipt.observedAt,
      expiresAt: receipt.expiresAt, ...(receipt.materialHash ? { materialHash: receipt.materialHash } : {}), verifiedAt: receipt.verifiedAt,
    };
  };

  /**
   * Arguments for a patch or commit against the state as `situation_read` shows it. Each commit moves revision and hash, so a
   * case reads them when it is sent (accessors keep the other properties lazy too). The proactive-policy revision never moves.
   */
  const current = (extra: Record<string, unknown>): Record<string, unknown> => Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(extra),
    expectedRevision: { enumerable: true, get: () => head()?.revision ?? 0 },
    expectedHash: { enumerable: true, get: () => head()?.hash ?? null },
    policyRevision: { enumerable: true, value: policyRevision },
  });
  /** The same arguments against a revision that is long gone. */
  const stale = (extra: Record<string, unknown>): Record<string, unknown> => ({ ...extra, expectedRevision: 0, expectedHash: null, policyRevision });

  return {
    service: ready, store, proactive, current, stale,
    /** A complete, valid state for the compatibility commit: every source once, nothing observed, no references. */
    bareState,
    /** A patch that records the location reference with one fact, a summary of it and a follow-up. */
    locationPatch: () => {
      const ref = locationRef();
      return {
        upsertRefs: [ref],
        upsertFacts: [{ id: 'fact:location', source: 'location', refIds: [ref.id], text: 'Coarse position near Copenhagen.', observedAt: clockIso, expiresAt: null, stale: false }],
        upsertFollowUps: [{ id: 'follow:errand', text: 'Ask Dan whether the errand near Copenhagen is done.', dueAt: null, refIds: [ref.id] }],
        summary: { text: 'Dan is near Copenhagen.', refIds: [ref.id] },
      };
    },
  };
}

export type SituationFixture = ReturnType<typeof createSituationFixture>;
