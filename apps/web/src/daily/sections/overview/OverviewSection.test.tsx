import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { DailySectionNavigationContext } from '../../section-navigation';
import type { DailySectionProps } from '../types';
import OverviewSection from './OverviewSection';

vi.mock('./health-panel/HealthPanel', () => ({ HealthPanel: () => null }));

vi.mock('../../DailyOverview', () => ({
  DailyOverview: ({ capabilities, onOpen }: { capabilities: { sources: string[] }; onOpen: (source: string) => void }) =>
    <button onClick={() => onOpen(capabilities.sources[0]!)}>Open fixture source</button>,
}));

const props: DailySectionProps = {
  backendUrl: null, getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.metrics], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};

describe('Overview section', () => {
  it('hands collection actions through to the shell', () => {
    const openSource = vi.fn();
    render(<DailySectionNavigationContext.Provider value={{
      openSource, backToOverview: () => {}, onSourceChange: () => {}, retryAvailability: () => {},
    }}><OverviewSection {...props} /></DailySectionNavigationContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open fixture source' }));
    expect(openSource).toHaveBeenCalledWith(sources.metrics);
  });
});
