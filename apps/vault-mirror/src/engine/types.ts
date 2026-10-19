import type { ValidatedPolicy } from './policy.js';

/** Hashes are SHA-256 of UTF-8 text with CRLF converted to LF; sizes are bytes. */
export interface FileRecord {
  readonly hash: string;
  readonly size: number;
  /** Only 100644 is eligible; executable files, symlinks and trees are refused. */
  readonly mode: string;
}

export interface BaseRecord extends FileRecord {
  readonly conflictFirstSeenAt?: number;
}

export type Side = 'O' | 'G' | 'B';
export type WriteBack = 'dry-run' | 'on';
export interface Limits {
  readonly maxChanged: number;
  readonly maxDeletes: number;
}

/** Readers and merge must be deterministic, in-memory functions, never I/O. */
export interface ReconcileInput {
  readonly policy: ValidatedPolicy;
  readonly writeBack: WriteBack;
  readonly limits: Limits;
  /** Unix milliseconds, supplied by the caller rather than read by the engine. */
  readonly now: number;
  readonly baseFreshlyInitialized: boolean;
  readonly O: ReadonlyMap<string, FileRecord>;
  readonly G: ReadonlyMap<string, FileRecord>;
  readonly B: ReadonlyMap<string, BaseRecord>;
  /** Also persists first-seen times for conflicts without a base record. */
  readonly conflictFirstSeenAt?: ReadonlyMap<string, number>;
  readonly readContent: (side: Side, path: string) => string;
  readonly merge: (base: string, ours: string, theirs: string) =>
    { clean: true; text: string } | { clean: false };
}

export type WriteKind = 'createOnG' | 'updateOnG' | 'deleteOnG' |
  'createOnO' | 'updateOnO' | 'deleteOnO';
/** Apply writes in order, then recordBase/forgetBase; never advance base early. */
export type Action =
  | { kind: Exclude<WriteKind, 'deleteOnG' | 'deleteOnO'>; path: string; text: string; record: FileRecord }
  | { kind: 'deleteOnG' | 'deleteOnO' | 'forgetBase'; path: string }
  | { kind: 'recordBase'; path: string; record: FileRecord; text: string };

export type SkipReason = 'path-collision' | 'oversized' | 'non-regular' |
  'invalid-record' | 'content-unavailable' | 'content-mismatch' | 'secret-match' |
  'conflict' | 'windows-path';
export type GuardReason = 'invalid-input' | 'max-changed-G' | 'max-changed-O' |
  'max-deletes-G' | 'max-deletes-O' | 'base-deletion-ratio' |
  'empty-side' | 'missing-base-O' | 'missing-base-G';

/** This is the only log-safe part of a plan: numbers and fixed vocabularies. */
export interface Counters {
  approved: number;
  pushed: number;
  writtenBack: number;
  deleted: number;
  conflicts: number;
  skipped: number;
  credentialMatches: number;
  pendingWriteBack: number;
  resolvedInObsidianFavor: number;
  excluded: number;
  changedOnG: number;
  changedOnO: number;
  deletedOnG: number;
  deletedOnO: number;
  skipReasons: Partial<Record<SkipReason, number>>;
  guardReasons: Partial<Record<GuardReason, number>>;
}

/** Actions/skips are private runner data, NOT log output. Guard trips empty actions. */
export interface Plan {
  actions: Action[];
  skipped: { path: string; reason: SkipReason; conflictFirstSeenAt?: number }[];
  counters: Counters;
  verdict: 'ok' | 'needs-attention' | 'guard-tripped';
  reason?: 'secret-match' | 'conflict' | 'guard-tripped';
}
