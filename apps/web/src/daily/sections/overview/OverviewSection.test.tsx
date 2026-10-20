import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import OverviewSection from './OverviewSection';

vi.mock('./health-panel/HealthPanel', () => ({ HealthPanel: () => <p>Health panel</p> }));

vi.mock('../../DailyOverview', () => ({
  DailyOverview: ({ capabilities, onRetryAvailability }: { capabilities: { sources: string[]; error?: string }; onRetryAvailability: () => void }) =>
    <button onClick={onRetryAvailability}>Retry {capabilities.sources.join(',')} {capabilities.error}</button>,
}));

const props: DailySectionProps = {
  backendUrl: null, getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.metrics], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};

function section(retryAvailability = () => {}, path = '/health') {
  return <MemoryRouter initialEntries={[path]}>
    <DailySectionNavigationContext.Provider value={{
      openSource: () => {}, backToOverview: () => {}, onSourceChange: () => {}, retryAvailability,
      availabilityError: 'Synthetic availability failure',
    }}><OverviewSection {...props} /></DailySectionNavigationContext.Provider>
  </MemoryRouter>;
}

describe('Overview section', () => {
  it('hands the available sources, the availability error and the retry through to the cards', () => {
    const retryAvailability = vi.fn();
    render(section(retryAvailability));
    const retry = screen.getByRole('button', { name: `Retry ${sources.metrics} Synthetic availability failure` });
    fireEvent.click(retry);
    expect(retryAvailability).toHaveBeenCalledTimes(1);
  });
  it('shows the Health panel only when the address asks for it', () => {
    const closed = render(section());
    expect(screen.queryByText('Health panel')).toBeNull();
    closed.unmount();
    render(section(undefined, '/health?panel=health'));
    expect(screen.getByText('Health panel')).toBeTruthy();
  });
});
