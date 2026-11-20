import { describe, expect, it } from 'vitest';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { createMemoryEventQueueStore } from '../proactive/events/event-queue.js';
import { sourceIds, type ProactiveSource } from '../proactive/types.js';
import { hasCredentialMarkerDeep } from '../core/memory-policy.js';
import {
  createMemoryPiSituationStore,
  createPiSituationService,
  parsePiSituationState,
  piSituationHash,
  sanitizeLegacyPiSituationState,
  PiSituationError,
  type PiSituationState,
} from './situation.js';

const owner = '11111111-1111-4111-8111-111111111111';
const signal = () => new AbortController().signal;
const at = new Date('2026-11-19T05:00:00.000Z');

function state(overrides: Partial<PiSituationState> = {}): PiSituationState {
  return parsePiSituationState({
    version: 1,
    asOf: at.toISOString(),
    summary: 'One compact cross-source model.',
    summaryRefIds: ['mail:42', 'location:device'],
    sources: sourceIds.map((id) => ({
      id,
      state: id === 'mail' || id === 'location' ? 'fresh' : 'missing',
      observedAt: id === 'mail' || id === 'location' ? at.toISOString() : null,
      expiresAt: id === 'location' ? new Date(at.getTime() + 3_600_000).toISOString() : null,
      reason: id === 'mail' || id === 'location' ? null : 'not_observed',
      refIds: id === 'mail' ? ['mail:42'] : id === 'location' ? ['location:device'] : [],
    })),
    refs: [
      {
        id: 'mail:42', source: 'mail', identity: 'mail:42', label: 'Travel confirmation',
        observedAt: at.toISOString(), expiresAt: null, verifiedAt: at.toISOString(),
      },
      {
        id: 'location:device', source: 'location', identity: 'location:device', label: 'Near Copenhagen',
        observedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 3_600_000).toISOString(),
        verifiedAt: at.toISOString(),
      },
    ],
    facts: [
      {
        id: 'fact:mail', source: 'mail', refIds: ['mail:42'], text: 'Flight confirmation exists.',
        observedAt: at.toISOString(), expiresAt: null, stale: false,
      },
      {
        id: 'fact:location', source: 'location', refIds: ['location:device'], text: 'Coarse position near Copenhagen.',
        observedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 3_600_000).toISOString(), stale: false,
      },
    ],
    followUps: [{ id: 'follow:trip', text: 'Check the departure before leaving.', dueAt: null, refIds: ['mail:42'] }],
    ...overrides,
  });
}

function setup(sources: readonly ProactiveSource[] = []) {
  const store = createMemoryPiSituationStore(state().refs.map((ref) => ({
    ...ref,
    verifiedAt: ref.verifiedAt!,
    activatedAt: ref.verifiedAt!,
    invalidatedAt: null,
    staleReason: null,
  })));
  const proactive = createMemoryProactiveStore(owner, () => at);
  const service = createPiSituationService({
    owner,
    store,
    proactive,
    sources,
    now: () => at,
  });
  return { store, proactive, service };
}

describe('PI situational state', () => {
  it('initializes and persists a valid source-complete state on first read', async () => {
    const { service, store } = setup();
    const first = await service.read(signal());
    expect(first.revision).toBe(1);
    expect(first.state?.sources).toHaveLength(sourceIds.length);
    expect(first.state?.facts).toEqual([]);
    expect(store.records.get(owner)?.state).toEqual(first.state);
  });

  it('requires the bounded schema and refuses credentials', () => {
    expect(() => parsePiSituationState({ ...state(), summary: 'token ghp_' + 'A'.repeat(36) }))
      .toThrow(PiSituationError);
    expect(() => parsePiSituationState({ ...state(), facts: [{ ...state().facts[0]!, refIds: ['unknown'] }] }))
      .toThrow(PiSituationError);
    const tokenState = state();
    tokenState.sources.find(({ id }) => id === 'memory')!.refIds = ['memory:token'];
    tokenState.refs.push({
      id: 'memory:token', source: 'memory', identity: 'memory:token',
      label: 'Integration token', observedAt: at.toISOString(), expiresAt: null,
    });
    expect(() => parsePiSituationState({
      ...tokenState,
      facts: [...tokenState.facts, {
        id: 'fact:memory-token',
        source: 'memory',
        refIds: ['memory:token'],
        text: 'githubApiTokenValue=legacy-secret',
        observedAt: at.toISOString(),
        expiresAt: null,
        stale: false,
      }],
    })).toThrow(PiSituationError);
  });

  it.each([
    ['summary', (value: PiSituationState) => { value.summary = 'Legacy api_token=one'; }],
    ['source reason', (value: PiSituationState) => {
      value.sources.find(({ id }) => id === 'mail')!.reason = 'Legacy authToken=two';
    }],
    ['ref identity', (value: PiSituationState) => {
      value.refs[0]!.identity = 'mail:bearer_token=three';
    }],
    ['ref label', (value: PiSituationState) => {
      value.refs[0]!.label = 'Legacy privateTokenValue';
    }],
    ['fact id', (value: PiSituationState) => {
      value.facts[0]!.id = 'fact:accessTokenValue';
    }],
    ['fact text', (value: PiSituationState) => {
      value.facts[0]!.text = 'Legacy oauth_token=four';
    }],
    ['follow-up id', (value: PiSituationState) => {
      value.followUps[0]!.id = 'follow:refreshTokenValue';
    }],
    ['follow-up text', (value: PiSituationState) => {
      value.followUps[0]!.text = 'Legacy session_token=five';
    }],
    ['reference IDs', (value: PiSituationState) => {
      const oldId = value.refs[0]!.id;
      const newId = 'mail:githubApiTokenValue';
      value.refs[0]!.id = newId;
      value.sources.find(({ id }) => id === 'mail')!.refIds = [newId];
      value.summaryRefIds = value.summaryRefIds.map((id) => id === oldId ? newId : id);
      for (const item of [...value.facts, ...value.followUps]) {
        item.refIds = item.refIds.map((id) => id === oldId ? newId : id);
      }
    }],
  ] as const)('sanitizes a credential-like legacy %s before strict parse', (_name, mutate) => {
    const legacy = state();
    mutate(legacy);
    const sanitized = sanitizeLegacyPiSituationState(legacy);
    expect(sanitized.changed).toBe(true);
    expect(hasCredentialMarkerDeep(sanitized.state)).toBe(false);
    expect(() => parsePiSituationState(sanitized.state)).not.toThrow();
  });

  it('commits revision-checked state and rejects a stale hash without overwriting it', async () => {
    const { service, store } = setup();
    const first = await service.read(signal());
    const committed = await service.commit({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000001', type: 'chat', source: 'chat', at },
    }, signal());
    expect(committed.record).toMatchObject({ revision: 2 });
    await expect(service.commit({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000002', type: 'chat', source: 'chat', at },
    }, signal())).rejects.toMatchObject({ code: 'conflict' });
    expect(store.records.get(owner)?.revision).toBe(2);
  });

  it('refuses model-minted references that were never observed or verified by a provider', async () => {
    const store = createMemoryPiSituationStore();
    const proactive = createMemoryProactiveStore(owner, () => at);
    const service = createPiSituationService({
      owner,
      store,
      proactive,
      sources: [],
      now: () => at,
    });
    const first = await service.read(signal());
    await expect(service.commit({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000024', type: 'chat', source: 'chat', at },
    }, signal())).rejects.toMatchObject({ code: 'invalid' });
    expect(store.records.get(owner)?.state.refs).toEqual([]);
  });

  it('canonicalizes reference identity, label and observation from provider authority', async () => {
    const { service, store } = setup();
    const first = await service.read(signal());
    const submitted = state();
    submitted.refs[0] = {
      ...submitted.refs[0]!,
      identity: 'invented-identity',
      label: 'Invented label',
      observedAt: new Date(at.getTime() - 1_000).toISOString(),
    };
    await service.commit({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state: submitted,
      activation: { id: '00000000-0000-4000-8000-000000000026', type: 'chat', source: 'chat', at },
    }, signal());
    expect(store.records.get(owner)?.state.refs[0]).toMatchObject({
      identity: 'mail:42',
      label: 'Travel confirmation',
      observedAt: at.toISOString(),
    });
  });

  it('applies a bounded patch without replacing unrelated source facts', async () => {
    const { service, store } = setup();
    const first = await service.read(signal());
    const initial = await service.commit({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000014', type: 'chat', source: 'chat', at },
    }, signal());
    const patched = await service.patch({
      expectedRevision: initial.record.revision,
      expectedHash: initial.record.hash,
      policyRevision: first.policyRevision,
      patch: {
        upsertFacts: [{
          ...state().facts[0]!,
          text: 'Flight departure moved to 17:30.',
        }],
      },
      activation: { id: '00000000-0000-4000-8000-000000000015', type: 'chat', source: 'chat', at },
    }, signal());
    expect(patched).toMatchObject({ changed: true });
    expect(store.records.get(owner)?.state.facts).toEqual([
      expect.objectContaining({ id: 'fact:mail', text: 'Flight departure moved to 17:30.' }),
      expect.objectContaining({ id: 'fact:location', text: 'Coarse position near Copenhagen.' }),
    ]);
  });

  it('excludes disabled-source contributions while retaining explicit stale storage', async () => {
    const { service, store, proactive } = setup();
    const initial = await service.read(signal());
    const withExpiredMail = state();
    withExpiredMail.sources.find(({ id }) => id === 'mail')!.expiresAt =
      new Date(at.getTime() - 60_000).toISOString();
    await service.commit({
      expectedRevision: initial.revision,
      expectedHash: initial.hash,
      policyRevision: initial.policyRevision,
      state: withExpiredMail,
      activation: { id: '00000000-0000-4000-8000-000000000003', type: 'event', source: 'mail', at },
    }, signal());
    await proactive.settings.patch({ sources: { mail: false } });
    const latest = await service.read(signal());
    expect(latest.disabledSources).toContain('mail');
    expect(latest.state?.facts.some(({ source }) => source === 'mail')).toBe(false);

    const replacement = state();
    replacement.summary = 'A newer summary must not add mail data.';
    const result = await service.commit({
      expectedRevision: latest.revision,
      expectedHash: latest.hash,
      policyRevision: latest.policyRevision,
      state: replacement,
      activation: { id: '00000000-0000-4000-8000-000000000004', type: 'event', source: 'mail', at },
    }, signal());
    expect(result.excluded).toContain('mail');
    const stored = store.records.get(owner)!;
    expect(stored.state.summary).toBe('');
    expect(stored.state.summaryRefIds).toEqual([]);
    expect(stored.state.facts.filter(({ source }) => source === 'mail').every(({ stale }) => stale)).toBe(true);
    expect((await service.read(signal())).state?.facts.some(({ source }) => source === 'mail')).toBe(false);
  });

  it('rejects an unrelated commit rather than truncating preserved stale facts', async () => {
    const { service, store, proactive } = setup();
    const first = await service.read(signal());
    await service.commit({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state: state(),
      activation: {
        id: '00000000-0000-4000-8000-000000000030',
        type: 'chat',
        source: 'chat',
        at,
      },
    }, signal());
    await proactive.settings.patch({ sources: { mail: false } });
    const before = structuredClone(store.records.get(owner)!);
    const disabled = await service.read(signal());
    const submitted = structuredClone(disabled.state!);
    submitted.facts.push(...Array.from({ length: 23 }, (_, index) => ({
      id: `fact:limit:${index}`,
      source: 'location' as const,
      refIds: ['location:device'],
      text: 'L',
      observedAt: at.toISOString(),
      expiresAt: null,
      stale: false,
    })));
    await expect(service.commit({
      expectedRevision: disabled.revision,
      expectedHash: disabled.hash,
      policyRevision: disabled.policyRevision,
      state: submitted,
      activation: {
        id: '00000000-0000-4000-8000-000000000031',
        type: 'chat',
        source: 'chat',
        at,
      },
    }, signal())).rejects.toThrow(/24-fact limit/u);
    expect(store.records.get(owner)).toEqual(before);
  });

  it('keeps location available when Weather is off and refuses a disabled source lookup', async () => {
    const location: ProactiveSource = {
      id: 'location',
      label: 'Location',
      async read() {
        return {
          source: 'location', state: 'ok', reason: null, observedAt: at.toISOString(),
          facts: [{
            ref: 'location:device', identity: 'location:device', kind: 'location',
            label: 'Near Copenhagen', text: 'Coarse position', observedAt: at.toISOString(),
          }],
        };
      },
    };
    const { service, proactive } = setup([location]);
    const initial = await service.read(signal());
    expect(initial.freshSources).not.toContain('location');
    await expect(service.refresh('location', signal())).resolves.toMatchObject({ changed: true });
    expect((await service.read(signal())).freshSources).toContain('location');
    await service.commit({
      expectedRevision: (await service.read(signal())).revision,
      expectedHash: (await service.read(signal())).hash,
      policyRevision: initial.policyRevision, state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000005', type: 'chat', source: 'chat', at },
    }, signal());
    await proactive.settings.patch({ sources: { weather: false, location: true, mail: false } });
    await expect(service.lookup({ source: 'mail', ref: 'mail:42' }, signal())).rejects.toMatchObject({ code: 'invalid' });
    await expect(service.lookup({ source: 'location', ref: 'location:device' }, signal())).resolves.toMatchObject({
      source: 'location', ref: 'location:device',
    });
  });

  it('withholds credential-like legacy Memory state and lookup results from PI context', async () => {
    const memory: ProactiveSource = {
      id: 'memory',
      label: 'Memory',
      async read() {
        return {
          source: 'memory', state: 'ok', reason: null, observedAt: at.toISOString(),
          facts: [{
            ref: 'memory:42', identity: 'memory:42', kind: 'memory',
            label: 'githubApiTokenValue', text: 'bearer_token=fixture-secret',
            observedAt: at.toISOString(),
          }],
        };
      },
    };
    const { service, store, proactive } = setup([memory]);
    await proactive.sources.upsert({
      id: 'memory', label: 'Memory', enabled: true, state: 'ok', reason: null,
      observedAt: at.toISOString(),
    });
    const legacy = state();
    legacy.summary = 'Legacy bearerToken=fixture-secret';
    legacy.summaryRefIds = ['memory:42'];
    legacy.sources.find(({ id }) => id === 'memory')!.state = 'fresh';
    legacy.sources.find(({ id }) => id === 'memory')!.observedAt = at.toISOString();
    legacy.sources.find(({ id }) => id === 'memory')!.refIds = ['memory:42'];
    legacy.refs.push({
      id: 'memory:42', source: 'memory', identity: 'memory:42', label: 'githubApiTokenValue',
      observedAt: at.toISOString(), expiresAt: null,
    });
    legacy.facts.push({
      id: 'fact:memory', source: 'memory', refIds: ['memory:42'],
      text: 'bearer_token=fixture-secret', observedAt: at.toISOString(), expiresAt: null, stale: false,
    });
    store.records.set(owner, {
      owner,
      revision: 1,
      state: legacy,
      hash: piSituationHash(legacy),
      asOf: at,
      updatedAt: at,
      lastActivation: null,
    });

    const view = await service.read(signal());
    expect(view.state?.summary).toBe('');
    expect(view.state?.summaryRefIds).toEqual([]);
    expect(view.state?.refs.some(({ source }) => source === 'memory')).toBe(false);
    expect(view.state?.facts.some(({ source }) => source === 'memory')).toBe(false);
    expect(JSON.stringify(view.state)).not.toContain('bearer');
    expect(JSON.stringify(view.state)).not.toContain('githubApiToken');
    await expect(service.lookup({ source: 'memory', ref: 'memory:42' }, signal()))
      .rejects.toMatchObject({ code: 'redacted' });
  });

  it('marks only the failed source stale and keeps unrelated verified facts usable', async () => {
    const { service, store, proactive } = setup();
    const initial = await service.read(signal());
    await service.commit({
      expectedRevision: initial.revision, expectedHash: initial.hash, policyRevision: initial.policyRevision, state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000006', type: 'scheduled', source: 'timer', at },
    }, signal());
    const baseline = store.records.get(owner)!;
    await service.markFailed({
      activation: {
        id: '00000000-0000-4000-8000-000000000007',
        type: 'scheduled',
        source: 'timer',
        at: new Date(at.getTime() + 60_000),
      },
      expectedRevision: baseline.revision,
      expectedHash: baseline.hash,
      sources: ['mail'],
    }, signal());
    expect(store.records.get(owner)?.state.facts.find(({ source }) => source === 'mail')?.stale).toBe(true);
    expect(store.records.get(owner)?.state.facts.find(({ source }) => source === 'location')?.stale).toBe(false);
    const failed = await service.read(signal());
    expect(failed.staleSources).not.toContain('location');
    expect(store.records.get(owner)?.state.summary).toBe('One compact cross-source model.');
    expect((await proactive.sources.list()).find(({ id }) => id === 'mail'))
      .toMatchObject({ state: 'stale', reason: 'activation_failed' });
    expect(failed.state?.summary).toBe('');
    expect(failed.state?.summaryRefIds).toEqual([]);
  });

  it('refreshes one source observation and invalidates only facts tied to changed evidence', async () => {
    const { service, store } = setup();
    const first = await service.read(signal());
    await service.commit({
      expectedRevision: first.revision, expectedHash: first.hash, policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000019', type: 'chat', source: 'chat', at },
    }, signal());
    await expect(service.observe('mail', {
      source: 'mail',
      state: 'ok',
      reason: null,
      observedAt: at.toISOString(),
      facts: [{
        ref: 'mail:42',
        identity: 'gmail-message:42',
        kind: 'mail',
        label: 'Travel confirmation',
        text: 'The itinerary now leaves at 17:30.',
        observedAt: at.toISOString(),
      }],
    }, signal())).resolves.toMatchObject({ changed: true, baseline: false });
    const facts = store.records.get(owner)!.state.facts;
    expect(facts.find(({ source }) => source === 'mail')).toMatchObject({
      stale: true,
      staleReason: 'source_material_changed',
    });
    expect(facts.find(({ source }) => source === 'location')).toMatchObject({ stale: false });
  });

  it('keeps a verified mail summary when a calendar refresh fails', async () => {
    const { service, store } = setup();
    const first = await service.read(signal());
    await service.commit({
      expectedRevision: first.revision, expectedHash: first.hash, policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000023', type: 'chat', source: 'chat', at },
    }, signal());
    await service.observe('calendar', {
      source: 'calendar',
      state: 'unavailable',
      reason: 'read_failed',
      observedAt: at.toISOString(),
      facts: [],
    }, signal());
    const stored = store.records.get(owner)!;
    expect(stored.state.summary).toBe('One compact cross-source model.');
    expect(stored.state.facts.find(({ source }) => source === 'mail')).toMatchObject({ stale: false });
    expect(stored.state.sources.find(({ id }) => id === 'calendar')).toMatchObject({
      state: 'missing',
    });
  });

  it('does not stale a newer successful state from an older failed activation', async () => {
    const { service, store } = setup();
    const firstView = await service.read(signal());
    const first = await service.commit({
      expectedRevision: firstView.revision, expectedHash: firstView.hash, policyRevision: firstView.policyRevision, state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000011', type: 'chat', source: 'chat', at },
    }, signal());
    const secondState = state();
    secondState.summary = 'A newer successful activation confirmed the state.';
    await service.commit({
      expectedRevision: first.record.revision,
      expectedHash: first.record.hash,
      policyRevision: firstView.policyRevision,
      state: secondState,
      activation: { id: '00000000-0000-4000-8000-000000000012', type: 'event', source: 'mail', at },
    }, signal());
    await service.markFailed({
      activation: {
        id: '00000000-0000-4000-8000-000000000013', type: 'chat', source: 'chat',
        at: new Date(at.getTime() + 60_000),
      },
      expectedRevision: first.record.revision,
      expectedHash: first.record.hash,
      sources: ['mail'],
    }, signal());
    expect(store.records.get(owner)).toMatchObject({ revision: 3 });
    expect(store.records.get(owner)?.state.facts.every(({ stale }) => !stale)).toBe(true);
  });

  it('persists a disable epoch and requires a newer provider observation before evidence returns', async () => {
    const clock = { current: at };
    const provider: ProactiveSource = {
      id: 'mail',
      label: 'Mail',
      async read() {
        return {
          source: 'mail',
          state: 'ok',
          reason: null,
          observedAt: at.toISOString(),
          facts: [{
            ref: 'message:epoch',
            identity: 'gmail-message:epoch',
            kind: 'mail',
            label: 'Epoch mail',
            text: 'Authoritative mail.',
            observedAt: at.toISOString(),
          }],
        };
      },
    };
    const store = createMemoryPiSituationStore();
    const proactive = createMemoryProactiveStore(owner, () => clock.current);
    const service = createPiSituationService({
      owner,
      store,
      proactive,
      sources: [provider],
      now: () => clock.current,
    });
    const queue = createMemoryEventQueueStore();
    service.attachEvents(queue);
    await service.refresh('mail', signal());
    let view = await service.read(signal());
    const refId = view.state!.refs.find(({ source }) => source === 'mail')!.id;
    await service.patch({
      expectedRevision: view.revision,
      expectedHash: view.hash,
      policyRevision: view.policyRevision,
      patch: {
        summary: { text: 'Mail matters.', refIds: [refId] },
        upsertFacts: [{
          id: 'fact:epoch',
          source: 'mail',
          refIds: [refId],
          text: 'The provider confirms the mail.',
          observedAt: at.toISOString(),
          expiresAt: null,
          stale: false,
        }],
        upsertFollowUps: [{
          id: 'follow:epoch',
          text: 'Follow the mail.',
          dueAt: new Date(at.getTime() + 30 * 60_000).toISOString(),
          refIds: [refId],
        }],
      },
      activation: { id: '00000000-0000-4000-8000-000000000025', type: 'chat', source: 'chat', at },
    }, signal());
    await service.synchronizeFollowUps(signal());
    expect(await queue.nextDueAt()).toEqual(new Date(at.getTime() + 30 * 60_000));
    await proactive.settings.patch({ sources: { mail: false } });
    const stored = store.records.get(owner)!;
    store.records.set(owner, {
      ...stored,
      authoritativeRefs: stored.authoritativeRefs.map((ref) =>
        ref.source === 'mail'
          ? { ...ref, invalidatedAt: at.toISOString(), staleReason: 'source_disabled' }
          : ref),
    });
    store.authorities.set(owner, [...store.records.get(owner)!.authoritativeRefs]);
    await service.synchronizeFollowUps(signal());
    expect(await queue.nextDueAt()).toBeNull();
    const disabledView = await service.read(signal());
    const unrelatedCommit = await service.commit({
      expectedRevision: disabledView.revision,
      expectedHash: disabledView.hash,
      policyRevision: disabledView.policyRevision,
      state: disabledView.state!,
      activation: {
        id: '00000000-0000-4000-8000-000000000027',
        type: 'chat',
        source: 'chat',
        at,
      },
    }, signal());
    const unrelatedPatch = await service.patch({
      expectedRevision: unrelatedCommit.record.revision,
      expectedHash: unrelatedCommit.record.hash,
      policyRevision: disabledView.policyRevision,
      patch: { asOf: new Date(at.getTime() + 1).toISOString() },
      activation: {
        id: '00000000-0000-4000-8000-000000000028',
        type: 'chat',
        source: 'chat',
        at,
      },
    }, signal());
    await service.markFailed({
      expectedRevision: unrelatedPatch.record.revision,
      expectedHash: unrelatedPatch.record.hash,
      sources: ['calendar'],
      activation: {
        id: '00000000-0000-4000-8000-000000000029',
        type: 'scheduled',
        source: 'timer',
        at: new Date(at.getTime() + 2),
      },
    }, signal());
    await proactive.settings.patch({ sources: { mail: true } });
    await service.synchronizeFollowUps(signal());
    expect(await queue.nextDueAt()).toBeNull();
    view = await service.read(signal());
    expect(view.state?.refs.some(({ source }) => source === 'mail')).toBe(false);
    expect(view.state?.facts.some(({ source }) => source === 'mail')).toBe(false);
    expect(view.state?.followUps.some(({ refIds }) => refIds.includes(refId))).toBe(false);
    expect(view.state?.summary).toBe('');

    await expect(service.lookup({ source: 'mail', ref: 'message:epoch' }, signal()))
      .rejects.toMatchObject({ code: 'invalid' });
    await service.observe('mail', await provider.read({ now: clock.current, signal: signal(), settings: await proactive.settings.read() }), signal());
    await service.synchronizeFollowUps(signal());
    expect((await service.read(signal())).state?.refs.some(({ source }) => source === 'mail')).toBe(false);

    clock.current = new Date(at.getTime() + 1);
    await service.refresh('mail', signal());
    await service.synchronizeFollowUps(signal());
    const restored = await service.read(signal());
    expect(restored.state?.refs.some(({ source }) => source === 'mail')).toBe(true);
    expect(restored.state?.refs.find(({ source }) => source === 'mail'))
      .toMatchObject({
        observedAt: at.toISOString(),
        verifiedAt: clock.current.toISOString(),
      });
    expect(restored.state?.facts).toContainEqual(expect.objectContaining({
      id: 'fact:epoch',
      stale: false,
    }));
    expect(restored.state?.summary).toBe('Mail matters.');
    expect(restored.state?.followUps.map(({ id }) => id)).toContain('follow:epoch');
    expect(await queue.nextDueAt()).toEqual(new Date(at.getTime() + 30 * 60_000));
  });

  it('schedules, updates and cancels evidence-linked dueAt follow-ups through the event queue', async () => {
    const { service } = setup();
    const queue = createMemoryEventQueueStore();
    let wakes = 0;
    service.attachEvents(queue, () => { wakes += 1; });
    const first = await service.read(signal());
    const dueAt = new Date(at.getTime() + 30 * 60_000);
    const firstState = state({
      followUps: [{ id: 'follow:trip', text: 'Check in before departure.', dueAt: dueAt.toISOString(), refIds: ['mail:42'] }],
    });
    const committed = await service.commit({
      expectedRevision: first.revision, expectedHash: first.hash, policyRevision: first.policyRevision,
      state: firstState,
      activation: { id: '00000000-0000-4000-8000-000000000020', type: 'chat', source: 'chat', at },
    }, signal());
    expect(wakes).toBe(1);
    expect(await queue.nextDueAt()).toBeNull();
    await service.synchronizeFollowUps(signal());
    expect(await queue.nextDueAt()).toEqual(dueAt);
    expect(await queue.claim(at, 10, 60_000)).toEqual([]);
    const movedAt = new Date(dueAt.getTime() + 15 * 60_000);
    const moved = await service.patch({
      expectedRevision: committed.record.revision,
      expectedHash: committed.record.hash,
      policyRevision: first.policyRevision,
      patch: {
        upsertFollowUps: [{
          id: 'follow:trip',
          text: 'Check in before the revised departure.',
          dueAt: movedAt.toISOString(),
          refIds: ['mail:42'],
        }],
      },
      activation: { id: '00000000-0000-4000-8000-000000000022', type: 'chat', source: 'chat', at },
    }, signal());
    await service.synchronizeFollowUps(signal());
    expect(moved.changed).toBe(true);
    expect(await queue.nextDueAt()).toEqual(movedAt);
    const cancelled = await service.patch({
      expectedRevision: moved.record.revision,
      expectedHash: moved.record.hash,
      policyRevision: first.policyRevision,
      patch: { removeFollowUpIds: ['follow:trip'] },
      activation: { id: '00000000-0000-4000-8000-000000000021', type: 'chat', source: 'chat', at },
    }, signal());
    await service.synchronizeFollowUps(signal());
    expect(cancelled.changed).toBe(true);
    expect(await queue.nextDueAt()).toBeNull();
  });
});
