import { dateOnly, day, instant, rounded } from '../health/value.js';

export type Coverage = 'complete' | 'partial' | 'missing' | 'stale';
export interface Reading {
  value: number | null;
  coverage: Coverage;
  sources: readonly string[];
}
export interface CoachingProfile {
  deficitRate: number;
  proteinMinimumGrams: number;
  proteinPerKg: number;
  stepsTarget: number;
  sleepTargetHours: number;
  coachingIntensity: string;
  profanityPreference: string;
}
export const defaultTargets = Object.freeze({
  proteinMinimumGrams: 180, proteinPerKg: 2, stepsTarget: 8000, sleepTargetHours: 7,
});
export interface CoachingDay {
  date: string;
  recovery: boolean;
  steps: Reading;
  sleepHours: Reading;
  restingKcal: Reading;
  activeKcal: Reading;
  maintenanceKcal: Reading;
  intakeKcal: Reading;
  proteinGrams: Reading;
  weightKg: Reading;
  waistMetres: Reading;
  fatPercentage: Reading;
  leanMassKg: Reading;
  workoutIds: readonly string[];
}
export interface Readiness {
  date: string;
  rating: number | null;
  context: string | null;
}
export interface Experiment {
  id: string;
  metric: string;
  instruction: string;
  targetValue: number;
  targetDays: number;
  unit: string;
  startsOn: string;
  endsOn: string;
  lockedVariables: readonly string[];
  baselineValue: number | null;
  baselineDays: number | null;
  rationale: string | null;
}
export interface CoachingInput {
  asOf: string;
  profile: CoachingProfile | null;
  days: readonly CoachingDay[];
  readiness: Readiness | null;
  activeExperiments: readonly Experiment[];
}
type Assessment = 'met' | 'missed' | 'in_progress' | 'unknown' | 'recovery';
type Order = { kind: 'protein' | 'steps' | 'sleep'; remaining: number; unit: 'g' | 'count' | 'h' };
const coverages = new Set<Coverage>(['complete', 'partial', 'missing', 'stale']);
export const missingReading = (): Reading => ({ value: null, coverage: 'missing', sources: [] });
const known = (reading: Reading) => reading.value !== null && (reading.coverage === 'complete' || reading.coverage === 'partial');
const complete = (reading: Reading) => reading.value !== null && reading.coverage === 'complete';
export function calendarDate(date: string, offset: number): string {
  dateOnly(date);
  if (!Number.isInteger(offset) || Math.abs(offset) > 366) throw new TypeError('Invalid coaching date offset');
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
function boundedText(value: string, max = 4096): void {
  if (typeof value !== 'string' || value.length > max) throw new TypeError('Invalid coaching text');
}
function validateReading(reading: Reading): void {
  if (!reading || !coverages.has(reading.coverage) || !Array.isArray(reading.sources) || reading.sources.length > 32 ||
      reading.value !== null && (!Number.isFinite(reading.value) || reading.value < 0) ||
      reading.coverage === 'missing' && reading.value !== null) throw new TypeError('Invalid coaching reading');
  reading.sources.forEach(source => boundedText(source, 256));
}
export function validateProfile(profile: CoachingProfile): void {
  if (Object.keys(profile).some(field => !['deficitRate', 'proteinMinimumGrams', 'proteinPerKg', 'stepsTarget', 'sleepTargetHours', 'coachingIntensity', 'profanityPreference'].includes(field)) ||
      !Number.isFinite(profile.deficitRate) || profile.deficitRate < 0 || profile.deficitRate >= 1 ||
      !Number.isFinite(profile.proteinMinimumGrams) || profile.proteinMinimumGrams <= 0 ||
      !Number.isFinite(profile.proteinPerKg) || profile.proteinPerKg <= 0 ||
      !Number.isSafeInteger(profile.stepsTarget) || profile.stepsTarget < 1 ||
      !Number.isFinite(profile.sleepTargetHours) || profile.sleepTargetHours <= 0 || profile.sleepTargetHours > 24) {
    throw new TypeError('Invalid coaching profile');
  }
  boundedText(profile.coachingIntensity, 256); boundedText(profile.profanityPreference, 256);
}
export function validateExperiment(experiment: Experiment): void {
  if (Object.keys(experiment).some(field => !['id', 'metric', 'instruction', 'targetValue', 'targetDays', 'unit', 'startsOn', 'endsOn', 'lockedVariables', 'baselineValue', 'baselineDays', 'rationale'].includes(field))) throw new TypeError('Invalid experiment fields');
  for (const value of [experiment.id, experiment.metric, experiment.unit]) {
    boundedText(value, 256); if (!value.trim()) throw new TypeError('Invalid experiment identity');
  }
  boundedText(experiment.instruction);
  if (!experiment.instruction.trim() || !Number.isFinite(experiment.targetValue) ||
      !Number.isSafeInteger(experiment.targetDays) || experiment.targetDays < 1 || experiment.targetDays > 366 ||
      !Array.isArray(experiment.lockedVariables) || experiment.lockedVariables.length > 32 ||
      experiment.baselineValue !== null && !Number.isFinite(experiment.baselineValue) ||
      experiment.baselineDays !== null && (!Number.isSafeInteger(experiment.baselineDays) || experiment.baselineDays < 0 || experiment.baselineDays > 366)) throw new TypeError('Invalid experiment');
  if (experiment.rationale !== null) boundedText(experiment.rationale);
  dateOnly(experiment.startsOn); dateOnly(experiment.endsOn);
  const length = (Date.parse(experiment.endsOn) - Date.parse(experiment.startsOn)) / 86400000 + 1;
  if (length < experiment.targetDays || length > 366) throw new TypeError('Invalid experiment period');
  experiment.lockedVariables.forEach(value => boundedText(value, 256));
}
function validate(input: CoachingInput): string {
  const today = day(instant(input.asOf));
  if (!Array.isArray(input.days) || input.days.length > 14 || !Array.isArray(input.activeExperiments) ||
      input.activeExperiments.length > 1) throw new TypeError('Coaching requires bounded evidence and one active experiment');
  if (input.profile) validateProfile(input.profile);
  const dates = new Set<string>();
  for (const evidence of input.days) {
    dateOnly(evidence.date);
    if (dates.has(evidence.date) || evidence.date < calendarDate(today, -13) || evidence.date > today ||
        typeof evidence.recovery !== 'boolean' || !Array.isArray(evidence.workoutIds) || evidence.workoutIds.length > 500) throw new TypeError('Invalid coaching day');
    dates.add(evidence.date);
    const ids = new Set<string>();
    for (const id of evidence.workoutIds) {
      boundedText(id, 256);
      if (!id.length || ids.has(id)) throw new TypeError('Invalid workout evidence');
      ids.add(id);
    }
    for (const field of ['steps', 'sleepHours', 'restingKcal', 'activeKcal', 'maintenanceKcal', 'intakeKcal', 'proteinGrams', 'weightKg', 'waistMetres', 'fatPercentage', 'leanMassKg'] as const) validateReading(evidence[field]);
    if (evidence.fatPercentage.value !== null && evidence.fatPercentage.value > 100) throw new TypeError('Invalid body-fat percentage');
  }
  if (input.readiness) {
    dateOnly(input.readiness.date);
    if (input.readiness.date > today || input.readiness.rating !== null && !Number.isSafeInteger(input.readiness.rating)) throw new TypeError('Invalid readiness');
    if (input.readiness.context !== null) boundedText(input.readiness.context);
  }
  input.activeExperiments.forEach(validateExperiment);
  return today;
}
function targetAssessment(reading: Reading, target: number | null, historical: boolean, recovery: boolean): Assessment {
  if (recovery) return 'recovery';
  if (target === null || !known(reading)) return 'unknown';
  if (reading.value! >= target) return 'met';
  return historical ? complete(reading) ? 'missed' : 'unknown' : 'in_progress';
}
function proteinTarget(evidence: CoachingDay | undefined, profile: CoachingProfile | null): number | null {
  if (!evidence || !known(evidence.weightKg) || evidence.weightKg.value! <= 0) return null;
  const policy = profile ?? defaultTargets;
  return rounded(Math.max(policy.proteinMinimumGrams, policy.proteinPerKg * evidence.weightKg.value!));
}
function deficitAssessment(evidence: CoachingDay, historical: boolean): Assessment {
  if (evidence.recovery) return 'recovery';
  if (!complete(evidence.maintenanceKcal) || !complete(evidence.intakeKcal) || evidence.maintenanceKcal.value! <= 0) return 'unknown';
  // Compare the original values, not a rounded displayed percentage at the 15% boundary.
  if (evidence.intakeKcal.value! <= evidence.maintenanceKcal.value! * 0.85) return 'met';
  return historical ? 'missed' : 'in_progress';
}
function consistency(days: readonly CoachingDay[], today: string, profile: CoachingProfile | null) {
  const policy = profile ?? defaultTargets;
  const records = Array.from({ length: 7 }, (_, index) => {
    const date = calendarDate(today, index - 7);
    const evidence = days.find(row => row.date === date);
    if (!evidence) return { date, eligible: true, deficit: 'unknown' as Assessment, protein: 'unknown' as Assessment, steps: 'unknown' as Assessment, sleep: 'unknown' as Assessment };
    return { date, eligible: !evidence.recovery, deficit: deficitAssessment(evidence, true),
      protein: targetAssessment(evidence.proteinGrams, proteinTarget(evidence, profile), true, evidence.recovery),
      steps: targetAssessment(evidence.steps, policy.stepsTarget, true, evidence.recovery),
      sleep: targetAssessment(evidence.sleepHours, policy.sleepTargetHours, true, evidence.recovery) };
  });
  const counts = (kind: 'deficit' | 'protein' | 'steps' | 'sleep') => {
    const eligible = records.filter(row => row.eligible);
    const met = eligible.filter(row => row[kind] === 'met').length;
    const missed = eligible.filter(row => row[kind] === 'missed').length;
    return { eligibleDays: eligible.length, met, missed, unknown: eligible.length - met - missed,
      assessedDays: met + missed, rate: met + missed ? met / (met + missed) : null };
  };
  return { startDate: calendarDate(today, -7), endDate: calendarDate(today, -1), days: records,
    deficit: counts('deficit'), protein: counts('protein'), steps: counts('steps'), sleep: counts('sleep') };
}
function bodyTrends(days: readonly CoachingDay[], today: string) {
  const points = [...days].sort((a, b) => a.date.localeCompare(b.date)).map(evidence => ({
    date: evidence.date, recovery: evidence.recovery,
    weightKg: known(evidence.weightKg) ? evidence.weightKg.value : null,
    waistMetres: known(evidence.waistMetres) ? evidence.waistMetres.value : null,
    fatPercentage: known(evidence.fatPercentage) ? evidence.fatPercentage.value : null,
    fatMassKg: known(evidence.weightKg) && known(evidence.fatPercentage) ? rounded(evidence.weightKg.value! * evidence.fatPercentage.value! / 100) : null,
    fatMassMethod: 'same-date weight * body-fat percentage / 100' as const,
    leanMassKg: known(evidence.leanMassKg) ? evidence.leanMassKg.value : null,
    sources: { weight: evidence.weightKg.sources, waist: evidence.waistMetres.sources, fatPercentage: evidence.fatPercentage.sources, leanMass: evidence.leanMassKg.sources },
  }));
  const trend = (field: 'weightKg' | 'waistMetres' | 'fatMassKg' | 'fatPercentage' | 'leanMassKg') => {
    const observed = points.filter(point => !point.recovery && point[field] !== null);
    const first = observed.at(0); const last = observed.at(-1);
    return { observedDays: observed.length, average: observed.length ? rounded(observed.reduce((total, point) => total + point[field]! / observed.length, 0)) : null,
      change: observed.length >= 2 ? rounded(last![field]! - first![field]!) : null,
      firstDate: first?.date ?? null, lastDate: last?.date ?? null };
  };
  return { startDate: calendarDate(today, -13), endDate: today, points, weightKg: trend('weightKg'),
    waistMetres: trend('waistMetres'), fatMassKg: { ...trend('fatMassKg'), derived: true as const },
    fatPercentage: trend('fatPercentage'), leanMassKg: trend('leanMassKg'),
    units: { weightKg: 'kg', waistMetres: 'm', fatMassKg: 'kg', fatPercentage: '%', leanMassKg: 'kg' } as const };
}

/** Shared arithmetic only. Call with server-owned evidence, never model-selected coverage or budgets. */
export function calculateCoaching(input: CoachingInput) {
  const today = validate(input);
  const evidence = input.days.find(row => row.date === today);
  const policy = input.profile ?? defaultTargets;
  const protein = proteinTarget(evidence, input.profile);
  const maintenance = evidence && complete(evidence.maintenanceKcal) ? evidence.maintenanceKcal.value : null;
  const deficitTarget = maintenance !== null && input.profile ? rounded(maintenance * (1 - input.profile.deficitRate)) : null;
  const intake = evidence && known(evidence.intakeKcal) ? evidence.intakeKcal.value : null;
  const proteinRemaining = evidence && protein !== null && known(evidence.proteinGrams) ? rounded(protein - evidence.proteinGrams.value!) : null;
  const orders: Order[] = [];
  if (evidence && !evidence.recovery) {
    if (proteinRemaining !== null && proteinRemaining > 0) orders.push({ kind: 'protein', remaining: proteinRemaining, unit: 'g' });
    if (known(evidence.steps) && evidence.steps.value! < policy.stepsTarget) orders.push({ kind: 'steps', remaining: policy.stepsTarget - evidence.steps.value!, unit: 'count' });
    if (known(evidence.sleepHours) && evidence.sleepHours.value! < policy.sleepTargetHours) orders.push({ kind: 'sleep', remaining: rounded(policy.sleepTargetHours - evidence.sleepHours.value!)!, unit: 'h' });
  }
  const readiness = input.readiness?.date === today ? input.readiness : null;
  const missingReadiness: ('rating' | 'context')[] = [];
  if (readiness?.rating === null || readiness?.rating === undefined) missingReadiness.push('rating');
  if (!readiness?.context?.trim()) missingReadiness.push('context');
  const weekly = consistency(input.days, today, input.profile);
  return {
    asOf: instant(input.asOf), date: today, timeZone: 'Europe/Copenhagen',
    profile: input.profile, targets: { ...policy, proteinGrams: protein },
    status: {
      recovery: evidence?.recovery ?? false,
      protein: { consumedGrams: evidence && known(evidence.proteinGrams) ? evidence.proteinGrams.value : null, targetGrams: protein, remainingGrams: proteinRemaining },
      energy: { maintenanceKcal: maintenance, deficitTargetKcal: deficitTarget, loggedIntakeKcal: intake,
        deficitRemainingKcal: deficitTarget !== null && intake !== null ? rounded(deficitTarget - intake) : null,
        maintenanceRemainingKcal: maintenance !== null && intake !== null ? rounded(maintenance - intake) : null,
        resting: evidence?.restingKcal ?? missingReading(), active: evidence?.activeKcal ?? missingReading(),
        intakeCoverage: evidence?.intakeKcal.coverage ?? 'missing' },
      steps: evidence ? targetAssessment(evidence.steps, policy.stepsTarget, false, evidence.recovery) : 'unknown',
      sleep: evidence ? targetAssessment(evidence.sleepHours, policy.sleepTargetHours, false, evidence.recovery) : 'unknown',
      workoutIds: evidence?.workoutIds ?? [], orders,
    },
    readiness: { rating: readiness?.rating ?? null, context: readiness?.context ?? null, missing: missingReadiness },
    recomp: bodyTrends(input.days, today),
    review: { consistency: weekly, experiment: input.activeExperiments[0] ?? null,
      nextAction: input.activeExperiments.length ? 'review_existing_experiment' : 'choose_one_experiment',
      automaticallyCommitted: false },
    coaching: { tone: 'concise, tough but fair; praise and orders must cite the returned evidence',
      intensity: input.profile?.coachingIntensity ?? null, profanityPreference: input.profile?.profanityPreference ?? null,
      rules: ['protein remaining first', 'missing or stale evidence is not a miss', 'no extra workout after a completed session', 'no medical readiness classification'] },
  };
}
