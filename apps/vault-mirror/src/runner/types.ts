import type { VaultMirrorStatus } from '@jarvis/contracts';
import type { FileRecord, Plan, WriteBack } from '../engine/index.js';
import type { ValidatedPolicy } from '../engine/policy.js';
import type { MirrorState } from './state.js';

export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
export const OVERALL_RUN_MS = 420_000;
export const VAULT_REPOSITORY = 'DanAakesen/vault';
export const VAULT_BRANCH = 'master';

export type MirrorReason = NonNullable<VaultMirrorStatus['reason']>;

export interface MirrorSecrets {
  readonly obsidianToken: string;
  readonly vaultName: string;
  readonly vaultPassword?: string;
  readonly policy: ValidatedPolicy;
  readonly githubPrivateKey: string;
}

export interface RemoteFile extends FileRecord {
  readonly sha: string;
  readonly text?: string;
}

export interface GitHubSnapshot {
  readonly head: string;
  readonly tree: string;
  readonly files: ReadonlyMap<string, RemoteFile>;
}

export interface GitHubClient {
  verifyRepository(signal: AbortSignal): Promise<void>;
  snapshot(signal: AbortSignal): Promise<GitHubSnapshot>;
  readFile(file: RemoteFile, signal: AbortSignal): Promise<string>;
  commit(
    snapshot: GitHubSnapshot,
    actions: Plan['actions'],
    signal: AbortSignal,
    beforeWrite: () => Promise<void>,
  ): Promise<void>;
}

export interface StateLease {
  readonly archive: Uint8Array | null;
  readonly etag: string;
  readonly checksum: string | null;
  renew(signal: AbortSignal): Promise<void>;
  upload(archive: Uint8Array, checksum: string, signal: AbortSignal): Promise<void>;
  release(signal: AbortSignal): Promise<void>;
}

export type LeaseResult = { readonly busy: true } | { readonly busy: false; readonly lease: StateLease };

export interface MirrorStorage {
  readStatus(): Promise<VaultMirrorStatus | null>;
  acquireLease(signal: AbortSignal): Promise<LeaseResult>;
  writeStatus(status: VaultMirrorStatus, signal: AbortSignal): Promise<void>;
}

export interface ObsidianClient {
  setup(vault: string, beforeWrite: () => Promise<void>): Promise<void>;
  sync(
    mode: 'pull-only' | 'bidirectional',
    operation: 'pull' | 'upload',
    beforeWrite: () => Promise<void>,
  ): Promise<void>;
  setMode(mode: 'pull-only' | 'bidirectional', beforeWrite: () => Promise<void>): Promise<void>;
}

export interface RunDependencies {
  readonly readSecrets: (signal: AbortSignal) => Promise<MirrorSecrets>;
  readonly createGitHub: (privateKey: string, policy: ValidatedPolicy) => GitHubClient;
  readonly storage: MirrorStorage;
  readonly createWorkspace: (signal: AbortSignal) => Promise<{
    readonly workingCopy: string;
    readonly configHome: string;
    readonly cleanup: () => Promise<void>;
  }>;
  readonly createObsidian: (options: {
    readonly token: string;
    readonly password?: string;
    readonly workingCopy: string;
    readonly configHome: string;
    readonly signal: AbortSignal;
    readonly remainingMs: () => number;
  }) => ObsidianClient;
  readonly afterWriteBack?: (workingCopy: string) => Promise<void>;
  readonly now?: () => number;
  readonly newRunId?: () => string;
  readonly log?: (entry: Readonly<Record<string, string | number>>) => void;
}

export interface RunOptions {
  readonly config: {
    readonly githubAppId: string;
    readonly writeBack: WriteBack;
    readonly maxChanged: number;
    readonly maxDeletes: number;
  };
  readonly dependencies: RunDependencies;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly status: VaultMirrorStatus;
  readonly exitCode: number;
}

export function emptyCounts() {
  return {
    approved: 0, pushed: 0, writtenBack: 0, deleted: 0, conflicts: 0,
    skipped: 0, credentialMatches: 0, pendingWriteBack: 0,
  };
}

export function isMirrorReason(value: string): value is MirrorReason {
  return [
    'auth', 'policy-missing', 'repo-not-private', 'pull-failed', 'guard-tripped',
    'conflict', 'secret-match', 'push-rejected', 'upload-failed', 'state-corrupt',
    'timeout', 'unexpected',
  ].includes(value);
}

export type { MirrorState };
