import { z } from 'zod';

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true }).max(64);

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
  lastSuccessAt: timestamp.nullable(),
  conflictPaths: z.array(z.string().min(1).max(1024)).max(10),
}).strict();

export const vaultMirrorStatusViewSchema = z.object({
  state: z.enum(['not-set-up', 'healthy', 'stale', 'needs-attention', 'failed', 'read-error']),
  lastSuccessAt: timestamp.nullable(),
  writeBack: vaultMirrorStatusSchema.shape.writeBack.optional(),
  reason: vaultMirrorStatusSchema.shape.reason,
  counts: vaultMirrorStatusSchema.pick({
    approved: true, pushed: true, writtenBack: true, deleted: true, conflicts: true,
    skipped: true, credentialMatches: true, pendingWriteBack: true, consecutiveFailures: true,
  }).optional(),
  conflictPaths: vaultMirrorStatusSchema.shape.conflictPaths.optional(),
}).strict();
