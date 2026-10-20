export const trainingTargetFields = ['gymSessionsPerWeek', 'runSessionsPerWeek', 'dailySteps'] as const;
export type TrainingTargetField = (typeof trainingTargetFields)[number];
export type TrainingTargets = Readonly<Record<TrainingTargetField, number | null>>;
export type TrainingTargetsPatch = Readonly<Partial<Record<TrainingTargetField, number | null>>>;

export interface TrainingTargetBound {
  readonly label: string;
  readonly unit: 'sessions/week' | 'steps/day';
  readonly min: number;
  readonly max: number;
}

const bound = (label: string, unit: TrainingTargetBound['unit'], min: number, max: number): TrainingTargetBound =>
  Object.freeze({ label, unit, min, max });

export const trainingTargetBounds: Readonly<Record<TrainingTargetField, TrainingTargetBound>> = Object.freeze({
  gymSessionsPerWeek: bound('Gym sessions', 'sessions/week', 0, 21),
  runSessionsPerWeek: bound('Run sessions', 'sessions/week', 0, 21),
  dailySteps: bound('Steps per day', 'steps/day', 0, 100_000),
});

export const emptyTrainingTargets: TrainingTargets = Object.freeze({
  gymSessionsPerWeek: null,
  runSessionsPerWeek: null,
  dailySteps: null,
});

export interface StoredTrainingTargets {
  readonly targets: TrainingTargets;
  readonly updatedAt: string | null;
}

export type TrainingTargetsParse =
  | { readonly ok: true; readonly patch: TrainingTargetsPatch }
  | { readonly ok: false; readonly reason: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseStoredTrainingTarget(field: TrainingTargetField, stored: unknown): number | null {
  const range = trainingTargetBounds[field];
  return typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= range.min && stored <= range.max
    ? stored
    : null;
}

export function parseTrainingTargetsPatch(value: unknown): TrainingTargetsParse {
  if (!isPlainRecord(value)) return { ok: false, reason: 'Send an object naming the training targets to change.' };
  const keys = Object.keys(value);
  if (keys.length === 0) return { ok: false, reason: 'Name at least one training target to change.' };
  const patch: { -readonly [Key in TrainingTargetField]?: number | null } = {};
  for (const key of keys) {
    if (!(trainingTargetFields as readonly string[]).includes(key)) {
      return { ok: false, reason: `Unknown training target. Use only ${trainingTargetFields.join(', ')}.` };
    }
    const field = key as TrainingTargetField;
    const entry = value[key];
    if (entry === null) {
      patch[field] = null;
      continue;
    }
    const range = trainingTargetBounds[field];
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < range.min || entry > range.max) {
      return { ok: false, reason: `${range.label} must be a whole number from ${range.min} to ${range.max} ${range.unit}, or null to clear it.` };
    }
    patch[field] = entry;
  }
  return { ok: true, patch };
}

export function changedTrainingTargets(current: TrainingTargets, patch: TrainingTargetsPatch): TrainingTargetField[] {
  return trainingTargetFields.filter((field) => patch[field] !== undefined && patch[field] !== current[field]);
}

export function presentTrainingTargets(stored: StoredTrainingTargets) {
  return {
    targets: { ...stored.targets },
    missing: trainingTargetFields.filter((field) => stored.targets[field] === null),
    updatedAt: stored.updatedAt,
    bounds: trainingTargetBounds,
  };
}
