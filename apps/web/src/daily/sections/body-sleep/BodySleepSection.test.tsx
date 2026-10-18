import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyQuery } from '@jarvis/contracts';
import { describe, expect, it, vi } from 'vitest';
import { dailyFixture, jsonResponse } from '../../test-support';
import { discoverDailySections } from '../discovery';
import type { DailySectionProps } from '../types';
import BodySleepSection from './BodySleepSection';
import { section } from './index';
import type { Row } from './metrics';

const period = { startDate: '2026-10-01', endDate: '2026-10-07' };
const props: DailySectionProps = {
  backendUrl: 'https://synthetic.test', getAccessToken: async () => 'synthetic-only',
  period, onPeriodChange: () => {}, refreshVersion: 0,
  sources: [sources.metrics, sources.metricCatalog, sources.sleep],
};
const catalogue: Row[] = [
  { metric_name: 'body_mass', units: ['kg', 'lb'], first_date: period.startDate, last_date: period.endDate, day_count: 3, latest_updated_at: '2026-10-07T00:00:00Z' },
  { metric_name: 'synthetic_other', units: ['count'], first_date: period.startDate, last_date: period.endDate, day_count: 2, latest_updated_at: '2026-10-07T00:00:00Z' },
];
const metricRows: Row[] = [
  { metric_name: 'body_mass', metric_date: '2026-10-01', value: 0, avg_value: 900, unit: 'kg', min_value: 0, max_value: 3, sample_count: 2 },
  { metric_name: 'body_mass', metric_date: '2026-10-03', value: null, avg_value: 12, unit: 'kg' },
  { metric_name: 'body_mass', metric_date: '2026-10-06', value: 3, unit: 'lb' },
];
const sleepRows: Row[] = [
  { sleep_date: '2026-10-02', sleep_start: '2026-10-01T21:30:00Z', sleep_end: '2026-10-02T05:00:00Z',
    total_sleep_hours: 9, asleep_hours: 7, deep_hours: 1, core_hours: 4, rem_hours: 2, awake_hours: 2, in_bed_hours: 10, segment_count: 15 },
  { sleep_date: '2026-10-04', total_sleep_hours: 6, asleep_hours: null },
  { sleep_date: '2026-10-05', asleep_hours: 0, deep_hours: 0, core_hours: null },
];

function stub(handler?: (query: DailyQuery) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    const query = JSON.parse(String(init?.body)) as DailyQuery;
    if (handler) return Promise.resolve(handler(query));
    const rows = query.source === sources.metricCatalog ? catalogue : query.source === sources.sleep ? sleepRows :
      query.source === sources.metrics && query.metric === 'body_mass' ? metricRows :
        [{ metric_name: 'synthetic_other', metric_date: '2026-10-01', value: 8, unit: 'count' }];
    return Promise.resolve(jsonResponse(dailyFixture(query, rows)));
  });
}

function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="URL">{location.search}</output>
    <button onClick={() => navigate(-1)}>Browser back</button></>;
}
function mount(overrides: Partial<DailySectionProps> = {}, url = '/daily?section=body-sleep&keep=retained') {
  const component = (next: Partial<DailySectionProps> = {}) => <MemoryRouter initialEntries={[url]}>
    <BodySleepSection {...props} {...overrides} {...next} /><Location />
  </MemoryRouter>;
  const result = render(component());
  return { ...result, update: (next: Partial<DailySectionProps>) => result.rerender(component(next)) };
}
const url = () => screen.getByLabelText('URL').textContent ?? '';

describe('Body & sleep section (synthetic records only)', () => {
  it.each([
    [[], false], [[sources.metrics], false], [[sources.metricCatalog], false],
    [[sources.sleep], true], [[sources.metrics, sources.metricCatalog], true],
  ])('discovers source combination %j without changing a registry', (available, expected) => {
    const found = discoverDailySections({ './sections/body-sleep/index.tsx': { section } }, available);
    expect(found.some(item => item.id === 'body-sleep')).toBe(expected);
    expect(section.requiredSources).toEqual([]);
  });

  it('hides Body independently and explains why, without requesting missing sources', async () => {
    const fetch = stub();
    mount({ sources: [sources.sleep] }, '/daily?view=body&metric=body_mass&keep=yes');
    expect(screen.queryByRole('tab', { name: 'Body' })).toBeNull();
    expect(screen.getByText(/Body is unavailable/)).toBeTruthy();
    await screen.findByRole('table', { name: /Nightly sleep records/ });
    expect(fetch.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).source === sources.sleep)).toBe(true);
    expect(url()).toContain('view=sleep');
    expect(url()).toContain('keep=yes');
  });

  it('hides Sleep independently with an honest unavailable explanation', async () => {
    stub();
    mount({ sources: [sources.metrics, sources.metricCatalog] });
    await screen.findByRole('img', { name: 'Body mass — kg' });
    expect(screen.queryByRole('tab', { name: 'Sleep' })).toBeNull();
    expect(screen.getByText(/Sleep is unavailable/)).toBeTruthy();
  });

  it('searches catalogue names, uses grouped native options and keeps unknown metrics selectable', async () => {
    stub();
    mount();
    await screen.findByRole('option', { name: /synthetic_other —/ });
    expect(screen.getByRole('group', { name: 'Body composition' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Other' })).toBeTruthy();
    await waitFor(() => expect(url()).toContain('metric=body_mass'));
    fireEvent.change(screen.getByLabelText('Search measurements'), { target: { value: 'synthetic_other' } });
    expect(screen.getByRole('option', { name: /Body mass — current selection/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Measurement'), { target: { value: 'synthetic_other' } });
    await screen.findByRole('img', { name: 'synthetic_other — count' });
    expect(url()).toContain('metric=synthetic_other');
    expect(url()).toContain('keep=retained');
    fireEvent.change(screen.getByLabelText('Search measurements'), { target: { value: 'NO MATCH' } });
    expect(screen.getByText(/0 measurements match/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Measurement').value).toBe('synthetic_other');
  });

  it('splits units, labels average fallback, keeps zero, dates, recorded ranges and newest-first rows', async () => {
    stub();
    mount();
    await screen.findByRole('img', { name: 'Body mass — kg' });
    expect(screen.getByRole('img', { name: 'Body mass — lb' })).toBeTruthy();
    expect(screen.getByText(/Multiple units stay separate/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Body mass — kg: newest first' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('Oct 3');
    expect(rows[2]?.textContent).toContain('Oct 1');
    expect(within(table).getByText('Recorded average (fallback)')).toBeTruthy();
    const kg = screen.getByRole('region', { name: 'Body mass — kg' });
    expect(within(kg).getByRole('heading', { name: 'Average over 2 days with data' })).toBeTruthy();
    expect(within(kg).getByText('2 of 7')).toBeTruthy();
    expect(within(table).getAllByText('0').length).toBeGreaterThan(0);
    const sourceQuery = JSON.parse(String(vi.mocked(fetch).mock.calls.find(([, init]) =>
      JSON.parse(String(init?.body)).source === sources.metrics)?.[1]?.body));
    expect(sourceQuery).toMatchObject({ ...period, metric: 'body_mass', limit: 500 });
  });

  it('does not bridge missing calendar days in the trend', async () => {
    stub();
    const result = mount();
    await screen.findByRole('img', { name: 'Body mass — kg' });
    const kg = screen.getByRole('img', { name: 'Body mass — kg' });
    expect(kg.querySelectorAll('.daily-chart-line')).toHaveLength(2);
    expect(result.container.querySelector('h2')?.textContent).toBe('Body & sleep');
  });

  it('uses keyboard roving tabs, URL state and browser history', async () => {
    stub();
    mount();
    const body = screen.getByRole('tab', { name: 'Body' });
    body.focus();
    fireEvent.keyDown(body, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Sleep' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Sleep' }));
    expect(url()).toContain('view=sleep');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sleep' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Body' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByText('Browser back'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sleep' }).getAttribute('aria-selected')).toBe('true'));
  });

  it('shows staged, totals-only and partial nights with all table fields and accessible unknowns', async () => {
    stub();
    mount({}, '/daily?view=sleep');
    const table = await screen.findByRole('table', { name: /Nightly sleep records/ });
    expect(screen.getByRole('list', { name: 'Sleep stages legend' }).textContent).toContain('1 · Deep');
    expect(screen.getByRole('list', { name: 'Sleep stages legend' }).textContent).toContain('3 · REM');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(12);
    expect(within(table).getAllByText('Unknown').length).toBeGreaterThan(5);
    expect(screen.getByText(/T: Stages not recorded/)).toBeTruthy();
    expect(screen.getByText(/marks partial stages/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Average asleep over 2 nights with data' })).toBeTruthy();
    expect(screen.getByText('2 of 7')).toBeTruthy();
    expect(within(table).getByText('1 Oct 2026, 23:30')).toBeTruthy();
  });

  it('opens a URL-linked night, focuses detail and returns focus to its row on close', async () => {
    stub();
    mount({}, '/daily?view=sleep&metric=body_mass');
    const open = await screen.findByRole('button', { name: /Open.*Oct 2/ });
    fireEvent.click(open);
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('body-sleep-night-heading'));
    expect(url()).toContain('night=2026-10-02');
    expect(url()).toContain('metric=body_mass');
    fireEvent.click(screen.getByRole('button', { name: 'Close night detail' }));
    await waitFor(() => expect(document.activeElement).toBe(open));
    expect(url()).not.toContain('night=');
  });

  it('restores a directly linked night and preserves it when refresh data no longer contains it', async () => {
    let missing = false;
    stub(query => jsonResponse(dailyFixture(query, missing ? [] : sleepRows)));
    const mounted = mount({}, '/daily?view=sleep&night=2026-10-02');
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('body-sleep-night-heading'));
    missing = true;
    mounted.update({ refreshVersion: 1 });
    await screen.findByText(/This night is not in the loaded period/);
    expect(url()).toContain('night=2026-10-02');
  });

  it('keeps metric selection, search, existing records and scroll during refresh', async () => {
    let pending = false;
    const finish: (() => void)[] = [];
    stub(query => {
      const response = () => jsonResponse(dailyFixture(query, query.source === sources.metricCatalog ? catalogue :
        [{ metric_name: 'synthetic_other', metric_date: '2026-10-01', value: 8, unit: 'count' }]));
      return pending ? new Promise(resolve => finish.push(() => resolve(response()))) : response();
    });
    const mounted = mount({}, '/daily?view=body&metric=synthetic_other&night=2026-10-02');
    await screen.findByRole('img', { name: 'synthetic_other — count' });
    const scroll = screen.getByRole('region', { name: /recorded daily rows/ });
    scroll.scrollLeft = 80;
    fireEvent.change(screen.getByLabelText('Search measurements'), { target: { value: 'synthetic' } });
    pending = true;
    mounted.update({ refreshVersion: 1 });
    await screen.findByText('Refreshing measurements…');
    expect(screen.getByRole('img', { name: 'synthetic_other — count' })).toBeTruthy();
    expect(scroll.scrollLeft).toBe(80);
    expect(screen.getByLabelText<HTMLInputElement>('Search measurements').value).toBe('synthetic');
    await act(async () => { finish.forEach(resolve => resolve()); });
    expect(url()).toContain('metric=synthetic_other');
    expect(url()).toContain('night=2026-10-02');
  });

  it('shows shared initial loading and empty states', async () => {
    let resolve!: (response: Response) => void;
    stub(() => new Promise(done => { resolve = done; }));
    mount({ sources: [sources.sleep] });
    expect(screen.getByText('Loading Daily history')).toBeTruthy();
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    await act(async () => { resolve(jsonResponse(dailyFixture({ source: sources.sleep, ...period }, []))); });
    expect(await screen.findByText(/History appears after an import/)).toBeTruthy();
    expect(screen.getByText('0 of 7')).toBeTruthy();
  });

  it.each(['body', 'sleep'])('shows %s error with a working view-specific Retry', async view => {
    let failed = true;
    stub(query => failed ? jsonResponse({}, 503) : jsonResponse(dailyFixture(query)));
    mount({}, `/daily?view=${view}`);
    const retry = await screen.findByRole('button', { name: view === 'body' ? 'Retry catalogue' : 'Retry sleep' });
    expect(screen.getByRole('alert').textContent).toContain('503');
    failed = false;
    fireEvent.click(retry);
    await screen.findByText(/History appears after an import/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('auto-loads cursor pages sequentially and stops at the five-page cap', async () => {
    let count = 0;
    const fetch = stub(query => {
      count++;
      return jsonResponse(dailyFixture(query, [{ sleep_date: `2026-10-0${count}`, total_sleep_hours: count }],
        { date: `2026-10-0${count}`, key: `synthetic-${count}` }));
    });
    mount({ sources: [sources.sleep] }, '/daily?view=sleep');
    await screen.findByText(/Five-page limit reached/);
    expect(count).toBe(5);
    expect(screen.getByText(/5 retained records loaded across 5 pages/)).toBeTruthy();
    const queries = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(queries[0].cursor).toBeUndefined();
    expect(queries[1].cursor).toEqual({ date: '2026-10-01', key: 'synthetic-1' });
  });

  it('bounds both catalogue and selected measurement reads to five auto-loaded pages', async () => {
    const counts = { catalogue: 0, measurements: 0 };
    stub(query => {
      if (query.source === sources.metricCatalog) {
        const page = ++counts.catalogue;
        const name = `synthetic_${page}`;
        return jsonResponse(dailyFixture(query, [{ ...catalogue[0], metric_name: name, units: ['kg'] }], { key: name }));
      }
      const page = ++counts.measurements;
      return jsonResponse(dailyFixture(query, [{
        metric_name: 'synthetic_1', metric_date: `2026-10-0${page}`, value: page, unit: 'kg',
      }], { date: `2026-10-0${page}`, key: 'synthetic_1' }));
    });
    mount({}, '/daily?view=body&metric=synthetic_1');
    await waitFor(() => expect(screen.getAllByText(/Five-page limit reached/)).toHaveLength(2));
    expect(counts).toEqual({ catalogue: 5, measurements: 5 });
    expect(screen.getByText('5 of 7')).toBeTruthy();
    expect(url()).toContain('metric=synthetic_1');
  });

  it('keeps rows and partial coverage visible when a subsequent page fails', async () => {
    stub(query => 'cursor' in query ? jsonResponse({}, 503) :
      jsonResponse(dailyFixture(query, sleepRows, { date: '2026-10-05', key: 'synthetic' })));
    mount({ sources: [sources.sleep] }, '/daily?view=sleep');
    await screen.findByRole('alert');
    expect(screen.getByText(/More records remain/)).toBeTruthy();
    expect(screen.getByRole('table', { name: /Nightly sleep records/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry sleep' })).toBeTruthy();
  });

  it('retains an all-null metric as unknown rather than drawing zeros', async () => {
    stub(query => jsonResponse(dailyFixture(query, query.source === sources.metricCatalog ? catalogue :
      [{ metric_name: 'body_mass', metric_date: '2026-10-01', value: null, avg_value: null, unit: 'kg' }])));
    mount({}, '/daily?view=body&metric=body_mass');
    await screen.findByRole('table', { name: 'Body mass — kg: newest first' });
    expect(screen.getAllByText('No recorded values to chart.').length).toBe(2);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(5);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps unknown units visible in a separately labelled chart and table', async () => {
    stub(query => jsonResponse(dailyFixture(query, query.source === sources.metricCatalog ? catalogue :
      [{ metric_name: 'body_mass', metric_date: '2026-10-01', value: 0, unit: null }])));
    mount({}, '/daily?view=body&metric=body_mass');
    await screen.findByRole('img', { name: 'Body mass — Unit unknown' });
    expect(screen.getByRole('table', { name: 'Body mass — Unit unknown: newest first' })).toBeTruthy();
    expect(screen.getAllByText('Unit unknown').length).toBeGreaterThan(0);
  });

  it('preserves an unavailable linked night until the user closes it', async () => {
    stub();
    mount({}, '/daily?view=sleep&night=2026-09-01');
    await screen.findByRole('table', { name: /Nightly sleep records/ });
    expect(screen.getByText(/This night is not in the loaded period/)).toBeTruthy();
    expect(url()).toContain('night=2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: 'Close night detail' }));
    expect(url()).not.toContain('night=');
  });

  it('changes period on both catalogue and selected metric without discarding URL selection', async () => {
    const fetch = stub();
    const mounted = mount({}, '/daily?view=body&metric=body_mass');
    await screen.findByRole('img', { name: 'Body mass — kg' });
    mounted.update({ period: { startDate: '2026-10-02', endDate: period.endDate } });
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => {
      const query = JSON.parse(String(init?.body));
      return query.source === sources.metrics && query.startDate === '2026-10-02';
    })).toBe(true));
    expect(url()).toContain('metric=body_mass');
  });
});
