import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import OverviewSection from './OverviewSection';

vi.mock('../../DailyOverview', () => ({
  DailyOverview: ({ capabilities, onRetryAvailability }: { capabilities: { sources: string[]; error?: string }; onRetryAvailability: () => void }) =>
    <button onClick={onRetryAvailability}>Retry {capabilities.sources.join(',')} {capabilities.error}</button>,
}));

const props: DailySectionProps = {
  backendUrl: null, getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.metrics], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};

describe('Overview section', () => {
  it('hands the available sources, the availability error and the retry through to the cards', () => {
    const retryAvailability = vi.fn();
    render(<DailySectionNavigationContext.Provider value={{
      openSource: () => {}, backToOverview: () => {}, onSourceChange: () => {}, retryAvailability,
      availabilityError: 'Synthetic availability failure',
    }}><OverviewSection {...props} /></DailySectionNavigationContext.Provider>);
    const retry = screen.getByRole('button', { name: `Retry ${sources.metrics} Synthetic availability failure` });
    fireEvent.click(retry);
    expect(retryAvailability).toHaveBeenCalledTimes(1);
  });
});
