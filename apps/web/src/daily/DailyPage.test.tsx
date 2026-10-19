import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources, isDailyQuery, type DailyQuery } from '@jarvis/contracts';
import { DailyPage } from './DailyPage';
import { DailyRefreshContext } from './refresh';
import { dailyFixture, jsonResponse } from './test-support';

const token = async () => 'synthetic-fixture';
const backendUrl = 'http://localhost:3999';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(answer?: (query: DailyQuery) => Response | Promise<Response>) {
  const queries: DailyQuery[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/daily/capabilities')) return jsonResponse({ module: 'daily', version: 3, sources: Object.values(sources) });
    const input: unknown = JSON.parse(String(init?.body));
    if (!isDailyQuery(input)) throw new Error('Invalid synthetic query');
    queries.push(input);
    if (answer) return answer(input);
    return jsonResponse(dailyFixture(input));
  });
  vi.stubGlobal('fetch', fetch);
  return { queries, fetch };
}
function page(refreshVersion = 0) {
  return <DailyRefreshContext.Provider value={refreshVersion}><DailyPage backendUrl={backendUrl} getAccessToken={token} /></DailyRefreshContext.Provider>;
}

describe('inactive single Daily data page', () => {
  it('browses exact historical briefs and stored body in the same page without dates, delivery or extra endpoints', async () => {
    const f = fixture(query => jsonResponse(dailyFixture(query,
      query.source === sources.briefs ? [{ id: 'cursor' in query ? ' padded ' : 'source-first', trigger: 'manual', started_at: '2026-10-16T07:00:00',
        status: 'completed', delivery_status: 'not_requested' }] :
        query.source === sources.brief ? [{ id: ' padded ', started_at: '2026-10-16T07:00:00',
          preview_text: 'Synthetic historical preview', body_json: 'Synthetic stored body <script>not executable</script>' }] : [],
      query.source === sources.briefs && !('cursor' in query) ? { startedAt: '2026-10-16T07:00:00', id: 'source-first' } : null)));
    render(page()); await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Browse'), { target: { value: sources.briefs } });
    await screen.findByText('2026-10-16T07:00:00');
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.queryByText(/Historical records only/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/Page 2, 1 record/u);
    fireEvent.click(screen.getByRole('button', { name: /Details for/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Open brief' }));
    await screen.findByRole('heading', { name: 'Brief details' });
    await screen.findByText('Synthetic stored body <script>not executable</script>');
    expect(document.querySelector('script')).toBeNull();
    expect(f.queries.at(-1)).toEqual({ source: sources.brief, briefId: ' padded ' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to brief history' }));
    await screen.findByRole('button', { name: /Details for/u });
    fireEvent.click(screen.getByRole('button', { name: /Details for/u }));
    expect(screen.getByRole('button', { name: 'Open brief' })).toBeTruthy();
    expect(screen.getByText(/Page 2, 1 record/u)).toBeTruthy();
    expect(f.queries.at(-1)).toMatchObject({ source: sources.briefs, cursor: { startedAt: '2026-10-16T07:00:00', id: 'source-first' } });
    expect(f.fetch.mock.calls.every(([url]) => /\/daily\/(?:capabilities|query)$/u.test(String(url)))).toBe(true);
  });
  it('browses actual returned values, keeps zero/unknown and every same-date point, and reuses the shared chart', async () => {
    fixture(query => jsonResponse(dailyFixture(query, [
      { metric_name: 'synthetic_scan_mass', metric_date: '2026-10-17', value: 0, unit: 'kg' },
      { metric_name: 'synthetic_scan_mass', metric_date: '2026-10-17', value: 2, unit: 'kg' },
      { metric_name: 'synthetic_scan_mass', metric_date: '2026-10-17', value: null, unit: 'kg' },
    ])));
    const { container } = render(page());
    const table = await screen.findByRole('table', { name: /Recorded Daily values/u });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('0')).toBeTruthy();
    expect(within(table).getAllByText('Not recorded').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    const presentation = screen.getByRole('group', { name: 'Record presentation' });
    expect(within(presentation).getByRole('button', { name: 'Chart' }).classList.contains('daily-section-tab')).toBe(true);
    expect(within(presentation).getByRole('button', { name: 'Chart' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('img', { name: /Synthetic scan mass \(kg\)/u })).toBeTruthy();
    expect(container.querySelectorAll('.daily-chart-bars path')).toHaveLength(2);
    expect(screen.getByText(/Other pages are not included/u)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('img', { name: /Synthetic scan mass \(kg\)/u }), { key: 'ArrowRight' });
    expect(container.querySelector('.daily-chart-readout')?.textContent).toContain(': 2');
    fireEvent.keyDown(screen.getByRole('img', { name: /Synthetic scan mass \(kg\)/u }), { key: 'Home' });
    expect(container.querySelector('.daily-chart-readout')?.textContent).toContain(': 0');
    const disclosure = screen.getByText('View data table').closest('details')!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(screen.getByText('View data table'));
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByRole('table')).toBeTruthy();
  });
  it('shows accepted, processing, succeeded and quarantined upload counts as separate evidence', async () => {
    fixture(query => jsonResponse(dailyFixture(query, query.source === sources.sync ? [{
      feeds: [], heartbeat: { last_received_at: '2026-10-17T08:00:00.000Z' },
      inbox: { retained: 10, accepted: 2, pending: 2, processing: 3, succeeded: 4, quarantined: 1 },
    }] : [])));
    render(page());
    await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Browse'), { target: { value: sources.sync } });
    await screen.findByText('Accepted uploads');
    expect(screen.getByText('2').textContent).toBe('2');
    expect(screen.getByText('Processing uploads')).toBeTruthy();
    expect(screen.getByText('3').textContent).toBe('3');
    expect(screen.getByText('Succeeded uploads')).toBeTruthy();
    expect(screen.getByText('4').textContent).toBe('4');
    expect(screen.getByText('Quarantined uploads')).toBeTruthy();
    expect(screen.getByText('1').textContent).toBe('1');
  });
  it('applies a period only on request and sends exact returned cursors for next/previous', async () => {
    const f = fixture(query => jsonResponse(dailyFixture(query, [{ metric_name: 'synthetic', value: 'cursor' in query ? 2 : 1, unit: 'm' }],
      'startDate' in query && !('cursor' in query) ? { date: query.startDate, key: 'synthetic' } : null)));
    render(page()); await screen.findByText(/Page 1, 1 record/u);
    const before = f.queries.length;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-07' } });
    expect(f.queries).toHaveLength(before);
    fireEvent.click(screen.getByRole('button', { name: 'Apply period' }));
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ startDate: '2026-01-01', endDate: '2026-01-07' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/Page 2, 1 record/u);
    expect(f.queries.at(-1)).toMatchObject({ cursor: { date: '2026-01-01', key: 'synthetic' } });
    await waitFor(() => expect(document.activeElement?.id).toBe('daily-records-heading'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await screen.findByText(/Page 1, 1 record/u);
    expect(f.queries.at(-1)).not.toHaveProperty('cursor');
  });
  it('settles disabled availability honestly without querying records or starting another login', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ error: 'disabled' }, 404)));
    vi.stubGlobal('fetch', fetch); render(page());
    expect((await screen.findByRole('alert')).textContent).toContain('Daily is not enabled');
    expect(screen.queryByLabelText('Browse')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retry availability' })).toBeTruthy();
  });
  it('retains last good evidence after a transient failure but clears it when access is refused', async () => {
    let status = 200;
    fixture(query => status === 200 ? jsonResponse(dailyFixture(query, [{ metric_name: 'synthetic_retained', value: 0, unit: 'm' }])) :
      jsonResponse({ private_detail: 'must-not-escape' }, status));
    render(page()); await screen.findByText('Synthetic retained');
    status = 503; fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 503'));
    expect(screen.getByText('Synthetic retained')).toBeTruthy();
    expect(screen.queryByText('must-not-escape')).toBeNull();
    status = 403; fireEvent.click(screen.getByRole('button', { name: 'Retry records' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be verified'));
    expect(screen.queryByText('Synthetic retained')).toBeNull();
  });
  it('loads periodless collections without dates and inspects workout detail/heart-rate through the same page', async () => {
    const f = fixture(query => jsonResponse(dailyFixture(query,
      query.source === sources.workouts ? [{ id: 'synthetic-workout', workout_date: '2026-10-17', workout_type: 'Synthetic run', duration_seconds: 120 }] :
        query.source === sources.workout ? [{ id: 'synthetic-workout', detail: { recorded: true } }] :
          query.source === sources.heartRate ? [{ sample_minute: '2026-10-17T07:00:00Z', avg_value: 80, unit: 'bpm' }] :
            query.source === sources.favorites ? [{ id: 'synthetic-favourite', favorite_name: 'Synthetic favourite', energy_kcal: 0, protein_grams: null }] : [])));
    render(page()); await screen.findByLabelText('Browse');
    fireEvent.change(screen.getByLabelText('Browse'), { target: { value: sources.favorites } });
    await screen.findByText('Synthetic favourite');
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(f.queries.at(-1)).not.toHaveProperty('startDate');
    fireEvent.change(screen.getByLabelText('Browse'), { target: { value: sources.workouts } });
    fireEvent.click(await screen.findByRole('button', { name: /Details for/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open workout' }));
    await screen.findByRole('heading', { name: 'Workout details' });
    await screen.findByText('synthetic-workout', { exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Heart rate samples' }));
    await screen.findByRole('heading', { name: 'Workout heart rate' });
    await waitFor(() => expect(f.queries.at(-1)).toMatchObject({ source: sources.heartRate, workoutId: 'synthetic-workout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to workouts' }));
    await screen.findByText('Synthetic run');
  });
  it('refetches on the existing refresh signal without adding a second SSE connection', async () => {
    const f = fixture();
    const rendered = render(page()); await screen.findByText(/Page 1, 0 records/u);
    const count = f.queries.length;
    await act(async () => { rendered.rerender(page(1)); });
    await waitFor(() => expect(f.queries.length).toBeGreaterThan(count));
    expect(f.fetch.mock.calls.every(([url]) => !String(url).includes('/now'))).toBe(true);
  });
  it('ignores an interrupted old source response after switching collections', async () => {
    let finish!: (response: Response) => void;
    const held = new Promise<Response>(resolve => { finish = resolve; });
    const f = fixture(query => query.source === sources.metrics ? held : jsonResponse(dailyFixture(query, [
      { favorite_name: 'Synthetic current collection', energy_kcal: 0 },
    ])));
    render(page());
    await waitFor(() => expect(f.queries).toHaveLength(1));
    const old = f.queries[0]!;
    fireEvent.change(screen.getByLabelText('Browse'), { target: { value: sources.favorites } });
    await screen.findByText('Synthetic current collection');
    await act(async () => { finish(jsonResponse(dailyFixture(old, [{ metric_name: 'synthetic_obsolete', value: 99, unit: 'kg' }]))); });
    expect(screen.queryByText('Synthetic obsolete')).toBeNull();
    expect(screen.getByText('Synthetic current collection')).toBeTruthy();
  });
  it('coalesces refreshes and queues one read rather than overlapping a pending read', async () => {
    let finish!: (response: Response) => void;
    const held = new Promise<Response>(resolve => { finish = resolve; });
    let initial: DailyQuery | undefined;
    const f = fixture(query => {
      if (!initial) { initial = query; return held; }
      return jsonResponse(dailyFixture(query));
    });
    const rendered = render(page());
    await waitFor(() => expect(f.queries).toHaveLength(1));
    vi.useFakeTimers();
    rendered.rerender(page(1));
    fireEvent.focus(window);
    expect(screen.getByRole('button', { name: 'Refresh records' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(f.queries).toHaveLength(1);
    await act(async () => { finish(jsonResponse(dailyFixture(initial!))); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(f.queries).toHaveLength(2);
    expect(screen.getByText(/Page 1, 0 records/u)).toBeTruthy();
  });
});
