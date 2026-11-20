import { describe, expect, it } from 'vitest';
import { createMemoryProactiveStore } from '../proactive/store.js';
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
        observedAt: at.toISOString(), expiresAt: null,
      },
      {
        id: 'location:device', source: 'location', identity: 'location:device', label: 'Near Copenhagen',
        observedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 3_600_000).toISOString(),
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
  const store = createMemoryPiSituationStore();
  const proactive = createMemoryProactiveStore(owner);
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
      expectedRevision: 0,
      expectedHash: null,
      policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000001', type: 'chat', source: 'chat', at },
    }, signal());
    expect(committed.record).toMatchObject({ revision: 1 });
    await expect(service.commit({
      expectedRevision: 0,
      expectedHash: null,
      policyRevision: first.policyRevision,
      state: state(),
      activation: { id: '00000000-0000-4000-8000-000000000002', type: 'chat', source: 'chat', at },
    }, signal())).rejects.toMatchObject({ code: 'conflict' });
    expect(store.records.get(owner)?.revision).toBe(1);
  });

  it('excludes disabled-source contributions while retaining explicit stale storage', async () => {
    const { service, store, proactive } = setup();
    const initial = await service.read(signal());
    const withExpiredMail = state();
    withExpiredMail.sources.find(({ id }) => id === 'mail')!.expiresAt =
      new Date(at.getTime() - 60_000).toISOString();
    await service.commit({
      expectedRevision: 0,
      expectedHash: null,
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
    expect(initial.freshSources).toContain('location');
    await service.commit({
      expectedRevision: 0, expectedHash: null, policyRevision: initial.policyRevision, state: state(),
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

  it('marks prior state stale after a failed activation without inventing a replacement', async () => {
    const { service, store } = setup();
    const initial = await service.read(signal());
    await service.commit({
      expectedRevision: 0, expectedHash: null, policyRevision: initial.policyRevision, state: state(),
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
    }, signal());
    expect(store.records.get(owner)?.state.facts.every(({ stale }) => stale)).toBe(true);
    const failed = await service.read(signal());
    expect(failed.staleSources.length).toBeGreaterThan(0);
    expect(failed.state?.summary).toBe('');
    expect(failed.state?.summaryRefIds).toEqual([]);
  });

  it('does not stale a newer successful state from an older failed activation', async () => {
    const { service, store } = setup();
    const firstView = await service.read(signal());
    const first = await service.commit({
      expectedRevision: 0, expectedHash: null, policyRevision: firstView.policyRevision, state: state(),
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
    }, signal());
    expect(store.records.get(owner)).toMatchObject({ revision: 2 });
    expect(store.records.get(owner)?.state.facts.every(({ stale }) => !stale)).toBe(true);
  });
});
