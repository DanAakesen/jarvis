import { randomUUID } from 'node:crypto';
import { ToolRefusal } from '../../../core/tool-registry.js';
import { dayKey, localDateTimeInstant } from '../../../proactive/time.js';
import type { HealthCoachStore } from '../../../health/coach-store.js';
import { parseWorkoutPatch, presentWorkoutEntry, type WorkoutCreate, type WorkoutEntry, type WorkoutSessionType } from '../../../health/gym/workouts.js';
import { parseLiftPatch, presentLiftEntry, presentLiftWrite, type LiftCreate, type LiftEntry, type LiftPatch } from '../../../health/lifts/lifts.js';
import type { LiftHistoryOptions } from '../../../health/lifts/lifts-store.js';
import { copenhagenDate, date as checkedDate } from '../../../health/nutrition/model.js';
import { emptyTrainingTargets, parseTrainingTargetsPatch, trainingTargetFields, type StoredTrainingTargets, type TrainingTargetsPatch } from '../../../health/training/targets.js';
import type { ConformanceContext } from '../types.testkit.js';

type Row = Record<string, unknown>;
type HistoryKind = 'metrics' | 'sleep' | 'workouts';
interface HealthCursor { readonly date: string; readonly key: string }

const clone = <T>(value: T): T => structuredClone(value);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dateOf = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export const today = () => copenhagenDate(new Date().toISOString());
export const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** An instant on a Copenhagen calendar day, as the ISO string the stores keep. */
export const localTime = (day: string, time: string) => localDateTimeInstant(day, time).toISOString();

// ---- Seeded identities the cases address -----------------------------------------------------------------------------------

export const seededIds = {
  benchPress: '00000000-0000-4000-8000-00000000b001',
  lateralRaise: '00000000-0000-4000-8000-00000000b002',
  cableCurl: '00000000-0000-4000-8000-00000000b003',
  chestSession: '00000000-0000-4000-8000-00000000c001',
  cardioSession: '00000000-0000-4000-8000-00000000c002',
  sessionToEdit: '00000000-0000-4000-8000-00000000c003',
  sessionToDelete: '00000000-0000-4000-8000-00000000c004',
  appleWorkout: 'workout-run-45min',
  brief: 'brief-morning',
} as const;

// ---- What the Health sync stored (Apple Health through the upload service) --------------------------------------------------

const stepsBefore = [4120, 9876, 11234, 8450, 12033, 7600, 10210, 9100];
const sleepHours = [7.4, 6.8, 7.9, 7.1, 6.5, 8.0, 7.3];

/** Rows in the shape the SQL read model returns, for the seven days up to today. Dated from the clock so "today" is always today. */
export class FakeHealthReadModel {
  private metrics(): Row[] {
    const now = today();
    return stepsBefore.flatMap((steps, ago) => {
      const day = shiftDay(now, -ago);
      const stamp = ago === 0 ? new Date(Date.now() - 12 * 60_000).toISOString() : localTime(day, '23:50');
      const base = { metric_date: asDate(day), min_value: null, avg_value: null, max_value: null, start_at: localTime(day, '00:00'), end_at: localTime(day, ago === 0 ? '12:00' : '23:59'), ingestion_id: `upload-${day}`, updated_at: stamp };
      const fields = (aggregation: 'sum' | 'average' | 'latest', unit: string, value: number) => ({
        aggregation, mergedDailyTotal: aggregation === 'sum', sources: ['Dan’s iPhone', 'Dan’s Apple Watch'], sourcesTruncated: false,
        latestSample: { observedAt: stamp, value, sourceUnit: unit, source: 'Dan’s Apple Watch', device: 'Watch', conversionFactor: null, valueIsSourceUnits: null },
      });
      return [
        { ...base, metric_name: 'step_count', unit: 'count', value: steps, sample_count: 24, fields: fields('sum', 'count', steps) },
        { ...base, metric_name: 'active_energy', unit: 'kcal', value: ago === 0 ? 420.5 : 520 + ago * 17, sample_count: 24, fields: fields('sum', 'kcal', 420.5) },
        { ...base, metric_name: 'resting_energy', unit: 'kcal', value: 1780, sample_count: 24, fields: fields('sum', 'kcal', 1780) },
        { ...base, metric_name: 'resting_heart_rate', unit: 'bpm', value: 52 + (ago % 4), sample_count: 1, fields: fields('latest', 'bpm', 52 + (ago % 4)) },
      ];
    });
  }

  private sleep(): Row[] {
    const now = today();
    return sleepHours.map((hours, ago) => {
      const day = shiftDay(now, -ago);
      return {
        sleep_date: asDate(day), sleep_start: localTime(shiftDay(day, -1), '23:05'), sleep_end: localTime(day, '06:40'), total_sleep_hours: hours,
        asleep_hours: Math.round((hours - 0.3) * 10) / 10, core_hours: Math.round(hours * 0.5 * 10) / 10, deep_hours: 1.2, rem_hours: 1.7, awake_hours: 0.3,
        in_bed_hours: Math.round((hours + 0.4) * 10) / 10, segment_count: 9, sources: ['Dan’s Apple Watch'], sourcesTruncated: false,
        ingestion_id: `upload-${day}`, updated_at: localTime(day, '07:00'),
      };
    });
  }

  private workouts(): Row[] {
    const now = today();
    const row = (ago: number, id: string, type: string, identifier: string, minutes: number, extra: Row) => {
      const day = shiftDay(now, -ago);
      return {
        id, workout_type: type, activity_identifier: identifier, workout_date: asDate(day), start_at: localTime(day, '17:30'),
        end_at: new Date(Date.parse(localTime(day, '17:30')) + minutes * 60_000).toISOString(), duration_seconds: minutes * 60, source_name: 'Dan’s Apple Watch',
        is_indoor: false, active_energy_value: Math.round(minutes * 11), active_energy_unit: 'kcal', total_energy_value: Math.round(minutes * 13), total_energy_unit: 'kcal',
        distance_value: null, distance_unit: null, avg_heart_rate: 138, max_heart_rate: 171, ingestion_id: `upload-${day}`, updated_at: localTime(day, '19:00'), ...extra,
      };
    };
    return [
      row(1, seededIds.appleWorkout, 'Running', 'HKWorkoutActivityTypeRunning', 45, { distance_value: 7400, distance_unit: 'm' }),
      row(3, 'workout-strength-62min', 'Traditional Strength Training', 'HKWorkoutActivityTypeTraditionalStrengthTraining', 62, { is_indoor: true, avg_heart_rate: 118 }),
      row(5, 'workout-walk-38min', 'Walking', 'HKWorkoutActivityTypeWalking', 38, { distance_value: 3100, distance_unit: 'm', avg_heart_rate: 104 }),
      row(8, 'workout-run-41min', 'Running', 'HKWorkoutActivityTypeRunning', 41, { distance_value: 6600, distance_unit: 'm' }),
    ];
  }

  async history(kind: HistoryKind, range: { startDate: string; endDate: string; limit?: number; after?: HealthCursor; metric?: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    const limit = range.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('Invalid health page limit');
    checkedDate(range.startDate); checkedDate(range.endDate);
    if (range.endDate < range.startDate || Date.parse(range.endDate) - Date.parse(range.startDate) > 366 * 86_400_000) throw new TypeError('Invalid health history range');
    if (range.metric !== undefined && kind !== 'metrics') throw new TypeError('Invalid health metric filter');
    const [dateColumn, keyColumn] = kind === 'metrics' ? ['metric_date', 'metric_name'] : kind === 'sleep' ? ['sleep_date', 'sleep_date'] : ['workout_date', 'id'];
    const alias = range.metric?.includes(' ') ? `${range.metric.charAt(0).toLowerCase()}${range.metric.slice(1).replaceAll(' ', '_')}` : null;
    const all = kind === 'metrics' ? this.metrics() : kind === 'sleep' ? this.sleep() : this.workouts();
    const exactExists = range.metric !== undefined && all.some((row) => row.metric_name === range.metric);
    const key = (row: Row) => dateOf(row[keyColumn]);
    const rows = all
      .filter((row) => dateOf(row[dateColumn]) >= range.startDate && dateOf(row[dateColumn]) <= range.endDate)
      .filter((row) => range.metric === undefined || row.metric_name === range.metric || (alias !== null && !exactExists && row.metric_name === alias))
      .sort((left, right) => dateOf(left[dateColumn]).localeCompare(dateOf(right[dateColumn])) || (kind === 'sleep' ? 0 : key(left).localeCompare(key(right))))
      .filter((row) => !range.after || dateOf(row[dateColumn]) > range.after.date || (kind !== 'sleep' && dateOf(row[dateColumn]) === range.after.date && key(row) > range.after.key));
    const truncated = rows.length > limit;
    const items = rows.slice(0, limit).map(clone);
    const last = items.at(-1);
    return { items, truncated, next: truncated && last ? { date: dateOf(last[dateColumn]), key: key(last) } : null };
  }

  async metricCatalog(range: { startDate: string; endDate: string; limit?: number; after?: { key: string } }, signal: AbortSignal) {
    signal.throwIfAborted();
    checkedDate(range.startDate); checkedDate(range.endDate);
    const limit = range.limit ?? 100;
    const inRange = this.metrics().filter((row) => dateOf(row.metric_date) >= range.startDate && dateOf(row.metric_date) <= range.endDate);
    const names = [...new Set(inRange.map((row) => String(row.metric_name)))].sort().filter((name) => !range.after || name > range.after.key);
    const items = names.slice(0, limit).map((name) => {
      const rows = inRange.filter((row) => row.metric_name === name);
      const days = rows.map((row) => dateOf(row.metric_date)).sort();
      return { metric_name: name, units: [...new Set(rows.map((row) => String(row.unit)))], first_date: asDate(days[0]!), last_date: asDate(days.at(-1)!),
        day_count: days.length, latest_updated_at: rows.map((row) => String(row.updated_at)).sort().at(-1)! };
    });
    return { items, next: names.length > limit ? { key: items.at(-1)!.metric_name } : null };
  }

  async workoutDetail(workoutId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const workout = this.workouts().find((row) => row.id === workoutId);
    if (!workout) return null;
    return { id: workoutId, detail: {
      name: workout.workout_type, location: workout.is_indoor ? 'Indoor' : 'Outdoor',
      heart_rate: { unit: 'bpm', samples: 2460, value: null, min_value: 96, avg_value: workout.avg_heart_rate, max_value: workout.max_heart_rate },
      activeEnergyBurned: { qty: workout.active_energy_value, units: 'kcal' },
    } };
  }

  async workoutMetrics(workoutId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const workout = this.workouts().find((row) => row.id === workoutId);
    if (!workout) return { items: [] as Row[], truncated: false };
    const fields = { aggregation: 'average', sources: ['Dan’s Apple Watch'], sourcesTruncated: false, latestSample: { observedAt: workout.end_at, value: 142, sourceUnit: 'bpm', source: 'Dan’s Apple Watch', device: 'Watch', conversionFactor: null, valueIsSourceUnits: null } };
    return { items: [
      { workout_id: workoutId, metric_name: 'heart_rate', unit: 'bpm', value: null, min_value: 96, avg_value: workout.avg_heart_rate, max_value: workout.max_heart_rate, sample_count: 2460, ingestion_id: workout.ingestion_id, updated_at: workout.updated_at, fields },
      { workout_id: workoutId, metric_name: 'step_cadence', unit: 'count/min', value: null, min_value: 140, avg_value: 168, max_value: 184, sample_count: 2400, ingestion_id: workout.ingestion_id, updated_at: workout.updated_at, fields },
    ] as Row[], truncated: false };
  }

  async heartRate(workoutId: string, options: { limit?: number; after?: { minute: string; metric: string }; metric?: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    const workout = this.workouts().find((row) => row.id === workoutId);
    const limit = options.limit ?? 200;
    if (!workout) return { items: [] as Row[], truncated: false, next: null };
    const start = Date.parse(String(workout.start_at));
    const rows = Array.from({ length: 8 }, (_, minute) => ({
      sample_minute: new Date(start + minute * 60_000).toISOString(), metric_name: 'heart_rate', min_value: 118 + minute, avg_value: 126 + minute * 2, max_value: 134 + minute * 2,
      unit: 'bpm', sample_count: 55, sources: ['Dan’s Apple Watch'], sourcesTruncated: false,
    })).filter((row) => (options.metric === undefined || row.metric_name === options.metric) && (!options.after || row.sample_minute > options.after.minute));
    const items = rows.slice(0, limit) as Row[];
    const last = items.at(-1);
    return { items, truncated: rows.length > limit, next: rows.length > limit && last ? { minute: String(last.sample_minute), metric: String(last.metric_name) } : null };
  }

  async sync(signal: AbortSignal) {
    signal.throwIfAborted();
    const processed = new Date(Date.now() - 25 * 60_000).toISOString();
    return {
      feeds: [
        { feed_kind: 'metrics', accepted_evidence_at: processed, processed_committed_at: processed, metric_rows: 32, sleep_rows: 7, workout_rows: null, heart_rate_minutes: null },
        { feed_kind: 'workouts', accepted_evidence_at: processed, processed_committed_at: processed, metric_rows: null, sleep_rows: null, workout_rows: 4, heart_rate_minutes: 8 },
      ] as Row[],
      heartbeat: { last_received_at: processed } as Row | null,
      inbox: { retained: 12, retained_bytes: 48_000, byte_limit: 25 * 1024 * 1024, row_limit: 5000, accepted: 0, pending: 0, processing: 0, succeeded: 12, quarantined: 0,
        last_accepted_at: processed, last_processed_upload_at: processed } as Row | null,
    };
  }
}

/** The stored morning brief, read as history only. */
export class FakeBriefs {
  private rows(): Row[] {
    const day = today();
    const started = localTime(day, '07:00');
    return [{
      id: seededIds.brief, trigger: 'scheduled', started_at: started, completed_at: localTime(day, '07:01'), status: 'completed', health_status: 'available',
      delivery_status: 'delivered', delivered_at: localTime(day, '07:02'), updated_at: localTime(day, '07:02'),
      preview_text: 'Slept 7.4 hours, 4,120 steps so far, a run planned for the evening.', body_json: JSON.stringify({ sections: [{ title: 'Sleep', text: '7.4 hours.' }] }),
    }];
  }

  async history(options: { limit?: number; after?: { startedAt: string; id: string } }, signal: AbortSignal) {
    signal.throwIfAborted();
    const limit = options.limit ?? 50;
    const rows = this.rows().filter((row) => !options.after || String(row.started_at) < options.after.startedAt);
    const items = rows.slice(0, limit).map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'preview_text' && field !== 'body_json')));
    return { items, next: null };
  }

  async detail(briefId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    return this.rows().find((row) => row.id === briefId) ?? null;
  }
}

// ---- Training targets and the coach ---------------------------------------------------------------------------------------

export class FakeTrainingTargets {
  private stored: StoredTrainingTargets;

  constructor(initial: TrainingTargetsPatch) {
    this.stored = { targets: { ...emptyTrainingTargets, ...initial } as StoredTrainingTargets['targets'], updatedAt: new Date().toISOString() };
  }

  async read(signal: AbortSignal): Promise<StoredTrainingTargets> {
    signal.throwIfAborted();
    return clone(this.stored);
  }

  async write(patch: TrainingTargetsPatch, signal: AbortSignal): Promise<StoredTrainingTargets> {
    signal.throwIfAborted();
    const checked = parseTrainingTargetsPatch(patch);
    if (!checked.ok) throw new TypeError('A training-target change must name valid targets');
    const targets = { ...this.stored.targets };
    for (const field of trainingTargetFields) if (checked.patch[field] !== undefined) (targets as Record<string, number | null>)[field] = checked.patch[field]!;
    this.stored = { targets, updatedAt: new Date().toISOString() };
    return clone(this.stored);
  }
}

type Profile = Record<string, unknown>;

export class FakeCoach implements HealthCoachStore {
  private profileRow: Profile = {
    displayName: 'Dan', primaryGoal: 'Lose fat and keep strength', currentPhase: 'cut', dateOfBirth: '1990-05-14', deficitRate: 0.01, proteinMinimumGrams: 150,
    proteinPerKg: 1.8, sleepTargetHours: 7.5, stepsTarget: 10_000, gymTargetWeekly: 3, runTargetWeekly: 2, coachingIntensity: 'steady', profanityPreference: 'none',
    mealSchedule: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, foodPreferences: { likes: ['skyr', 'salmon'] }, restrictions: [], footballPreferences: {},
    revision: '1', updatedAt: new Date().toISOString(),
  };
  private recoveryDays = new Map<string, Row>();

  async profile(signal: AbortSignal): Promise<{ status: 'available'; profile: Profile }> {
    signal.throwIfAborted();
    return { status: 'available', profile: clone(this.profileRow) };
  }

  async updateProfile(patch: Row, expectedRevision: bigint, signal: AbortSignal): Promise<Row> {
    signal.throwIfAborted();
    if (BigInt(String(this.profileRow.revision)) !== expectedRevision) throw new ToolRefusal('The coach profile changed. Read the current profile and review the update again.');
    this.profileRow = { ...this.profileRow, ...clone(patch), revision: String(expectedRevision + 1n), updatedAt: new Date().toISOString() };
    return clone(this.profileRow);
  }

  async recovery(startDate: string, endDate: string, signal: AbortSignal): Promise<Row[]> {
    signal.throwIfAborted();
    checkedDate(startDate); checkedDate(endDate);
    return [...this.recoveryDays.entries()].filter(([day]) => day >= startDate && day <= endDate).sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => clone(row));
  }

  async setRecovery(startDate: string, endDate: string, state: 'sick' | 'clear', context: string | null, signal: AbortSignal) {
    signal.throwIfAborted();
    checkedDate(startDate); checkedDate(endDate);
    const days: string[] = [];
    for (let day = startDate; day <= endDate; day = shiftDay(day, 1)) days.push(day);
    const at = new Date().toISOString();
    if (state === 'clear') {
      const affected = days.filter((day) => this.recoveryDays.delete(day)).length;
      return { affectedDays: affected, state } as const;
    }
    for (const day of days) this.recoveryDays.set(day, { recovery_date: asDate(day), context_text: context, created_at: at, updated_at: at });
    return { affectedDays: days.length, state } as const;
  }
}

// ---- Strength lifts and gym sessions (the app's own log) -------------------------------------------------------------------

type Changes = { publish(change: { owner: string; sources: never[] }): void };

/** The Gym log copy in the vault, healthy: every saved entry is marked as copied. */
const syncedNow = <T extends { revision: number }>(entry: T) => ({ ...entry, vaultSyncedRevision: entry.revision });

export class FakeLifts {
  private entries: LiftEntry[] = [];
  private keys = new Map<string, string>();

  constructor(private readonly context: ConformanceContext, private readonly changes: Changes, private readonly workouts: FakeWorkouts) {}

  seed(input: { id?: string; name: string; weightKg: number; reps: number; sets: number; performedAt: string; workoutId?: string | null }): string {
    const id = input.id ?? randomUUID();
    this.entries.push(syncedNow({
      id, exerciseName: input.name, exerciseKey: input.name.toLowerCase(), weightKg: input.weightKg, reps: input.reps, sets: input.sets, performedAt: input.performedAt,
      deletedAt: null, updatedAt: input.performedAt, revision: 1, workoutId: input.workoutId ?? null, gymDay: dayKey(new Date(input.performedAt)), vaultSyncedRevision: null,
    }));
    return id;
  }

  async history(options: LiftHistoryOptions, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new TypeError('Invalid lift history options');
    const live = this.entries.filter((entry) => entry.deletedAt === null)
      .sort((left, right) => right.performedAt.localeCompare(left.performedAt) || right.id.localeCompare(left.id));
    const wanted = options.lastPerExercise ? live.filter((entry, index) => live.findIndex((other) => other.exerciseKey === entry.exerciseKey) === index) : live;
    const rows = wanted.filter((entry) => !options.cursor || entry.performedAt < options.cursor.performedAt || (entry.performedAt === options.cursor.performedAt && entry.id < options.cursor.id));
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return { items: items.map(presentLiftEntry), next: rows.length > options.limit && last ? { performedAt: last.performedAt, id: last.id } : null };
  }

  /** A saved lift under the same idempotency key (the same Dan message and entry index) is a replay of the first one. */
  async create(value: LiftCreate, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = value.idempotencyKey;
    const known = this.keys.get(key);
    if (known) return { entry: presentLiftWrite(this.entries.find((entry) => entry.id === known)!), replayed: true };
    if (value.workoutId && !this.workouts.exists(value.workoutId)) throw new ToolRefusal('Workout entry not found.');
    const at = new Date().toISOString();
    const entry: LiftEntry = syncedNow({
      id: randomUUID(), exerciseName: value.exerciseName, exerciseKey: value.exerciseKey, weightKg: value.weightKg, reps: value.reps, sets: value.sets, performedAt: value.performedAt,
      deletedAt: null, updatedAt: at, revision: 1, workoutId: value.workoutId, gymDay: dayKey(new Date(value.performedAt)), vaultSyncedRevision: null,
    });
    this.entries.push(entry);
    this.keys.set(key, entry.id);
    this.changes.publish({ owner: this.context.owner, sources: [] });
    return { entry: presentLiftWrite(entry), replayed: false };
  }

  async update(id: string, patch: LiftPatch, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!parseLiftPatch(patch).ok) throw new TypeError('A lift update must include a valid entry and patch');
    const index = this.entries.findIndex((entry) => entry.id === id && entry.deletedAt === null);
    if (index < 0) return null;
    const current = this.entries[index]!;
    const updated: LiftEntry = syncedNow({
      ...current, ...patch, ...(patch.exerciseName !== undefined ? { exerciseKey: patch.exerciseName.toLowerCase() } : {}),
      updatedAt: new Date().toISOString(), revision: current.revision + 1,
    });
    this.entries[index] = updated;
    return presentLiftWrite(updated);
  }

  async delete(id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const index = this.entries.findIndex((entry) => entry.id === id && entry.deletedAt === null);
    if (index < 0) return null;
    const at = new Date().toISOString();
    const deleted: LiftEntry = syncedNow({ ...this.entries[index]!, deletedAt: at, updatedAt: at, revision: this.entries[index]!.revision + 1 });
    this.entries[index] = deleted;
    return presentLiftWrite(deleted);
  }
}

export class FakeWorkouts {
  private entries: WorkoutEntry[] = [];
  private keys = new Map<string, string>();

  constructor(private readonly context: ConformanceContext, private readonly changes: Changes) {}

  exists(id: string): boolean { return this.entries.some((entry) => entry.id === id && entry.deletedAt === null); }

  seed(input: { id?: string; type: WorkoutSessionType; title?: string | null; startedAt: string; durationMinutes: number | null; note?: string | null }): string {
    const id = input.id ?? randomUUID();
    this.entries.push(syncedNow({
      id, sessionType: input.type, title: input.title ?? null, startedAt: input.startedAt, gymDay: dayKey(new Date(input.startedAt)), durationMinutes: input.durationMinutes,
      note: input.note ?? null, deletedAt: null, updatedAt: input.startedAt, revision: 1, vaultSyncedRevision: null,
    }));
    return id;
  }

  async history(options: { readonly limit: number; readonly days?: number }, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new TypeError('Invalid workout history options');
    const since = options.days === undefined ? null : new Date(Date.now() - options.days * 86_400_000).toISOString();
    const items = this.entries.filter((entry) => entry.deletedAt === null && (since === null || entry.startedAt >= since))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id)).slice(0, options.limit);
    return { items: items.map(presentWorkoutEntry) };
  }

  async create(value: WorkoutCreate, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = value.idempotencyKey;
    const known = this.keys.get(key);
    if (known) return { entry: presentWorkoutEntry(this.entries.find((entry) => entry.id === known)!), replayed: true };
    const at = new Date().toISOString();
    const entry: WorkoutEntry = syncedNow({
      id: randomUUID(), sessionType: value.sessionType, title: value.title, startedAt: value.startedAt, gymDay: dayKey(new Date(value.startedAt)),
      durationMinutes: value.durationMinutes, note: value.note, deletedAt: null, updatedAt: at, revision: 1, vaultSyncedRevision: null,
    });
    this.entries.push(entry);
    this.keys.set(key, entry.id);
    this.changes.publish({ owner: this.context.owner, sources: [] });
    return { entry: presentWorkoutEntry(entry), replayed: false };
  }

  async update(id: string, patch: Row, signal: AbortSignal) {
    signal.throwIfAborted();
    const checked = parseWorkoutPatch(patch);
    if (!checked.ok) throw new TypeError('A workout update must include a valid entry and patch');
    const index = this.entries.findIndex((entry) => entry.id === id && entry.deletedAt === null);
    if (index < 0) return null;
    const current = this.entries[index]!;
    const { sessionType, title, durationMinutes, note } = checked.patch;
    const type = sessionType ?? current.sessionType;
    const updated: WorkoutEntry = syncedNow({
      ...current, sessionType: type, title: type === 'other' ? (title !== undefined ? title : current.title) : null,
      durationMinutes: durationMinutes !== undefined ? durationMinutes : current.durationMinutes, note: note !== undefined ? note : current.note,
      updatedAt: new Date().toISOString(), revision: current.revision + 1,
    });
    this.entries[index] = updated;
    return presentWorkoutEntry(updated);
  }

  async delete(id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const index = this.entries.findIndex((entry) => entry.id === id && entry.deletedAt === null);
    if (index < 0) return null;
    const at = new Date().toISOString();
    const deleted: WorkoutEntry = syncedNow({ ...this.entries[index]!, deletedAt: at, updatedAt: at, revision: this.entries[index]!.revision + 1 });
    this.entries[index] = deleted;
    return presentWorkoutEntry(deleted);
  }
}

