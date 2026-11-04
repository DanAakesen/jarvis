import { describe, expect, it, vi } from 'vitest';
import { VaultWriteConflictError } from '../../vault/github-client.js';
import { applyGymLogOperation, createGymLogWriter, gymLogPath, type GymLogLift, type GymLogWorkout } from './gym-log.js';

const w1 = '11111111-1111-4111-8111-111111111111';
const l1 = '22222222-2222-4222-8222-222222222222';
const l2 = '33333333-3333-4333-8333-333333333333';
const workout: GymLogWorkout = {
  id: w1, sessionType: 'chest_triceps_core', title: null, startedAt: '2026-11-02T17:30:00.000Z', durationMinutes: 60, note: 'Felt good',
};
const lift = (id: string, workoutId: string | null, name = 'Bench press'): GymLogLift => ({ id, workoutId, exerciseName: name, weightKg: 80, reps: 4, sets: 3 });
const day = '2026-11-02';

describe('applyGymLogOperation', () => {
  it('creates a note with one section per session and lifts under it', () => {
    let note = applyGymLogOperation(null, day, { type: 'upsert-workout', workout }, 'en');
    note = applyGymLogOperation(note, day, { type: 'upsert-lift', lift: lift(l1, w1) }, 'en');
    expect(note).toBe([
      '# Gym log 2026-11-02', '',
      `## Chest + Triceps + Core <!-- jarvis:workout:${w1} -->`,
      `- 18:30 · 60 min · Felt good <!-- jarvis:details:${w1} -->`,
      `- Bench press: 80 kg × 4 × 3 sets <!-- jarvis:lift:${l1} -->`, '',
    ].join('\n'));
  });

  it('is idempotent for every operation', () => {
    const operations = [
      { type: 'upsert-workout', workout }, { type: 'upsert-lift', lift: lift(l1, w1) },
      { type: 'upsert-lift', lift: lift(l2, null, 'Squat') }, { type: 'remove-lift', id: l2 },
    ] as const;
    let note: string | null = null;
    for (const operation of operations) {
      note = applyGymLogOperation(note, day, operation);
      expect(applyGymLogOperation(note, day, operation)).toBe(note);
    }
  });

  it('updates an edited lift in place and removes a deleted one', () => {
    let note = applyGymLogOperation(null, day, { type: 'upsert-workout', workout });
    note = applyGymLogOperation(note, day, { type: 'upsert-lift', lift: lift(l1, w1) });
    note = applyGymLogOperation(note, day, { type: 'upsert-lift', lift: lift(l1, w1, 'Incline press') });
    expect(note).toContain('Incline press');
    expect(note).not.toContain('Bench press');
    note = applyGymLogOperation(note, day, { type: 'remove-lift', id: l1 });
    expect(note).not.toContain('jarvis:lift');
  });

  it('keeps lifts without a session in their own section and drops it when empty', () => {
    let note = applyGymLogOperation(null, day, { type: 'upsert-lift', lift: lift(l1, null) }, 'en');
    expect(note).toContain('## Lifts without a session');
    note = applyGymLogOperation(note, day, { type: 'remove-lift', id: l1 });
    expect(note).toBe('# Gym log 2026-11-02\n');
  });

  it('moves lifts to the unassigned section when their session is removed and preserves owner text', () => {
    let note = applyGymLogOperation('# Gym log 2026-11-02\n\nMy own paragraph.\n', day, { type: 'upsert-workout', workout });
    note = applyGymLogOperation(note, day, { type: 'upsert-lift', lift: lift(l1, w1) });
    note = applyGymLogOperation(note, day, { type: 'remove-workout', id: w1 });
    expect(note).not.toContain('jarvis:workout');
    expect(note).toContain('My own paragraph.');
    expect(note).toContain(`jarvis:lift:${l1}`);
  });

  it('neutralizes markers, control characters and secret-like text from user input', () => {
    const note = applyGymLogOperation(null, day, {
      type: 'upsert-workout', workout: { ...workout, sessionType: 'other', title: 'Run <!-- jarvis:lift:x -->\nHack', note: 'password: hunter2' },
    }, 'en');
    expect(note.match(/<!--/gu)).toHaveLength(2);
    expect(note).not.toContain('jarvis:lift:x -->');
    expect(applyGymLogOperation(null, day, { type: 'upsert-lift', lift: lift(l1, null, 'a <!-- b --!> c') }, 'en')).not.toMatch(/<!-- b|--!>/u);
    expect(note).toContain('[withheld]');
    expect(() => applyGymLogOperation(null, '../x', { type: 'remove-lift', id: l1 })).toThrow();
  });
});

function vault(initial: { content: string; sha: string } | null = null) {
  let file = initial;
  return {
    read: vi.fn(async (path: string) => file ? { path, ...file } : null),
    write: vi.fn(async (_path: string, content: string, _message: string, sha: string | undefined) => {
      if ((file?.sha) !== sha) throw new VaultWriteConflictError();
      file = { content, sha: String(Number((sha ?? '0')) + 1).padStart(40, '0') };
      return 'a'.repeat(40);
    }),
    get file() { return file; },
  };
}

describe('createGymLogWriter', () => {
  const signal = new AbortController().signal;
  it('writes once and treats a repeat as unchanged', async () => {
    const v = vault();
    const writer = createGymLogWriter({ vault: v });
    expect(await writer.apply(day, { type: 'upsert-workout', workout }, signal)).toBe('written');
    expect(v.write.mock.calls[0]![0]).toBe(gymLogPath(day));
    expect(await writer.apply(day, { type: 'upsert-workout', workout }, signal)).toBe('unchanged');
    expect(v.write).toHaveBeenCalledTimes(1);
  });

  it('does not create a note only to remove an entry', async () => {
    const v = vault();
    expect(await createGymLogWriter({ vault: v }).apply(day, { type: 'remove-lift', id: l1 }, signal)).toBe('unchanged');
    expect(v.write).not.toHaveBeenCalled();
  });

  it('re-reads and re-applies after a stale write, then gives up after the bound', async () => {
    const v = vault({ content: '# Gym log 2026-11-02\n', sha: '0'.repeat(40) });
    const realRead = v.read.getMockImplementation()!;
    let first = true;
    v.read.mockImplementation(async (path: string) => {
      const result = await realRead(path);
      if (first && result) { first = false; return { ...result, sha: '9'.repeat(40) }; }
      return result;
    });
    const writer = createGymLogWriter({ vault: v });
    expect(await writer.apply(day, { type: 'upsert-lift', lift: lift(l1, null) }, signal)).toBe('written');
    expect(v.write).toHaveBeenCalledTimes(2);
    const always = { read: vi.fn(async (path: string) => ({ path, content: '', sha: '1'.repeat(40) })), write: vi.fn(async () => { throw new VaultWriteConflictError(); }) };
    await expect(createGymLogWriter({ vault: always, attempts: 2 }).apply(day, { type: 'upsert-lift', lift: lift(l1, null) }, signal))
      .rejects.toBeInstanceOf(VaultWriteConflictError);
    expect(always.write).toHaveBeenCalledTimes(2);
  });

  it('propagates a vault failure and refuses oversized notes', async () => {
    const failing = { read: vi.fn(async () => null), write: vi.fn(async () => { throw new Error('down'); }) };
    await expect(createGymLogWriter({ vault: failing }).apply(day, { type: 'upsert-workout', workout }, signal)).rejects.toThrow('down');
    const big = { read: vi.fn(async (path: string) => ({ path, content: 'x'.repeat(300 * 1024), sha: '1'.repeat(40) })), write: vi.fn() };
    await expect(createGymLogWriter({ vault: big }).apply(day, { type: 'upsert-workout', workout }, signal)).rejects.toThrow();
    expect(big.write).not.toHaveBeenCalled();
  });
});
