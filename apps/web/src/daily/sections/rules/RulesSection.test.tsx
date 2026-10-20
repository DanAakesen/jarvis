import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyQuerySources as sources, type DailyQueryResult } from '@jarvis/contracts';
import { DailyReadError, queryDaily } from '../../client';
import { dailyFixture, jsonResponse } from '../../test-support';
import { TrainingTargetsContext } from '../../training-targets-context';
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
    deficitKcal: { label: 'Deficit per day', unit: 'kcal', min: 0, max: 2000 },
    proteinGrams: { label: 'Protein target', unit: 'g', min: 30, max: 400 },
  },
};
const training = {
  targets: { gymSessionsPerWeek: 3, runSessionsPerWeek: null, dailySteps: 9_000 }, missing: ['runSessionsPerWeek'], updatedAt: '2026-10-17T10:00:00.000Z',
  bounds: {
    gymSessionsPerWeek: { label: 'Gym sessions', unit: 'sessions/week', min: 0, max: 21 },
    runSessionsPerWeek: { label: 'Run sessions', unit: 'sessions/week', min: 0, max: 21 },
    dailySteps: { label: 'Steps per day', unit: 'steps/day', min: 0, max: 100_000 },
  },
};

function Location() {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname}{location.search}</output>;
}
function mount(overrides: Partial<DailySectionProps> = {}, areaPath = '/health') {
  return render(<MemoryRouter initialEntries={[`${areaPath}?section=rules`]}><Location />
    <Routes><Route path={`${areaPath}/*`} element={<RulesSection {...props} {...overrides} />} /></Routes>
  </MemoryRouter>);
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
    if (String(url).endsWith('/daily/training-targets')) return jsonResponse(training);
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
    expect(screen.getByLabelText('Deficit per day (kcal)')).not.toBeNull();
    expect(screen.getByLabelText('Protein target (g)')).not.toBeNull();
    expect(await screen.findByLabelText('Gym sessions (sessions/week)')).not.toBeNull();
    expect(screen.getByLabelText('Run sessions (sessions/week)')).not.toBeNull();
    expect(screen.getByLabelText('Steps per day (steps/day)')).not.toBeNull();
    expect(screen.queryByText(/Training targets are not available here yet/u)).toBeNull();
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/me'))?.[1]).toMatchObject({
      headers: { Authorization: `${['Bear', 'er'].join('')} synthetic-session` },
    });
    expect(document.body.textContent).not.toMatch(/\bdaily\b/iu);
    expect(document.body.textContent).not.toContain('daily.sync');
  });

  it('hands the training targets it reads to the shared state of the Health area', async () => {
    const apply = vi.fn();
    render(<MemoryRouter initialEntries={['/health?section=rules']}>
      <TrainingTargetsContext.Provider value={{ view: { status: 'loading' }, retry: vi.fn(), apply, want: vi.fn() }}>
        <RulesSection {...props} />
      </TrainingTargetsContext.Provider>
    </MemoryRouter>);
    await screen.findByLabelText('Gym sessions (sessions/week)');
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ targets: training.targets }));
  });

  it.each(['/health', '/wellness'])('returns to the current area overview at %s without hard-coding a route', async areaPath => {
    mount({}, areaPath);
    await screen.findByText('Protected · Synthetic Owner');
    const back = screen.getByRole('link', { name: 'Back to Health' });
    expect(back.getAttribute('href')).toBe(areaPath);
    fireEvent.click(back);
    expect(screen.getByLabelText('Location').textContent).toBe(areaPath);
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
    read.mockRejectedValueOnce(new DailyReadError('Daily could not be loaded: daily.sync'));
    fireEvent.click(screen.getByRole('button', { name: 'Check sync again' }));
    expect(await within(source('Health uploads')).findByText('Stale')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Previous sync evidence');
    expect(screen.getByRole('alert').textContent).toContain('Health sync status could not be loaded.');
    expect(document.body.textContent).not.toMatch(/\bdaily\b/iu);
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
    expect(screen.getByText('Checking sync status…').classList.contains('visually-hidden')).toBe(true);
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
