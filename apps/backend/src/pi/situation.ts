import { createHash } from 'node:crypto';
import { z } from 'zod';
import { proactiveSettingsRevision } from '../proactive/preferences.js';
import type { ProactiveStore } from '../proactive/store.js';
import type { EventQueueStore } from '../proactive/events/event-queue.js';
import {
  sourceIds, type ProactiveSettings, type ProactiveSource, type SourceId, type SourceResult, type SourceStatus,
} from '../proactive/types.js';
import { hasCredentialMarkerDeep } from '../core/memory-policy.js';

export const PI_SITUATION_SCHEMA_VERSION = 1 as const;
export const PI_SITUATION_MAX_BYTES = 8 * 1024;
export const PI_SITUATION_LOOKUP_MAX_BYTES = 8 * 1024;
export const PI_SITUATION_PATCH_MAX_BYTES = 6 * 1024;
const iso = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u);
const sourceId = z.enum(sourceIds);

const sourceSchema = z.object({
  id: sourceId,
  state: z.enum(['fresh', 'stale', 'missing', 'disabled']),
  observedAt: iso.nullable(),
  verifiedAt: iso.optional(),
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
  materialHash: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
  verifiedAt: iso.optional(),
}).strict();

const factSchema = z.object({
  id,
  source: sourceId,
  refIds: z.array(id).min(1).max(4),
  text: z.string().min(1).max(600),
  observedAt: iso,
  expiresAt: iso.nullable(),
  stale: z.boolean(),
  staleReason: z.string().min(1).max(160).optional(),
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
export type PiSituationAuthorityRef = PiSituationState['refs'][number] & {
  readonly verifiedAt: string;
  readonly receiptId?: string;
  readonly activatedAt: string | null;
  readonly invalidatedAt: string | null;
  readonly staleReason: string | null;
};
export interface PiSituationSourceObservation {
  readonly source: SourceId;
  readonly state: SourceStatus['state'];
  readonly reason: string | null;
  readonly observedAt: string | null;
  readonly verifiedAt: string;
}
const patchSchema = z.object({
  asOf: iso.optional(),
  summary: z.union([
    z.null(),
    z.object({ text: z.string().max(1_600), refIds: z.array(id).max(8) }).strict(),
  ]).optional(),
  sources: z.array(sourceSchema).max(sourceIds.length).optional(),
  upsertRefs: z.array(refSchema).max(16).optional(),
  removeRefIds: z.array(id).max(16).optional(),
  upsertFacts: z.array(factSchema).max(12).optional(),
  removeFactIds: z.array(id).max(12).optional(),
  upsertFollowUps: z.array(followUpSchema).max(8).optional(),
  removeFollowUpIds: z.array(id).max(8).optional(),
}).strict().superRefine((patch, context) => {
  const unique = (values: readonly { id: string }[] | readonly string[] | undefined) => {
    const items = values?.map((value) => typeof value === 'string' ? value : value.id) ?? [];
    return new Set(items).size === items.length;
  };
  if (!unique(patch.sources) || !unique(patch.upsertRefs) || !unique(patch.removeRefIds) ||
      !unique(patch.upsertFacts) || !unique(patch.removeFactIds) ||
      !unique(patch.upsertFollowUps) || !unique(patch.removeFollowUpIds)) {
    context.addIssue({ code: 'custom', message: 'Patch entries must be unique' });
  }
});
export type PiSituationPatch = z.infer<typeof patchSchema>;
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
  readonly authoritativeRefs: readonly PiSituationAuthorityRef[];
  readonly lastActivation: null | {
    readonly id: string;
    readonly type: PiActivationType;
    readonly source: string | null;
    readonly at: Date;
  };
}

export interface PiSituationActivation {
  readonly id: string;
  readonly type: PiActivationType;
  readonly source: string | null;
  readonly at: Date;
}

export interface PiSituationCommit {
  readonly owner: string;
  readonly expectedRevision: number;
  readonly expectedHash: string | null;
  readonly state: PiSituationState;
  readonly activation: PiSituationActivation | null;
  readonly policyRevision: string;
  readonly followUpActions: readonly PiSituationFollowUpAction[];
  readonly authoritativeRefs: readonly PiSituationAuthorityRef[];
  readonly observations: readonly PiSituationSourceObservation[];
  readonly preserveInvalidated?: boolean;
}

export type PiSituationFollowUpAction =
  | {
    readonly operation: 'cancel';
    readonly identity: string;
    readonly followUpId: string;
  }
  | {
    readonly operation: 'upsert';
    readonly followUpId: string;
    readonly event: {
      readonly source: string;
      readonly kind: string;
      readonly identity: string;
      readonly material: unknown;
      readonly dedupeKey: string;
      readonly summary: string;
      readonly detail: Record<string, unknown>;
      readonly occurredAt: string;
      readonly notBeforeAt: string;
    };
  };

export interface PiSituationStore {
  readonly atomicObservations: boolean;
  read(owner: string, signal: AbortSignal): Promise<PiSituationRecord | null>;
  initialize(owner: string, state: PiSituationState, at: Date, signal: AbortSignal): Promise<PiSituationRecord>;
  commit(input: PiSituationCommit, signal: AbortSignal): Promise<PiSituationRecord>;
  recordLookupAuthority(
    owner: string,
    ref: PiSituationAuthorityRef,
    policyRevision: string,
    signal: AbortSignal,
  ): Promise<void>;
  recordActivation(
    owner: string,
    activation: PiSituationActivation,
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
  policy(signal: AbortSignal): Promise<{
    readonly revision: string;
    readonly disabledSources: readonly SourceId[];
  }>;
  context(signal: AbortSignal): Promise<{ text: string; view: PiSituationView }>;
  markActivation(activation: PiSituationActivation, signal: AbortSignal): Promise<void>;
  commit(input: {
    readonly expectedRevision: number;
    readonly expectedHash: string | null;
    readonly policyRevision: string;
    readonly state: unknown;
    readonly activation: PiSituationActivation;
  }, signal: AbortSignal): Promise<{ record: PiSituationRecord; excluded: readonly SourceId[] }>;
  patch(input: {
    readonly expectedRevision: number;
    readonly expectedHash: string | null;
    readonly policyRevision: string;
    readonly patch: unknown;
    readonly activation: PiSituationActivation;
  }, signal: AbortSignal): Promise<{
    readonly record: PiSituationRecord;
    readonly excluded: readonly SourceId[];
    readonly changed: boolean;
  }>;
  markFailed(input: {
    readonly activation: PiSituationActivation;
    readonly expectedRevision: number;
    readonly expectedHash: string | null;
    readonly sources?: readonly SourceId[];
  }, signal: AbortSignal): Promise<void>;
  observe(source: SourceId, result: SourceResult, signal: AbortSignal): Promise<{
    readonly changed: boolean;
    readonly baseline: boolean;
    readonly admissible: boolean;
  }>;
  refresh(source: SourceId, signal: AbortSignal): Promise<{
    readonly changed: boolean;
    readonly baseline: boolean;
    readonly admissible: boolean;
  }>;
  attachEvents(queue: EventQueueStore, wake?: (() => void) | undefined): void;
  synchronizeFollowUps(signal: AbortSignal): Promise<{ changed: boolean; pending: boolean }>;
  lookup(input: { readonly source: SourceId; readonly ref: string }, signal: AbortSignal): Promise<Record<string, unknown>>;
}

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

function parsePiSituationStructure(value: unknown): PiSituationState {
  const result = schema.safeParse(value);
  if (!result.success || jsonBytes(result.data) > PI_SITUATION_MAX_BYTES) {
    throw new PiSituationError('invalid', 'The situational state did not match the bounded schema.');
  }
  return result.data;
}

export function parsePiSituationState(value: unknown): PiSituationState {
  const state = parsePiSituationStructure(value);
  if (hasCredentialMarkerDeep(state)) {
    throw new PiSituationError('redacted', 'Secrets and credentials cannot be stored in situational state.');
  }
  return state;
}

export function parsePiSituationPatch(value: unknown): PiSituationPatch {
  const result = patchSchema.safeParse(value);
  if (!result.success || jsonBytes(result.data) > PI_SITUATION_PATCH_MAX_BYTES ||
      hasCredentialMarkerDeep(result.data)) {
    const code = hasCredentialMarkerDeep(value)
      ? 'redacted' : 'invalid';
    throw new PiSituationError(code, code === 'redacted'
      ? 'Secrets and credentials cannot be stored in situational state patches.'
      : 'The situational state patch did not match the bounded schema.');
  }
  return result.data;
}

export function piSituationHash(state: PiSituationState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function authorityKey(
  ref: Pick<PiSituationState['refs'][number], 'source' | 'id' | 'verifiedAt' | 'materialHash'>,
): string {
  return `${ref.source}\u0000${ref.id}\u0000${ref.verifiedAt ?? ''}\u0000${ref.materialHash ?? ''}`;
}

function stateRef(authority: PiSituationAuthorityRef): PiSituationState['refs'][number] {
  return {
    id: authority.id,
    source: authority.source,
    identity: authority.identity,
    label: authority.label,
    observedAt: authority.observedAt,
    expiresAt: authority.expiresAt,
    ...(authority.materialHash ? { materialHash: authority.materialHash } : {}),
    verifiedAt: authority.verifiedAt,
  };
}

export function canonicalizePiSituationState(
  state: PiSituationState,
  authoritativeRefs: readonly PiSituationAuthorityRef[],
  allowInvalidated = false,
): PiSituationState {
  const authority = new Map(authoritativeRefs.map((ref) => [authorityKey(ref), structuredClone(ref)]));
  const refs = state.refs.map((ref) => {
    const canonical = authority.get(authorityKey(ref));
    if (!canonical ||
        (!allowInvalidated && canonical.invalidatedAt !== null)) {
      throw new PiSituationError(
        'invalid',
        'A situational reference was not observed by a provider or verified by a live lookup.',
      );
    }
    return stateRef(canonical);
  });
  return parsePiSituationState({ ...state, refs });
}

export function retainAuthoritativePiSituationState(
  state: PiSituationState,
  authoritativeRefs: readonly PiSituationAuthorityRef[],
  includeInvalidated = false,
): PiSituationState {
  const authority = new Map(authoritativeRefs.map((ref) => [authorityKey(ref), structuredClone(ref)]));
  const refs = state.refs.flatMap((ref) => {
    const canonical = authority.get(authorityKey(ref));
    return canonical && canonical.activatedAt !== null &&
      (includeInvalidated || canonical.invalidatedAt === null)
      ? [stateRef(canonical)]
      : [];
  });
  const validRefIds = new Set(refs.map(({ id: value }) => value));
  const facts = state.facts.filter(({ refIds }) => refIds.every((value) => validRefIds.has(value)));
  const followUps = state.followUps.filter(({ refIds }) => refIds.every((value) => validRefIds.has(value)));
  const summaryRefIds = state.summaryRefIds.filter((value) => validRefIds.has(value));
  const summary = summaryRefIds.length > 0 &&
    summaryRefIds.length === state.summaryRefIds.length ? state.summary : '';
  return parsePiSituationState({
    ...state,
    sources: state.sources.map((source) => ({
      ...source,
      refIds: source.refIds.filter((value) => validRefIds.has(value)),
    })),
    refs,
    facts,
    followUps,
    summary,
    summaryRefIds: summary ? summaryRefIds : [],
  });
}

export function sourceRefsFor(state: PiSituationState): unknown {
  return state.refs.map(({ id: value, source, identity, label, observedAt, expiresAt, materialHash, verifiedAt }) => ({
    id: value, source, identity, label, observedAt, expiresAt,
    ...(materialHash ? { materialHash } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
  }));
}

export function freshnessFor(state: PiSituationState): unknown {
  return state.sources.map(({ id: value, state: freshness, observedAt, verifiedAt, expiresAt, reason }) => ({
    source: value, state: freshness, observedAt, verifiedAt, expiresAt, reason,
  }));
}

export function staleReasonsFor(state: PiSituationState): unknown {
  return state.sources
    .filter(({ state: value }) => value === 'stale' || value === 'missing')
    .map(({ id: value, state: freshness, reason }) => ({ source: value, state: freshness, reason }));
}

function emptyState(now: Date, settings?: ProactiveSettings, statuses?: readonly SourceStatus[]): PiSituationState {
  const byStatus = new Map(statuses?.map((status) => [status.id, status]));
  return {
    version: PI_SITUATION_SCHEMA_VERSION,
    asOf: now.toISOString(),
    summary: '',
    summaryRefIds: [],
    sources: sourceIds.map((value) => {
      const status = byStatus?.get(value);
      const enabled = settings?.sources[value] ?? true;
      const verifiedAt = status?.verifiedAt ?? status?.observedAt;
      const invalidated = status?.invalidatedAt && verifiedAt &&
        Date.parse(verifiedAt) <= Date.parse(status.invalidatedAt);
      const state = !enabled ? 'disabled' : invalidated ? 'stale' : status?.state === 'ok' ? 'fresh'
        : status?.state === 'stale' ? 'stale'
          : 'missing';
      return {
        id: value,
        state,
        observedAt: status?.observedAt ?? null,
        ...(status?.verifiedAt ? { verifiedAt: status.verifiedAt } : {}),
        expiresAt: null,
        reason: !enabled ? 'source_disabled' : invalidated
          ? 'observation_not_newer_than_source_invalidation'
          : status?.state === 'ok' ? null : status?.reason ?? 'not_observed',
        refIds: [],
      } as PiSituationState['sources'][number];
    }),
    refs: [],
    facts: [],
    followUps: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function credentialSafeState(state: PiSituationState): PiSituationState {
  const refs = state.refs.filter((ref) => !hasCredentialMarkerDeep(ref));
  const refIds = new Set(refs.map(({ id: value }) => value));
  const summarySafe = !hasCredentialMarkerDeep(state.summary);
  const summaryRefIds = summarySafe
    ? state.summaryRefIds.filter((value) => refIds.has(value))
    : [];
  return {
    ...state,
    summary: summarySafe && summaryRefIds.length === state.summaryRefIds.length ? state.summary : '',
    summaryRefIds: summarySafe ? summaryRefIds : [],
    sources: state.sources.map((source) => ({
      ...source,
      reason: hasCredentialMarkerDeep(source.reason) ? null : source.reason,
      refIds: source.refIds.filter((value) => refIds.has(value)),
    })),
    refs,
    facts: state.facts.filter((fact) =>
      !hasCredentialMarkerDeep(fact) &&
      fact.refIds.every((value) => refIds.has(value))),
    followUps: state.followUps.filter((followUp) =>
      !hasCredentialMarkerDeep(followUp) &&
      followUp.refIds.every((value) => refIds.has(value))),
  };
}

/** One-time read adapter for rows written before the stricter Memory credential classifier. */
export function sanitizeLegacyPiSituationState(value: unknown): {
  readonly original: PiSituationState;
  readonly state: PiSituationState;
  readonly changed: boolean;
} {
  const original = parsePiSituationStructure(value);
  const state = parsePiSituationState(credentialSafeState(original));
  return { original, state, changed: JSON.stringify(original) !== JSON.stringify(state) };
}

function sourceState(status: SourceStatus | undefined, now: Date, settings: ProactiveSettings):
'fresh' | 'stale' | 'missing' | 'disabled' {
  if (!status?.enabled || !settings.sources[status.id]) return 'disabled';
  if (status.state === 'unavailable' || status.state === 'not_run' || status.observedAt === null) return 'missing';
  const verifiedAt = status.verifiedAt ?? status.observedAt;
  if (status.invalidatedAt && verifiedAt &&
      Date.parse(verifiedAt) <= Date.parse(status.invalidatedAt)) return 'stale';
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

export function currentSituationFollowUpActions(
  state: PiSituationState,
  settings: ProactiveSettings,
  at: Date,
): PiSituationFollowUpAction[] {
  const refs = new Map(state.refs.map((ref) => [ref.id, ref]));
  const sources = new Map(state.sources.map((source) => [source.id, source]));
  return state.followUps.flatMap((followUp) => {
    if (followUp.dueAt === null || followUp.refIds.length === 0 ||
        !followUp.refIds.every((id) => {
          const ref = refs.get(id);
          return ref !== undefined && settings.sources[ref.source] &&
            sources.get(ref.source)?.state === 'fresh' &&
            (ref.expiresAt === null || Date.parse(ref.expiresAt) > at.getTime());
        })) {
      return [];
    }
    const dueAt = new Date(followUp.dueAt);
    if (!Number.isFinite(dueAt.getTime())) return [];
    const identity = `pi-followup:${followUp.id}`;
    const material = {
      text: followUp.text,
      dueAt: followUp.dueAt,
      refIds: [...followUp.refIds],
    };
    const materialHash = createHash('sha256').update(JSON.stringify(material)).digest('hex');
    return [{
      operation: 'upsert' as const,
      followUpId: followUp.id,
      event: {
        source: 'followup',
        kind: 'commitment.due',
        identity,
        material,
        dedupeKey: `${identity}:${materialHash}`,
        summary: followUp.text,
        detail: {
          followUpId: followUp.id,
          dueAt: followUp.dueAt,
          refIds: [...followUp.refIds],
          evidenceSources: [...new Set(followUp.refIds.flatMap((id) => {
            const ref = refs.get(id);
            return ref ? [ref.source] : [];
          }))],
        },
        occurredAt: dueAt.toISOString(),
        notBeforeAt: dueAt.toISOString(),
      },
    }];
  });
}

export function createPiSituationService(options: {
  readonly owner: string;
  readonly store: PiSituationStore;
  readonly proactive: ProactiveStore;
  readonly sources: readonly ProactiveSource[] | (() => readonly ProactiveSource[]);
  readonly now?: () => Date;
}): PiSituationService {
  const now = options.now ?? (() => new Date());
  let events: EventQueueStore | undefined;
  let wakeEvents: (() => void) | undefined;
  let memoryFollowUpSnapshot: PiSituationState | null = null;

  async function updateMemoryObservations(
    observations: readonly PiSituationSourceObservation[],
  ): Promise<void> {
    if (options.store.atomicObservations) return;
    for (const observation of observations) {
      await options.proactive.sources.upsert({
        id: observation.source,
        label: observation.source,
        enabled: true,
        state: observation.state,
        reason: observation.reason,
        observedAt: observation.observedAt,
        verifiedAt: observation.verifiedAt,
      });
    }
  }

  function pendingReferenceObservations(
    state: PiSituationState,
    authoritativeRefs: readonly PiSituationAuthorityRef[],
  ): PiSituationSourceObservation[] {
    const latest = new Map<SourceId, {
      source: SourceId;
      observedAt: string;
      verifiedAt: string;
    }>();
    for (const ref of state.refs) {
      if (!ref.verifiedAt) continue;
      const authority = authoritativeRefs.find((entry) =>
        authorityKey(entry) === authorityKey(ref));
      if (!authority || authority.activatedAt !== null ||
          authority.invalidatedAt !== null) continue;
      const previous = latest.get(ref.source);
      if (!previous || Date.parse(ref.verifiedAt) > Date.parse(previous.verifiedAt)) {
        latest.set(ref.source, {
          source: ref.source,
          observedAt: ref.observedAt,
          verifiedAt: ref.verifiedAt,
        });
      }
    }
    return [...latest.values()].map((ref) => ({
      source: ref.source,
      state: 'ok' as const,
      reason: null,
      observedAt: ref.observedAt,
      verifiedAt: ref.verifiedAt,
    }));
  }

  function policyWithObservations<T extends {
    settings: ProactiveSettings;
    statuses: readonly SourceStatus[];
  }>(
    policy: T,
    observations: readonly PiSituationSourceObservation[],
  ): T {
    const statuses = new Map(policy.statuses.map((status) => [status.id, status]));
    for (const observation of observations) {
      const current = statuses.get(observation.source);
      const invalidatedAt = current?.invalidatedAt;
      if (!policy.settings.sources[observation.source] ||
          invalidatedAt && Date.parse(observation.verifiedAt) <= Date.parse(invalidatedAt)) {
        continue;
      }
      statuses.set(observation.source, {
        id: observation.source,
        label: current?.label ?? observation.source,
        enabled: true,
        state: observation.state,
        reason: observation.reason,
        observedAt: observation.observedAt,
        verifiedAt: observation.verifiedAt,
        invalidatedAt: current?.invalidatedAt ?? null,
      });
    }
    return { ...policy, statuses: [...statuses.values()] };
  }

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
    return { settings, revision: proactiveSettingsRevision(settings), statuses: storedStatuses };
  }

  function visible(record: PiSituationRecord | null, settings: ProactiveSettings, statuses: readonly SourceStatus[], at: Date): PiSituationView {
    const raw = credentialSafeState(record
      ? retainAuthoritativePiSituationState(record.state, record.authoritativeRefs)
      : emptyState(at, settings, statuses));
    const byStatus = new Map(statuses.map((status) => [status.id, status]));
    const states = raw.sources.map((entry) => {
      const status = byStatus.get(entry.id);
      const statusVerifiedAt = status?.verifiedAt ?? status?.observedAt;
      const generationMismatch = statusVerifiedAt !== null && statusVerifiedAt !== undefined &&
        entry.verifiedAt !== undefined &&
        Date.parse(entry.verifiedAt) !== Date.parse(statusVerifiedAt);
      const freshness = generationMismatch ? 'stale' : sourceState(status ?? {
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
        verifiedAt: status?.verifiedAt ?? entry.verifiedAt,
        reason: freshness === 'disabled' ? 'source_disabled'
          : expired ? 'expired' : freshness === 'missing' ? status?.reason ?? entry.reason ?? 'not_observed'
            : freshness === 'stale' ? generationMismatch
              ? 'source_observation_generation_mismatch'
              : status?.reason ?? entry.reason ?? 'stale'
              : null,
      } as PiSituationState['sources'][number];
    });
    const available = new Set(states.filter(({ state }) => state === 'fresh').map(({ id: value }) => value));
    const refIds = new Set(raw.refs.filter(({ source, verifiedAt, expiresAt }) => {
      const invalidatedAt = byStatus.get(source)?.invalidatedAt;
      return available.has(source) &&
        verifiedAt !== undefined &&
        (!invalidatedAt || Date.parse(verifiedAt) > Date.parse(invalidatedAt)) &&
        (expiresAt === null || Date.parse(expiresAt) > at.getTime());
    })
      .map(({ id: value }) => value));
    const summaryAvailable = raw.summaryRefIds.length > 0 &&
      raw.summaryRefIds.every((value) => refIds.has(value));
    const state: PiSituationState = {
      ...raw,
      sources: states.map((source) => ({
        ...source,
        refIds: source.refIds.filter((value) => refIds.has(value)),
      })),
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
      state,
      revision: record?.revision ?? 1,
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
    const policy = await currentPolicy(signal);
    let record = await options.store.read(options.owner, signal);
    if (!record) {
      record = await options.store.initialize(
        options.owner,
        parsePiSituationState(emptyState(now(), policy.settings, policy.statuses)),
        now(),
        signal,
      );
    }
    return visible(record, policy.settings, policy.statuses, now());
  }

  function validateTimes(state: PiSituationState): void {
    const latestAllowed = now().getTime() + 5 * 60_000;
    const times = [
      state.asOf,
      ...state.refs.map(({ observedAt }) => observedAt),
      ...state.facts.map(({ observedAt }) => observedAt),
    ];
    if (times.some((value) => Date.parse(value) > latestAllowed)) {
      throw new PiSituationError('invalid', 'Situational state cannot claim a future observation.');
    }
  }

  function applyPatch(base: PiSituationState, value: unknown): PiSituationState {
    const patch = parsePiSituationPatch(value);
    const next = clone(base);
    if (patch.asOf !== undefined) next.asOf = patch.asOf;
    for (const entry of patch.sources ?? []) {
      const index = next.sources.findIndex(({ id: value }) => value === entry.id);
      next.sources[index] = structuredClone(entry);
    }
    const removedRefs = new Set(patch.removeRefIds ?? []);
    next.refs = next.refs.filter(({ id: value }) => !removedRefs.has(value));
    for (const entry of patch.upsertRefs ?? []) {
      const index = next.refs.findIndex(({ id: value }) => value === entry.id);
      if (index >= 0) next.refs[index] = structuredClone(entry);
      else next.refs.push(structuredClone(entry));
    }
    const refIds = new Set(next.refs.map(({ id: value }) => value));
    const removedFacts = new Set(patch.removeFactIds ?? []);
    next.facts = next.facts.filter((entry) =>
      !removedFacts.has(entry.id) && !entry.refIds.some((ref) => removedRefs.has(ref)) &&
      entry.refIds.every((ref) => refIds.has(ref)));
    for (const entry of patch.upsertFacts ?? []) {
      const index = next.facts.findIndex(({ id: value }) => value === entry.id);
      if (index >= 0) next.facts[index] = structuredClone(entry);
      else next.facts.push(structuredClone(entry));
    }
    const removedFollowUps = new Set(patch.removeFollowUpIds ?? []);
    next.followUps = next.followUps.filter((entry) =>
      !removedFollowUps.has(entry.id) && !entry.refIds.some((ref) => removedRefs.has(ref)) &&
      entry.refIds.every((ref) => refIds.has(ref)));
    for (const entry of patch.upsertFollowUps ?? []) {
      const index = next.followUps.findIndex(({ id: value }) => value === entry.id);
      if (index >= 0) next.followUps[index] = structuredClone(entry);
      else next.followUps.push(structuredClone(entry));
    }
    if (patch.summary === null) {
      next.summary = '';
      next.summaryRefIds = [];
    } else if (patch.summary) {
      next.summary = patch.summary.text;
      next.summaryRefIds = [...patch.summary.refIds];
    } else if (next.summaryRefIds.some((value) => removedRefs.has(value))) {
      next.summary = '';
      next.summaryRefIds = [];
    }
    return parsePiSituationState(next);
  }

  function applyPolicy(
    submitted: PiSituationState,
    current: PiSituationRecord | null,
    policy: { readonly settings: ProactiveSettings; readonly statuses: readonly SourceStatus[] },
    options: {
      readonly preserveInvalidated?: boolean;
      readonly removedRefIds?: ReadonlySet<string>;
      readonly removedFactIds?: ReadonlySet<string>;
      readonly removedFollowUpIds?: ReadonlySet<string>;
      readonly summaryRemoved?: boolean;
    } = {},
  ): { readonly state: PiSituationState; readonly excluded: readonly SourceId[] } {
    const excluded: SourceId[] = [];
    const retainedDisabled: PiSituationState['facts'] = [];
    const retainedRefs: PiSituationState['refs'] = [];
    const next = clone(submitted);
    const sourceById = new Map(policy.statuses.map((entry) => [entry.id, entry]));
    const invalidatedFor = (ref: PiSituationState['refs'][number]) => {
      const invalidatedAt = sourceById.get(ref.source)?.invalidatedAt;
      return invalidatedAt !== undefined && invalidatedAt !== null &&
        (ref.verifiedAt === undefined ||
          Date.parse(ref.verifiedAt) <= Date.parse(invalidatedAt));
    };
    const staleSource = (source: SourceId) => {
      const entry = sourceById.get(source);
      return !policy.settings.sources[source] ||
        entry?.state === 'stale' ||
        entry?.state === 'unavailable' ||
        entry?.state === 'not_run';
    };
    const removedRefIds = options.removedRefIds ?? new Set<string>();
    const removedFactIds = options.removedFactIds ?? new Set<string>();
    const removedFollowUpIds = options.removedFollowUpIds ?? new Set<string>();
    for (const entry of next.sources) {
      if (policy.settings.sources[entry.id]) continue;
      excluded.push(entry.id);
      entry.state = 'disabled';
      entry.reason = 'source_disabled';
      entry.refIds = [];
      if (current) {
        retainedRefs.push(...current.state.refs.filter(({ source }) => source === entry.id));
        retainedDisabled.push(...current.state.facts.filter(({ source }) => source === entry.id)
          .map((fact) => ({ ...fact, stale: true, staleReason: 'source_disabled' })));
      }
    }
    if (options.preserveInvalidated && current) {
      retainedRefs.push(...current.state.refs.filter((ref) =>
        !removedRefIds.has(ref.id) &&
        (invalidatedFor(ref) || staleSource(ref.source))));
    }
    retainedRefs.push(...next.refs.filter(invalidatedFor).map((ref) => ({
      ...ref,
      expiresAt: sourceById.get(ref.source)?.invalidatedAt ?? ref.expiresAt,
    })));
    const acceptedRefs = next.refs.filter((ref) =>
      policy.settings.sources[ref.source] && !invalidatedFor(ref));
    const refs = [...acceptedRefs, ...retainedRefs]
      .filter((entry, index, values) => values.findIndex(({ id: value }) => value === entry.id) === index);
    if (refs.length > 48) {
      throw new PiSituationError(
        'invalid',
        'Preserving stale reconciliation references would exceed the 48-ref limit. Remove obsolete refs explicitly before committing.',
      );
    }
    const refIds = new Set(refs.map(({ id: value }) => value));
    const activeRefIds = new Set(acceptedRefs
      .filter(({ id: value }) => refIds.has(value))
      .map(({ id: value }) => value));
    const acceptedFacts = next.facts
      .filter(({ source, refIds: values }) =>
        policy.settings.sources[source] && values.every((value) => activeRefIds.has(value)));
    const retainedStaleFacts = options.preserveInvalidated && current
      ? current.state.facts.filter((fact) =>
        !removedFactIds.has(fact.id) &&
        fact.refIds.every((value) => refIds.has(value)) &&
        (fact.source !== undefined && staleSource(fact.source)))
        .map((fact) => ({
          ...fact,
          stale: true,
          staleReason: fact.staleReason ?? 'source_not_current',
        }))
      : [];
    const staleFacts = [
      ...next.facts.filter((fact) =>
        !policy.settings.sources[fact.source] || fact.refIds.some((value) =>
          refs.some((ref) => ref.id === value && invalidatedFor(ref))))
        .map((fact) => ({
          ...fact,
          stale: true,
          staleReason: 'source_observation_not_newer_than_invalidation' as const,
        })),
      ...retainedDisabled,
      ...retainedStaleFacts,
    ]
      .filter(({ refIds: values }) => values.every((value) => refIds.has(value)));
    const facts = [...acceptedFacts, ...staleFacts]
      .filter((entry, index, values) => values.findIndex(({ id: value }) => value === entry.id) === index);
    if (facts.length > 24) {
      throw new PiSituationError(
        'invalid',
        'Preserving stale reconciliation facts would exceed the 24-fact limit. Remove obsolete facts explicitly before committing.',
      );
    }
    const retainedFollowUps = options.preserveInvalidated && current
      ? current.state.followUps.filter((followUp) =>
        !removedFollowUpIds.has(followUp.id) &&
        followUp.refIds.every((value) => refIds.has(value)) &&
        followUp.refIds.some((value) =>
          current.state.refs.some((ref) => ref.id === value &&
            (invalidatedFor(ref) || staleSource(ref.source)))))
      : [];
    const followUps = [...next.followUps, ...retainedFollowUps]
      .filter(({ id: value, refIds: values }) =>
        !removedFollowUpIds.has(value) &&
        values.every((id) => refIds.has(id)))
      .filter((entry, index, values) =>
        values.findIndex(({ id: value }) => value === entry.id) === index);
    if (followUps.length > 16) {
      throw new PiSituationError(
        'invalid',
        'Preserving stale reconciliation follow-ups would exceed the 16-follow-up limit. Remove obsolete follow-ups explicitly before committing.',
      );
    }
    const retainedSummaryRefs = next.summaryRefIds.filter((value) => refIds.has(value));
    const unchangedStoredSummary = current !== null &&
      next.summary === current.state.summary &&
      next.summaryRefIds.length === current.state.summaryRefIds.length &&
      next.summaryRefIds.every((value, index) => value === current.state.summaryRefIds[index]);
    const summaryIsActive = retainedSummaryRefs.length === next.summaryRefIds.length &&
      retainedSummaryRefs.length > 0 &&
      next.summaryRefIds.every((value) => activeRefIds.has(value));
    const currentSummaryStale = options.preserveInvalidated && current !== null &&
      current.state.summary.length > 0 &&
      current.state.summaryRefIds.every((value) => refIds.has(value)) &&
      current.state.summaryRefIds.some((value) =>
        current.state.refs.some((ref) => ref.id === value &&
          (invalidatedFor(ref) || staleSource(ref.source))));
    const summaryExplicitlyRemoved = options.summaryRemoved === true ||
      current?.state.summaryRefIds.some((value) => removedRefIds.has(value)) === true;
    const summary = !summaryExplicitlyRemoved && currentSummaryStale &&
        next.summary.length === 0
      ? current.state.summary
      : retainedSummaryRefs.length === next.summaryRefIds.length &&
      retainedSummaryRefs.length > 0 &&
      (summaryIsActive || unchangedStoredSummary) ? next.summary : '';
    const summaryRefIds = summary === current?.state.summary && next.summary.length === 0
      ? [...current.state.summaryRefIds]
      : summary ? retainedSummaryRefs : [];
    for (const entry of next.sources) {
      const status = sourceById.get(entry.id);
      const invalidated = status?.invalidatedAt !== null && status?.invalidatedAt !== undefined &&
        (status.verifiedAt ?? status.observedAt) !== null &&
        Date.parse(status.verifiedAt ?? status.observedAt!) <= Date.parse(status.invalidatedAt);
      if (invalidated) {
        entry.state = 'stale';
        entry.observedAt = status!.observedAt;
        entry.verifiedAt = status!.verifiedAt ?? status!.observedAt ?? undefined;
        entry.reason = 'observation_not_newer_than_source_invalidation';
      } else if (status && (status.state === 'stale' || status.state === 'unavailable' ||
          status.state === 'not_run' || status.observedAt === null)) {
        entry.state = status.state === 'unavailable' || status.state === 'not_run' || status.observedAt === null
          ? 'missing' : 'stale';
        entry.observedAt = status.observedAt;
        entry.verifiedAt = status.verifiedAt ?? status.observedAt ?? undefined;
        entry.reason = status.reason;
      }
      if (entry.state === 'disabled') entry.refIds = [];
      else entry.refIds = entry.refIds.filter((value) => refIds.has(value));
    }
    return {
      state: parsePiSituationState({
        ...next,
        summary,
        summaryRefIds,
        refs,
        facts,
        followUps,
      }),
      excluded: [...new Set(excluded)],
    };
  }

  function followUpIdentity(followUpId: string): string {
    return `pi-followup:${followUpId}`;
  }

  function followUpActions(
    previous: PiSituationState | null,
    next: PiSituationState,
    policy: { readonly settings: ProactiveSettings },
    at: Date,
  ): PiSituationFollowUpAction[] {
    const desired = currentSituationFollowUpActions(next, policy.settings, at);
    const eligible = new Map(desired.map((entry) =>
      [entry.followUpId, entry] as const));
    const ids = new Set([
      ...(previous?.followUps.map(({ id: value }) => value) ?? []),
      ...next.followUps.map(({ id: value }) => value),
    ]);
    const actions: PiSituationFollowUpAction[] = [];
    for (const followUpId of ids) {
      const desiredAction = eligible.get(followUpId);
      if (!desiredAction) {
        actions.push({
          operation: 'cancel',
          identity: followUpIdentity(followUpId),
          followUpId,
        });
        continue;
      }
      actions.push(desiredAction);
    }
    return actions;
  }

  async function syncFollowUps(
    previous: PiSituationState | null,
    next: PiSituationState,
    policy: { readonly settings: ProactiveSettings },
    at: Date,
  ): Promise<boolean> {
    const queue = events;
    if (!queue) return false;
    let changed = false;
    for (const action of followUpActions(previous, next, policy, at)) {
      if (action.operation === 'cancel') {
        changed = await queue.cancel(
          action.identity,
          at,
          'follow-up cancelled or invalidated',
        ) || changed;
        continue;
      }
      const result = await queue.enqueue({
        ...action.event,
        occurredAt: new Date(action.event.occurredAt),
        notBeforeAt: new Date(action.event.notBeforeAt),
      }, at);
      changed ||= result.inserted;
    }
    return changed;
  }

  function sourceRef(
    source: SourceId,
    fact: SourceResult['facts'][number],
    verifiedAt: string,
    pending = false,
  ): PiSituationAuthorityRef {
    const rawIdentity = fact.identity ?? fact.ref;
    const identityDigest = createHash('sha256').update(rawIdentity).digest('hex');
    const identity = rawIdentity.length <= 240 ? rawIdentity : `provider:${identityDigest}`;
    const stable = `${source}:${identityDigest.slice(0, 48)}`;
    const materialText = source === 'factory'
      ? fact.text.replace(/; waited [^;]+$/u, '')
      : fact.text;
    const materialHash = createHash('sha256').update(JSON.stringify([
      source,
      identity,
      materialText,
      fact.startsAt ?? null,
      fact.endsAt ?? null,
      fact.dueAt ?? null,
      fact.kind,
    ])).digest('hex');
    return {
      id: stable,
      source,
      identity,
      label: fact.label.slice(0, 160),
      observedAt: fact.observedAt,
      expiresAt: null,
      materialHash,
      verifiedAt,
      activatedAt: pending ? null : verifiedAt,
      invalidatedAt: null,
      staleReason: null,
    };
  }

  async function observeResult(
    source: SourceId,
    result: SourceResult,
    signal: AbortSignal,
  ): Promise<{ readonly changed: boolean; readonly baseline: boolean; readonly admissible: boolean }> {
    const settings = await options.proactive.settings.read();
    if (!settings.sources[source]) {
      return { changed: false, baseline: false, admissible: false };
    }
    const observedAt = Number.isFinite(Date.parse(result.observedAt))
      ? result.observedAt : now().toISOString();
    const verifiedAt = now().toISOString();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const policy = await currentPolicy(signal);
      const status = policy.statuses.find((entry) => entry.id === source);
      const statusVerifiedAt = status?.verifiedAt ?? status?.observedAt;
      if (statusVerifiedAt && Date.parse(statusVerifiedAt) > Date.parse(verifiedAt)) {
        return { changed: false, baseline: false, admissible: false };
      }
      const observationInvalidated = status?.invalidatedAt !== undefined &&
        status.invalidatedAt !== null &&
        Date.parse(verifiedAt) <= Date.parse(status.invalidatedAt);
      let current = await options.store.read(options.owner, signal);
      if (!current) {
        current = await options.store.initialize(
          options.owner,
          parsePiSituationState(emptyState(now(), policy.settings, policy.statuses)),
          now(),
          signal,
        );
      }
      const previous = retainAuthoritativePiSituationState(
        current.state,
        current.authoritativeRefs,
        true,
      );
      const oldRefs = previous.refs.filter((ref) => ref.source === source);
      const baseline = oldRefs.length === 0 && !previous.sources.some((entry) =>
        entry.id === source && entry.observedAt !== null);
      const observedAuthorityRefs = result.state === 'ok' && !observationInvalidated
        ? result.facts.slice(0, 8).map((fact) => sourceRef(source, fact, verifiedAt))
          .filter((entry, index, values) => values.findIndex(({ id }) => id === entry.id) === index)
        : [];
      const freshRefs = result.state === 'ok' && !observationInvalidated
        ? observedAuthorityRefs.map(stateRef)
        : oldRefs;
      const knownAuthority = [
        ...current.authoritativeRefs,
        ...observedAuthorityRefs,
      ];
      const nextMaterial = new Map(freshRefs.map((entry) => [entry.id, entry.materialHash]));
      const oldById = new Map(oldRefs.map((entry) => [entry.id, entry]));
      const affectedRefs = new Set(oldRefs.flatMap((entry) => {
        const material = nextMaterial.get(entry.id);
        return result.state !== 'ok' || !nextMaterial.has(entry.id) || material !== entry.materialHash
          ? [entry.id] : [];
      }));
      for (const fresh of freshRefs) {
        if (!oldById.has(fresh.id)) affectedRefs.add(fresh.id);
      }
      const remappedRefs = new Set(oldRefs.filter((entry) => {
        const fresh = freshRefs.find(({ id: value }) => value === entry.id);
        return fresh !== undefined && fresh.materialHash === entry.materialHash;
      }).map(({ id: value }) => value));
      const retainedRefs = oldRefs.filter((entry) => !nextMaterial.has(entry.id) &&
        (previous.facts.some((fact) => fact.refIds.includes(entry.id)) ||
          previous.followUps.some((followUp) => followUp.refIds.includes(entry.id))))
        .map((entry) => ({
          ...entry,
          expiresAt: observedAt,
        }));
      const refs = [
        ...freshRefs,
        ...previous.refs.filter((entry) => entry.source !== source),
        ...retainedRefs,
      ].slice(0, 48);
      const validRefIds = new Set(refs.map(({ id }) => id));
      const facts = previous.facts.map((fact) => {
        if (fact.source === source &&
            fact.refIds.some((id) => affectedRefs.has(id))) {
          return {
            ...fact,
            stale: true,
            staleReason: result.state === 'ok'
              ? 'source_material_changed'
              : result.reason ?? 'source_unavailable',
          };
        }
        if (fact.source === source && result.state === 'ok' &&
            !observationInvalidated &&
            fact.refIds.every((id) => remappedRefs.has(id))) {
          const current = { ...fact, stale: false };
          delete current.staleReason;
          return current;
        }
        if (fact.source === source && result.state !== 'ok') {
          return {
            ...fact,
            stale: true,
            staleReason: result.reason ?? 'source_unavailable',
          };
        }
        return fact;
      }).filter((fact) => fact.refIds.every((id) => validRefIds.has(id)));
      const followUps = previous.followUps.filter((entry) =>
        entry.refIds.every((id) => validRefIds.has(id)) &&
        !entry.refIds.some((id) => affectedRefs.has(id)));
      const summaryAffected = previous.summaryRefIds.some((id) =>
        affectedRefs.has(id) || !validRefIds.has(id));
      const sourceEntry = previous.sources.find((entry) => entry.id === source)!;
      const freshnessChanged = result.state === 'ok'
        ? sourceEntry.state !== (observationInvalidated ? 'stale' : 'fresh')
        : sourceEntry.state !== 'stale' && sourceEntry.state !== 'missing';
      const sourcePatch: PiSituationState['sources'][number] = {
        ...sourceEntry,
        state: result.state === 'ok' && !observationInvalidated ? 'fresh' : 'stale',
        observedAt,
        verifiedAt,
        expiresAt: null,
        reason: observationInvalidated
          ? 'observation_not_newer_than_source_invalidation'
          : result.reason,
        refIds: freshRefs.map(({ id }) => id),
      };
      const effectiveStatus: SourceStatus = {
        id: source,
        label: source,
        enabled: true,
        state: observationInvalidated
          ? 'stale'
          : result.state === 'ok' && result.reason !== 'source_stale'
            ? 'ok'
            : result.state === 'ok' ? 'stale' : result.state,
        reason: observationInvalidated
          ? 'observation_not_newer_than_source_invalidation'
          : result.reason,
        observedAt,
        verifiedAt,
        invalidatedAt: status?.invalidatedAt ?? null,
      };
      const effectivePolicy = {
        ...policy,
        statuses: [
          ...policy.statuses.filter(({ id: value }) => value !== source),
          effectiveStatus,
        ],
      };
      const next = parsePiSituationState({
        ...previous,
        asOf: now().toISOString(),
        sources: previous.sources.map((entry) => entry.id === source ? sourcePatch : entry),
        refs,
        facts,
        followUps,
        summary: summaryAffected ? '' : previous.summary,
        summaryRefIds: summaryAffected ? [] : previous.summaryRefIds,
      });
      const prepared = applyPolicy(
        next,
        { ...current, state: previous },
        effectivePolicy,
        { preserveInvalidated: true },
      );
      const canonicalState = canonicalizePiSituationState(prepared.state, knownAuthority, true);
      const stateChanged = piSituationHash(canonicalState) !== current.hash;
      const actions = followUpActions(previous, canonicalState, effectivePolicy, now());
      const observations: PiSituationSourceObservation[] = [{
        source,
        state: observationInvalidated ? 'stale' : result.state,
        reason: observationInvalidated
          ? 'observation_not_newer_than_source_invalidation'
          : result.reason,
        observedAt: result.state === 'ok' ? observedAt : null,
        verifiedAt,
      }];
      try {
        await options.store.commit({
          owner: options.owner,
          expectedRevision: current.revision,
          expectedHash: current.hash,
          state: canonicalState,
          activation: null,
          policyRevision: policy.revision,
          followUpActions: actions,
          authoritativeRefs: observedAuthorityRefs,
          preserveInvalidated: true,
          observations,
        }, signal);
        await updateMemoryObservations(observations);
        wakeEvents?.();
        return {
          changed: stateChanged && (affectedRefs.size > 0 || freshnessChanged),
          baseline,
          admissible: !observationInvalidated,
        };
      } catch (error) {
        if (error instanceof PiSituationError && error.code === 'conflict' && attempt < 3) continue;
        throw error;
      }
    }
    throw new PiSituationError('conflict', 'Situational source refresh conflicted repeatedly. Try the source again.');
  }

  return {
    read,
    async policy(signal) {
      signal.throwIfAborted();
      const settings = await options.proactive.settings.read();
      return {
        revision: proactiveSettingsRevision(settings),
        disabledSources: sourceIds.filter((source) => !settings.sources[source]),
      };
    },
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
    attachEvents(queue, wake) {
      events = queue;
      wakeEvents = wake;
      memoryFollowUpSnapshot = null;
    },
    async synchronizeFollowUps(signal) {
      if (events?.supportsSituationOutbox) {
        const result = await events.reconcileSituationOutbox(now(), signal);
        if (result.changed) wakeEvents?.();
        return result;
      }
      const policy = await currentPolicy(signal);
      const record = await options.store.read(options.owner, signal);
      if (!record) return { changed: false, pending: false };
      const view = visible(record, policy.settings, policy.statuses, now());
      const changed = await syncFollowUps(memoryFollowUpSnapshot, view.state!, policy, now());
      memoryFollowUpSnapshot = clone(view.state!);
      if (changed) wakeEvents?.();
      return { changed, pending: false };
    },
    async observe(source, result, signal) {
      return observeResult(source, result, signal);
    },
    async refresh(source, signal) {
      const settings = await options.proactive.settings.read();
      if (!settings.sources[source]) {
        return { changed: false, baseline: false, admissible: false };
      }
      const provider = (typeof options.sources === 'function' ? options.sources() : options.sources)
        .find(({ id }) => id === source);
      if (!provider) throw new PiSituationError('unavailable', `${source} is not connected.`);
      const result = await provider.read({
        now: now(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        settings,
      });
      return observeResult(source, result, signal);
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
      const state = canonicalizePiSituationState(
        parsePiSituationState(input.state),
        current?.authoritativeRefs ?? [],
      );
      validateTimes(state);
      const currentState = current
        ? retainAuthoritativePiSituationState(current.state, current.authoritativeRefs, true)
        : null;
      const observations = pendingReferenceObservations(
        state,
        current?.authoritativeRefs ?? [],
      );
      const effectivePolicy = policyWithObservations(policy, observations);
      const prepared = applyPolicy(
        state,
        current && currentState ? { ...current, state: currentState } : null,
        effectivePolicy,
        { preserveInvalidated: true },
      );
      const beforeWrite = await currentPolicy(signal);
      if (beforeWrite.revision !== input.policyRevision) {
        throw new PiSituationError('conflict', 'Proactive policy changed. Read the situation again before committing.');
      }
      const actions = followUpActions(currentState, prepared.state, effectivePolicy, input.activation.at);
      const record = await options.store.commit({
        owner: options.owner,
        expectedRevision: input.expectedRevision,
        expectedHash: input.expectedHash,
        state: prepared.state,
        activation: input.activation,
        policyRevision: policy.revision,
        followUpActions: actions,
        authoritativeRefs: [],
        observations,
        preserveInvalidated: true,
      }, signal);
      await updateMemoryObservations(observations);
      wakeEvents?.();
      return { record, excluded: prepared.excluded };
    },
    async patch(input, signal) {
      const policy = await currentPolicy(signal);
      if (policy.revision !== input.policyRevision) {
        throw new PiSituationError('conflict', 'Proactive policy changed. Read the situation again before patching.');
      }
      let current = await options.store.read(options.owner, signal);
      if (!current) {
        current = await options.store.initialize(
          options.owner,
          parsePiSituationState(emptyState(now(), policy.settings, policy.statuses)),
          now(),
          signal,
        );
      }
      if (current.revision !== input.expectedRevision || current.hash !== input.expectedHash) {
        throw new PiSituationError('conflict', 'Situational state changed. Read the current revision before patching.');
      }
      const currentState = retainAuthoritativePiSituationState(
        current.state,
        current.authoritativeRefs,
        true,
      );
      const parsedPatch = parsePiSituationPatch(input.patch);
      const patched = applyPatch(currentState, parsedPatch);
      validateTimes(patched);
      const canonicalState = canonicalizePiSituationState(
        patched,
        current.authoritativeRefs,
        true,
      );
      const observations = pendingReferenceObservations(
        canonicalState,
        current.authoritativeRefs,
      );
      const effectivePolicy = policyWithObservations(policy, observations);
      const prepared = applyPolicy(
        canonicalState,
        { ...current, state: currentState },
        effectivePolicy,
        {
          preserveInvalidated: true,
          removedRefIds: new Set(parsedPatch.removeRefIds ?? []),
          removedFactIds: new Set(parsedPatch.removeFactIds ?? []),
          removedFollowUpIds: new Set(parsedPatch.removeFollowUpIds ?? []),
          summaryRemoved: parsedPatch.summary === null,
        },
      );
      if (piSituationHash(prepared.state) === current.hash) {
        return { record: current, excluded: prepared.excluded, changed: false };
      }
      const beforeWrite = await currentPolicy(signal);
      if (beforeWrite.revision !== input.policyRevision) {
        throw new PiSituationError('conflict', 'Proactive policy changed. Read the situation again before patching.');
      }
      const actions = followUpActions(currentState, prepared.state, effectivePolicy, input.activation.at);
      const record = await options.store.commit({
        owner: options.owner,
        expectedRevision: current.revision,
        expectedHash: current.hash,
        state: prepared.state,
        activation: input.activation,
        policyRevision: policy.revision,
        followUpActions: actions,
        authoritativeRefs: [],
        observations,
        preserveInvalidated: true,
      }, signal);
      await updateMemoryObservations(observations);
      wakeEvents?.();
      return { record, excluded: prepared.excluded, changed: true };
    },
    async markFailed(input, signal) {
      const current = await options.store.read(options.owner, signal);
      if (!current) return;
      if (current.revision !== input.expectedRevision || current.hash !== input.expectedHash) return;
      const affected = new Set(input.sources ?? []);
      if (affected.size === 0) return;
      const previous = retainAuthoritativePiSituationState(
        current.state,
        current.authoritativeRefs,
        true,
      );
      const state = credentialSafeState(clone(previous));
      state.sources = state.sources.map((source) => !affected.has(source.id) || source.state === 'disabled'
        ? source
        : { ...source, state: 'stale', reason: 'activation_failed' });
      state.facts = state.facts.map((fact) => !affected.has(fact.source)
        ? fact
        : { ...fact, stale: true, staleReason: 'activation_failed' });
      state.asOf = current.asOf.toISOString();
      const next = parsePiSituationState(state);
      const policy = await currentPolicy(signal);
      const actions = followUpActions(previous, next, policy, input.activation.at);
      const observations: PiSituationSourceObservation[] = [...affected].map((source) => ({
        source,
        state: 'stale' as const,
        reason: 'activation_failed',
        observedAt: null,
        verifiedAt: input.activation.at.toISOString(),
      }));
      await options.store.commit({
        owner: options.owner,
        expectedRevision: current.revision,
        expectedHash: current.hash,
        state: next,
        activation: input.activation,
        policyRevision: policy.revision,
        followUpActions: actions,
        authoritativeRefs: [],
        observations,
      }, signal);
      await updateMemoryObservations(observations);
      wakeEvents?.();
    },
    async lookup(input, signal) {
      const policy = await currentPolicy(signal);
      const { settings } = policy;
      if (!settings.sources[input.source]) {
        throw new PiSituationError('invalid', `${input.source} is disabled in Proactive settings.`);
      }
      const sources = typeof options.sources === 'function' ? options.sources() : options.sources;
      const source = sources.find(({ id: value }) => value === input.source);
      if (!source) throw new PiSituationError('unavailable', `${input.source} is not connected.`);
      const view = await read(signal);
      const linked = view.state?.refs.find((ref) =>
        ref.source === input.source && (ref.id === input.ref || ref.identity === input.ref));
      const rawRef = linked?.identity ?? linked?.id ?? input.ref;
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      const result = await source.read({ now: now(), signal: deadline, settings });
      if (result.state !== 'ok') {
        throw new PiSituationError('unavailable', `${input.source} could not be read${result.reason ? `: ${result.reason}` : ''}.`);
      }
      const fact = result.facts.find(({ ref, identity }) =>
        ref === rawRef || identity === rawRef || ref === input.ref || identity === input.ref);
      if (!fact) throw new PiSituationError('invalid', 'That raw source reference is no longer available.');
      const verifiedAt = now().toISOString();
      const status = policy.statuses.find(({ id: value }) => value === input.source);
      if (status?.invalidatedAt && Date.parse(verifiedAt) <= Date.parse(status.invalidatedAt)) {
        throw new PiSituationError(
          'invalid',
          'The live provider observation is not newer than the persisted source-disable epoch.',
        );
      }
      const authorityRef = sourceRef(input.source, fact, verifiedAt, true);
      const verifiedRef = stateRef(authorityRef);
      const value = {
        source: input.source, ref: fact.ref, identity: fact.identity ?? null, label: fact.label,
        text: fact.text, observedAt: fact.observedAt, dueAt: fact.dueAt ?? null,
        startsAt: fact.startsAt ?? null, endsAt: fact.endsAt ?? null,
        verifiedRef,
      };
      if (hasCredentialMarkerDeep(value)) {
        throw new PiSituationError('redacted', 'That source record contains a credential and is not returned here.');
      }
      await options.store.recordLookupAuthority(
        options.owner,
        authorityRef,
        policy.revision,
        signal,
      );
      return boundedResult(value);
    },
  };
}

export function createMemoryPiSituationStore(
  seededAuthority: readonly PiSituationAuthorityRef[] = [],
): PiSituationStore & {
  readonly records: Map<string, PiSituationRecord>;
  readonly authorities: Map<string, PiSituationAuthorityRef[]>;
} {
  const records = new Map<string, PiSituationRecord>();
  const authorities = new Map<string, PiSituationAuthorityRef[]>();
  const authority = (owner: string, extra: readonly PiSituationAuthorityRef[] = []) => {
    const combined = [
      ...seededAuthority.map((ref) => structuredClone(ref)),
      ...(authorities.get(owner) ?? []).map((ref) => structuredClone(ref)),
    ];
    for (const ref of extra) {
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        const existing = combined[index]!;
        if (existing.invalidatedAt === null &&
            existing.source === ref.source &&
            existing.id === ref.id) {
          combined.splice(index, 1);
        }
      }
      combined.push(structuredClone(ref));
    }
    const byKey = new Map(combined.map((ref) => [authorityKey(ref), ref]));
    return [...byKey.values()];
  };
  return {
    atomicObservations: false,
    records,
    authorities,
    async read(owner) {
      const record = records.get(owner);
      return record ? structuredClone(record) : null;
    },
    async initialize(owner, state, at) {
      const existing = records.get(owner);
      if (existing) return structuredClone(existing);
      const known = authority(owner);
      const stateWithAuthority = canonicalizePiSituationState(state, known);
      const record: PiSituationRecord = {
        owner,
        revision: 1,
        state: structuredClone(stateWithAuthority),
        hash: piSituationHash(stateWithAuthority),
        asOf: new Date(stateWithAuthority.asOf),
        updatedAt: at,
        authoritativeRefs: known,
        lastActivation: null,
      };
      authorities.set(owner, known);
      records.set(owner, record);
      return structuredClone(record);
    },
    async commit(input) {
      const current = records.get(input.owner);
      if ((current?.revision ?? 0) !== input.expectedRevision ||
          current !== undefined && current.hash !== input.expectedHash) {
        throw new PiSituationError('conflict', 'Situational state changed. Read the current revision before committing.');
      }
      let known = authority(input.owner, input.authoritativeRefs);
      const state = canonicalizePiSituationState(
        input.state,
        known,
        input.observations.length > 0 || input.preserveInvalidated === true,
      );
      for (const ref of state.refs) {
        const receipt = known.find((entry) =>
          authorityKey(entry) === authorityKey(ref));
        if (!receipt || receipt.activatedAt !== null || receipt.invalidatedAt !== null) continue;
        known = known.map((entry) =>
          entry.activatedAt !== null && entry.invalidatedAt === null &&
          entry.source === ref.source && entry.id === ref.id
            ? {
              ...entry,
              invalidatedAt: ref.verifiedAt!,
              staleReason: 'superseded_by_committed_lookup',
            }
            : authorityKey(entry) === authorityKey(ref)
              ? { ...entry, activatedAt: ref.verifiedAt! }
              : entry);
      }
      const activation = input.activation;
      const record: PiSituationRecord = {
        owner: input.owner,
        revision: (current?.revision ?? 0) + 1,
        state: structuredClone(state),
        hash: piSituationHash(state),
        asOf: new Date(state.asOf),
        updatedAt: activation?.at ?? new Date(state.asOf),
        authoritativeRefs: known,
        lastActivation: activation ? {
          id: activation.id,
          type: activation.type,
          source: activation.source,
          at: activation.at,
        } : current?.lastActivation ?? null,
      };
      authorities.set(input.owner, known);
      records.set(input.owner, record);
      return structuredClone(record);
    },
    async recordLookupAuthority(owner, ref) {
      const currentAuthority = authority(owner);
      const knownCurrent = currentAuthority.find((entry) =>
        entry.invalidatedAt === null &&
        entry.activatedAt !== null &&
        entry.source === ref.source &&
        entry.id === ref.id);
      if (knownCurrent && Date.parse(knownCurrent.verifiedAt) > Date.parse(ref.verifiedAt)) {
        throw new PiSituationError(
          'conflict',
          'The provider returned an older verification than its active reference receipt.',
        );
      }
      if (knownCurrent &&
          Date.parse(knownCurrent.verifiedAt) === Date.parse(ref.verifiedAt) &&
          knownCurrent.identity === ref.identity &&
          (knownCurrent.materialHash ?? null) === (ref.materialHash ?? null)) return;
      const pending = currentAuthority.find((entry) =>
        entry.activatedAt === null &&
        entry.invalidatedAt === null &&
        entry.source === ref.source &&
        entry.id === ref.id &&
        entry.verifiedAt === ref.verifiedAt &&
        (entry.materialHash ?? null) === (ref.materialHash ?? null));
      const known = pending ? currentAuthority : [
        ...currentAuthority,
        structuredClone(ref),
      ];
      authorities.set(owner, known);
      const current = records.get(owner);
      if (current) records.set(owner, { ...current, authoritativeRefs: known });
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
