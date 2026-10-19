import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailyCursor } from '@jarvis/contracts';
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

type SyntheticRow = Record<string, DailyJson>;

function mockFetch(respond: (query: DailyQuery, queries: DailyQuery[], signal?: AbortSignal) => Response | Promise<Response>) {
  const queries: DailyQuery[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const query: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(query)) throw new Error('Invalid synthetic query');
    queries.push(query);
    return respond(query, queries, init?.signal ?? undefined);
  }));
  return queries;
}

function renderBriefs(rows: SyntheticRow[]) {
  const queries = mockFetch(query => {
    const resultRows = query.source === sources.briefs
      ? rows : query.source === sources.brief ? rows.filter(row => row.id === query.briefId) : [];
    return jsonResponse(dailyFixture(query, resultRows));
  });
  render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
  return queries;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Briefs section', () => {
  it('shows the dated history and focuses the reading view, then restores focus to the opener', async () => {
    const queries = renderBriefs([brief]);
    expect(await screen.findByRole('heading', { level: 2, name: 'Briefs' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 3, name: 'October 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' })).toBeTruthy();
    expect(screen.getByText('2026-10-18T08:00:00')).toBeTruthy();
    expect(screen.getByText('Status: completed')).toBeTruthy();
    expect(screen.getByText('Delivery: not_requested')).toBeTruthy();
    expect(screen.getByText('1 brief loaded.')).toBeTruthy();

    const opener = screen.getByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' });
    fireEvent.click(opener);
    const detailHeading = await screen.findByRole('heading', { level: 3, name: 'Scheduled brief' });
    await waitFor(() => expect(document.activeElement).toBe(detailHeading));
    expect(screen.getByText('Showing Scheduled brief, 2026-10-18T08:00:00.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Overview' })).toBeTruthy();
    expect(screen.getByText('Synthetic brief body.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Next' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Brief facts' }).textContent).toContain('Triggerscheduled');
    expect(queries.map(query => query.source)).toEqual([sources.briefs, sources.brief]);

    fireEvent.click(screen.getByRole('button', { name: 'Back to brief history' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('groups by the month in stored date text without converting its timezone', async () => {
    renderBriefs([
      { ...brief, id: 'october', started_at: '2026-10-01T00:30:00+14:00' },
      { ...brief, id: 'september', started_at: '2026-09-30T23:30:00-12:00' },
      { ...brief, id: 'unknown-date', started_at: null, status: null, delivery_status: null },
    ]);

    expect(await screen.findByRole('heading', { level: 3, name: 'October 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'September 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Date unknown' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open brief Scheduled brief, 2026-10-01T00:30:00+14:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open brief Scheduled brief, 2026-09-30T23:30:00-12:00' })).toBeTruthy();
    expect(screen.getByText('2026-10-01T00:30:00+14:00')).toBeTruthy();
    expect(screen.getByText('2026-09-30T23:30:00-12:00')).toBeTruthy();
    expect(screen.getByText('Status: Unknown')).toBeTruthy();
    expect(screen.getByText('Delivery: Unknown')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Open brief/u })).toHaveLength(3);
  });

  it('shows a plain empty state instead of a blank history panel', async () => {
    renderBriefs([]);
    expect(await screen.findByText('No briefs')).toBeTruthy();
  });

  it('shows the loading state while history is pending', () => {
    mockFetch((_query, _queries, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    expect(screen.getByText('Loading Daily history')).toBeTruthy();
  });

  it('offers Retry after a history error and recovers on the next request', async () => {
    let historyRequests = 0;
    mockFetch(query => {
      if (query.source === sources.briefs && historyRequests++ === 0) return jsonResponse({}, 503);
      return jsonResponse(dailyFixture(query, query.source === sources.briefs ? [brief] : []));
    });
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    expect(await screen.findByText(/HTTP 503/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry brief history' }));
    expect(await screen.findByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' })).toBeTruthy();
  });

  it('offers Retry after a detail error and recovers the selected brief', async () => {
    let detailRequests = 0;
    mockFetch(query => {
      if (query.source === sources.brief && detailRequests++ === 0) return jsonResponse({}, 503);
      return jsonResponse(dailyFixture(query, query.source === sources.briefs ? [brief] : [brief]));
    });
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' }));
    expect(await screen.findByText(/HTTP 503/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry brief details' }));
    expect(await screen.findByText('Synthetic brief body.')).toBeTruthy();
  });

  it('keeps partial history and its load-more control visible while the next page is pending', async () => {
    let finishSecondPage!: (response: Response) => void;
    let pageCount = 0;
    const queries = mockFetch((query) => {
      if (query.source !== sources.briefs) return jsonResponse(dailyFixture(query, [brief]));
      pageCount += 1;
      if (pageCount === 1) {
        const next = { startedAt: '2026-10-17T08:00:00', id: 'next-page' } satisfies DailyCursor;
        return jsonResponse(dailyFixture(query, [brief], next));
      }
      return new Promise<Response>(resolve => { finishSecondPage = resolve; });
    });
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Loading more briefs…' })).toHaveProperty('disabled', true);
    expect(screen.getByText('1 brief loaded.')).toBeTruthy();
    await act(async () => {
      finishSecondPage(jsonResponse(dailyFixture(queries[1]!, [], null)));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /more briefs|Load more/u })).toBeNull());
  });

  it('announces newer and older navigation, disables both ends with reasons, and focuses the new heading', async () => {
    const rows = [
      { ...brief, id: 'newest', started_at: '2026-10-18T08:00:00', trigger: 'scheduled' },
      { ...brief, id: 'middle', started_at: '2026-10-17T08:00:00', trigger: 'manual' },
      { ...brief, id: 'oldest', started_at: '2026-10-16T08:00:00', trigger: 'catch_up' },
    ];
    renderBriefs(rows);
    fireEvent.click(await screen.findByRole('button', { name: 'Open brief Manual brief, 2026-10-17T08:00:00' }));
    await screen.findByRole('heading', { level: 3, name: 'Manual brief' });

    const newer = screen.getByRole('button', { name: 'Newer brief' });
    const older = screen.getByRole('button', { name: 'Older brief' });
    expect(newer.hasAttribute('disabled')).toBe(false);
    expect(older.hasAttribute('disabled')).toBe(false);
    fireEvent.click(newer);
    const newestHeading = await screen.findByRole('heading', { level: 3, name: 'Scheduled brief' });
    await waitFor(() => expect(document.activeElement).toBe(newestHeading));
    expect(screen.getByText('No newer brief is loaded.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Older brief' }));
    await screen.findByRole('heading', { level: 3, name: 'Manual brief' });
    fireEvent.click(screen.getByRole('button', { name: 'Older brief' }));
    const oldestHeading = await screen.findByRole('heading', { level: 3, name: 'Catch up brief' });
    await waitFor(() => expect(document.activeElement).toBe(oldestHeading));
    expect(screen.getByText('No older brief is loaded.')).toBeTruthy();
  });

  it('renders structured body content as readable facts and bullets, keeping JSON disclosed', async () => {
    const structured = {
      ...brief,
      preview_text: 'A concise synthetic preview.',
      body_json: { sections: [{ title: 'Recovery', content: { sleep: { hours: 8 }, notes: ['Rested', 'Recovered'] } }] },
    };
    renderBriefs([structured]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' }));
    expect(await screen.findByText('A concise synthetic preview.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Recovery' })).toBeTruthy();
    expect(screen.getByText('sleep')).toBeTruthy();
    expect(screen.getByText('hours')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('Rested')).toBeTruthy();
    expect(screen.getByText('Raw brief').closest('details')?.hasAttribute('open')).toBe(false);
    expect(screen.getByText(/"sections"/u).closest('details')?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('Raw brief'));
    expect(screen.getByText(/"sections"/u)).toBeTruthy();
  });

  it('presents a plain-text body as prose and retains its raw value behind disclosure', async () => {
    const plain = { ...brief, preview_text: 'A lead paragraph.', body_json: 'The main synthetic brief body.' };
    renderBriefs([plain]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' }));
    expect(await screen.findByText('A lead paragraph.')).toBeTruthy();
    expect(screen.getAllByText('The main synthetic brief body.')).toHaveLength(2);
    expect(screen.getByText('Raw brief').closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('explains when a loaded history row has no identifier to open', async () => {
    renderBriefs([{ ...brief, id: null }]);
    const unavailable = await screen.findByRole('button', { name: 'Open brief Scheduled brief, 2026-10-18T08:00:00' });
    expect(unavailable.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Details unavailable because this brief has no recorded identifier.')).toBeTruthy();
  });

  it('reports the automatic history cap after ten partial pages', async () => {
    let pageCount = 0;
    const queries = mockFetch(query => {
      if (query.source !== sources.briefs) return jsonResponse(dailyFixture(query, []));
      pageCount += 1;
      const row = { ...brief, id: `brief-${pageCount}`, started_at: `2026-10-${String(19 - pageCount).padStart(2, '0')}T08:00:00` };
      const next = { startedAt: `2026-10-${String(18 - pageCount).padStart(2, '0')}T08:00:00`, id: `next-${pageCount}` };
      return jsonResponse(dailyFixture(query, [row], next));
    });
    render(<MemoryRouter><BriefsSection {...props} /></MemoryRouter>);
    expect(await screen.findByText('Page limit reached.')).toBeTruthy();
    expect(screen.getByText('10 briefs loaded.')).toBeTruthy();
    expect(queries.filter(query => query.source === sources.briefs)).toHaveLength(10);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
