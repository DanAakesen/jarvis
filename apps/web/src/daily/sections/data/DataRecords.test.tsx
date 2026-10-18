import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { DataRecords } from './DataRecords';
import { DailyPage } from '../../DailyPage';
import { dailyFixture, jsonResponse } from '../../test-support';
import { DailyRefreshContext } from '../../refresh';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const row = { meal_date: '2026-10-17', meal_name: 'Synthetic lunch with a long recorded description',
  energy_kcal: 0, confidence: null, protein_grams: null, notes: 'Synthetic full detail '.repeat(20), extra: { checked: false } };

describe('Daily Data records', () => {
  it('uses the sticky kit table and opens formatted details, nested raw record, and restores focus on close or Escape', async () => {
    const { container } = render(<DataRecords source={sources.meals} rows={[row]} units={{ '*_grams': 'g' }} />);
    const table = screen.getByRole('table');
    expect(container.querySelector('.daily-scroll-table-sticky')).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Energy (kcal)' })).toBeTruthy();
    expect(within(table).getByText('0').closest('td')?.className).toBe('daily-record-number');
    expect(screen.queryByRole('region', { name: /Details for/u })).toBeNull();
    const opener = screen.getByRole('button', { name: /Details for/u });
    opener.focus(); fireEvent.click(opener);
    const panel = screen.getByRole('region', { name: /Details for/u });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    expect(within(panel).getByText('Protein grams (g)')).toBeTruthy();
    expect(within(panel).getAllByText('Not recorded')).toHaveLength(2);
    expect(within(panel).getByText(row.notes.trim())).toBeTruthy();
    expect(within(panel).getByText('No')).toBeTruthy();
    const raw = within(panel).getByText('Raw record').closest('details')!;
    expect(raw.open).toBe(false);
    fireEvent.click(within(panel).getByText('Raw record'));
    expect(raw.open).toBe(true);
    expect(raw.querySelector('pre')?.textContent).toContain('"protein_grams": null');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close details' }));
    expect(document.activeElement).toBe(opener);
    expect(screen.queryByRole('region', { name: /Details for/u })).toBeNull();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('region'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('replaces the table with phone cards and responds to the 700px breakpoint', () => {
    let phone = true;
    let change = () => {};
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: phone, addEventListener: (_: string, listener: () => void) => { change = listener; }, removeEventListener: vi.fn(),
    })));
    render(<DataRecords source={sources.meals} rows={[row]} />);
    const cards = screen.getByRole('list', { name: 'Daily records' });
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(cards).getByRole('heading').textContent).not.toContain('Unknown');
    expect(cards.querySelector('.daily-record-summary')?.textContent).toContain('Energy: 0 kcal');
    expect(cards.querySelector('dt')?.textContent).toBe('Confidence');
    expect(within(cards).getByText('Not recorded')).toBeTruthy();
    act(() => { phone = false; change(); });
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Daily records' })).toBeNull();
  });

  it('keeps the selected record through refresh/reordering and recovers focus if it disappears', async () => {
    const original = { metric_date: '2026-10-17', metric_name: 'synthetic_mass', value: 0, unit: 'kg', notes: 'Original synthetic detail' };
    const rendered = render(<DataRecords source={sources.metrics} rows={[original]} />);
    fireEvent.click(screen.getByRole('button', { name: /Details for/u }));
    const panel = screen.getByRole('region', { name: /Details for/u });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    fireEvent.click(within(panel).getByText('Raw record'));
    const raw = within(panel).getByText('Raw record').closest('details')!;
    const summary = within(panel).getByText('Raw record');
    summary.focus();
    rendered.rerender(<DataRecords source={sources.metrics} rows={[
      { metric_date: '2026-10-18', metric_name: 'synthetic_distance', value: 10, unit: 'km' },
      { ...original, notes: 'Updated synthetic detail' },
    ]} />);
    expect(screen.getByRole('region', { name: /Details for/u })).toBe(panel);
    expect(within(panel).getByText('Updated synthetic detail')).toBeTruthy();
    expect(raw.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    rendered.rerender(<DataRecords source={sources.metrics} rows={[]} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Daily records' })));
    expect(screen.queryByRole('region', { name: /Details for/u })).toBeNull();
  });

  it('keeps record details and raw disclosure open when an automatic read changes the freshness timestamp', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const result = dailyFixture(JSON.parse(String(init.body)), [{ ...row, id: 'synthetic-meal' }]);
      result.freshness.observedAt = new Date(Date.UTC(2026, 9, 17, 7, reads++)).toISOString();
      return jsonResponse(result);
    }));
    const token = async () => 'synthetic';
    const page = (version: number) => <DailyRefreshContext.Provider value={version}>
      <DailyPage embedded backendUrl="http://localhost" getAccessToken={token} knownSources={[sources.meals]} initialSource={sources.meals} />
    </DailyRefreshContext.Provider>;
    const rendered = render(page(0));
    fireEvent.click(await screen.findByRole('button', { name: /Details for/u }));
    const panel = screen.getByRole('region', { name: /Details for/u });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    const summary = within(panel).getByText('Raw record');
    fireEvent.click(summary); summary.focus();
    rendered.rerender(page(1));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(document.querySelector('.daily-freshness time')?.getAttribute('datetime')).toBe('2026-10-17T07:01:00.000Z'));
    expect(screen.getByRole('region', { name: /Details for/u })).toBe(panel);
    expect(summary.closest('details')?.open).toBe(true);
    expect(document.activeElement).toBe(summary);
  });

  it('keeps shared-period reads, source callbacks, partial freshness and pagination explanations', async () => {
    const onSourceChange = vi.fn();
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const query = JSON.parse(String(init.body));
      requests.push(query);
      return jsonResponse(dailyFixture(query, [row], 'cursor' in query ? null : { createdAt: '2026-10-17T12:00:00Z', id: 'synthetic' }));
    }));
    render(<DailyPage embedded backendUrl="http://localhost" getAccessToken={async () => 'synthetic'}
      knownSources={[sources.meals, sources.sleep]} initialSource={sources.meals} onSourceChange={onSourceChange}
      sharedPeriod={{ startDate: '2026-10-11', endDate: '2026-10-17' }} />);
    await screen.findByText('Page 1, 1 record, more available.');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.getByText(/Read .*, 1 record, partial/u)).toBeTruthy();
    expect(screen.getByText(/Previous unavailable: this is the first page/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true);
    expect(requests[0]).toMatchObject({ startDate: '2026-10-11', endDate: '2026-10-17' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Page 2, 1 record, end of returned records.');
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Next unavailable: no more returned records/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Browse'), { target: { value: sources.sleep } });
    expect(onSourceChange).toHaveBeenCalledWith(sources.sleep);
  });

  it('shows a plain unavailable-collection state with a Health upload link and no query', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<DailyPage embedded backendUrl="http://localhost" getAccessToken={async () => 'synthetic'} knownSources={[]} />);
    expect(screen.getByRole('status').textContent).toContain('not exposed a browsable');
    expect(screen.getByRole('link', { name: 'Settings, Health upload' }).getAttribute('href')).toBe('/settings#health-upload');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('settles loading into an error with Retry, then an honest empty state', async () => {
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(response).mockImplementation(async (_url: string, init: RequestInit) =>
      jsonResponse(dailyFixture(JSON.parse(String(init.body)))));
    vi.stubGlobal('fetch', fetch);
    render(<DailyPage embedded backendUrl="http://localhost" getAccessToken={async () => 'synthetic'} knownSources={[sources.meals]} initialSource={sources.meals} />);
    expect(screen.getByRole('status').textContent).toContain('Loading Daily history');
    await act(async () => { finish(jsonResponse({}, 503)); });
    expect((await screen.findByRole('alert')).textContent).toContain('HTTP 503');
    fireEvent.click(screen.getByRole('button', { name: 'Retry records' }));
    await screen.findByText(/History appears after an import or a phone upload/u);
    expect(screen.getByRole('link', { name: 'Settings, Health upload' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
