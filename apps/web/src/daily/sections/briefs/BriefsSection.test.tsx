import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery } from '@jarvis/contracts';
import type { DailySectionProps } from '../types';
import { dailyFixture, jsonResponse } from '../../test-support';
import BriefsSection from './BriefsSection';

const props: DailySectionProps = {
  backendUrl: 'http://localhost:3999', getAccessToken: async () => 'synthetic-fixture',
  sources: [sources.briefs, sources.brief], period: { startDate: '2026-10-12', endDate: '2026-10-18' },
  onPeriodChange: () => {}, refreshVersion: 0,
};
const brief = {
  id: 'synthetic-brief-1', started_at: '2026-10-18T08:00:00',
  status: 'completed', delivery_status: 'not_requested', trigger: 'scheduled',
  body_json: { sections: [{ title: 'Overview', text: 'Synthetic brief body.' }, { heading: 'Next', content: 'A second section.' }] },
};

function fixture() {
  const queries: DailyQuery[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const query: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
    queries.push(query);
    const rows = query.source === sources.briefs ? [brief] : query.source === sources.brief ? [brief] : [];
    return jsonResponse(dailyFixture(query, rows as Record<string, DailyJson>[]));
  }));
  return queries;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Briefs section', () => {
  it('shows a readable history list and focuses its detail, then restores focus to the opener', async () => {
    const queries = fixture();
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 2, name: 'Briefs' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 4, name: 'Scheduled brief' })).toBeTruthy();
    expect(screen.getByText('Status: completed · Delivery: not_requested')).toBeTruthy();
    expect(screen.getByText('2026-10-18')).toBeTruthy();

    const opener = screen.getByRole('button', { name: 'Open brief' });
    fireEvent.click(opener);
    const detailHeading = await screen.findByRole('heading', { level: 3, name: 'Scheduled brief' });
    await waitFor(() => expect(document.activeElement).toBe(detailHeading));
    expect(screen.getByRole('heading', { level: 4, name: 'Overview' })).toBeTruthy();
    expect(screen.getByText('Synthetic brief body.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Next' })).toBeTruthy();
    expect(queries.map(query => query.source)).toEqual([sources.briefs, sources.brief]);

    fireEvent.click(screen.getByRole('button', { name: 'Back to brief history' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open brief' })));
  });

  it('shows the shared empty state when no history is returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const query: unknown = JSON.parse(String(init?.body));
      if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
      return jsonResponse(dailyFixture(query, []));
    }));
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    expect(await screen.findByText(/History appears after an import/u)).toBeTruthy();
  });
});
