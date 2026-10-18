import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionProps } from '../types';
import BriefsSection from './BriefsSection';

vi.mock('../../DailyPage', () => ({
  DailyPage: ({ initialSource, knownSources }: { initialSource: string; knownSources: string[] }) =>
    <output>{JSON.stringify({ initialSource, knownSources })}</output>,
}));

const props: DailySectionProps = {
  backendUrl: null, getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.metrics, sources.briefs, sources.brief], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};

describe('Briefs section', () => {
  it('locks the existing browser to history and detail collections', () => {
    render(<BriefsSection {...props} />);
    expect(screen.getByText(JSON.stringify({ initialSource: sources.briefs, knownSources: [sources.briefs, sources.brief] })).textContent)
      .toContain(sources.brief);
  });
});
