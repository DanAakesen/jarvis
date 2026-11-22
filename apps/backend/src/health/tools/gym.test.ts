import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { toolArgumentRefusal } from '../../core/tool-arguments.js';
import type { JarvisTool } from '../../core/tool-registry.js';
import { gymTools } from './gym.js';

const tools = gymTools({ lifts: () => { throw new Error('unused'); }, workouts: () => { throw new Error('unused'); } } as never);
const tool = (name: string): JarvisTool => tools.find((candidate) => candidate.name === name)!;
const explain = (name: string, input: unknown) => tool(name).explainInvalidInput?.(input, {} as FastifyInstance);

describe('gym tools explain an invalid argument', () => {
  it('names the lift field that failed and never echoes its value', () => {
    expect(explain('gym_lifts', { operation: 'create', values: { exerciseName: 'Squat', weightKg: 100, reps: 0 } }))
      .toBe('Reps must be a whole number from 1 to 1000.');
    const weight = explain('gym_lifts', { operation: 'create', values: { exerciseName: 'Squat', weightKg: 82.555, reps: 5 } });
    expect(weight).toMatch(/^Weight must be/u);
    expect(weight).not.toContain('82.555');
  });

  it('lists the fields a values object may carry instead of echoing an unknown one', () => {
    const lift = explain('gym_lifts', { operation: 'create', values: { exerciseName: 'Squat', weightKg: 100, reps: 5, secret_note: 'x' } });
    expect(lift).toBe('Lift values for create take only exerciseName, weightKg, reps, sets, performedAt, workoutId.');
    expect(lift).not.toContain('secret_note');
    expect(explain('gym_sessions', { operation: 'update', id: '11111111-1111-4111-8111-111111111111', values: { startedAt: '2026-11-21T10:00:00+01:00' } }))
      .toBe('Session values for update take only sessionType, title, durationMinutes, note.');
  });

  it('names the session field that failed', () => {
    expect(explain('gym_sessions', { operation: 'create', values: { sessionType: 'swimming' } })).toBe('Session type is not supported.');
  });

  it('has nothing to say about a valid call', () => {
    expect(explain('gym_lifts', { operation: 'list' })).toBeUndefined();
    expect(explain('gym_lifts', { operation: 'create', values: { exerciseName: 'Squat', weightKg: 100, reps: 5 } })).toBeUndefined();
  });

  it('reaches the model through the dispatcher refusal', () => {
    const input = { operation: 'create', values: { exerciseName: 'Squat', weightKg: 100, reps: 0 } };
    const { refused } = toolArgumentRefusal(tool('gym_lifts'), { keyword: 'schema', instancePath: '', schemaPath: '#/strictInput', params: {} },
      { info: () => undefined }, { input, app: {} as FastifyInstance });
    expect(refused).toBe('Invalid arguments: Reps must be a whole number from 1 to 1000. Retry with arguments matching the tool schema.');
  });
});
