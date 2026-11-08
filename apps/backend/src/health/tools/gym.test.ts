import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createToolRegistry, ToolFailure } from '../../core/tool-registry.js';
import { executeRealtimeCapabilityCall, VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL } from '../../voice/realtime.js';
import type { LiftCreate, LiftPatch } from '../lifts/lifts.js';
import type { WorkoutCreate, WorkoutPatch } from '../gym/workouts.js';
import { gymTools } from './gym.js';

const owner = '11111111-1111-4111-8111-111111111111';
const workoutId = '22222222-2222-4222-8222-222222222222';
const liftId = '33333333-3333-4333-8333-333333333333';
const at = new Date('2026-11-08T15:49:00Z');
const source = { id: '42', sessionId: 'gym-session', role: 'dan' as const,
  text: 'Kan du logge 24 kg shoulder press (db) 4 reps and 3 sets today on chest day', at, model: null };
const signal = () => new AbortController().signal;
const liftValues = { exerciseName: 'Shoulder press (db)', weightKg: 24, reps: 4, sets: 3 };

function fixture() {
  const session = { id: source.sessionId, channel: 'chat', endedAt: null };
  const getHistory = vi.fn(async () => ({ messages: [source] }));
  const request = { server: { ownerObjectId: owner, conversationStore: { getHistory, getSession: vi.fn(async () => session) } },
    headers: {}, principal: { objectId: owner }, jarvisConversationMessage: { ...source },
    validateInput: vi.fn(() => true), getValidationFunction: vi.fn(() => undefined), log: { info: vi.fn() },
  } as unknown as FastifyRequest;
  const savedLifts = new Map<string, Record<string, unknown>>();
  const savedSessions = new Map<string, Record<string, unknown>>();
  const lifts = {
    history: vi.fn(async () => ({ items: [...savedLifts.values()], next: null })),
    create: vi.fn(async (value: LiftCreate) => {
      const existing = savedLifts.get(value.idempotencyKey);
      const entry = existing ?? { ...value, id: liftId, deletedAt: null, revision: 1, vault: 'synced' };
      savedLifts.set(value.idempotencyKey, entry);
      return { entry, replayed: !!existing };
    }),
    update: vi.fn(async (id: string, patch: LiftPatch) => ({ id, ...patch })),
    delete: vi.fn(async (id: string) => ({ id, deletedAt: at.toISOString() })),
  };
  const workouts = {
    history: vi.fn(async () => ({ items: [...savedSessions.values()] })),
    create: vi.fn(async (value: WorkoutCreate) => {
      const existing = savedSessions.get(value.idempotencyKey);
      const entry = existing ?? { ...value, id: workoutId, deletedAt: null, revision: 1, vault: 'synced' };
      savedSessions.set(value.idempotencyKey, entry);
      return { entry, replayed: !!existing };
    }),
    update: vi.fn(async (id: string, patch: WorkoutPatch) => ({ id, ...patch })),
    delete: vi.fn(async (id: string) => ({ id, deletedAt: at.toISOString() })),
  };
  // Store return projection is covered by store tests; these doubles retain inputs for parity assertions.
  const tools = gymTools({ lifts: () => lifts, workouts: () => workouts } as never);
  return { request, session, getHistory, lifts, workouts, savedLifts, savedSessions, tools,
    lift: tools[0]!, workout: tools[1]! };
}

describe('owner gym actions shared with the app', () => {
  it.each(['owner', 'hosted agent'] as const)('saves the reported chest session and exact dumbbell lift through %s with no extra approval', async kind => {
    const f = fixture();
    if (kind === 'hosted agent') {
      delete f.request.principal;
      f.request.agentPrincipal = { kind: 'jarvis-agent', objectId: owner, tenantId: owner };
      f.request.headers['x-jarvis-message-id'] = source.id;
    }
    expect(await f.workout.execute({ operation: 'list' }, f.request, signal())).toEqual({ items: [], limited: false });
    const session = await f.workout.execute({ operation: 'create', values: { sessionType: 'chest_triceps_core' } }, f.request, signal());
    expect(session).toMatchObject({ entry: { id: workoutId, startedAt: at.toISOString(), durationMinutes: null, title: null } });
    expect(await f.lift.execute({ operation: 'create', values: { ...liftValues, workoutId } }, f.request, signal()))
      .toMatchObject({ entry: { ...liftValues, workoutId, performedAt: at.toISOString(), vault: 'synced' }, replayed: false });
    expect(f.lifts.create).toHaveBeenCalledOnce(); expect(f.workouts.create).toHaveBeenCalledOnce();
  });

  it('reuses the stored record across transport retries and argument changes, while separate requested entries remain distinct', async () => {
    const f = fixture();
    const input = { operation: 'create', values: liftValues };
    await f.lift.execute(input, f.request, signal());
    const replay = await f.lift.execute({ ...input, values: { ...liftValues, weightKg: 28 } }, f.request, signal());
    expect(replay).toMatchObject({ entry: { weightKg: 24 }, replayed: true });
    expect(f.savedLifts.size).toBe(1);
    await f.lift.execute({ ...input, entryIndex: 1 }, f.request, signal());
    expect(f.savedLifts.size).toBe(2);
    f.request.jarvisConversationMessage = { ...source, id: '43' };
    await f.lift.execute(input, f.request, signal());
    expect(f.savedLifts.size).toBe(3);
    expect(f.lifts.create.mock.calls[0]![0].idempotencyKey).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/u);
  });

  it('preserves a requested date, decimals, pending vault sync and a standalone lift', async () => {
    const f = fixture();
    const create = f.lifts.create.getMockImplementation()!;
    f.lifts.create.mockImplementationOnce(async value => {
      const saved = await create(value); saved.entry.vault = 'pending'; return saved;
    });
    const result = await f.lift.execute({ operation: 'create', values: { ...liftValues, weightKg: 24.5, performedAt: '2026-11-07T23:30:00+01:00' } }, f.request, signal());
    expect(result).toMatchObject({ entry: { weightKg: 24.5, performedAt: '2026-11-07T22:30:00.000Z', workoutId: null, vault: 'pending' } });
  });

  it('updates and deletes the exact saved lift and session rather than creating replacements', async () => {
    const f = fixture();
    await f.lift.execute({ operation: 'update', id: liftId, values: { weightKg: 26, sets: 4 } }, f.request, signal());
    await f.workout.execute({ operation: 'update', id: workoutId, values: { durationMinutes: 45 } }, f.request, signal());
    expect(f.lifts.update).toHaveBeenCalledWith(liftId, { weightKg: 26, sets: 4 }, expect.any(AbortSignal));
    expect(f.workouts.update).toHaveBeenCalledWith(workoutId, { durationMinutes: 45 }, expect.any(AbortSignal));
    await f.lift.execute({ operation: 'delete', id: liftId }, f.request, signal());
    await f.workout.execute({ operation: 'delete', id: workoutId }, f.request, signal());
    expect(f.lifts.delete).toHaveBeenCalledWith(liftId, expect.any(AbortSignal));
    expect(f.workouts.delete).toHaveBeenCalledWith(workoutId, expect.any(AbortSignal));
    expect(f.lifts.create).not.toHaveBeenCalled(); expect(f.workouts.create).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'create', values: { ...liftValues, sets: '3' } },
    { operation: 'create', values: { ...liftValues, reps: 4.5 } },
    { operation: 'create', values: { ...liftValues, weightKg: NaN } },
    { operation: 'create', values: { ...liftValues, idempotencyKey: owner } },
    { operation: 'create', values: liftValues, entryIndex: -1 },
    { operation: 'create', values: liftValues, confirmed: true },
    { operation: 'delete', id: 'invented' },
    { operation: 'list', owner },
    { operation: 'update', id: liftId, values: { workoutId } },
  ])('refuses invalid or authority-bearing input before persistence (%j)', async input => {
    const f = fixture(); expect(f.lift.validateInput!(input)).toBe(false);
    await expect(f.lift.execute(input, f.request, signal())).rejects.toThrow();
    expect(f.lifts.create).not.toHaveBeenCalled(); expect(f.lifts.update).not.toHaveBeenCalled(); expect(f.lifts.delete).not.toHaveBeenCalled();
  });

  it.each(['no message', 'mismatched message', 'phone', 'ended', 'connector', 'other owner'])('rejects %s without persisting', async mode => {
    const f = fixture();
    if (mode === 'no message') delete f.request.jarvisConversationMessage;
    if (mode === 'mismatched message') {
      delete f.request.principal;
      f.request.agentPrincipal = { kind: 'jarvis-agent', objectId: owner, tenantId: owner };
      f.request.headers['x-jarvis-message-id'] = '99';
    }
    if (mode === 'phone') f.session.channel = 'phone';
    if (mode === 'ended') Object.assign(f.session, { endedAt: at });
    if (mode === 'connector') Object.assign(f.request, { healthConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner } });
    if (mode === 'other owner') Object.assign(f.request, { principal: { objectId: workoutId } });
    await expect(f.lift.execute({ operation: 'create', values: liftValues }, f.request, signal())).rejects.toThrow();
    expect(f.lifts.create).not.toHaveBeenCalled();
  });

  it('does not silently expire a verified active long-running turn or invent success after a failed save', async () => {
    const f = fixture();
    f.request.jarvisConversationMessage = { ...source, at: new Date('2020-01-01T12:00:00Z') };
    await f.lift.execute({ operation: 'create', values: liftValues }, f.request, signal());
    expect(f.lifts.create.mock.calls[0]![0].performedAt).toBe('2020-01-01T12:00:00.000Z');
    f.workouts.create.mockRejectedValueOnce(new ToolFailure('Save uncertain; inspect history.'));
    await expect(f.workout.execute({ operation: 'create', values: { sessionType: 'cardio' } }, f.request, signal())).rejects.toThrow('Save uncertain');
  });

  it('preserves private gym actions through shared voice capability discovery and dispatch', async () => {
    const f = fixture(); f.session.channel = 'voice';
    const registry = createToolRegistry([{ id: 'health', tools: f.tools }]);
    const discovered = new Set<string>();
    await executeRealtimeCapabilityCall({ type: 'response.function_call_arguments.done', name: VOICE_CAPABILITY_DISCOVERY_TOOL,
      call_id: 'gym-discovery', arguments: '{}' }, registry, f.request, signal(), discovered, undefined, false);
    const result = JSON.parse(await executeRealtimeCapabilityCall({ type: 'response.function_call_arguments.done', name: VOICE_CAPABILITY_EXECUTION_TOOL,
      call_id: 'gym-save', arguments: JSON.stringify({ capability: 'gym_lifts', arguments: { operation: 'create', values: liftValues } }) },
    registry, f.request, signal(), discovered, undefined, false));
    expect(result).toMatchObject({ outcome: 'ok', result: { entry: liftValues } });
    for (const tool of f.tools) { expect(tool.sensitive).toBe(true); expect(tool.denyOnPhone).toBe(true); }
  });
});
