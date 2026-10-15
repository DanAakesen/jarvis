import { describe, expect, it } from 'vitest';
import { calculateCoaching, calendarDate, defaultTargets, missingReading, validateExperiment, type CoachingDay, type CoachingInput, type Experiment, type Reading } from './model.js';

const reading = (value: number | null, coverage: Reading['coverage'] = value === null ? 'missing' : 'complete'): Reading => ({ value, coverage, sources: ['synthetic'] });
const day = (date = '2026-10-15', changes: Partial<CoachingDay> = {}): CoachingDay => ({
  date, recovery: false, steps: reading(8000), sleepHours: reading(7), restingKcal: reading(1800), activeKcal: reading(600),
  maintenanceKcal: reading(2400), intakeKcal: reading(2000), proteinGrams: reading(180), weightKg: reading(90),
  waistMetres: missingReading(), fatPercentage: reading(20), leanMassKg: reading(65), workoutIds: [], ...changes,
});
const experiment: Experiment = { id: 'synthetic-experiment', metric: 'protein', instruction: 'Keep the agreed protein target.',
  targetValue: 180, targetDays: 7, unit: 'g', startsOn: '2026-10-15', endsOn: '2026-10-21', lockedVariables: ['steps', 'sleep'],
  baselineValue: null, baselineDays: null, rationale: null };
const input = (changes: Partial<CoachingInput> = {}): CoachingInput => ({
  asOf: '2026-10-15T12:00:00Z', days: [day()], profile: { ...defaultTargets, deficitRate: 0.2, coachingIntensity: 'direct', profanityPreference: 'natural' },
  readiness: { date: '2026-10-15', rating: 3, context: 'Synthetic context.' }, activeExperiments: [], ...changes,
});

describe('inactive shared coaching calculations, synthetic evidence only', () => {
  it('keeps deficit and maintenance budgets distinct, resting separate, protein first and over-budget negatives', () => {
    const result = calculateCoaching(input({ days: [day(undefined, { proteinGrams: reading(100), steps: reading(6000), sleepHours: reading(6) })] }));
    expect(result.status.energy).toMatchObject({ maintenanceKcal: 2400, deficitTargetKcal: 1920, deficitRemainingKcal: -80, maintenanceRemainingKcal: 400 });
    expect(result.status.energy.resting.value).toBe(1800); expect(result.status.energy.active.value).toBe(600);
    expect(result.status.orders).toEqual([
      { kind: 'protein', remaining: 80, unit: 'g' }, { kind: 'steps', remaining: 2000, unit: 'count' }, { kind: 'sleep', remaining: 1, unit: 'h' },
    ]);
    expect(result.coaching.profanityPreference).toBe('natural');
  });
  it.each([[85, 180], [90, 180], [100, 200]])('uses max(180 g, 2 g/kg) for %s kg', (weight, target) => {
    expect(calculateCoaching(input({ days: [day(undefined, { weightKg: reading(weight) })] })).targets.proteinGrams).toBe(target);
  });
  it('does not infer an exact protein target from missing/stale weight or an empty day', () => {
    for (const weightKg of [missingReading(), reading(90, 'stale')]) {
      const result = calculateCoaching(input({ days: [day(undefined, { weightKg })] }));
      expect(result.targets.proteinGrams).toBeNull();
      expect(result.status.protein.remainingGrams).toBeNull();
    }
    const result = calculateCoaching(input({ days: [] }));
    expect(result.status.energy.loggedIntakeKcal).toBeNull(); expect(result.status.orders).toEqual([]);
  });
  it.each([[2040, 'met'], [2039.99, 'met'], [2040.01, 'missed'], [2400, 'missed'], [0, 'met']])('compares the unrounded 15%% deficit boundary at %s kcal', (kcal, expected) => {
    const result = calculateCoaching(input({ days: [day('2026-10-14', { intakeKcal: reading(Number(kcal)) })] }));
    expect(result.review.consistency.days.at(-1)?.deficit).toBe(expected);
    expect(result.review.consistency.deficit.unknown).toBe(6);
  });
  it('does not turn absent, incomplete or stale food/maintenance into a deficit or a miss', () => {
    for (const intakeKcal of [missingReading(), reading(0, 'partial'), reading(2000, 'stale')]) {
      expect(calculateCoaching(input({ days: [day('2026-10-14', { intakeKcal })] })).review.consistency.days.at(-1)?.deficit).toBe('unknown');
    }
    const result = calculateCoaching(input({ days: [day(undefined, { maintenanceKcal: missingReading() })] }));
    expect(result.status.energy.maintenanceKcal).toBeNull(); expect(result.status.energy.deficitTargetKcal).toBeNull();
    expect(result.status.energy.deficitRemainingKcal).toBeNull();
  });
  it('never labels an unfinished today a missed target or adds steps/workouts after completion', () => {
    const result = calculateCoaching(input({ days: [day(undefined, { proteinGrams: reading(200), workoutIds: ['one', 'two'] })] }));
    expect(result.status.steps).toBe('met'); expect(result.status.sleep).toBe('met'); expect(result.status.orders).toEqual([]);
    expect(result.status.workoutIds).toEqual(['one', 'two']); expect(result.status.protein.remainingGrams).toBe(-20);
    expect(calculateCoaching(input({ days: [day(undefined, { steps: reading(6000) })] })).status.steps).toBe('in_progress');
  });
  it('keeps sick-day observations, excludes sick days from denominators and never issues recovery-day orders', () => {
    const result = calculateCoaching(input({ days: [
      day('2026-10-14', { recovery: true, steps: reading(0), weightKg: reading(120) }),
      day(undefined, { recovery: true, steps: reading(0), proteinGrams: reading(0) }),
    ] }));
    expect(result.recomp.points).toHaveLength(2); expect(result.recomp.points[0]?.weightKg).toBe(120);
    expect(result.recomp.weightKg.observedDays).toBe(0);
    expect(result.review.consistency.steps).toMatchObject({ eligibleDays: 6, met: 0, missed: 0, unknown: 6, assessedDays: 0, rate: null });
    expect(result.status.orders).toEqual([]); expect(result.status.steps).toBe('recovery');
  });
  it('uses seven completed Copenhagen calendar days, separate observed denominators and no imputation', () => {
    const result = calculateCoaching(input({ days: [day('2026-10-08'), day('2026-10-14', { steps: reading(7000) }), day()] }));
    expect(result.review.consistency).toMatchObject({ startDate: '2026-10-08', endDate: '2026-10-14' });
    expect(result.review.consistency.steps).toEqual({ eligibleDays: 7, met: 1, missed: 1, unknown: 5, assessedDays: 2, rate: 0.5 });
    expect(result.review.consistency.days).toHaveLength(7);
  });
  it('does not count a partial historical shortfall as a miss but retains an observed met target', () => {
    const result = calculateCoaching(input({ days: [day('2026-10-13', { steps: reading(7000, 'partial') }), day('2026-10-14', { steps: reading(8000, 'partial') })] }));
    expect(result.review.consistency.steps).toMatchObject({ met: 1, missed: 0, unknown: 6, assessedDays: 1 });
  });
  it('retains actual scan points, derives only same-date fat mass and never invents lean/muscle mass', () => {
    const result = calculateCoaching(input({ days: [day('2026-10-02', { weightKg: reading(100), leanMassKg: missingReading() }),
      day(undefined, { weightKg: reading(90), leanMassKg: reading(65) })] }));
    expect(result.recomp).toMatchObject({ startDate: '2026-10-02', endDate: '2026-10-15',
      weightKg: { observedDays: 2, average: 95, change: -10 }, leanMassKg: { observedDays: 1, average: 65, change: null } });
    expect(result.recomp.points[0]).toMatchObject({ fatMassKg: 20, leanMassKg: null });
    expect(result.recomp.points[1]).toMatchObject({ fatMassKg: 18, leanMassKg: 65 });
    expect(JSON.stringify(result.recomp)).not.toContain('muscle');
  });
  it('carries actual waist through the 14-day trend in canonical metres with dates and provenance', () => {
    const result = calculateCoaching(input({ days: [
      day('2026-10-02', { waistMetres: { ...reading(0.90, 'partial'), sources: ['waist-first'] } }),
      day(undefined, { waistMetres: { ...reading(0.88, 'partial'), sources: ['waist-last'] } }),
    ] }));
    expect(result.recomp.waistMetres).toEqual({ observedDays: 2, average: 0.89, change: -0.02, firstDate: '2026-10-02', lastDate: '2026-10-15' });
    expect(result.recomp.units.waistMetres).toBe('m');
    expect(result.recomp.points[0]).toMatchObject({ date: '2026-10-02', waistMetres: 0.9, sources: { waist: ['waist-first'] } });
    expect(result.recomp.points[1]).toMatchObject({ date: '2026-10-15', waistMetres: 0.88, leanMassKg: 65, sources: { waist: ['waist-last'] } });
    expect(result.recomp.fatMassKg.derived).toBe(true);
  });
  it('retains recovery waist points but excludes recovery and stale waist from averages and changes', () => {
    const result = calculateCoaching(input({ days: [day('2026-10-02', { waistMetres: reading(0.9) }),
      day('2026-10-13', { recovery: true, waistMetres: reading(0.7) }),
      day('2026-10-14', { waistMetres: reading(0.8, 'stale') }), day(undefined, { waistMetres: reading(0.88) })] }));
    expect(result.recomp.points[1]?.waistMetres).toBe(0.7);
    expect(result.recomp.points[2]?.waistMetres).toBeNull();
    expect(result.recomp.waistMetres).toMatchObject({ observedDays: 2, average: 0.89, change: -0.02 });
  });
  it('does not substitute derived fat mass or actual lean mass for an absent waist observation', () => {
    const result = calculateCoaching(input());
    expect(result.recomp.points[0]).toMatchObject({ waistMetres: null, fatMassKg: 18, leanMassKg: 65 });
    expect(result.recomp.waistMetres).toMatchObject({ observedDays: 0, average: null, change: null });
    expect(result.recomp.fatMassKg.derived).toBe(true);
  });
  it('does not combine weight and fat percentages from different dates or make empty averages zero', () => {
    const result = calculateCoaching(input({ days: [day('2026-10-14', { fatPercentage: missingReading(), leanMassKg: missingReading() }),
      day(undefined, { weightKg: missingReading(), leanMassKg: missingReading() })] }));
    expect(result.recomp.points.every(point => point.fatMassKg === null)).toBe(true);
    expect(result.recomp.fatMassKg.average).toBeNull(); expect(result.recomp.leanMassKg.average).toBeNull();
  });
  it('asks for only missing current-day readiness fields, preserving rating/context without invented classification', () => {
    expect(calculateCoaching(input()).readiness).toEqual({ rating: 3, context: 'Synthetic context.', missing: [] });
    expect(calculateCoaching(input({ readiness: { date: '2026-10-15', rating: 0, context: null } })).readiness).toEqual({ rating: 0, context: null, missing: ['context'] });
    expect(calculateCoaching(input({ readiness: { date: '2026-10-14', rating: 3, context: 'Old.' } })).readiness.missing).toEqual(['rating', 'context']);
    expect(calculateCoaching(input({ readiness: { date: '2026-10-15', rating: null, context: 'Tired.' } })).readiness.missing).toEqual(['rating']);
  });
  it('preserves a single experiment and locked variables without an automatic new commitment', () => {
    const result = calculateCoaching(input({ activeExperiments: [experiment] }));
    expect(result.review).toMatchObject({ experiment, nextAction: 'review_existing_experiment', automaticallyCommitted: false });
    expect(calculateCoaching(input()).review.nextAction).toBe('choose_one_experiment');
    expect(() => calculateCoaching(input({ activeExperiments: [experiment, { ...experiment, id: 'two' }] }))).toThrow('one active experiment');
  });
  it('uses Copenhagen date at UTC midnight boundaries and across DST without host-zone arithmetic', () => {
    const result = calculateCoaching(input({ asOf: '2026-10-14T22:30:00Z' }));
    expect(result.date).toBe('2026-10-15');
    expect(calendarDate('2026-10-25', -1)).toBe('2026-10-24'); expect(calendarDate('2026-03-29', 1)).toBe('2026-03-30');
  });
  it('rejects duplicate/future/out-of-period dates, invalid values and oversized evidence', () => {
    for (const days of [[day(), day()], [day('2026-10-16')], [day('2026-10-01')], [day(undefined, { steps: reading(NaN) })],
      [day(undefined, { weightKg: reading(-1) })], [day(undefined, { waistMetres: reading(-0.1) })],
      [day(undefined, { waistMetres: reading(NaN) })], [day(undefined, { fatPercentage: reading(101) })],
      [day(undefined, { workoutIds: ['same', 'same'] })]]) expect(() => calculateCoaching(input({ days }))).toThrow();
    expect(() => validateExperiment({ ...experiment, targetDays: 8 })).toThrow();
    expect(() => calculateCoaching(input({ profile: { ...input().profile!, deficitRate: 1 } }))).toThrow();
  });
});
