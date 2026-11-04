import { dayKey } from '../../proactive/time.js';
import type { LiftEntry } from '../lifts/lifts.js';
import type { LiftEntriesStore } from '../lifts/lifts-store.js';
import type { GymLogWriter } from './gym-log.js';
import type { VaultState, WorkoutEntry } from './workouts.js';
import type { WorkoutEntriesStore } from './workouts-store.js';

export interface GymSyncLogger {
  warn(data: { reason: string; durationMs: number }, message: string): void;
}

export interface GymVaultSyncOptions {
  readonly writer: GymLogWriter;
  readonly workouts: Pick<WorkoutEntriesStore, 'get' | 'pendingVaultCopies' | 'markVaultSynced'>;
  readonly lifts: Pick<LiftEntriesStore, 'pendingVaultCopies' | 'markVaultSynced'>;
  readonly logger?: GymSyncLogger;
  readonly now?: () => number;
  /** Time allowed for one entry's vault write. */
  readonly writeTimeoutMs?: number;
}

/**
 * Mirrors saved workouts and lifts into the daily Gym log note. The database row is the record; a vault
 * failure leaves it "pending" and the retry job finishes it. Success is reported only after the note write.
 */
export function createGymVaultSync(options: GymVaultSyncOptions) {
  const now = options.now ?? Date.now;
  const timeout = options.writeTimeoutMs ?? 20_000;
  const warn = (reason: string, startedAt: number) => {
    try { options.logger?.warn({ reason, durationMs: Math.max(0, now() - startedAt) }, 'daily.gym_log'); } catch { /* Logging never fails a save. */ }
  };

  async function writeWorkout(entry: WorkoutEntry, signal: AbortSignal) {
    await options.writer.apply(entry.gymDay, entry.deletedAt
      ? { type: 'remove-workout', id: entry.id }
      : { type: 'upsert-workout', workout: entry }, signal);
    await options.workouts.markVaultSynced(entry.id, entry.revision, signal);
  }

  async function writeLift(entry: LiftEntry, signal: AbortSignal) {
    const day = entry.gymDay ?? dayKey(new Date(entry.performedAt));
    if (!entry.deletedAt && entry.workoutId) {
      // The session section must exist before its lifts are placed under it.
      const workout = await options.workouts.get(entry.workoutId, signal);
      if (workout && (workout.vaultSyncedRevision === null || workout.vaultSyncedRevision < workout.revision)) {
        await writeWorkout(workout, signal);
      }
    }
    await options.writer.apply(day, entry.deletedAt
      ? { type: 'remove-lift', id: entry.id }
      : { type: 'upsert-lift', lift: entry }, signal);
    await options.lifts.markVaultSynced(entry.id, entry.revision, signal);
  }

  async function attempt(work: (signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<VaultState> {
    const startedAt = now();
    try {
      await work(AbortSignal.any([signal, AbortSignal.timeout(timeout)]));
      return 'synced';
    } catch {
      warn(signal.aborted ? 'aborted' : 'vault_write_failed', startedAt);
      return 'pending';
    }
  }

  return {
    syncWorkout: (entry: WorkoutEntry, signal: AbortSignal) => attempt(inner => writeWorkout(entry, inner), signal),
    syncLift: (entry: LiftEntry, signal: AbortSignal) => attempt(inner => writeLift(entry, inner), signal),
    /** Retry job body: bounded, workouts first, stops at the first vault failure so one outage is not hammered. */
    async retryPending(signal: AbortSignal, limit = 25): Promise<{ synced: number; pending: number }> {
      let synced = 0;
      const workouts = await options.workouts.pendingVaultCopies(limit, signal);
      const lifts = await options.lifts.pendingVaultCopies(limit, signal);
      const total = workouts.length + lifts.length;
      for (const entry of workouts) {
        if (await this.syncWorkout(entry, signal) === 'pending') return { synced, pending: total - synced };
        synced += 1;
      }
      for (const entry of lifts) {
        if (await this.syncLift(entry, signal) === 'pending') return { synced, pending: total - synced };
        synced += 1;
      }
      return { synced, pending: 0 };
    },
  };
}

export type GymVaultSync = ReturnType<typeof createGymVaultSync>;
