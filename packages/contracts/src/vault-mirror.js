import { z } from 'zod';

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true }).max(64);
const guardReason = z.enum([
  'invalid-input', 'max-changed-G', 'max-changed-O', 'max-deletes-G',
  'max-deletes-O', 'base-deletion-ratio', 'empty-side', 'missing-base-O',
  'missing-base-G',
]);

export const vaultMirrorStatusSchema = z.object({
  runId: z.string().min(1).max(128),
  startedAt: timestamp,
  finishedAt: timestamp,
  outcome: z.enum(['ok', 'ok-noop', 'skipped-busy', 'needs-attention', 'failed']),
  reason: z.enum([
    'auth', 'policy-missing', 'repo-not-private', 'pull-failed', 'guard-tripped',
    'conflict', 'secret-match', 'push-rejected', 'upload-failed', 'state-corrupt',
    'timeout', 'unexpected',
  ]).optional(),
  writeBack: z.enum(['dry-run', 'on']),
  approved: count,
  pushed: count,
  writtenBack: count,
  deleted: count,
  conflicts: count,
  skipped: count,
  credentialMatches: count,
  pendingWriteBack: count,
  consecutiveFailures: count,
  changedOnGitHub: count.optional(),
  changedOnObsidian: count.optional(),
  deletedOnGitHub: count.optional(),
  deletedOnObsidian: count.optional(),
  guardReasons: z.array(guardReason).max(9).optional(),
  lastSuccessAt: timestamp.nullable(),
  conflictPaths: z.array(z.string().min(1).max(1024)).max(10),
}).strict();

export const vaultMirrorStatusViewSchema = z.object({
  state: z.enum(['not-set-up', 'healthy', 'stale', 'needs-attention', 'failed', 'read-error']),
  lastSuccessAt: timestamp.nullable(),
  lastRunAt: timestamp.optional(),
  outcome: vaultMirrorStatusSchema.shape.outcome.optional(),
  guardReasons: vaultMirrorStatusSchema.shape.guardReasons,
  changedOnGitHub: vaultMirrorStatusSchema.shape.changedOnGitHub,
  changedOnObsidian: vaultMirrorStatusSchema.shape.changedOnObsidian,
  deletedOnGitHub: vaultMirrorStatusSchema.shape.deletedOnGitHub,
  deletedOnObsidian: vaultMirrorStatusSchema.shape.deletedOnObsidian,
  readReason: z.enum([
    'backend-not-configured', 'status-missing', 'access-denied', 'timed-out',
    'invalid', 'unavailable',
  ]).optional(),
  writeBack: vaultMirrorStatusSchema.shape.writeBack.optional(),
  reason: vaultMirrorStatusSchema.shape.reason,
  counts: vaultMirrorStatusSchema.pick({
    approved: true, pushed: true, writtenBack: true, deleted: true, conflicts: true,
    skipped: true, credentialMatches: true, pendingWriteBack: true, consecutiveFailures: true,
  }).optional(),
  conflictPaths: vaultMirrorStatusSchema.shape.conflictPaths.optional(),
}).strict();
