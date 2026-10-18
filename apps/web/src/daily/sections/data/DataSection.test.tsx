import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import DataSection from './DataSection';

vi.mock('../../DailyPage', () => ({
  DailyPage: ({ onBack, onSourceChange, sharedPeriod }: {
    onBack: () => void;
    onSourceChange: (source: string) => void;
    sharedPeriod: { startDate: string };
  }) => <>
    <span>{sharedPeriod.startDate}</span>
    <button onClick={() => onSourceChange(sources.meals)}>Change source</button>
    <button onClick={onBack}>Back</button>
  </>,
}));

const props: DailySectionProps = {
  backendUrl: null, getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.metrics, sources.meals], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};

describe('Data section', () => {
  it('shares period and collection navigation with the shell', () => {
    const onSourceChange = vi.fn();
    const backToOverview = vi.fn();
    render(<DailySectionNavigationContext.Provider value={{
      openSource: () => {}, backToOverview, onSourceChange, retryAvailability: () => {},
    }}><DataSection {...props} /></DailySectionNavigationContext.Provider>);
    expect(screen.getByText('2026-10-12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSourceChange).toHaveBeenCalledWith(sources.meals);
    expect(backToOverview).toHaveBeenCalledOnce();
  });
});
