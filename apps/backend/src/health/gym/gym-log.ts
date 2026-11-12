import { VaultWriteConflictError, MAX_VAULT_FILE_BYTES, type createGitHubVaultClient } from '../../vault/github-client.js';
import { isVaultLineSafe } from '../../vault/index.js';
import type { WorkoutSessionType } from './workouts.js';

type VaultNotes = Pick<ReturnType<typeof createGitHubVaultClient>, 'read' | 'write'>;

export interface GymLogWorkout {
  readonly id: string;
  readonly sessionType: WorkoutSessionType;
  readonly title: string | null;
  readonly startedAt: string;
  readonly durationMinutes: number | null;
  readonly note: string | null;
}

export interface GymLogLift {
  readonly id: string;
  readonly workoutId: string | null;
  readonly exerciseName: string;
  readonly weightKg: number;
  readonly reps: number;
  readonly sets: number;
}

export type GymLogOperation =
  | { readonly type: 'upsert-workout'; readonly workout: GymLogWorkout }
  | { readonly type: 'remove-workout'; readonly id: string }
  | { readonly type: 'upsert-lift'; readonly lift: GymLogLift }
  | { readonly type: 'remove-lift'; readonly id: string };

const labels = {
  sessions: {
    chest_triceps_core: 'Chest + Triceps + Core', back_biceps_core: 'Back + Biceps + Core',
    arms_shoulders: 'Arms + Shoulders', legs_core: 'Legs + Core', cardio: 'Cardio', other: 'Other',
  },
  minutes: 'min', lifts: 'Lifts without a session', sets: 'sets', log: 'Gym log', withheld: '[withheld]',
};

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const markerPattern = /\s*<!-- jarvis:(workout|details|lift|lifts)(?::([\da-f-]{36}))? -->\s*$/iu;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

interface Section {
  heading: string;
  kind: 'workout' | 'lifts' | 'foreign';
  id: string | null;
  lines: string[];
}
interface Note { head: string[]; sections: Section[] }

function marked(line: string): { kind: string; id: string | null } | null {
  const match = markerPattern.exec(line);
  return match ? { kind: match[1]!.toLowerCase(), id: match[2]?.toLowerCase() ?? null } : null;
}

function parse(content: string): Note {
  const note: Note = { head: [], sections: [] };
  let current: Section | undefined;
  for (const line of content.replace(/\r\n/gu, '\n').replace(/\n$/u, '').split('\n')) {
    if (/^##\s/u.test(line)) {
      const mark = marked(line);
      current = {
        heading: line,
        kind: mark?.kind === 'workout' ? 'workout' : mark?.kind === 'lifts' ? 'lifts' : 'foreign',
        id: mark?.kind === 'workout' ? mark.id : null,
        lines: [],
      };
      note.sections.push(current);
    } else if (current) current.lines.push(line);
    else note.head.push(line);
  }
  return note;
}

function serialize(note: Note): string {
  const lines = [...note.head];
  trimBlankTail(lines);
  for (const section of note.sections) {
    const body = [...section.lines];
    trimBlankTail(body);
    lines.push('', section.heading, ...body);
  }
  return `${lines.join('\n')}\n`;
}

function clean(value: string): string {
  const text = Array.from(value.replace(/[<>]/gu, ''), char => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? ' ' : char;
  }).join('').trim();
  return isVaultLineSafe(text) ? text : labels.withheld;
}

function workoutHeading(workout: GymLogWorkout): string {
  const name = workout.sessionType === 'other' && workout.title
    ? clean(workout.title) : labels.sessions[workout.sessionType];
  return `## ${name} <!-- jarvis:workout:${workout.id} -->`;
}

function detailsLine(workout: GymLogWorkout): string {
  const parts = [timeFormatter.format(new Date(workout.startedAt))];
  if (workout.durationMinutes !== null) parts.push(`${workout.durationMinutes} ${labels.minutes}`);
  if (workout.note) parts.push(clean(workout.note));
  return `- ${parts.join(' · ')} <!-- jarvis:details:${workout.id} -->`;
}

function liftLine(lift: GymLogLift): string {
  return `- ${clean(lift.exerciseName)}: ${lift.weightKg} kg × ${lift.reps} × ${lift.sets} ${labels.sets} <!-- jarvis:lift:${lift.id} -->`;
}

function trimmedInsert(lines: string[], line: string) {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === '') end -= 1;
  lines.splice(end, 0, line);
}

function trimBlankTail(lines: string[]) {
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
}

function liftsSection(note: Note, create: boolean): Section | undefined {
  let section = note.sections.find(item => item.kind === 'lifts');
  if (!section && create) {
    section = { heading: `## ${labels.lifts} <!-- jarvis:lifts -->`, kind: 'lifts', id: null, lines: [] };
    note.sections.push(section);
  }
  return section;
}

function removeLiftLine(note: Note, id: string): { removedFrom?: Section; line?: string } {
  for (const section of note.sections) {
    const index = section.lines.findIndex(line => {
      const mark = marked(line);
      return mark?.kind === 'lift' && mark.id === id;
    });
    if (index >= 0) return { removedFrom: section, line: section.lines.splice(index, 1)[0]! };
  }
  return {};
}

function dropEmptyLiftsSection(note: Note) {
  const index = note.sections.findIndex(section => section.kind === 'lifts' && section.lines.every(line => line.trim() === ''));
  if (index >= 0) note.sections.splice(index, 1);
}

export function applyGymLogOperation(
  content: string | null, day: string, operation: GymLogOperation,
): string {
  if (!dayPattern.test(day)) throw new RangeError('Invalid gym log day');
  const note = parse(content ?? `# ${labels.log} ${day}\n`);
  if (operation.type === 'upsert-workout') {
    const { workout } = operation;
    let section = note.sections.find(item => item.kind === 'workout' && item.id === workout.id);
    const details = detailsLine(workout);
    if (!section) {
      section = { heading: workoutHeading(workout), kind: 'workout', id: workout.id, lines: [details] };
      const before = note.sections.findIndex(item => item.kind === 'lifts');
      note.sections.splice(before === -1 ? note.sections.length : before, 0, section);
    } else {
      section.heading = workoutHeading(workout);
      const index = section.lines.findIndex(line => marked(line)?.kind === 'details');
      if (index >= 0) section.lines[index] = details;
      else section.lines.unshift(details);
    }
  } else if (operation.type === 'remove-workout') {
    const index = note.sections.findIndex(item => item.kind === 'workout' && item.id === operation.id);
    if (index < 0) return serialize(note);
    const section = note.sections[index]!;
    const kept: string[] = [];
    const moved: string[] = [];
    for (const line of section.lines) {
      const mark = marked(line);
      if (mark?.kind === 'details') continue;
      if (mark?.kind === 'lift') moved.push(line);
      else kept.push(line);
    }
    if (kept.some(line => line.trim() !== '')) {
      section.heading = section.heading.replace(markerPattern, '');
      section.kind = 'foreign';
      section.id = null;
      section.lines = kept;
    } else note.sections.splice(index, 1);
    if (moved.length > 0) {
      const target = liftsSection(note, true)!;
      for (const line of moved) trimmedInsert(target.lines, line);
    }
  } else if (operation.type === 'upsert-lift') {
    const { lift } = operation;
    const line = liftLine(lift);
    const target = (lift.workoutId
      ? note.sections.find(item => item.kind === 'workout' && item.id === lift.workoutId) : undefined)
      ?? liftsSection(note, true)!;
    const existing = target.lines.findIndex(item => {
      const mark = marked(item);
      return mark?.kind === 'lift' && mark.id === lift.id;
    });
    if (existing >= 0) target.lines[existing] = line;
    else {
      removeLiftLine(note, lift.id);
      trimmedInsert(target.lines, line);
    }
    dropEmptyLiftsSection(note);
  } else {
    removeLiftLine(note, operation.id);
    dropEmptyLiftsSection(note);
  }
  return serialize(note);
}

export interface GymLogWriterOptions {
  readonly vault: VaultNotes;
  readonly attempts?: number;
}

export function gymLogPath(day: string): string {
  if (!dayPattern.test(day)) throw new RangeError('Invalid gym log day');
  return `Health/Gym log/${day}.md`;
}

export function createGymLogWriter(options: GymLogWriterOptions) {
  const attempts = Math.min(Math.max(options.attempts ?? 3, 1), 5);
  return {
    /** Applies one idempotent change to the day's note. Repeating it writes nothing. */
    async apply(day: string, operation: GymLogOperation, signal: AbortSignal): Promise<'written' | 'unchanged'> {
      const path = gymLogPath(day);
      for (let attempt = 1; ; attempt += 1) {
        signal.throwIfAborted();
        const file = await options.vault.read(path, signal);
        if (file && file.path !== path) throw new Error('Gym log note could not be verified');
        const next = applyGymLogOperation(file?.content ?? null, day, operation);
        if (file ? next === file.content : operation.type === 'remove-workout' || operation.type === 'remove-lift') {
          return 'unchanged';
        }
        if (Buffer.byteLength(next, 'utf8') > MAX_VAULT_FILE_BYTES) throw new Error('Gym log note is too large');
        try {
          await options.vault.write(path, next, `jarvis: update gym log ${day}\n\nCo-authored-by: Jarvis`, file?.sha, signal);
          return 'written';
        } catch (error) {
          if (!(error instanceof VaultWriteConflictError) || attempt >= attempts) throw error;
        }
      }
    },
  };
}

export type GymLogWriter = ReturnType<typeof createGymLogWriter>;
