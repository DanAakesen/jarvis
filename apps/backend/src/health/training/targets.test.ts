import { describe, expect, it } from 'vitest';
import {
  changedTrainingTargets, emptyTrainingTargets, parseStoredTrainingTarget, parseTrainingTargetsPatch,
  presentTrainingTargets, trainingTargetBounds, trainingTargetFields,
} from './targets.js';

describe('training targets', () => {
  it('defines bounded, owner-entered whole-number targets without defaults', () => {
    expect(Object.isFrozen(trainingTargetBounds)).toBe(true);
    expect(trainingTargetFields).toEqual(['gymSessionsPerWeek', 'runSessionsPerWeek', 'dailySteps']);
    expect(trainingTargetBounds.gymSessionsPerWeek).toMatchObject({ label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 });
    expect(trainingTargetBounds.runSessionsPerWeek).toMatchObject({ unit: 'sessions/week', min: 0, max: 21 });
    expect(trainingTargetBounds.dailySteps).toMatchObject({ unit: 'steps/day', min: 0, max: 100_000 });
    expect(emptyTrainingTargets).toEqual({ gymSessionsPerWeek: null, runSessionsPerWeek: null, dailySteps: null });
  });

  it('accepts partial whole-number changes and null clears, without coercion', () => {
    expect(parseTrainingTargetsPatch({ gymSessionsPerWeek: 3, dailySteps: null })).toEqual({
      ok: true, patch: { gymSessionsPerWeek: 3, dailySteps: null },
    });
    expect(parseTrainingTargetsPatch({ dailySteps: 0 })).toEqual({ ok: true, patch: { dailySteps: 0 } });
  });

  it.each([
    ['empty patch', {}],
    ['array', []],
    ['unknown field', { target: 3 }],
    ['owner override', { gymSessionsPerWeek: 3, owner: 'other' }],
    ['numeric string', { gymSessionsPerWeek: '3' }],
    ['fraction', { dailySteps: 3.5 }],
    ['negative', { runSessionsPerWeek: -1 }],
    ['over the bound', { dailySteps: 100_001 }],
    ['unsafe integer', { dailySteps: Number.MAX_SAFE_INTEGER + 1 }],
    ['poisoned prototype', JSON.parse('{"__proto__":{"dailySteps":100}}')],
  ])('rejects %s', (_label, patch) => {
    expect(parseTrainingTargetsPatch(patch).ok).toBe(false);
  });

  it('turns malformed stored values into unset values', () => {
    expect(parseStoredTrainingTarget('gymSessionsPerWeek', 0)).toBe(0);
    expect(parseStoredTrainingTarget('dailySteps', '100')).toBeNull();
    expect(parseStoredTrainingTarget('dailySteps', 100_001)).toBeNull();
  });

  it('reports unset targets, only changed fields, and server-owned bounds', () => {
    expect(presentTrainingTargets({ targets: emptyTrainingTargets, updatedAt: null })).toMatchObject({
      missing: trainingTargetFields, updatedAt: null, bounds: trainingTargetBounds,
    });
    expect(changedTrainingTargets({ ...emptyTrainingTargets, gymSessionsPerWeek: 3 }, { gymSessionsPerWeek: 3, dailySteps: null }))
      .toEqual([]);
    expect(changedTrainingTargets(emptyTrainingTargets, { gymSessionsPerWeek: 3, dailySteps: null }))
      .toEqual(['gymSessionsPerWeek']);
  });
});
