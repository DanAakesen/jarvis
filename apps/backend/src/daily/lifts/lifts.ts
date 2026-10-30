export interface LiftEntry {
  readonly id: string;
  readonly exerciseName: string;
  readonly exerciseKey: string;
  readonly weightKg: number;
  readonly reps: number;
  readonly sets: number;
  readonly performedAt: string;
  readonly deletedAt: string | null;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface LiftCreate {
  readonly idempotencyKey: string;
  readonly exerciseName: string;
  readonly exerciseKey: string;
  readonly weightKg: number;
  readonly reps: number;
  readonly sets: number;
  readonly performedAt: string;
}

export type LiftPatch = Readonly<Partial<Pick<LiftCreate, 'exerciseName' | 'weightKg' | 'reps' | 'sets'>>>;

export type LiftParse =
  | { readonly ok: true; readonly value: LiftCreate }
  | { readonly ok: false; readonly reason: string };

export type LiftPatchParse =
  | { readonly ok: true; readonly patch: LiftPatch }
  | { readonly ok: false; readonly reason: string };

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const fields = ['exerciseName', 'weightKg', 'reps', 'sets'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function parseName(value: unknown): { exerciseName: string; exerciseKey: string } | null {
  if (typeof value !== 'string' || hasControlCharacters(value)) return null;
  const exerciseName = value.trim();
  if (exerciseName.length < 1 || exerciseName.length > 80) return null;
  return { exerciseName, exerciseKey: exerciseName.toLowerCase() };
}

function parseWeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-7 ? rounded / 100 : null;
}

function parsePerformedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !timestamp.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const day = value.slice(0, 10);
  if (day.startsWith('0000-') || !Number.isFinite(Date.parse(day)) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return new Date(time).toISOString();
}

function parseNumericFields(value: Record<string, unknown>) {
  const weightKg = parseWeight(value.weightKg);
  if (weightKg === null) return { ok: false as const, reason: 'Weight must be from 0 to 1000 kg with at most two decimal places.' };
  if (typeof value.reps !== 'number' || !Number.isSafeInteger(value.reps) || value.reps < 1 || value.reps > 1000) {
    return { ok: false as const, reason: 'Reps must be a whole number from 1 to 1000.' };
  }
  if (typeof value.sets !== 'number' || !Number.isSafeInteger(value.sets) || value.sets < 1 || value.sets > 100) {
    return { ok: false as const, reason: 'Sets must be a whole number from 1 to 100.' };
  }
  return { ok: true as const, weightKg, reps: Number(value.reps), sets: Number(value.sets) };
}

export function parseLiftCreate(value: unknown, now: () => number = Date.now): LiftParse {
  if (!isRecord(value) || Object.keys(value).some(key => !['idempotencyKey', ...fields, 'performedAt'].includes(key)) ||
      !uuid.test(String(value.idempotencyKey ?? ''))) {
    return { ok: false, reason: 'Send an idempotency key and valid lift values.' };
  }
  const name = parseName(value.exerciseName);
  if (!name) return { ok: false, reason: 'Exercise name must contain 1 to 80 characters.' };
  const numbers = parseNumericFields(value);
  if (!numbers.ok) return numbers;
  const performedAt = value.performedAt === undefined ? new Date(now()).toISOString() : parsePerformedAt(value.performedAt);
  if (!performedAt) return { ok: false, reason: 'Performed time must be a valid ISO timestamp.' };
  return {
    ok: true,
    value: {
      idempotencyKey: String(value.idempotencyKey).toLowerCase(), ...name,
      weightKg: numbers.weightKg, reps: numbers.reps, sets: numbers.sets, performedAt,
    },
  };
}

export function parseLiftPatch(value: unknown): LiftPatchParse {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).some(key => !fields.includes(key as typeof fields[number]))) {
    return { ok: false, reason: 'Send one or more valid lift fields to update.' };
  }
  const patch: { -readonly [Key in keyof LiftPatch]?: LiftPatch[Key] } = {};
  if ('exerciseName' in value) {
    const name = parseName(value.exerciseName);
    if (!name) return { ok: false, reason: 'Exercise name must contain 1 to 80 characters.' };
    patch.exerciseName = name.exerciseName;
  }
  if ('weightKg' in value) {
    const weightKg = parseWeight(value.weightKg);
    if (weightKg === null) return { ok: false, reason: 'Weight must be from 0 to 1000 kg with at most two decimal places.' };
    patch.weightKg = weightKg;
  }
  if ('reps' in value) {
    if (typeof value.reps !== 'number' || !Number.isSafeInteger(value.reps) || value.reps < 1 || value.reps > 1000) {
      return { ok: false, reason: 'Reps must be a whole number from 1 to 1000.' };
    }
    patch.reps = Number(value.reps);
  }
  if ('sets' in value) {
    if (typeof value.sets !== 'number' || !Number.isSafeInteger(value.sets) || value.sets < 1 || value.sets > 100) {
      return { ok: false, reason: 'Sets must be a whole number from 1 to 100.' };
    }
    patch.sets = Number(value.sets);
  }
  return { ok: true, patch };
}

export function presentLiftEntry(entry: LiftEntry) {
  return {
    id: entry.id,
    exerciseName: entry.exerciseName,
    weightKg: entry.weightKg,
    reps: entry.reps,
    sets: entry.sets,
    performedAt: entry.performedAt,
    deletedAt: entry.deletedAt,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
  };
}
