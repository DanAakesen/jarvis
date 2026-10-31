import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySourceId } from '@jarvis/contracts';
import { queryDaily } from '../../client';
import { dailyFixture } from '../../test-support';
import { LastLifts } from './LastLifts';

vi.mock('../../client', async importOriginal => ({
  ...await importOriginal<typeof import('../../client')>(), queryDaily: vi.fn(),
}));

const read = vi.mocked(queryDaily);
const entry = {
  id: '33333333-3333-4333-8333-333333333333', exerciseName: 'Bench press', weightKg: 80,
  reps: 4, sets: 3, performedAt: '2026-10-30T12:00:00.000Z', deletedAt: null,
  updatedAt: '2026-10-30T12:00:00.000Z', revision: 1,
};

function Location() {
  const location = useLocation();
  return <output aria-label="URL">{location.search}</output>;
}

function mount(available: readonly DailySourceId[] = [sources.lifts]) {
  return render(<MemoryRouter initialEntries={['/health']}>
    <Location />
    <LastLifts backendUrl="http://localhost:3999" getAccessToken={async () => 'synthetic'}
      available={available} refreshVersion={0} />
  </MemoryRouter>);
}

beforeEach(() => {
  read.mockReset();
  read.mockImplementation(async (_url, query) => dailyFixture(query, [entry]));
});
afterEach(() => { vi.useRealTimers(); });

describe('Dashboard Last lifts', () => {
  it('shows the latest exercise values and links to Track workout', async () => {
    mount();
    expect(await screen.findByRole('list', { name: 'Latest lift per exercise' })).toBeTruthy();
    expect(screen.getByText('Bench press')).toBeTruthy();
    expect(screen.getByText('80 kg · 4 reps · 3 sets')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Track workout' }));
    expect(screen.getByLabelText('URL').textContent).toContain('section=track-workout');
  });

  it('does not request lifts when the capability is absent', () => {
    const view = mount([sources.workouts]);
    expect(view.container.textContent).toBe('');
    expect(read).not.toHaveBeenCalled();
  });
});
