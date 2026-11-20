import { createHash } from 'node:crypto';
import { z } from 'zod';
import { proactiveSettingsRevision } from '../proactive/preferences.js';
import type { ProactiveStore } from '../proactive/store.js';
import {
  sourceIds, type ProactiveSettings, type ProactiveSource, type SourceId, type SourceStatus,
} from '../proactive/types.js';
import { hasCredentialMarker } from '../core/memory-policy.js';

export const PI_SITUATION_SCHEMA_VERSION = 1 as const;
export const PI_SITUATION_MAX_BYTES = 8 * 1024;
export const PI_SITUATION_LOOKUP_MAX_BYTES = 8 * 1024;
const iso = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u);
const sourceId = z.enum(sourceIds);

const sourceSchema = z.object({
  id: sourceId,
  state: z.enum(['fresh', 'stale', 'missing', 'disabled']),
  observedAt: iso.nullable(),
  expiresAt: iso.nullable(),
  reason: z.string().max(160).nullable(),
  refIds: z.array(id).max(8),
}).strict();

const refSchema = z.object({
  id,
  source: sourceId,
  identity: z.string().min(1).max(240),
  label: z.string().min(1).max(160),
  observedAt: iso,
  expiresAt: iso.nullable(),
}).strict();

const factSchema = z.object({
  id,
  source: sourceId,
  refIds: z.array(id).min(1).max(4),
  text: z.string().min(1).max(600),
  observedAt: iso,
  expiresAt: iso.nullable(),
  stale: z.boolean(),
}).strict();

const followUpSchema = z.object({
  id,
  text: z.string().min(1).max(300),
  dueAt: iso.nullable(),
  refIds: z.array(id).min(1).max(4),
}).strict();

const schema = z.object({
  version: z.literal(PI_SITUATION_SCHEMA_VERSION),
  asOf: iso,
  summary: z.string().max(1_600),
  summaryRefIds: z.array(id).max(8),
  sources: z.array(sourceSchema).min(1).max(sourceIds.length),
  refs: z.array(refSchema).max(48),
  facts: z.array(factSchema).max(24),
  followUps: z.array(followUpSchema).max(16),
}).strict().superRefine((state, context) => {
  const sourceSet = new Set(state.sources.map(({ id: value }) => value));
  if (sourceSet.size !== state.sources.length || sourceSet.size !== sourceIds.length) {
    context.addIssue({ code: 'custom', message: 'Every source must appear exactly once' });
  }
  const refs = new Map(state.refs.map((ref) => [ref.id, ref]));
  if (refs.size !== state.refs.length) context.addIssue({ code: 'custom', message: 'Reference ids must be unique' });
  const factIds = new Set(state.facts.map(({ id: value }) => value));
  if (factIds.size !== state.facts.length) context.addIssue({ code: 'custom', message: 'Fact ids must be unique' });
  const followUpIds = new Set(state.followUps.map(({ id: value }) => value));
  if (followUpIds.size !== state.followUps.length) context.addIssue({ code: 'custom', message: 'Follow-up ids must be unique' });
  const validRefs = (values: readonly string[], source?: SourceId) => values.every((value) => {
    const ref = refs.get(value);
    return ref !== undefined && (source === undefined || ref.source === source);
  });
  if (state.sources.some((entry) => !validRefs(entry.refIds, entry.id))) {
    context.addIssue({ code: 'custom', message: 'A source references an unknown or differently sourced record' });
  }
  if (state.facts.some((entry) => !validRefs(entry.refIds, entry.source))) {
    context.addIssue({ code: 'custom', message: 'A fact references an unknown or differently sourced record' });
  }
  if (state.followUps.some((entry) => !validRefs(entry.refIds))) {
    context.addIssue({ code: 'custom', message: 'A follow-up references an unknown record' });
  }
  if (!validRefs(state.summaryRefIds) || state.summary.length > 0 && state.summaryRefIds.length === 0) {
    context.addIssue({ code: 'custom', message: 'A non-empty summary needs fresh raw references' });
  }
});

export type PiSituationState = z.infer<typeof schema>;
export type PiActivationType = 'chat' | 'voice' | 'scheduled' | 'event';

export class PiSituationError extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'unavailable' | 'redacted', message: string) {
    super(message);
    this.name = 'PiSituationError';
  }
}

export interface PiSituationRecord {
  readonly owner: string;
  readonly revision: number;
  readonly state: PiSituationState;
  readonly hash: string;
  readonly asOf: Date;
  readonly updatedAt: Date;
  readonly lastActivation: null | {
    readonly id: string;
    readonly type: PiActivationType;
    readonly source: string | null;
    readonly at: Date;
  };
}

export interface PiSituationCommit {
  readonly owner: string;
  readonly expectedRevision: number;
  readonly expectedHash: string | null;
  readonly state: PiSituationState;
  readonly activation: {
    readonly id: string;
    readonly type: PiActivationType;
    readonly source: string | null;
    readonly at: Date;
  };
}

export interface PiSituationStore {
  read(owner: string, signal: AbortSignal): Promise<PiSituationRecord | null>;
  commit(input: PiSituationCommit, signal: AbortSignal): Promise<PiSituationRecord>;
  recordActivation(
    owner: string,
    activation: PiSituationCommit['activation'],
    signal: AbortSignal,
  ): Promise<void>;
}

export interface PiSituationView {
  readonly state: PiSituationState | null;
  readonly revision: number;
  readonly hash: string | null;
  readonly policyRevision: string;
  readonly staleSources: readonly SourceId[];
  readonly missingSources: readonly SourceId[];
  readonly disabledSources: readonly SourceId[];
  readonly freshSources: readonly SourceId[];
  readonly asOf: string | null;
  readonly updatedAt: string | null;
  readonly lastActivation: PiSituationRecord['lastActivation'];
}

export interface PiSituationService {
  read(signal: AbortSignal): Promise<PiSituationView>;
  context(signal: AbortSignal): Promise<{ text: string; view: PiSituationView }>;
  markActivation(activation: PiSituationCommit['activation'], signal: AbortSignal): Promise<void>;
  commit(input: {
    readonly expectedRevision: number;
    readonly expectedHash: string | null;
    readonly policyRevision: string;
    readonly state: unknown;
    readonly activation: PiSituationCommit['activation'];
  }, signal: AbortSignal): Promise<{ record: PiSituationRecord; excluded: readonly SourceId[] }>;
  markFailed(input: {
    readonly activation: PiSituationCommit['activation'];
    readonly expectedRevision: number;
    readonly expectedHash: string | null;
  }, signal: AbortSignal): Promise<void>;
  lookup(input: { readonly source: SourceId; readonly ref: string }, signal: AbortSignal): Promise<Record<string, unknown>>;
}

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

export function parsePiSituationState(value: unknown): PiSituationState {
  const result = schema.safeParse(value);
  const serialized = JSON.stringify(result.success ? result.data : value);
  if (!result.success || jsonBytes(result.data) > PI_SITUATION_MAX_BYTES || hasCredentialMarker(serialized)) {
    const code = hasCredentialMarker(typeof value === 'string' ? value : JSON.stringify(value)) ? 'redacted' : 'invalid';
    throw new PiSituationError(code, code === 'redacted'
      ? 'Secrets and credentials cannot be stored in situational state.'
      : 'The situational state did not match the bounded schema.');
  }
  return result.data;
}

export function piSituationHash(state: PiSituationState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

export function sourceRefsFor(state: PiSituationState): unknown {
  return state.refs.map(({ id: value, source, identity, label, observedAt, expiresAt }) => ({
    id: value, source, identity, label, observedAt, expiresAt,
  }));
}

export function freshnessFor(state: PiSituationState): unknown {
  return state.sources.map(({ id: value, state: freshness, observedAt, expiresAt, reason }) => ({
    source: value, state: freshness, observedAt, expiresAt, reason,
  }));
}

export function staleReasonsFor(state: PiSituationState): unknown {
  return state.sources
    .filter(({ state: value }) => value === 'stale' || value === 'missing')
    .map(({ id: value, state: freshness, reason }) => ({ source: value, state: freshness, reason }));
}

function emptyState(now: Date): PiSituationState {
  return {
    version: PI_SITUATION_SCHEMA_VERSION,
    asOf: now.toISOString(),
    summary: '',
    summaryRefIds: [],
    sources: sourceIds.map((value) => ({
      id: value, state: 'missing', observedAt: null, expiresAt: null, reason: 'not_observed', refIds: [],
    })),
    refs: [],
    facts: [],
    followUps: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function credentialSafeState(state: PiSituationState): PiSituationState {
  const refs = state.refs.filter((ref) => !hasCredentialMarker(JSON.stringify(ref)));
  const refIds = new Set(refs.map(({ id: value }) => value));
  const summarySafe = !hasCredentialMarker(state.summary);
  const summaryRefIds = summarySafe
    ? state.summaryRefIds.filter((value) => refIds.has(value))
    : [];
  return {
    ...state,
    summary: summarySafe && summaryRefIds.length === state.summaryRefIds.length ? state.summary : '',
    summaryRefIds: summarySafe ? summaryRefIds : [],
    sources: state.sources.map((source) => ({
      ...source,
      refIds: source.refIds.filter((value) => refIds.has(value)),
    })),
    refs,
    facts: state.facts.filter((fact) =>
      !hasCredentialMarker(JSON.stringify(fact)) &&
      fact.refIds.every((value) => refIds.has(value))),
    followUps: state.followUps.filter((followUp) =>
      !hasCredentialMarker(JSON.stringify(followUp)) &&
      followUp.refIds.every((value) => refIds.has(value))),
  };
}

function sourceState(status: SourceStatus | undefined, now: Date, settings: ProactiveSettings):
'fresh' | 'stale' | 'missing' | 'disabled' {
  if (!status?.enabled || !settings.sources[status.id]) return 'disabled';
  if (status.state === 'unavailable' || status.state === 'not_run' || status.observedAt === null) return 'missing';
  if (status.state === 'stale') return 'stale';
  const observed = Date.parse(status.observedAt);
  if (status.id === 'location' && Number.isFinite(observed) && now.getTime() - observed > 6 * 60 * 60_000) return 'stale';
  return 'fresh';
}

function boundedResult(value: Record<string, unknown>): Record<string, unknown> {
  if (jsonBytes(value) <= PI_SITUATION_LOOKUP_MAX_BYTES) return value;
  return {
    ...value,
    text: typeof value.text === 'string'
      ? `${Array.from(value.text).slice(0, 4_000).join('')}…`
      : '[truncated]',
    truncated: true,
  };
}

export function createPiSituationService(options: {
  readonly owner: string;
  readonly store: PiSituationStore;
  readonly proactive: ProactiveStore;
  readonly sources: readonly ProactiveSource[] | (() => readonly ProactiveSource[]);
  readonly now?: () => Date;
}): PiSituationService {
  const now = options.now ?? (() => new Date());

  async function currentPolicy(signal: AbortSignal): Promise<{
    readonly settings: ProactiveSettings;
    readonly revision: string;
    readonly statuses: readonly SourceStatus[];
  }> {
    signal.throwIfAborted();
    const [settings, storedStatuses] = await Promise.all([
      options.proactive.settings.read(),
      options.proactive.sources.list(),
    ]);
    const statuses = [...storedStatuses];
    const sources = typeof options.sources === 'function' ? options.sources() : options.sources;
    const location = sources.find(({ id }) => id === 'location');
    if (location && settings.sources.location) {
      const result = await location.read({ now: now(), signal, settings });
      const existing = statuses.findIndex(({ id }) => id === 'location');
      const status: SourceStatus = {
        id: 'location',
        label: 'Location',
        enabled: true,
        state: result.reason === 'location_observation_stale' ? 'stale' : result.state,
        reason: result.reason,
        observedAt: result.observedAt,
      };
      if (existing >= 0) statuses.splice(existing, 1, status);
      else statuses.push(status);
    }
    return { settings, revision: proactiveSettingsRevision(settings), statuses };
  }

  function visible(record: PiSituationRecord | null, settings: ProactiveSettings, statuses: readonly SourceStatus[], at: Date): PiSituationView {
    const raw = credentialSafeState(record?.state ?? emptyState(at));
    const byStatus = new Map(statuses.map((status) => [status.id, status]));
    const states = raw.sources.map((entry) => {
      const status = byStatus.get(entry.id);
      const freshness = sourceState(status ?? {
        id: entry.id,
        label: entry.id,
        enabled: settings.sources[entry.id],
        state: entry.state === 'missing' ? 'not_run' : entry.state === 'stale' ? 'stale' : 'ok',
        reason: entry.reason,
        observedAt: entry.observedAt,
      }, at, settings);
      const expired = entry.expiresAt !== null && Date.parse(entry.expiresAt) <= at.getTime();
      return {
        ...entry,
        state: freshness === 'disabled' ? 'disabled' : expired ? 'stale' : freshness,
        reason: freshness === 'disabled' ? 'source_disabled'
          : expired ? 'expired' : freshness === 'missing' ? status?.reason ?? entry.reason ?? 'not_observed'
            : freshness === 'stale' ? status?.reason ?? entry.reason ?? 'stale'
              : null,
      } as PiSituationState['sources'][number];
    });
    const available = new Set(states.filter(({ state }) => state === 'fresh').map(({ id: value }) => value));
    const refIds = new Set(raw.refs.filter(({ source, expiresAt }) =>
      available.has(source) && (expiresAt === null || Date.parse(expiresAt) > at.getTime()))
      .map(({ id: value }) => value));
    const summaryAvailable = raw.summaryRefIds.length > 0 &&
      raw.summaryRefIds.every((value) => refIds.has(value));
    const state: PiSituationState = {
      ...raw,
      sources: states,
      summary: summaryAvailable ? raw.summary : '',
      summaryRefIds: summaryAvailable ? [...raw.summaryRefIds] : [],
      refs: raw.refs.filter(({ id: value, source }) => available.has(source) && refIds.has(value)),
      facts: raw.facts.filter(({ source, stale, refIds: values, expiresAt }) =>
        available.has(source) && !stale && values.every((value) => refIds.has(value)) &&
        (expiresAt === null || Date.parse(expiresAt) > at.getTime())),
      followUps: raw.followUps.filter(({ refIds: values }) => values.every((value) => refIds.has(value))),
    };
    const staleSources = states.filter(({ state: value }) => value === 'stale').map(({ id: value }) => value);
    const missingSources = states.filter(({ state: value }) => value === 'missing').map(({ id: value }) => value);
    const disabledSources = states.filter(({ state: value }) => value === 'disabled').map(({ id: value }) => value);
    const freshSources = states.filter(({ state: value }) => value === 'fresh').map(({ id: value }) => value);
    return {
      state: record ? state : null,
      revision: record?.revision ?? 0,
      hash: record?.hash ?? null,
      policyRevision: proactiveSettingsRevision(settings),
      staleSources,
      missingSources,
      disabledSources,
      freshSources,
      asOf: record?.asOf.toISOString() ?? null,
      updatedAt: record?.updatedAt.toISOString() ?? null,
      lastActivation: record?.lastActivation ?? null,
    };
  }

  async function read(signal: AbortSignal): Promise<PiSituationView> {
    const [{ settings, statuses }, record] = await Promise.all([
      currentPolicy(signal),
      options.store.read(options.owner, signal),
    ]);
    return visible(record, settings, statuses, now());
  }

  return {
    read,
    async context(signal) {
      const view = await read(signal);
      const body = {
        revision: view.revision,
        hash: view.hash,
        asOf: view.asOf,
        staleSources: view.staleSources,
        missingSources: view.missingSources,
        freshSources: view.freshSources,
        sourceRefs: view.freshSources.includes('location') ? [{ source: 'location', ref: 'location:device' }] : [],
        state: view.state,
      };
      const compact = JSON.stringify(body);
      return {
        view,
        text: [
          '[Current PI situational state from Jarvis. This compact working context is not the source archive; use the refs and tools for detail. Disabled and stale source facts are excluded.]',
          compact,
        ].join('\n'),
      };
    },
    async markActivation(activation, signal) {
      await options.store.recordActivation(options.owner, activation, signal);
    },
    async commit(input, signal) {
      const policy = await currentPolicy(signal);
      if (policy.revision !== input.policyRevision) {
        throw new PiSituationError('conflict', 'Proactive policy changed. Read the situation again before committing.');
      }
      const current = await options.store.read(options.owner, signal);
      if ((current?.revision ?? 0) !== input.expectedRevision ||
          current !== null && current.hash !== input.expectedHash) {
        throw new PiSituationError('conflict', 'Situational state changed. Read the current revision before committing.');
      }
      const state = parsePiSituationState(input.state);
      const latestAllowed = now().getTime() + 5 * 60_000;
      const times = [
        state.asOf,
        ...state.refs.map(({ observedAt }) => observedAt),
        ...state.facts.map(({ observedAt }) => observedAt),
      ];
      if (times.some((value) => Date.parse(value) > latestAllowed)) {
        throw new PiSituationError('invalid', 'Situational state cannot claim a future observation.');
      }
      const excluded: SourceId[] = [];
      const submitted = clone(state);
      const retainedDisabled: PiSituationState['facts'] = [];
      const retainedRefs: PiSituationState['refs'] = [];
      for (const entry of submitted.sources) {
        if (policy.settings.sources[entry.id]) continue;
        excluded.push(entry.id);
        entry.state = 'disabled';
        entry.reason = 'source_disabled';
        entry.refIds = [];
        if (current) {
          retainedRefs.push(...current.state.refs.filter(({ source }) => source === entry.id));
          retainedDisabled.push(...current.state.facts.filter(({ source }) => source === entry.id)
            .map((fact) => ({ ...fact, stale: true })));
        }
      }
      const acceptedRefs = submitted.refs.filter(({ source }) => policy.settings.sources[source]);
      const refs = [...acceptedRefs, ...retainedRefs]
        .filter((entry, index, values) => values.findIndex(({ id: value }) => value === entry.id) === index)
        .slice(0, 48);
      const refIds = new Set(refs.map(({ id: value }) => value));
      const activeRefIds = new Set(acceptedRefs.map(({ id: value }) => value));
      const acceptedFacts = submitted.facts
        .filter(({ source, refIds: values }) => policy.settings.sources[source] && values.every((value) => refIds.has(value)));
      const staleFacts = retainedDisabled
        .filter(({ refIds: values }) => values.every((value) => refIds.has(value)));
      const facts = [...acceptedFacts, ...staleFacts].slice(0, 24);
      const followUps = submitted.followUps.filter(({ refIds: values }) =>
        values.every((value) => activeRefIds.has(value)));
      const filteredSummaryRefs = submitted.summaryRefIds.filter((value) => activeRefIds.has(value));
      const summary = filteredSummaryRefs.length === submitted.summaryRefIds.length &&
        filteredSummaryRefs.length > 0
        ? submitted.summary
        : '';
      const summaryRefIds = summary ? filteredSummaryRefs : [];
      const sourceById = new Map(policy.statuses.map((entry) => [entry.id, entry]));
      for (const entry of submitted.sources) {
        const status = sourceById.get(entry.id);
        if (status && (status.state === 'stale' || status.state === 'unavailable' || status.observedAt === null)) {
          entry.state = status.state === 'unavailable' || status.state === 'not_run' ? 'missing' : 'stale';
          entry.observedAt = status.observedAt;
          entry.reason = status.reason;
        }
        if (entry.state === 'disabled') entry.refIds = [];
        else entry.refIds = entry.refIds.filter((value) => refIds.has(value));
      }
      const next = parsePiSituationState({
        ...submitted,
        summary,
        summaryRefIds,
        refs,
        facts,
        followUps,
      });
      const beforeWrite = await currentPolicy(signal);
      if (beforeWrite.revision !== input.policyRevision) {
        throw new PiSituationError('conflict', 'Proactive policy changed. Read the situation again before committing.');
      }
      const record = await options.store.commit({
        owner: options.owner,
        expectedRevision: input.expectedRevision,
        expectedHash: input.expectedHash,
        state: next,
        activation: input.activation,
      }, signal);
      return { record, excluded: [...new Set(excluded)] };
    },
    async markFailed(input, signal) {
      const current = await options.store.read(options.owner, signal);
      if (!current) return;
      if (current.revision !== input.expectedRevision || current.hash !== input.expectedHash) return;
      const state = credentialSafeState(clone(current.state));
      state.sources = state.sources.map((source) => source.state === 'disabled'
        ? source
        : { ...source, state: 'stale', reason: 'activation_failed' });
      state.facts = state.facts.map((fact) => ({ ...fact, stale: true }));
      state.asOf = current.asOf.toISOString();
      const next = parsePiSituationState(state);
      await options.store.commit({
        owner: options.owner,
        expectedRevision: current.revision,
        expectedHash: current.hash,
        state: next,
        activation: input.activation,
      }, signal);
    },
    async lookup(input, signal) {
      const { settings } = await currentPolicy(signal);
      if (!settings.sources[input.source]) {
        throw new PiSituationError('invalid', `${input.source} is disabled in Proactive settings.`);
      }
      const sources = typeof options.sources === 'function' ? options.sources() : options.sources;
      const source = sources.find(({ id: value }) => value === input.source);
      if (!source) throw new PiSituationError('unavailable', `${input.source} is not connected.`);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      const result = await source.read({ now: now(), signal: deadline, settings });
      if (result.state !== 'ok') {
        throw new PiSituationError('unavailable', `${input.source} could not be read${result.reason ? `: ${result.reason}` : ''}.`);
      }
      const fact = result.facts.find(({ ref, identity }) => ref === input.ref || identity === input.ref);
      if (!fact) throw new PiSituationError('invalid', 'That raw source reference is no longer available.');
      const value = {
        source: input.source, ref: fact.ref, identity: fact.identity ?? null, label: fact.label,
        text: fact.text, observedAt: fact.observedAt, dueAt: fact.dueAt ?? null,
        startsAt: fact.startsAt ?? null, endsAt: fact.endsAt ?? null,
      };
      if (hasCredentialMarker(JSON.stringify(value))) {
        throw new PiSituationError('redacted', 'That source record contains a credential and is not returned here.');
      }
      return boundedResult(value);
    },
  };
}

export function createMemoryPiSituationStore(): PiSituationStore & { readonly records: Map<string, PiSituationRecord> } {
  const records = new Map<string, PiSituationRecord>();
  return {
    records,
    async read(owner) {
      const record = records.get(owner);
      return record ? structuredClone(record) : null;
    },
    async commit(input) {
      const current = records.get(input.owner);
      if ((current?.revision ?? 0) !== input.expectedRevision ||
          current !== undefined && current.hash !== input.expectedHash) {
        throw new PiSituationError('conflict', 'Situational state changed. Read the current revision before committing.');
      }
      const record: PiSituationRecord = {
        owner: input.owner,
        revision: (current?.revision ?? 0) + 1,
        state: structuredClone(input.state),
        hash: piSituationHash(input.state),
        asOf: new Date(input.state.asOf),
        updatedAt: input.activation.at,
        lastActivation: {
          id: input.activation.id,
          type: input.activation.type,
          source: input.activation.source,
          at: input.activation.at,
        },
      };
      records.set(input.owner, record);
      return structuredClone(record);
    },
    async recordActivation(owner, activation) {
      const current = records.get(owner);
      if (!current) return;
      records.set(owner, {
        ...current,
        updatedAt: activation.at,
        lastActivation: {
          id: activation.id, type: activation.type, source: activation.source, at: activation.at,
        },
      });
    },
  };
}
