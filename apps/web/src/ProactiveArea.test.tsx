import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appAreas } from './areas';
import { ProactiveArea, ProactiveItemPage } from './ProactiveArea';
import {
  copenhagenClock, formatTime, runReason, sourceReason, tomorrowAtSeven,
  type ProactiveItem, type ProactiveStatus, type RunSummary,
} from './proactive-data';

const backendUrl = 'https://api.example.com';
const id = '11111111-1111-4111-8111-111111111111';
const token = vi.fn(async () => 'fixture-token');
const at = '2026-10-17T12:00:00.000Z';
const item: ProactiveItem = {
  id, kind: 'finding', title: 'Synthetic calendar reminder', body: 'A fixture body from Calendar and Todo list.',
  category: 'deadline', urgency: 'time_critical', dueAt: at,
  evidence: [
    { source: 'calendar', label: 'Calendar', observedAt: at },
    { source: 'todos', label: 'Todo list', observedAt: at },
  ],
  state: 'new', snoozedUntil: null, feedback: null, runId: null,
  todoAdded: true, language: 'en', createdAt: at,
};
const run: RunSummary = {
  id: '22222222-2222-4222-8222-222222222222', trigger: 'scheduled', slot: '2026-10-17 07:00',
  status: 'done', reason: null, startedAt: at, finishedAt: at, findingCount: 1,
};
const status: ProactiveStatus = {
  paused: false, quietNow: false, nextSlotAt: at, lastRun: run,
  budget: { month: '2026-10', monthlyLimitDkk: 100, estimatedSpendDkk: 42, state: 'warn' },
  sources: [
    { id: 'calendar', enabled: true, state: 'ok', reason: null, observedAt: at },
    { id: 'todos', enabled: true, state: 'stale', reason: null, observedAt: at },
  ],
};
const response = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
const itemEnvelope = (value = item) => response({ items: [value] });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function renderArea({ clock = () => Date.parse(at) }: { clock?: () => number } = {}) {
  return render(<MemoryRouter initialEntries={['/proactive']}>
    <Routes>
      <Route path="/proactive" element={<ProactiveArea backendUrl={backendUrl} getAccessToken={token}
        signIn={vi.fn(async () => {})} now={clock} />} />
      <Route path="/proactive/:id" element={<ProactiveItemPage backendUrl={backendUrl} getAccessToken={token}
        signIn={vi.fn(async () => {})} proactiveEnabled now={clock} />} />
    </Routes>
  </MemoryRouter>);
}

function stubPage() {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/proactive/status') return response(status);
    if (url.pathname === '/proactive/items' && url.searchParams.get('state') === 'open') return itemEnvelope();
    if (url.pathname === '/proactive/items' && url.searchParams.get('state') === 'all') return response({ items: [] });
    if (url.pathname === '/proactive/runs') return response({ runs: [run] });
    if (url.pathname.endsWith('/feedback') && init?.method === 'POST') return response(item);
    return response({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  token.mockClear();
  stubPage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Proactive area', () => {
  it('gates the navigation area until enabled', () => {
    expect(appAreas().some(({ id: areaId }) => areaId === 'proactive')).toBe(false);
    expect(appAreas(false, true).find(({ id: areaId }) => areaId === 'proactive')).toMatchObject({
      label: 'Proactive', path: 'proactive',
    });
  });

  it('renders status, open items, source labels, estimated budget and recent checks as plain text', async () => {
    renderArea();
    expect(await screen.findByRole('heading', { name: 'Proactive' })).not.toBeNull();
    expect(screen.getByText(/Next check at/)).not.toBeNull();
    expect(screen.getByText(/Last check/)).not.toBeNull();
    expect(screen.getByText('Time-critical')).not.toBeNull();
    expect(screen.getByText('New')).not.toBeNull();
    expect(screen.getByText('Todo added')).not.toBeNull();
    expect(screen.getByText('From Calendar and Todo list')).not.toBeNull();
    expect(screen.getByText('Close to the monthly limit')).not.toBeNull();
    expect(screen.getByText('Estimated 42 of 100 DKK this month. This is an estimate.')).not.toBeNull();
    expect(screen.getByText('Stale, last read just now')).not.toBeNull();

    fireEvent.click(screen.getByText('Recent checks'));
    expect(await screen.findByText('Proactive check (07:00)')).not.toBeNull();
    expect(screen.getByText('1 finding')).not.toBeNull();
  });

  it.each([[1, '1 finding'], [3, '3 findings']])('words the last check outcome for %i finding(s) in the right number', async (findingCount, text) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => new URL(String(input)).pathname === '/proactive/status'
      ? response({ ...status, lastRun: { ...run, findingCount } })
      : original(input, init));
    renderArea();
    expect((await screen.findByText(/Last check/)).textContent).toMatch(new RegExp(` · ${text}$`));
  });

  it('loads Earlier items only when opened and keeps them read-only', async () => {
    const user = userEvent.setup();
    renderArea();
    const details = await screen.findByText('Earlier items');
    await user.click(details);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/proactive/items?state=all&limit=50`, expect.objectContaining({ cache: 'no-store' }),
    ));
  });

  it('expands the body without following the item link', async () => {
    const user = userEvent.setup();
    const longItem = { ...item, body: 'A long synthetic sentence. '.repeat(20) };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items') return itemEnvelope(longItem);
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    renderArea();
    await user.click(await screen.findByRole('button', { name: `Show more ${longItem.title}` }));
    expect(screen.getByRole('button', { name: `Show less ${longItem.title}` }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Open items' })).not.toBeNull();
    expect(screen.getByRole('link', { name: `Open ${item.title}` })).not.toBeNull();
    expect(document.querySelector('.proactive-detail')).toBeNull();
  });

  it('shows the empty state with the last-check time', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items') return response({ items: [] });
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    renderArea();
    expect(await screen.findByText(/Nothing needs you right now/u)).not.toBeNull();
    expect(screen.getAllByText(/Last check/).length).toBeGreaterThan(0);
  });

  it('shows a backend-off status without a retry loop', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/proactive/status') return response({}, 404);
      if (path === '/proactive/items') return response({ items: [] });
      if (path === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    renderArea();
    expect(await screen.findByText('Proactive is not turned on for this backend.')).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/proactive/status')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('retries a status error independently', async () => {
    fetchMock.mockImplementationOnce(async () => response({}, 503)).mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/proactive/status') return response(status);
      if (path === '/proactive/items') return response({ items: [] });
      if (path === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    const user = userEvent.setup();
    renderArea();
    expect(await screen.findByText('Proactive status could not be loaded. Try again.')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Next check at/)).not.toBeNull();
  });

  it.each([
    ['ok', 'Within the monthly limit', false],
    ['warn', 'Close to the monthly limit', false],
    ['exhausted', 'Limit reached', true],
  ] as const)('renders budget state %s with accessible meter copy', async (state, label, exhausted) => {
    const current = { ...status, budget: { ...status.budget, state } };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(current);
      if (url.pathname === '/proactive/items') return response({ items: [] });
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    renderArea();
    expect(await screen.findByText(label)).not.toBeNull();
    expect(screen.getByRole('meter', { name: 'Estimated monthly proactive spend' })).not.toBeNull();
    expect(screen.getByText('Estimated 42 of 100 DKK this month. This is an estimate.')).not.toBeNull();
    if (exhausted) {
      expect(screen.getByText('Limit reached. Proactive checks are paused until next month or until you raise the limit in Settings.')).not.toBeNull();
    }
  });

  it('uses fixed source and run reason labels, including unknown codes', () => {
    expect([
      'not_connected', 'not_authorised', 'rate_limited', 'timeout', 'read_failed', 'too_large',
      'no_location', 'todo_file_missing', 'todo_file_ambiguous', 'no_provider', 'invalid_feed',
      'no_feeds', 'some_feeds_failed',
    ].map((code) => sourceReason(code))).toEqual([
      'Not connected', 'Not authorised', 'Rate limited', 'Timed out', 'Could not be read', 'Too large',
      'No home location saved', 'Todo file not found', 'More than one todo file', 'No provider connected',
      'A feed is invalid', 'No feeds set', 'Some feeds failed',
    ]);
    expect(sourceReason('__proto__')).toBe('Unavailable');
    expect([
      'budget_exhausted', 'model_unavailable', 'invalid_model_output', 'no_sources', 'quiet_hours',
      'interrupted_by_restart', 'lease_lost', 'deadline_exceeded', 'paused',
    ].map((code) => runReason(code))).toEqual([
      'Monthly budget reached', 'Summary step unavailable', 'Summary step rejected', 'No source could be read',
      'Stopped for quiet hours', 'Interrupted by a restart', 'Another run took over', 'Took too long', 'Paused',
    ]);
    expect(runReason('toString')).toBeNull();
  });

  it('optimistically marks an item, rolls back failure and offers a retry', async () => {
    const user = userEvent.setup();
    let finishRequest!: (response: Response) => void;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items' && url.searchParams.get('state') === 'open') return itemEnvelope();
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      if (url.pathname.endsWith('/feedback') && init?.method === 'POST') {
        return await new Promise<Response>((resolve) => { finishRequest = resolve; });
      }
      return response({}, 404);
    });
    renderArea();
    const button = await screen.findByRole('button', { name: `Useful ${item.title}` });
    await user.click(button);
    expect(screen.getByRole('button', { name: `Useful ${item.title}` }).getAttribute('aria-pressed')).toBe('true');
    finishRequest(response({ error: 'PRIVATE SERVER TEXT' }, 503));
    expect(await screen.findByRole('alert')).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: `Useful ${item.title}` }).getAttribute('aria-pressed')).toBe('false'));
    expect(screen.queryByText('PRIVATE SERVER TEXT')).toBeNull();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body).toBe(JSON.stringify({ action: 'useful' }));
  });

  it('moves focus to the list heading when the last open item is dismissed', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items') return itemEnvelope();
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      if (url.pathname.endsWith('/feedback') && init?.method === 'POST') {
        return response({ ...item, state: 'dismissed' });
      }
      return response({}, 404);
    });
    renderArea();
    await user.click(await screen.findByRole('button', { name: `Dismiss ${item.title}` }));
    await waitFor(() => expect(screen.queryByRole('link', { name: `Open ${item.title}` })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Open items' }));
  });

  it.each([
    ['already_running', 'A check is already running.'],
    ['paused', 'Proactive is paused.'],
    ['budget_exhausted', 'The monthly budget is used up.'],
    ['no_sources', 'Every source is switched off.'],
  ])('maps Check now conflict %s to fixed copy', async (error, message) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items') return response({ items: [] });
      if (url.pathname === '/proactive/runs' && init?.method === 'POST') return response({ error }, 409);
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    renderArea();
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(message)).not.toBeNull();
  });

  it('shows Checking after 202, polls while visible, and reloads items when done', async () => {
    const user = userEvent.setup();
    let statusCalls = 0;
    const runningRun = { ...run, status: 'running' as const, finishedAt: null };
    const complete = { ...status, lastRun: { ...run, status: 'done' as const } };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') {
        statusCalls += 1;
        return response(statusCalls === 1 ? status : complete);
      }
      if (url.pathname === '/proactive/items') return itemEnvelope();
      if (url.pathname === '/proactive/runs' && init?.method === 'POST') return response({ run: runningRun }, 202);
      if (url.pathname === '/proactive/runs') return response({ runs: [run] });
      return response({}, 404);
    });
    renderArea();
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByRole('button', { name: 'Checking…' })).not.toBeNull();
    await waitFor(() => expect(statusCalls).toBe(2), { timeout: 5000 });
    expect(statusCalls).toBe(2);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Checking…' })).toBeNull());
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) =>
      new URL(String(url)).pathname === '/proactive/items')).toHaveLength(2));
  });

  it.each([
    [404, 'Check now is not available on this backend yet.'],
    [429, 'Checked a moment ago. Try again in a few minutes.'],
  ])('shows fixed Check now error copy for HTTP %i', async (code, message) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items') return response({ items: [] });
      if (url.pathname === '/proactive/runs' && init?.method === 'POST') return response({}, code);
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });
    renderArea();
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(message)).not.toBeNull();
  });

  it('does not start a manual run when paused and explains the disabled action', async () => {
    const paused = { ...status, paused: true };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(paused);
      if (url.pathname === '/proactive/items') return response({ items: [] });
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      return response({}, 404);
    });

    renderArea();
    const button = await screen.findByRole('button', { name: 'Check now' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Proactive is paused.')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('posts a Copenhagen tomorrow snooze timestamp and removes the row after success', async () => {
    const user = userEvent.setup();
    const snoozed = { ...item, state: 'snoozed' as const, snoozedUntil: '2026-10-18T05:00:00.000Z' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/proactive/status') return response(status);
      if (url.pathname === '/proactive/items' && url.searchParams.get('state') === 'open') return itemEnvelope();
      if (url.pathname === '/proactive/runs') return response({ runs: [] });
      if (url.pathname.endsWith('/feedback') && init?.method === 'POST') return response(snoozed);
      return response({}, 404);
    });
    renderArea();
    await screen.findByRole('button', { name: 'Check now' });
    expect(screen.getByText('Snooze').classList.contains('secondary-button')).toBe(true);
    await user.click(screen.getByText('Snooze'));
    await user.click(screen.getByRole('button', { name: `Snooze ${item.title} Tomorrow 07:00 Europe/Copenhagen` }));
    await waitFor(() => expect(screen.queryByRole('link', { name: `Open ${item.title}` })).toBeNull());
    const call = fetchMock.mock.calls.find(([url, init]) =>
      new URL(String(url)).pathname.endsWith('/feedback') && init?.method === 'POST');
    expect(call?.[1]?.body).toBe(JSON.stringify({ action: 'snooze', snoozeUntil: '2026-10-18T05:00:00.000Z' }));
  });

  it('computes Copenhagen tomorrow at 07 through both 2026 and 2027 DST changes', () => {
    const autumn = tomorrowAtSeven(Date.parse('2026-10-24T12:00:00.000Z'));
    const spring = tomorrowAtSeven(Date.parse('2027-03-27T11:00:00.000Z'));
    expect(autumn.toISOString()).toBe('2026-10-25T06:00:00.000Z');
    expect(spring.toISOString()).toBe('2027-03-28T05:00:00.000Z');
    expect(copenhagenClock(autumn.toISOString())).toBe('07:00');
    expect(copenhagenClock(spring.toISOString())).toBe('07:00');
  });

  it('uses Danish for Danish proactive items and en-GB otherwise', () => {
    expect(formatTime('2026-10-17T12:00:00.000Z')).toBe('17 Oct 2026, 14:00');
    expect(formatTime('2026-10-17T12:00:00.000Z', 'da')).toBe('17. okt. 2026, 14.00');
  });

  it('loads a full detail item, sends seen once and renders markup-looking content inert', async () => {
    const malicious = {
      ...item, title: '<img src=x onerror=alert(1)>',
      body: 'Literal **bold** and [link](https://example.invalid)',
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === `/proactive/items/${id}`) return response(malicious);
      if (url.pathname.endsWith('/feedback') && init?.method === 'POST') return response({ ...malicious, state: 'seen' });
      return response({}, 404);
    });
    render(<MemoryRouter initialEntries={[`/proactive/${id}`]}>
      <Routes><Route path="/proactive/:id" element={<ProactiveItemPage backendUrl={backendUrl}
        getAccessToken={token} signIn={vi.fn(async () => {})} proactiveEnabled />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' })).not.toBeNull();
    expect(screen.getByText('Literal **bold** and [link](https://example.invalid)')).not.toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'link' })).toBeNull();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) =>
      init?.method === 'POST' && String(init.body).includes('"action":"seen"'))).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'All open items' })).not.toBeNull();
  });
});
