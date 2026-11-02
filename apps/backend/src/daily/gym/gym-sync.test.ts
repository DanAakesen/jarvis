import { describe, expect, it, vi } from 'vitest';
import type { LiftEntry } from '../lifts/lifts.js';
import { createGymVaultSync } from './gym-sync.js';
import type { WorkoutEntry } from './workouts.js';

const signal = new AbortController().signal;
const workout: WorkoutEntry = {
  id: '11111111-1111-4111-8111-111111111111', sessionType: 'cardio', title: null, startedAt: '2026-11-02T10:00:00.000Z',
  gymDay: '2026-11-02', durationMinutes: null, note: null, deletedAt: null, updatedAt: '2026-11-02T10:00:00.000Z', revision: 1, vaultSyncedRevision: null,
};
const lift: LiftEntry = {
  id: '22222222-2222-4222-8222-222222222222', exerciseName: 'Squat', exerciseKey: 'squat', weightKg: 100, reps: 5, sets: 3,
  performedAt: '2026-11-02T10:05:00.000Z', deletedAt: null, updatedAt: '2026-11-02T10:05:00.000Z', revision: 2,
  workoutId: workout.id, gymDay: '2026-11-02', vaultSyncedRevision: null,
};

function fixture(failWrites = false) {
  const writer = { apply: vi.fn(async () => { if (failWrites) throw new Error('vault down'); return 'written' as const; }) };
  const workouts = {
    get: vi.fn(async () => workout), pendingVaultCopies: vi.fn(async () => [workout]), markVaultSynced: vi.fn(async () => undefined),
  };
  const lifts = { pendingVaultCopies: vi.fn(async () => [lift]), markVaultSynced: vi.fn(async () => undefined) };
  const logger = { warn: vi.fn() };
  return { writer, workouts, lifts, logger, sync: createGymVaultSync({ writer, workouts, lifts, logger }) };
}

describe('createGymVaultSync', () => {
  it('marks an entry synced only after the vault write succeeds', async () => {
    const f = fixture();
    expect(await f.sync.syncWorkout(workout, signal)).toBe('synced');
    expect(f.workouts.markVaultSynced).toHaveBeenCalledWith(workout.id, 1, expect.any(AbortSignal));
  });

  it('reports pending and keeps the database state when the vault write fails', async () => {
    const f = fixture(true);
    expect(await f.sync.syncWorkout(workout, signal)).toBe('pending');
    expect(await f.sync.syncLift(lift, signal)).toBe('pending');
    expect(f.workouts.markVaultSynced).not.toHaveBeenCalled();
    expect(f.lifts.markVaultSynced).not.toHaveBeenCalled();
    expect(f.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'vault_write_failed' }), 'daily.gym_log');
  });

  it('writes the session before its lift and removes deleted entries', async () => {
    const f = fixture();
    await f.sync.syncLift(lift, signal);
    expect(f.writer.apply.mock.calls.map(call => (call as unknown as [string, { type: string }])[1].type)).toEqual(['upsert-workout', 'upsert-lift']);
    f.writer.apply.mockClear();
    await f.sync.syncLift({ ...lift, deletedAt: '2026-11-02T11:00:00.000Z', revision: 3 }, signal);
    expect(f.writer.apply.mock.calls.map(call => (call as unknown as [string, { type: string }])[1].type)).toEqual(['remove-lift']);
  });

  it('retries pending entries, stops at the first failure and never reports false success', async () => {
    const ok = fixture();
    expect(await ok.sync.retryPending(signal)).toEqual({ synced: 2, pending: 0 });
    const down = fixture(true);
    expect(await down.sync.retryPending(signal)).toEqual({ synced: 0, pending: 2 });
    expect(down.writer.apply).toHaveBeenCalledTimes(1);
  });
});
