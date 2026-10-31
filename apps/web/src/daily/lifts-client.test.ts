import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLift, deleteLift, LiftWriteError, updateLift } from './lifts-client';
import { jsonResponse } from './test-support';

const id = '33333333-3333-4333-8333-333333333333';
const entry = {
  id, exerciseName: 'Bench press', weightKg: 80.29, reps: 4, sets: 3,
  performedAt: '2026-10-30T12:00:00.000Z', deletedAt: null, updatedAt: '2026-10-30T12:00:00.000Z', revision: 1,
};
const signal = () => new AbortController().signal;
const token = async () => 'synthetic-owner-session';
afterEach(() => vi.unstubAllGlobals());

describe('owner lift write client', () => {
  it('creates with an idempotency key and no-store owner authentication', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ entry, replayed: false }, 201));
    vi.stubGlobal('fetch', fetch);
    await expect(createLift('http://localhost:3999/', token, {
      exerciseName: 'Bench press', weightKg: 80.29, reps: 4, sets: 3,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    }, signal())).resolves.toMatchObject({ entry, replayed: false });
    expect(fetch).toHaveBeenCalledWith('http://localhost:3999/daily/lifts', expect.objectContaining({
      method: 'POST', cache: 'no-store', body: expect.stringContaining('"idempotencyKey"'),
    }));
  });

  it('uses the shared route for corrections and soft deletes', async () => {
    const deleted = { ...entry, deletedAt: '2026-10-30T13:00:00.000Z', revision: 2 };
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ entry: { ...entry, revision: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ entry: deleted }));
    vi.stubGlobal('fetch', fetch);
    await updateLift('http://localhost:3999', token, id, { exerciseName: 'Bench press', weightKg: 82, reps: 4, sets: 3 }, signal());
    await deleteLift('http://localhost:3999', token, id, signal());
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`http://localhost:3999/daily/lifts/${id}`, 'PATCH'],
      [`http://localhost:3999/daily/lifts/${id}`, 'DELETE'],
    ]);
  });

  it('keeps bounded validation and safe error messages at the HTTP boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Weight is outside the limit.' }, 400)));
    await expect(createLift('http://localhost:3999', token, {
      exerciseName: 'Bench press', weightKg: 80, reps: 4, sets: 3,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    }, signal())).rejects.toEqual(new LiftWriteError('rejected', 'Weight is outside the limit.'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entry: { ...entry, weightKg: 80.123 }, replayed: false })));
    await expect(createLift('http://localhost:3999', token, {
      exerciseName: 'Bench press', weightKg: 80, reps: 4, sets: 3,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    }, signal())).rejects.toMatchObject({ kind: 'invalid' });
  });
});
