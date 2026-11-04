export const workoutSessionTypes = [
  'chest_triceps_core', 'back_biceps_core', 'arms_shoulders', 'legs_core', 'cardio', 'other',
] as const;
export type WorkoutSessionType = typeof workoutSessionTypes[number];
export type VaultState = 'synced' | 'pending';

export interface WorkoutEntry {
  readonly id: string;
  readonly sessionType: WorkoutSessionType;
  readonly title: string | null;
  readonly startedAt: string;
  readonly gymDay: string;
  readonly durationMinutes: number | null;
  readonly note: string | null;
  readonly deletedAt: string | null;
  readonly updatedAt: string;
  readonly revision: number;
  readonly vaultSyncedRevision: number | null;
}

export interface WorkoutCreate {
  readonly idempotencyKey: string;
  readonly sessionType: WorkoutSessionType;
  readonly title: string | null;
  readonly startedAt: string;
  readonly durationMinutes: number | null;
  readonly note: string | null;
}

export interface WorkoutPatch {
  readonly sessionType?: WorkoutSessionType;
  readonly title?: string | null;
  readonly durationMinutes?: number | null;
  readonly note?: string | null;
}

export type WorkoutParse =
  | { readonly ok: true; readonly value: WorkoutCreate }
  | { readonly ok: false; readonly reason: string };
export type WorkoutPatchParse =
  | { readonly ok: true; readonly patch: WorkoutPatch }
  | { readonly ok: false; readonly reason: string };

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const createKeys = ['idempotencyKey', 'sessionType', 'title', 'startedAt', 'durationMinutes', 'note'];
const patchKeys = ['sessionType', 'title', 'durationMinutes', 'note'];
const noteReason = 'Note must be one line of at most 500 characters.';
const titleReason = 'Title must contain 1 to 80 characters and is only used for the Other session type.';

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

function parseText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || hasControlCharacters(value)) return undefined;
  const text = value.trim();
  if (text.length > max) return undefined;
  return text.length === 0 ? null : text;
}

function parseDuration(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1440 ? value : undefined;
}

export function isSessionType(value: unknown): value is WorkoutSessionType {
  return typeof value === 'string' && (workoutSessionTypes as readonly string[]).includes(value);
}

function parseStartedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !timestamp.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const day = value.slice(0, 10);
  if (day.startsWith('0000-') || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return new Date(time).toISOString();
}

export function parseWorkoutCreate(value: unknown, now: () => number = Date.now): WorkoutParse {
  if (!isRecord(value) || Object.keys(value).some(key => !createKeys.includes(key)) ||
      !uuid.test(String(value.idempotencyKey ?? ''))) {
    return { ok: false, reason: 'Send an idempotency key and valid workout values.' };
  }
  if (!isSessionType(value.sessionType)) return { ok: false, reason: 'Session type is not supported.' };
  const title = value.title === undefined ? null : parseText(value.title, 80);
  if (title === undefined || title !== null && value.sessionType !== 'other') return { ok: false, reason: titleReason };
  const note = value.note === undefined ? null : parseText(value.note, 500);
  if (note === undefined) return { ok: false, reason: noteReason };
  const durationMinutes = value.durationMinutes === undefined ? null : parseDuration(value.durationMinutes);
  if (durationMinutes === undefined) return { ok: false, reason: 'Duration must be a whole number of minutes from 1 to 1440.' };
  const startedAt = value.startedAt === undefined ? new Date(now()).toISOString() : parseStartedAt(value.startedAt);
  if (!startedAt) return { ok: false, reason: 'Start time must be a valid ISO timestamp.' };
  return {
    ok: true,
    value: {
      idempotencyKey: String(value.idempotencyKey).toLowerCase(), sessionType: value.sessionType,
      title, startedAt, durationMinutes, note,
    },
  };
}

export function parseWorkoutPatch(value: unknown): WorkoutPatchParse {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).some(key => !patchKeys.includes(key))) {
    return { ok: false, reason: 'Send one or more valid workout fields to update.' };
  }
  const patch: { -readonly [Key in keyof WorkoutPatch]?: WorkoutPatch[Key] } = {};
  if ('sessionType' in value) {
    if (!isSessionType(value.sessionType)) return { ok: false, reason: 'Session type is not supported.' };
    patch.sessionType = value.sessionType;
  }
  if ('title' in value) {
    const title = parseText(value.title, 80);
    if (title === undefined || title !== null && patch.sessionType !== undefined && patch.sessionType !== 'other') {
      return { ok: false, reason: titleReason };
    }
    patch.title = title;
  }
  if ('durationMinutes' in value) {
    const duration = parseDuration(value.durationMinutes);
    if (duration === undefined) return { ok: false, reason: 'Duration must be a whole number of minutes from 1 to 1440.' };
    patch.durationMinutes = duration;
  }
  if ('note' in value) {
    const note = parseText(value.note, 500);
    if (note === undefined) return { ok: false, reason: noteReason };
    patch.note = note;
  }
  return { ok: true, patch };
}

export function vaultStateOf(entry: { readonly revision: number; readonly vaultSyncedRevision: number | null }): VaultState {
  return entry.vaultSyncedRevision !== null && entry.vaultSyncedRevision >= entry.revision ? 'synced' : 'pending';
}

export function presentWorkoutEntry(entry: WorkoutEntry) {
  return {
    id: entry.id,
    sessionType: entry.sessionType,
    title: entry.title,
    startedAt: entry.startedAt,
    durationMinutes: entry.durationMinutes,
    note: entry.note,
    deletedAt: entry.deletedAt,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
    vault: vaultStateOf(entry),
  };
}
