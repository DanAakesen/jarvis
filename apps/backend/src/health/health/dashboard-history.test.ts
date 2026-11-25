import { describe, expect, it } from 'vitest';
import { monthlyTraining } from './read-model.js';

describe('all-time training', () => {
  it('counts manual and synced workouts, matching each compatible manual entry at most once', () => {
    const workout = (day: string, hour: string, kind: string, manual = false) =>
      ({ day, started: new Date(day + 'T' + hour + ':00Z'), kind, manual });
    expect(monthlyTraining([
      workout('2026-10-31', '09:00', 'legs_core', true),
      workout('2026-11-01', '10:00', 'cardio', true),
      workout('2026-11-01', '10:15', 'HKWorkoutActivityType(rawValue: 37)'),
      workout('2026-11-01', '10:30', 'running'),
      workout('2026-11-01', '11:00', 'strengthtraining'),
    ])).toEqual([{ month: '2026-10', days: 1, total: 1 }, { month: '2026-11', days: 1, total: 3 }]);
  });
});
