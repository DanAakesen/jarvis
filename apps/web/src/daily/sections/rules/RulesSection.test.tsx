import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources, type DailyQueryResult } from '@jarvis/contracts';
import { queryDaily } from '../../client';
import { dailyFixture, jsonResponse } from '../../test-support';
import { discoverDailySections, loadDailySectionModules } from '../discovery';
import type { DailySectionDefinition, DailySectionProps } from '../types';
import RulesSection from './RulesSection';
import { section } from './index';

vi.mock('../../client', async importOriginal => ({
  ...await importOriginal<typeof import('../../client')>(), queryDaily: vi.fn(),
}));

const read = vi.mocked(queryDaily);
const fetchMock = vi.fn<typeof fetch>();
const getAccessToken = vi.fn(async () => 'synthetic-session');
const props: DailySectionProps = {
  backendUrl: 'https://api.example.com', getAccessToken, sources: [sources.sync],
  period: { startDate: '2026-10-01', endDate: '2026-10-20' }, onPeriodChange: vi.fn(), refreshVersion: 0,
};
const syncQuery = { source: sources.sync };
const processedAt = '2026-10-19T07:00:00Z';
const nutrition = {
  targets: { restingKcal: null, deficitKcal: null, proteinGrams: null }, missing: ['restingKcal', 'deficitKcal', 'proteinGrams'], updatedAt: null,
  bounds: {
    restingKcal: { label: 'Resting energy burn', unit: 'kcal', min: 1000, max: 4000 },
    deficitKcal: { label: 'Daily deficit', unit: 'kcal', min: 0, max: 2000 },
    proteinGrams: { label: 'Protein target', unit: 'g', min: 30, max: 400 },
  },
};

function Location() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}
function mount(overrides: Partial<DailySectionProps> = {}) {
  return render(<MemoryRouter initialEntries={['/daily?section=rules']}><Location /><RulesSection {...props} {...overrides} /></MemoryRouter>);
}
function source(name: string) {
  return within(screen.getByRole('heading', { name: 'Source coverage' }).closest('section')!).getByRole('heading', { name }).closest('li')!;
}

beforeEach(() => {
  localStorage.clear();
  getAccessToken.mockClear();
  read.mockReset().mockResolvedValue(dailyFixture(syncQuery, [{
    feeds: [{ feed_kind: 'metrics', processed_committed_at: processedAt }], heartbeat: null, inbox: null,
  }]));
  fetchMock.mockReset().mockImplementation(async url => {
    if (String(url).endsWith('/me')) return jsonResponse({ name: 'Synthetic Owner' });
    if (String(url).endsWith('/daily/nutrition-targets')) return jsonResponse(nutrition);
    throw new Error('Unexpected fixture request');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Rules & sources section', () => {
  it('is discovered, orders last among shipped sections, and never uses the period control', async () => {
    const modules = import.meta.glob<{ section: DailySectionDefinition }>('../*/index.tsx');
    const loaded = await loadDailySectionModules(modules);
    const entries = Object.fromEntries(Object.entries(loaded).map(([path, module]) => [`./sections/${path.split('/')[1]}/index.tsx`, module]));
    const found = discoverDailySections(entries, Object.values(sources));
    expect(found.at(-1)).toBe(section);
    expect(section).toMatchObject({ id: 'rules', label: 'Rules & sources', usesPeriod: false, requiredSources: [] });
    expect(discoverDailySections(entries, [])).toContain(section);
  });

  it('renders all seven applicable rule cards, the session account, and the real nutrition editor', async () => {
    mount();
    for (const name of ['Access', 'Behaviour', 'Mail', 'Calendar', 'Refresh', 'Notification', 'Sources']) {
      expect(screen.getAllByRole('heading', { name }).some(heading => heading.closest('article'))).toBe(true);
    }
    expect(screen.queryByRole('heading', { name: 'Tasks' })).toBeNull();
    expect(await screen.findByText('Protected · Synthetic Owner')).not.toBeNull();
    expect(await screen.findByLabelText('Resting energy burn (kcal)')).not.toBeNull();
    expect(screen.getByLabelText('Daily deficit (kcal)')).not.toBeNull();
    expect(screen.getByLabelText('Protein target (g)')).not.toBeNull();
    expect(screen.getByText('Training targets are not available here yet.')).not.toBeNull();
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/me'))?.[1]).toMatchObject({
      headers: { Authorization: `${['Bear', 'er'].join('')} synthetic-session` },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Back to Daily' }));
    expect(screen.getByLabelText('Location').textContent).toBe('/daily');
  });

  it('shows completed health sync, not phone contact or receipt, and explicit unserved sources', async () => {
    mount();
    expect(await within(source('Health uploads')).findByText('Synced')).not.toBeNull();
    expect(source('Health uploads').querySelector('time')?.dateTime).toBe(processedAt);
    expect(within(source('Health uploads')).getByText(/Source freshness is unknown/u)).not.toBeNull();
    for (const name of ['Nutrition capture', 'Mail', 'Calendar']) {
      expect(within(source(name)).getByText('Not connected')).not.toBeNull();
      expect(source(name).querySelector('time')).toBeNull();
    }
    expect(read).toHaveBeenCalledWith(props.backendUrl, syncQuery, getAccessToken, expect.any(AbortSignal));
  });

  it('keeps prior evidence visibly stale after a failed refresh, then recovers', async () => {
    mount();
    await within(source('Health uploads')).findByText('Synced');
    read.mockRejectedValueOnce(new Error('Synthetic failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Check sync again' }));
    expect(await within(source('Health uploads')).findByText('Stale')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Previous sync evidence');
    expect(source('Health uploads').querySelector('time')?.dateTime).toBe(processedAt);
    fireEvent.click(screen.getByRole('button', { name: 'Check sync again' }));
    await within(source('Health uploads')).findByText('Synced');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not manufacture sync from missing, malformed, receipt-only, or heartbeat evidence', async () => {
    read.mockResolvedValue(dailyFixture(syncQuery, [{
      feeds: [null, { feed_kind: 'metrics', processed_committed_at: 'invalid', accepted_evidence_at: processedAt }],
      heartbeat: { last_received_at: processedAt }, inbox: { last_accepted_at: processedAt },
    }]));
    mount();
    await waitFor(() => expect(screen.queryByText('Checking sync status…')).toBeNull());
    expect(within(source('Health uploads')).getByText('Not connected')).not.toBeNull();
    expect(source('Health uploads').querySelector('time')).toBeNull();
  });

  it('handles unavailable sync capabilities without making a query', async () => {
    mount({ sources: [] });
    expect(screen.getByText('Sync status is not served here.')).not.toBeNull();
    await screen.findByText('Protected · Synthetic Owner');
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Check sync again' })).toBeNull();
  });

  it('shows loading and initial read errors without claiming a connection, and retries', async () => {
    let reject!: (error: Error) => void;
    read.mockReturnValueOnce(new Promise<DailyQueryResult>((_resolve, no) => { reject = no; }));
    mount();
    expect(screen.getByText('Checking sync status…')).not.toBeNull();
    await act(async () => { reject(new Error('Synthetic failure')); });
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(within(source('Health uploads')).getByText('Not connected')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check sync again' }));
    await within(source('Health uploads')).findByText('Synced');
  });

  it('never displays Protected for a failed account read and permits recovery', async () => {
    fetchMock.mockImplementation(async url => String(url).endsWith('/me') ? jsonResponse({}, 403) : jsonResponse(nutrition));
    mount();
    await screen.findByText('Account unavailable');
    expect(screen.queryByText(/Protected/u)).toBeNull();
    fetchMock.mockImplementation(async url => String(url).endsWith('/me') ? jsonResponse({ name: 'Synthetic Owner' }) : jsonResponse(nutrition));
    fireEvent.click(screen.getByRole('button', { name: 'Retry account' }));
    await screen.findByText('Protected · Synthetic Owner');
  });
});
