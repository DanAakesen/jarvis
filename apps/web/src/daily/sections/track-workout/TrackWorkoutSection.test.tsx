import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { queryDaily } from '../../client';
import { createLift, deleteLift, LiftWriteError, updateLift } from '../../lifts-client';
import { dailyFixture } from '../../test-support';
import type { DailySectionProps } from '../types';
import TrackWorkoutSection from './TrackWorkoutSection';
import { section } from './index';
import { discoverDailySections } from '../discovery';

vi.mock('../../client', async importOriginal => ({
  ...await importOriginal<typeof import('../../client')>(), queryDaily: vi.fn(),
}));
vi.mock('../../lifts-client', async importOriginal => ({
  ...await importOriginal<typeof import('../../lifts-client')>(),
  createLift: vi.fn(), updateLift: vi.fn(), deleteLift: vi.fn(),
}));

const read = vi.mocked(queryDaily);
const create = vi.mocked(createLift);
const update = vi.mocked(updateLift);
const remove = vi.mocked(deleteLift);
const entry = {
  id: '33333333-3333-4333-8333-333333333333', exerciseName: 'Bench press', weightKg: 80,
  reps: 4, sets: 3, performedAt: '2026-10-30T12:00:00.000Z', deletedAt: null,
  updatedAt: '2026-10-30T12:00:00.000Z', revision: 1,
};
const props: DailySectionProps = {
  backendUrl: 'http://localhost:3999', getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.lifts], period: { startDate: '2026-10-01', endDate: '2026-10-30' },
  onPeriodChange: () => {}, refreshVersion: 0,
};

function mount() {
  return render(<MemoryRouter><TrackWorkoutSection {...props} /></MemoryRouter>);
}

beforeEach(() => {
  read.mockReset();
  read.mockImplementation(async (_url, query) => dailyFixture(query,
    query.source === sources.lifts ? [entry] : []));
  create.mockReset();
  update.mockReset();
  remove.mockReset();
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '55555555-5555-4555-8555-555555555555') });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Track workout section', () => {
  it('is discovered after Workouts and only when lift logging is available', () => {
    expect(section.order).toBeGreaterThan(20);
    expect(discoverDailySections({ './sections/track-workout/index.tsx': { section } }, [sources.lifts])).toEqual([section]);
    expect(discoverDailySections({ './sections/track-workout/index.tsx': { section } }, [sources.workouts])).toEqual([]);
  });

  it('prefills known lifts and keeps the entry and idempotency key for a retry', async () => {
    create.mockRejectedValueOnce(new LiftWriteError('failed', 'Lift could not be saved. Try again.'))
      .mockResolvedValueOnce({ entry, replayed: false });
    mount();
    const exercise = await screen.findByLabelText('Exercise');
    fireEvent.change(exercise, { target: { value: 'Bench press' } });
    expect(screen.getByLabelText('Weight (kg)')).toHaveProperty('value', '80');
    expect(screen.getByLabelText('Reps')).toHaveProperty('value', '4');
    expect(screen.getByLabelText('Sets')).toHaveProperty('value', '3');
    expect(screen.getByText(/Last used/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save lift' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Lift could not be saved. Try again.');
    expect(screen.getByLabelText('Exercise')).toHaveProperty('value', 'Bench press');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Lift saved.');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]?.[2].idempotencyKey).toBe(create.mock.calls[1]?.[2].idempotencyKey);
  });

  it('supports correcting and confirming deletion of a logged lift', async () => {
    update.mockResolvedValue({ ...entry, weightKg: 82.5, revision: 2 });
    remove.mockResolvedValue({ ...entry, deletedAt: '2026-10-30T13:00:00.000Z', revision: 2 });
    mount();
    await screen.findByRole('list', { name: 'Recorded lifts' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getAllByLabelText('Weight (kg)')[1]!, { target: { value: '82.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(props.backendUrl, props.getAccessToken, entry.id,
      { exerciseName: 'Bench press', weightKg: 82.5, reps: 4, sets: 3 }, expect.any(AbortSignal)));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(props.backendUrl, props.getAccessToken, entry.id, expect.any(AbortSignal)));
  });
});
