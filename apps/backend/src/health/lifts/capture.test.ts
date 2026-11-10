import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolFailure } from '../../core/tool-registry.js';
import { createLiftCapture, liftCaptureSystemPrompt, LiftCaptureDeleted } from './capture.js';
import type { LiftEntriesAccess } from './lifts-store.js';
import type { LiftCreate } from './lifts.js';

const owner = '11111111-1111-4111-8111-111111111111';
const key = '44444444-4444-4444-8444-444444444444';
const request = { principal: { objectId: owner }, server: { ownerObjectId: owner } } as FastifyRequest;
const signal = () => new AbortController().signal;
const extracted = { exerciseName: 'Dumbbell press', weightKg: 24, reps: 4, sets: null, question: null };
function fixture() {
  const saved = new Map<string, {
    id: string; exerciseName: string; weightKg: number; reps: number; sets: number; performedAt: string;
    deletedAt: string | null; updatedAt: string; revision: number; workoutId: null; vault: 'pending';
  }>();
  const store = {
    findByIdempotencyKey: vi.fn(async (id: string) => saved.get(id) ?? null),
    create: vi.fn(async (value: LiftCreate) => {
      const previous = saved.get(value.idempotencyKey);
      const entry = previous ?? {
        id: owner, exerciseName: value.exerciseName, weightKg: value.weightKg, reps: value.reps, sets: value.sets,
        performedAt: value.performedAt, deletedAt: null, updatedAt: value.performedAt, revision: 1, workoutId: null, vault: 'pending' as const,
      };
      saved.set(value.idempotencyKey, entry);
      return { entry, replayed: !!previous };
    }),
    history: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
  const access: LiftEntriesAccess = () => store;
  const model = vi.fn(async () => JSON.stringify(extracted));
  return { saved, store, access, model, capture: createLiftCapture(access, model) };
}
const submission = (text = 'Log dumbbell press, 24 kg, 4 reps') => ({ idempotencyKey: key, text });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('natural lift capture', () => {
  it.each([
    ['Log bench press 80 kilos for 3 reps', 'Bench press', 80, 3],
    ['Log skulderpres med håndvægte, 24 kilo, 4 gentagelser', 'Skulderpres med håndvægte', 24, 4],
    ['Log squat at 100 kg for 8 reps', 'Squat', 100, 8],
    ['Jeg tog håndvægtspres med 24,5 kg, 12 gentagelser', 'Håndvægtspres', 24.5, 12],
    ['Squat 100 kg, 1 rep', 'Squat', 100, 1],
    ['Calf raises 20 kg for 1000 reps', 'Calf raises', 20, 1000],
  ])('passes %s through tool-free extraction and saves exact actual values', async (text, exerciseName, weightKg, reps) => {
    const f = fixture();
    f.model.mockResolvedValueOnce(JSON.stringify({ ...extracted, exerciseName, weightKg, reps }));
    expect(await f.capture(submission(text), request, signal())).toMatchObject({
      status: 'saved', replayed: false, entry: { exerciseName, weightKg, reps, sets: 1, vault: 'pending' },
    });
    expect(f.model).toHaveBeenCalledWith({ system: liftCaptureSystemPrompt, user: JSON.stringify({ text }) }, expect.any(AbortSignal));
    expect(f.store.create).toHaveBeenCalledWith(expect.objectContaining({ exerciseName, weightKg, reps, sets: 1, workoutId: null }), expect.any(AbortSignal));
    expect(liftCaptureSystemPrompt).toContain('Never calculate, estimate or record a one-rep max');
    expect(liftCaptureSystemPrompt).toContain('never double');
  });

  it('preserves explicit sets and zero bodyweight load', async () => {
    const f = fixture();
    f.model.mockResolvedValueOnce(JSON.stringify({ ...extracted, weightKg: 0, sets: 2 }));
    expect(await f.capture(submission('Bodyweight press, 4 reps, 2 sets'), request, signal()))
      .toMatchObject({ entry: { weightKg: 0, sets: 2, reps: 4 } });
  });

  it.each(['exerciseName', 'weightKg', 'reps'])('asks for missing %s without writing or reserving the UUID', async missing => {
    const f = fixture();
    f.model.mockResolvedValueOnce(JSON.stringify({ ...extracted, [missing]: null, question: 'Hvilken vægt brugte du?' }));
    expect(await f.capture(submission('Log mit tunge sæt'), request, signal()))
      .toEqual({ status: 'needsDetails', question: 'Hvilken vægt brugte du?' });
    expect(f.store.create).not.toHaveBeenCalled();
    expect(await f.capture(submission('Log mit tunge sæt. Håndvægtspres 24 kg 4 gentagelser'), request, signal()))
      .toMatchObject({ status: 'saved', replayed: false, entry: { sets: 1 } });
  });

  it('does not save ambiguous/multiple lifts even when all numeric fields are present', async () => {
    const f = fixture();
    f.model.mockResolvedValueOnce(JSON.stringify({ ...extracted, question: 'Which of the two lifts should I log?' }));
    expect(await f.capture(submission(), request, signal())).toMatchObject({ status: 'needsDetails' });
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it.each([
    '{', '', JSON.stringify({ ...extracted, reps: 0 }), JSON.stringify({ ...extracted, reps: 1001 }),
    JSON.stringify({ ...extracted, sets: 101 }), JSON.stringify({ ...extracted, weightKg: 1001 }),
    JSON.stringify({ ...extracted, weightKg: '24' }), JSON.stringify({ ...extracted, tool: 'delete' }),
    JSON.stringify({ exerciseName: 'Squat' }), JSON.stringify({ ...extracted, question: 'x'.repeat(251) }),
    'x'.repeat(2049),
  ])('rejects malformed or out-of-range model output without a write (%s)', async raw => {
    const f = fixture(); f.model.mockResolvedValueOnce(raw);
    await expect(f.capture(submission(), request, signal())).rejects.toThrow('Lift parsing is unavailable');
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it('replays actual persisted values before parsing edited text, including after a new capture instance', async () => {
    const f = fixture();
    const first = await f.capture(submission(), request, signal());
    f.model.mockResolvedValue(JSON.stringify({ ...extracted, weightKg: 48, reps: 3 }));
    const restarted = createLiftCapture(f.access, f.model);
    expect(await restarted(submission('Actually bench 90 kg, 3 reps'), request, signal()))
      .toEqual({ ...first, replayed: true });
    expect(f.model).toHaveBeenCalledOnce();
    expect(f.store.create).toHaveBeenCalledOnce();
  });

  it('recovers a committed save whose response was lost without parsing or overwriting', async () => {
    const f = fixture(); const create = f.store.create.getMockImplementation()!;
    f.store.create.mockImplementationOnce(async value => {
      await create(value);
      throw new ToolFailure('Lift save outcome uncertain');
    });
    await expect(f.capture(submission(), request, signal())).rejects.toThrow('uncertain');
    f.model.mockRejectedValue(new Error('offline'));
    const restarted = createLiftCapture(f.access, f.model);
    expect(await restarted(submission('changed text'), request, signal()))
      .toMatchObject({ status: 'saved', replayed: true, entry: { weightKg: 24, reps: 4, sets: 1 } });
    expect(f.saved.size).toBe(1);
    expect(f.model).toHaveBeenCalledOnce();
  });

  it('refuses deleted replay rather than reporting a successful save or resurrecting the entry', async () => {
    const f = fixture();
    await f.capture(submission(), request, signal());
    f.saved.set(key, { ...f.saved.get(key)!, deletedAt: '2026-11-10T12:00:00.000Z' });
    await expect(f.capture(submission('changed text'), request, signal())).rejects.toBeInstanceOf(LiftCaptureDeleted);
    expect(f.model).toHaveBeenCalledOnce();
    expect(f.store.create).toHaveBeenCalledOnce();
    expect(f.saved.get(key)?.deletedAt).not.toBeNull();
  });

  it('also refuses deleted entries returned by concurrent persistent create arbitration', async () => {
    const f = fixture();
    await f.capture(submission(), request, signal());
    f.saved.set(key, { ...f.saved.get(key)!, deletedAt: '2026-11-10T12:00:00.000Z' });
    f.store.findByIdempotencyKey.mockResolvedValueOnce(null);
    await expect(f.capture(submission(), request, signal())).rejects.toBeInstanceOf(LiftCaptureDeleted);
    expect(f.saved.size).toBe(1);
  });

  it('rereads persisted state before clarification if another replica completed the same key', async () => {
    const f = fixture();
    let finish!: (value: string) => void;
    let parsing!: () => void;
    const started = new Promise<void>(resolve => { parsing = resolve; });
    f.model.mockImplementationOnce(() => {
      parsing();
      return new Promise<string>(resolve => { finish = resolve; });
    });
    const incomplete = f.capture(submission('Log dumbbell press'), request, signal());
    await started;
    const completed = await createLiftCapture(f.access, f.model)(submission(), request, signal());
    finish(JSON.stringify({ ...extracted, weightKg: null, question: 'How much weight?' }));
    expect(await incomplete).toEqual({ ...completed, replayed: true });
    expect(f.store.create).toHaveBeenCalledOnce();
  });

  it('lets persistent create arbitrate concurrent parses with different values without overwriting', async () => {
    const f = fixture();
    f.model.mockResolvedValueOnce(JSON.stringify(extracted))
      .mockResolvedValueOnce(JSON.stringify({ ...extracted, weightKg: 99 }));
    const otherReplica = createLiftCapture(f.access, f.model);
    const results = await Promise.all([
      f.capture(submission(), request, signal()),
      otherReplica(submission('Bench 99 kg for 4 reps'), request, signal()),
    ]);
    expect(f.saved.size).toBe(1);
    expect(results).toMatchObject([
      { status: 'saved', replayed: false, entry: { weightKg: 24 } },
      { status: 'saved', replayed: true, entry: { weightKg: 24 } },
    ]);
  });

  it('does not parse if the durable lookup fails or is unavailable', async () => {
    const f = fixture();
    f.store.findByIdempotencyKey.mockRejectedValueOnce(new ToolFailure('Lift save status is unavailable'));
    await expect(f.capture(submission(), request, signal())).rejects.toThrow('save status');
    const unavailable = createLiftCapture(() => ({ ...f.store, findByIdempotencyKey: undefined }) as never, f.model);
    await expect(unavailable(submission(), request, signal())).rejects.toThrow('Durable lift capture');
    expect(f.model).not.toHaveBeenCalled();
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it('fails visibly for missing/offline models and for persistence failure', async () => {
    const f = fixture();
    await expect(createLiftCapture(f.access)(submission(), request, signal())).rejects.toThrow('parsing is unavailable');
    f.model.mockRejectedValueOnce(new Error('private provider details'));
    await expect(f.capture(submission(), request, signal())).rejects.toThrow('parsing is unavailable');
    expect(f.store.create).not.toHaveBeenCalled();
    f.store.create.mockRejectedValueOnce(new ToolFailure('Lift could not be saved'));
    await expect(f.capture(submission(), request, signal())).rejects.toThrow('could not be saved');
  });

  it('bounds time even when the model ignores cancellation', async () => {
    vi.useFakeTimers();
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      setTimeout(() => { deadline.abort(); }, milliseconds);
      return deadline.signal;
    });
    const f = fixture(); f.model.mockImplementation(() => new Promise(() => {}));
    const result = expect(f.capture(submission(), request, signal())).rejects.toThrow('parsing is unavailable');
    await vi.advanceTimersByTimeAsync(10_001);
    await result;
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it('never writes after cancellation', async () => {
    const f = fixture(); const controller = new AbortController();
    f.model.mockImplementationOnce(async () => { controller.abort(); return JSON.stringify(extracted); });
    await expect(f.capture(submission(), request, controller.signal)).rejects.toThrow();
    expect(f.store.create).not.toHaveBeenCalled();
  });

  it('bounds concurrent model calls and rate limits new parsing but not saved replay', async () => {
    const f = fixture();
    await f.capture(submission(), request, signal());
    f.model.mockImplementation(() => new Promise(() => {}));
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const pending = controllers.map((controller, index) =>
      f.capture({ ...submission(), idempotencyKey: `55555555-5555-4555-8555-55555555555${index}` }, request, controller.signal)
        .catch(() => undefined));
    await vi.waitFor(() => expect(f.model).toHaveBeenCalledTimes(5));
    await expect(f.capture({ ...submission(), idempotencyKey: owner }, request, signal())).rejects.toThrow('busy');
    expect(await f.capture(submission(), request, signal())).toMatchObject({ status: 'saved', replayed: true });
    controllers.forEach(controller => { controller.abort(); });
    await Promise.all(pending);
    f.model.mockResolvedValue(JSON.stringify({ ...extracted, reps: null }));
    for (let index = 0; index < 15; index += 1) await f.capture({ ...submission(), idempotencyKey: owner }, request, signal());
    await expect(f.capture({ ...submission(), idempotencyKey: owner }, request, signal())).rejects.toThrow('busy');
  });
});
