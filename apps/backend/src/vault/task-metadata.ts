export interface TaskMetadata {
  notes?: string | undefined;
  timeZone?: string | undefined;
  dueAt?: string | undefined;
}

export const taskMetadataComment = /<!-- jarvis-task:([A-Za-z0-9_-]{1,16000}) -->/gu;

export function validTaskTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

export function taskLocalParts(instant: Date, timeZone: string): { due: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return { due: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Match candidate offsets rather than normalizing a missing spring-forward wall time. Ambiguous times use the first occurrence. */
export function taskLocalInstant(due: string, time: string, timeZone: string): string {
  const target = Date.parse(`${due}T${time}:00Z`);
  if (!Number.isFinite(target) || !validTaskTimeZone(timeZone)) throw new RangeError('Invalid task date or time zone');
  const candidates = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = target + hours * 3_600_000;
    const local = taskLocalParts(new Date(sample), timeZone);
    const offset = Date.parse(`${local.due}T${local.time}:00Z`) - sample;
    const candidate = target - offset;
    const represented = taskLocalParts(new Date(candidate), timeZone);
    if (represented.due === due && represented.time === time) candidates.add(candidate);
  }
  if (candidates.size === 0) throw new RangeError('That local task time does not exist');
  return new Date(Math.min(...candidates)).toISOString();
}

export function encodeTaskMetadata(metadata: TaskMetadata): string {
  const value = Object.fromEntries(Object.entries(metadata).filter(([, field]) => field !== undefined));
  return Object.keys(value).length === 0 ? '' : `<!-- jarvis-task:${Buffer.from(JSON.stringify(value)).toString('base64url')} -->`;
}

export function readTaskMetadata(raw: string): TaskMetadata {
  const match = /<!-- jarvis-task:([A-Za-z0-9_-]{1,16000}) -->/u.exec(raw);
  if (!match) return {};
  try {
    const value: unknown = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const metadata = value as Record<string, unknown>;
    if (Object.keys(metadata).some((key) => !['notes', 'timeZone', 'dueAt'].includes(key)) ||
        (metadata.notes !== undefined && (typeof metadata.notes !== 'string' || metadata.notes.length > 4000)) ||
        (metadata.timeZone !== undefined && !validTaskTimeZone(metadata.timeZone)) ||
        (metadata.dueAt !== undefined && (typeof metadata.dueAt !== 'string' || !Number.isFinite(Date.parse(metadata.dueAt))))) return {};
    return metadata as TaskMetadata;
  } catch { return {}; }
}
