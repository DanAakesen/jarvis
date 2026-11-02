import { describe, expect, it } from 'vitest';
import { parseWorkoutCreate, parseWorkoutPatch, presentWorkoutEntry } from './workouts.js';

const key = '44444444-4444-4444-8444-444444444444';
const now = () => Date.parse('2026-11-02T12:00:00Z');

describe('parseWorkoutCreate', () => {
  it('accepts every session type and defaults the start time', () => {
    for (const sessionType of ['chest_triceps_core', 'back_biceps_core', 'arms_shoulders', 'legs_core', 'cardio']) {
      expect(parseWorkoutCreate({ idempotencyKey: key, sessionType }, now)).toMatchObject({ ok: true, value: { startedAt: '2026-11-02T12:00:00.000Z', title: null, durationMinutes: null, note: null } });
    }
    expect(parseWorkoutCreate({ idempotencyKey: key.toUpperCase(), sessionType: 'other', title: ' Climbing ', durationMinutes: 45, note: ' ok ', startedAt: '2026-11-02T10:00:00+01:00' }, now))
      .toEqual({ ok: true, value: { idempotencyKey: key, sessionType: 'other', title: 'Climbing', startedAt: '2026-11-02T09:00:00.000Z', durationMinutes: 45, note: 'ok' } });
  });

  it.each([
    ['missing key', { sessionType: 'cardio' }],
    ['unknown field', { idempotencyKey: key, sessionType: 'cardio', owner: 'x' }],
    ['unknown type', { idempotencyKey: key, sessionType: 'swim' }],
    ['title on a fixed type', { idempotencyKey: key, sessionType: 'cardio', title: 'x' }],
    ['long note', { idempotencyKey: key, sessionType: 'cardio', note: 'x'.repeat(501) }],
    ['multi-line note', { idempotencyKey: key, sessionType: 'cardio', note: 'a\nb' }],
    ['zero duration', { idempotencyKey: key, sessionType: 'cardio', durationMinutes: 0 }],
    ['fractional duration', { idempotencyKey: key, sessionType: 'cardio', durationMinutes: 1.5 }],
    ['bad date', { idempotencyKey: key, sessionType: 'cardio', startedAt: '2026-02-30T12:00:00Z' }],
    ['non-object', 'x'],
  ])('rejects %s', (_label, body) => { expect(parseWorkoutCreate(body, now).ok).toBe(false); });
});

describe('parseWorkoutPatch', () => {
  it('accepts partial changes and clears with null', () => {
    expect(parseWorkoutPatch({ durationMinutes: null, note: '' })).toEqual({ ok: true, patch: { durationMinutes: null, note: null } });
    expect(parseWorkoutPatch({ sessionType: 'other', title: 'Yoga' })).toEqual({ ok: true, patch: { sessionType: 'other', title: 'Yoga' } });
  });
  it.each([{}, { startedAt: '2026-11-02T12:00:00Z' }, { sessionType: 'x' }, { sessionType: 'cardio', title: 'x' }, { durationMinutes: 2000 }])('rejects %j', body => {
    expect(parseWorkoutPatch(body).ok).toBe(false);
  });
});

describe('presentWorkoutEntry', () => {
  it('reports the vault copy from the synced revision', () => {
    const base = { id: key, sessionType: 'cardio' as const, title: null, startedAt: 'x', gymDay: 'y', durationMinutes: null, note: null, deletedAt: null, updatedAt: 'x', revision: 2 };
    expect(presentWorkoutEntry({ ...base, vaultSyncedRevision: 2 }).vault).toBe('synced');
    expect(presentWorkoutEntry({ ...base, vaultSyncedRevision: 1 }).vault).toBe('pending');
    expect(presentWorkoutEntry({ ...base, vaultSyncedRevision: null })).not.toHaveProperty('gymDay');
  });
});
