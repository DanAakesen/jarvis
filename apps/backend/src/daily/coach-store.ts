import sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { ToolFailure, ToolRefusal } from '../core/tool-registry.js';
import { resolveDailyOwner } from './owner.js';

const profileFields = {
  displayName: ['display_name', sql.NVarChar(sql.MAX)],
  primaryGoal: ['primary_goal', sql.NVarChar(sql.MAX)],
  currentPhase: ['current_phase', sql.NVarChar(256)],
  dateOfBirth: ['date_of_birth', sql.Date],
  deficitRate: ['deficit_rate', sql.Float],
  proteinMinimumGrams: ['protein_minimum_grams', sql.Float],
  proteinPerKg: ['protein_per_kg', sql.Float],
  sleepTargetHours: ['sleep_target_hours', sql.Float],
  stepsTarget: ['steps_target', sql.BigInt],
  gymTargetWeekly: ['gym_target_weekly', sql.BigInt],
  runTargetWeekly: ['run_target_weekly', sql.BigInt],
  coachingIntensity: ['coaching_intensity', sql.NVarChar(256)],
  profanityPreference: ['profanity_preference', sql.NVarChar(256)],
  mealSchedule: ['meal_schedule_json', sql.NVarChar(sql.MAX)],
  foodPreferences: ['food_preferences_json', sql.NVarChar(sql.MAX)],
  restrictions: ['restrictions_json', sql.NVarChar(sql.MAX)],
  footballPreferences: ['football_preferences_json', sql.NVarChar(sql.MAX)],
} as const;

type ProfileField = keyof typeof profileFields;
type ProfilePatch = Partial<Record<ProfileField, string | number | Record<string, unknown> | unknown[]>>;
type RecoveryState = 'sick' | 'clear';

export interface DailyCoachStore {
  profile(signal: AbortSignal): Promise<{ status: 'available'; profile: Record<string, unknown> } | { status: 'not-configured'; profile: null }>;
  updateProfile(patch: ProfilePatch, expectedRevision: bigint, signal: AbortSignal): Promise<Record<string, unknown>>;
  recovery(startDate: string, endDate: string, signal: AbortSignal): Promise<Record<string, unknown>[]>;
  setRecovery(startDate: string, endDate: string, state: RecoveryState, context: string | null, signal: AbortSignal): Promise<{ affectedDays: number; state: RecoveryState }>;
}

function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new TypeError('Invalid Daily date');
  }
  return value;
}

function profilePatch(value: unknown): ProfilePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolRefusal('Use a non-empty profile patch with only supported fields.');
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (!keys.length || keys.some(key => !Object.hasOwn(profileFields, key))) throw new ToolRefusal('Use a non-empty profile patch with only supported fields.');
  const result: Record<string, string | number | Record<string, unknown> | unknown[]> = {};
  for (const key of keys as ProfileField[]) {
    const entry = input[key];
    if (['mealSchedule', 'foodPreferences', 'restrictions', 'footballPreferences'].includes(key)) {
      if (!entry || typeof entry !== 'object' || JSON.stringify(entry).length > 12_000) throw new ToolRefusal('Profile preference values must be bounded JSON objects or arrays.');
      result[key] = entry as Record<string, unknown> | unknown[];
      continue;
    }
    if (key === 'deficitRate' && typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 0.5) {
      result[key] = entry;
      continue;
    }
    if (key === 'proteinMinimumGrams' && typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 500) {
      result[key] = entry;
      continue;
    }
    if (key === 'proteinPerKg' && typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 5) {
      result[key] = entry;
      continue;
    }
    if (key === 'sleepTargetHours' && typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 24) {
      result[key] = entry;
      continue;
    }
    if (['stepsTarget', 'gymTargetWeekly', 'runTargetWeekly'].includes(key) && typeof entry === 'number' &&
        Number.isSafeInteger(entry) && entry >= 0 && entry <= (key === 'stepsTarget' ? 100_000 : 50)) {
      result[key] = entry;
      continue;
    }
    if (key === 'dateOfBirth' && typeof entry === 'string') {
      result[key] = date(entry);
      continue;
    }
    if (typeof entry === 'string' && entry.trim() === entry && entry.length > 0 && entry.length <= (key === 'displayName' || key === 'primaryGoal' ? 2000 : 256)) {
      result[key] = entry;
      continue;
    }
    throw new ToolRefusal(`The ${key} profile value is invalid or outside its supported range.`);
  }
  return result as ProfilePatch;
}

function parseProfile(row: Record<string, unknown>): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  for (const [field, [column]] of Object.entries(profileFields)) {
    const value = row[column];
    profile[field] = column.endsWith('_json') && typeof value === 'string' ? JSON.parse(value) : value instanceof Date && column === 'date_of_birth' ? value.toISOString().slice(0, 10) : value;
  }
  profile.revision = String(row.revision);
  profile.updatedAt = row.updated_at;
  return profile;
}

export class SqlDailyCoachStore implements DailyCoachStore {
  private constructor(private readonly pool: sql.ConnectionPool, private readonly owner: string) {}

  static forRequest(pool: sql.ConnectionPool, request: FastifyRequest): SqlDailyCoachStore {
    return new SqlDailyCoachStore(pool, resolveDailyOwner(request));
  }

  private async query(request: sql.Request, statement: string, signal: AbortSignal) {
    const cancel = () => request.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try { signal.throwIfAborted(); return await request.query<Record<string, unknown>>(statement); }
    finally { signal.removeEventListener('abort', cancel); }
  }

  async profile(signal: AbortSignal) {
    try {
      const row = (await this.query(this.pool.request().input('owner', sql.UniqueIdentifier, this.owner),
        'SELECT * FROM daily.coach_profiles WHERE owner_object_id=@owner;', signal)).recordset[0];
      return row ? { status: 'available' as const, profile: parseProfile(row) } : { status: 'not-configured' as const, profile: null };
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('The coach profile could not be read.');
    }
  }

  async updateProfile(rawPatch: ProfilePatch, expectedRevision: bigint, signal: AbortSignal) {
    const patch = profilePatch(rawPatch);
    if (typeof expectedRevision !== 'bigint' || expectedRevision < 1n || expectedRevision >= 9223372036854775807n) throw new TypeError('Invalid coach profile revision');
    const tx = new sql.Transaction(this.pool);
    let started = false;
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); started = true;
      const current = (await this.query(new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner),
        'SELECT * FROM daily.coach_profiles WITH (UPDLOCK,HOLDLOCK) WHERE owner_object_id=@owner;', signal)).recordset[0];
      if (!current) throw new ToolRefusal('The coach profile is not configured, so no profile fields were changed.');
      const revision = BigInt(String(current.revision));
      const same = Object.entries(patch).every(([field, value]) => {
        const [column] = profileFields[field as ProfileField];
        const stored = current[column];
        return column.endsWith('_json') ? JSON.stringify(JSON.parse(String(stored))) === JSON.stringify(value) : stored instanceof Date && column === 'date_of_birth'
          ? stored.toISOString().slice(0, 10) === value : String(stored) === String(value);
      });
      if (revision === expectedRevision + 1n && same) {
        await tx.commit(); started = false;
        return parseProfile(current);
      }
      if (revision !== expectedRevision) throw new ToolRefusal('The coach profile changed. Read the current profile and review the update again.');
      const assignments: string[] = [];
      const request = new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner).input('now', sql.NVarChar(64), new Date().toISOString());
      for (const [field, value] of Object.entries(patch) as [ProfileField, ProfilePatch[ProfileField]][]) {
        const [column, type] = profileFields[field];
        const parameter = `value${assignments.length}`;
        const bound = column.endsWith('_json') ? JSON.stringify(value) : column === 'date_of_birth' ? new Date(`${value}T00:00:00Z`) : value;
        request.input(parameter, type, bound);
        assignments.push(`[${column}]=@${parameter}`);
      }
      const saved = (await this.query(request,
        `UPDATE daily.coach_profiles SET ${assignments.join(',')},revision=revision+1,updated_at=@now OUTPUT INSERTED.* WHERE owner_object_id=@owner;`, signal)).recordset[0];
      if (!saved) throw new ToolFailure('The coach profile update returned no committed row.');
      signal.throwIfAborted();
      await tx.commit(); started = false;
      return parseProfile(saved);
    } catch (error) {
      if (started) await tx.rollback().catch(() => undefined);
      if (signal.aborted || error instanceof ToolRefusal || error instanceof ToolFailure) throw error;
      throw new ToolFailure('The coach profile update could not be confirmed. Read the profile before retrying.');
    }
  }

  async recovery(startDate: string, endDate: string, signal: AbortSignal) {
    date(startDate); date(endDate);
    if (endDate < startDate || Date.parse(endDate) - Date.parse(startDate) > 366 * 86_400_000) throw new TypeError('Invalid recovery period');
    try {
      return (await this.query(this.pool.request().input('owner', sql.UniqueIdentifier, this.owner)
        .input('start', sql.Date, new Date(`${startDate}T00:00:00Z`)).input('end', sql.Date, new Date(`${endDate}T00:00:00Z`)),
      'SELECT recovery_date,context_text,created_at,updated_at FROM daily.recovery_days WHERE owner_object_id=@owner AND recovery_date BETWEEN @start AND @end ORDER BY recovery_date;', signal)).recordset;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ToolFailure('Recovery markers could not be read.');
    }
  }

  async setRecovery(startDate: string, endDate: string, state: RecoveryState, context: string | null, signal: AbortSignal) {
    date(startDate); date(endDate);
    const span = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (endDate < startDate || span > 364 || endDate > today ||
        !['sick', 'clear'].includes(state) || context !== null && (context.trim() !== context || context.length < 1 || context.length > 280) ||
        state === 'clear' && context !== null) throw new TypeError('Invalid recovery period');
    const tx = new sql.Transaction(this.pool);
    let started = false;
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); started = true;
      const request = new sql.Request(tx).input('owner', sql.UniqueIdentifier, this.owner)
        .input('start', sql.Date, new Date(`${startDate}T00:00:00Z`)).input('end', sql.Date, new Date(`${endDate}T00:00:00Z`));
      if (state === 'clear') {
        const deleted = await this.query(request, 'DELETE daily.recovery_days WHERE owner_object_id=@owner AND recovery_date BETWEEN @start AND @end;', signal);
        signal.throwIfAborted(); await tx.commit(); started = false;
        return { affectedDays: deleted.rowsAffected[0] ?? 0, state };
      }
      const count = span + 1;
      const values = Array.from({ length: count }, (_, index) => {
        const parameter = `date${index}`;
        request.input(parameter, sql.Date, new Date(Date.parse(`${startDate}T00:00:00Z`) + index * 86_400_000));
        request.input(`context${index}`, sql.NVarChar(sql.MAX), context);
        return `(@${parameter},@context${index})`;
      });
      request.input('now', sql.NVarChar(64), new Date().toISOString());
      await this.query(request, `MERGE daily.recovery_days WITH (HOLDLOCK) AS target
        USING (VALUES ${values.join(',')}) AS source(recovery_date,context_text)
        ON target.owner_object_id=@owner AND target.recovery_date=source.recovery_date
        WHEN MATCHED THEN UPDATE SET context_text=source.context_text,updated_at=@now
        WHEN NOT MATCHED THEN INSERT(owner_object_id,recovery_date,context_text,created_at,updated_at)
          VALUES(@owner,source.recovery_date,source.context_text,@now,@now);`, signal);
      signal.throwIfAborted(); await tx.commit(); started = false;
      return { affectedDays: count, state };
    } catch (error) {
      if (started) await tx.rollback().catch(() => undefined);
      if (signal.aborted || error instanceof ToolFailure) throw error;
      throw new ToolFailure('The recovery period was not confirmed as saved. Read markers before retrying.');
    }
  }
}

export type DailyCoachAccess = (request: FastifyRequest) => DailyCoachStore;
export { profilePatch };
