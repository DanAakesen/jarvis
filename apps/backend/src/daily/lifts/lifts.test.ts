import { describe, expect, it } from 'vitest';
import { parseLiftCreate, parseLiftPatch } from './lifts.js';

const key = '44444444-4444-4444-8444-444444444444';
const valid = { idempotencyKey: key, exerciseName: ' Bench press ', weightKg: 80.25, reps: 4, sets: 3 };

describe('parseLiftCreate', () => {
  it('normalizes names and supplies a deterministic default performed time', () => {
    expect(parseLiftCreate(valid, () => Date.parse('2026-10-30T12:00:00Z'))).toEqual({
      ok: true,
      value: {
        idempotencyKey: key, exerciseName: 'Bench press', exerciseKey: 'bench press',
        weightKg: 80.25, reps: 4, sets: 3, performedAt: '2026-10-30T12:00:00.000Z',
      },
    });
  });

  it.each([
    ['unknown key', { ...valid, owner: 'foreign' }],
    ['bad UUID idempotency key', { ...valid, idempotencyKey: 'not-a-uuid' }],
    ['empty name', { ...valid, exerciseName: '  ' }],
    ['too long name', { ...valid, exerciseName: 'x'.repeat(81) }],
    ['control characters', { ...valid, exerciseName: 'Bench\npress' }],
    ['more than two decimals', { ...valid, weightKg: 80.123 }],
    ['too many reps', { ...valid, reps: 1001 }],
    ['too many sets', { ...valid, sets: 101 }],
    ['invalid date', { ...valid, performedAt: '2026-02-30T12:00:00Z' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseLiftCreate(payload)).toMatchObject({ ok: false });
  });
});

describe('parseLiftPatch', () => {
  it('accepts a strict partial correction', () => {
    expect(parseLiftPatch({ exerciseName: 'Squat', weightKg: 95 })).toEqual({
      ok: true, patch: { exerciseName: 'Squat', weightKg: 95 },
    });
  });

  it.each([null, {}, { owner: 'foreign' }, { sets: 0 }, { weightKg: 1000.01 }])('rejects invalid patches %#', payload => {
    expect(parseLiftPatch(payload)).toMatchObject({ ok: false });
  });
});
