import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@jarvis/contracts';
import type { FeedAttention } from './activity';
import { JobsChip } from './JobsChip';
import { hasRunningJob, publishJob as publishStoreJob, resetJobsForTests } from './jobs-store';
import { resetPresenceForTests } from './presence-store';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const job = (patch: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId: '11111111-1111-4111-8111-111111111111', kind: 'research', title: 'Research: Microsoft Foundry IQ', status: 'running', step: 1, steps: 3,
  detail: 'Searching: Key findings', startedAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:10.000Z', ...patch,
});
let serverJobs = new Map<string, BackgroundJob>();

function publishJob(job: BackgroundJob) {
  serverJobs.set(job.jobId, job);
  publishStoreJob(job);
}

function stubFetch(mode: 'present' | 'away', jobs: BackgroundJob[] = []) {
  serverJobs = new Map(jobs.map((job) => [job.jobId, job]));
  const dismissed = new Set<string>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/presence') return json({ mode, source: 'manual', changedAt: null });
    if (path === '/jobs') return json({ jobs: [...serverJobs.values()].filter((job) => !dismissed.has(job.jobId)), dismissedJobIds: [...dismissed] });
    if (path.endsWith('/dismiss') && init?.method === 'POST') {
      const id = path.split('/')[2]!;
      dismissed.add(id);
      return json({ dismissedJobIds: [id] });
    }
    if (path === '/jobs/dismissals/import' && init?.method === 'POST') {
      const { jobIds } = JSON.parse(String(init.body)) as { jobIds: string[] };
      jobIds.forEach((id) => dismissed.add(id));
      return json({ dismissedJobIds: jobIds });
    }
    if (path === '/jobs/dismiss-finished' && init?.method === 'POST') {
      const ids = [...serverJobs.values()].filter((job) => job.status !== 'running').map(({ jobId }) => jobId);
      ids.forEach((id) => dismissed.add(id));
      return json({ dismissedJobIds: ids });
    }
    if (path === '/jobs/11111111-1111-4111-8111-111111111111/cancel' && init?.method === 'POST') return new Response(null, { status: 202 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mount(onResult = vi.fn(() => true), accountId = 'fixture-owner', attention: FeedAttention | null = null) {
  return render(<JobsChip accountId={accountId} backendUrl="https://api.example.com" getAccessToken={getAccessToken}
    onResult={onResult} attention={attention} />);
}

function openHistoryJob(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /Show background work/ }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Background work' })).getByRole('button', { name }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetJobsForTests();
  resetPresenceForTests();
});

describe('job tabs', () => {
  it('hides the background-work cluster when the server filters all dismissed jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/presence'
      ? json({ mode: 'present', source: 'manual', changedAt: null })
      : json({ jobs: [], dismissedJobIds: [job().jobId] })));
    mount();
    await waitFor(() => expect(document.querySelector('.job-tabs')).toHaveProperty('hidden', true));
    expect(screen.queryByRole('button', { name: 'Show background work' })).toBeNull();
    act(() => publishJob(job({ status: 'failed' })));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
  });
  it('hides the background-work cluster when there are no jobs or attention items', async () => {
    stubFetch('present');
    mount();
    expect(screen.queryByRole('button', { name: /Show background work/ })).toBeNull();
    expect(document.querySelector('.job-tabs')).toHaveProperty('hidden', true);
    act(() => publishJob(job({ status: 'cancelled' })));
    await screen.findByRole('button', { name: 'Show background work' });
    expect(screen.getByRole('img', { name: 'Background work history available' })).not.toBeNull();
  });

  it('counts each undismissed outcome with a distinct icon, accessible name and tooltip', async () => {
    stubFetch('away', [
      job(),
      job({ jobId: '22222222-2222-4222-8222-222222222222', status: 'done', kind: 'embedding' }),
      job({ jobId: '33333333-3333-4333-8333-333333333333', status: 'failed' }),
      job({ jobId: '44444444-4444-4444-8444-444444444444', status: 'failed', detail: 'Provider unavailable' }),
      job({ jobId: '55555555-5555-4555-8555-555555555555', status: 'cancelled' }),
    ]);
    mount();
    await screen.findByRole('img', { name: '2 failed background jobs' });
    const icons = ['1 running background job', '1 done background job', '2 failed background jobs'].map((name) => {
      const pair = screen.getByRole('img', { name });
      expect(pair.title).toBe(name);
      return pair.querySelector('svg')!.innerHTML;
    });

    expect(new Set(icons).size).toBe(3);
    expect(screen.queryByRole('img', { name: 'Background work history available' })).toBeNull();
    const trigger = screen.getByRole('button', { name: /Show background work/ });
    expect(trigger.textContent).toBe('112');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*33333333.*from header/ }));
    await waitFor(() => expect(screen.queryByRole('img', { name: '2 failed background jobs' })).toBeNull());
    expect(screen.getByRole('img', { name: '1 failed background job' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*44444444.*from header/ }));
    await waitFor(() => expect(screen.queryByRole('img', { name: /failed background job/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*22222222.*from header/ }));
    await waitFor(() => expect(screen.queryByRole('img', { name: /done background job/ })).toBeNull());
    expect(screen.queryByRole('button', { name: /Dismiss .*11111111.*from header/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hide .*11111111.*from header/ }));
    expect(screen.getByRole('img', { name: '1 running background job' })).not.toBeNull();
    expect(screen.getByText('1 background jobs running')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelling…' })).toBeNull());
    act(() => publishJob(job({ status: 'cancelled', updatedAt: '2026-10-07T12:01:00.000Z' })));
    expect(screen.queryByRole('img', { name: /running background job/ })).toBeNull();
    expect(screen.queryByText('1 background jobs running')).toBeNull();
    expect(screen.getByRole('img', { name: 'Background work history available' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show background work' }));
    expect(await screen.findByRole('button', { name: /cancelled/ })).not.toBeNull();
  });

  it('shows the attention pair independently of background-work counts', async () => {
    stubFetch('present');
    mount(vi.fn(() => true), 'fixture-owner', {
      items: [{ id: 'alert-1', category: 'alert', title: 'Deployment failed', link: null, at: '2026-10-07T12:00:00Z' }],
      confirmations: [],
    });
    const trigger = await screen.findByRole('button', { name: '1 item needs attention' });
    expect(trigger.title).toBe('1 item needs attention');
    expect(screen.queryByRole('button', { name: /Show background work/ })).toBeNull();
    expect(document.querySelector('.job-tabs')).toHaveProperty('hidden', false);
  });

  it('removes dismissed entries from the header list across refresh, reload and later events', async () => {
    const failed = job({ status: 'failed', detail: 'The web search timed out.' });
    const completed = job({
      jobId: '22222222-2222-4222-8222-222222222222', kind: 'embedding',
      title: 'Completed indexing', status: 'done',
    });
    const fetchMock = stubFetch('present', [failed, completed]);
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss Research.*11111111.*from header/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull());
    expect(screen.getByRole('button', { name: /Completed indexing Memory re-embed · done/ })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Background work' })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/jobs'))).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    first.unmount();
    resetJobsForTests();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work/ }));
    act(() => publishJob({ ...failed, updatedAt: '2026-10-07T12:03:00.000Z' }));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('shows running progress, peeks at the step and cancels', async () => {
    const fetchMock = stubFetch('present');
    mount();
    expect(screen.queryByRole('button', { name: /Show details/ })).toBeNull();

    act(() => publishJob(job()));
    const chip = await screen.findByRole('button', { name: /Research running: Research: Microsoft Foundry IQ · 11111111 · 1\/3/ });
    expect(chip.closest('.job-tab-list')).not.toBeNull();
    fireEvent.click(chip);
    const details = screen.getByRole('group', { name: 'Research: Microsoft Foundry IQ details' });
    expect(details.textContent).toContain('Searching: Key findings');
    expect(details.closest('.job-tab-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/11111111-1111-4111-8111-111111111111/cancel', expect.objectContaining({ method: 'POST' })));

    act(() => publishJob(job({ jobId: '22222222-2222-4222-8222-222222222222', title: 'Research: Work IQ', startedAt: '2026-10-07T12:00:05.000Z' })));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Research running/ })).toHaveLength(2));
  });

  it('opens a finished result while present and parks it in the chip while away', async () => {
    stubFetch('present');
    const onResult = vi.fn(() => true);
    const { unmount } = mount(onResult);
    act(() => publishJob(job({ status: 'done', step: 3, viewId: 'research-1', updatedAt: '2026-10-07T12:01:00.000Z' })));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('research-1', 'open'));
    unmount();
    resetJobsForTests();
    resetPresenceForTests();

    stubFetch('away');
    const parked = vi.fn(() => true);
    mount(parked);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/presence', expect.anything()));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    act(() => publishJob(job({ jobId: '99999999-9999-4999-8999-999999999999', status: 'done', step: 3, viewId: 'research-9', updatedAt: '2026-10-07T12:01:00.000Z' })));
    await waitFor(() => expect(parked).toHaveBeenCalledWith('research-9', 'park'));
    fireEvent.click(screen.getByRole('button', { name: /Research ready/ }));
    expect(await screen.findByText('Waiting here while you are away.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(parked).toHaveBeenLastCalledWith('research-9', 'open');
  });

  it('retains a failed run and its reason, with truthful unavailable retry and confirmed Dismiss', async () => {
    stubFetch('present');
    mount();
    act(() => publishJob(job({ status: 'failed', detail: 'The web search timed out.', updatedAt: '2026-10-07T12:02:00.000Z' })));
    await screen.findByRole('button', { name: 'Show background work: 1 failed' });
    expect(screen.queryByRole('button', { name: /Research failed/ })).toBeNull();
    openHistoryJob(/Research: Microsoft Foundry IQ Research · failed/);
    expect(screen.getByText('The web search timed out.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /details/ })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Show background work' })).toBeNull();
  });

  it('consolidates 18 real interrupted indexing runs without dropping identities or dispatching fake retries', async () => {
    const failures = Array.from({ length: 18 }, (_, index) => job({
      jobId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      kind: 'embedding', title: 'Re-embed memory and vault', status: 'failed',
      detail: index % 2 === 0 ? 'interrupted by restart' : 'Interrupted by a backend restart',
      updatedAt: '2026-10-07T12:05:07.000Z',
    }));
    const fetchMock = stubFetch('present', failures);
    mount();
    expect(await screen.findByRole('button', { name: 'Show background work' })).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Background work history available' })).not.toBeNull();
    expect(screen.queryByRole('img', { name: /failed background job/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Show details/ })).toBeNull();
    expect(document.querySelectorAll('.job-tab')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Show background work/ }));
    expect(screen.getAllByRole('button', { name: /Re-embed memory and vault · 18 runs Memory re-embed · interrupted/ })).toHaveLength(1);
    expect(document.querySelector('.jobs-history-entry .jobs-mark')?.getAttribute('data-status')).toBe('cancelled');
    fireEvent.click(screen.getByRole('button', { name: /Re-embed memory and vault · 18 runs Memory re-embed · interrupted/ }));
    expect(screen.getByText('Interrupted by a restart')).not.toBeNull();
    expect(screen.getByText(/5m 07s/)).not.toBeNull();
    expect(screen.getByText(/No supported indexing retry action/)).not.toBeNull();
    expect(screen.getByText(/not a check of current indexing/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    expect(screen.getByText('Interrupted by a restart')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Background work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 18 Memory re-embed runs' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /details/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/dismissals/import', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ jobIds: failures.map(({ jobId }) => jobId) }),
    }));
    await waitFor(() => expect(screen.getByText('No background work to show.')).not.toBeNull());
  });

  it('confirms bulk dismissal before hiding finished rows and leaves running work intact', async () => {
    const running = job();
    const finished = [
      job({ jobId: '22222222-2222-4222-8222-222222222222', title: 'Research completed', status: 'done', detail: 'Finished' }),
      job({ jobId: '33333333-3333-4333-8333-333333333333', title: 'Research failed', status: 'failed', detail: 'Search unavailable' }),
    ];
    const fetchMock = stubFetch('present', [running, ...finished]);
    const respond = fetchMock.getMockImplementation()!;
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation((input, init) => String(input).endsWith('/dismiss-finished')
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : respond(input, init));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all finished' }));
    expect(screen.getByRole('button', { name: 'Dismissing…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Research completed Research · done/ })).not.toBeNull();
    expect(screen.getByRole('img', { name: '1 done background job' })).not.toBeNull();
    expect(screen.getByRole('img', { name: '1 failed background job' })).not.toBeNull();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => { finish(json({ dismissedJobIds: finished.map(({ jobId }) => jobId) })); });
    expect(screen.queryByRole('button', { name: /Research completed Research · done/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Research failed Research · failed/ })).toBeNull();
    expect(screen.queryByRole('img', { name: /done background job|failed background job/ })).toBeNull();
    expect(screen.getByRole('img', { name: '1 running background job' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss all finished' })).toHaveProperty('disabled', true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/dismiss-finished', expect.objectContaining({ method: 'POST' }));
  });

  it('groups completed memory re-embeds with shared backfill markers and dismisses every member', async () => {
    const entries = Array.from({ length: 3 }, (_, index) => job({
      jobId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      kind: 'embedding', title: 'Re-embed memory and vault', status: 'done', detail: 'Memory re-embedded',
      viewId: 'embedding-backfill',
    }));
    const fetchMock = stubFetch('present', entries);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Show background work' }));
    expect(screen.getAllByRole('button', { name: /Re-embed memory and vault · 3 runs Memory re-embed · done/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Re-embed memory and vault · 3 runs Memory re-embed · done/ }));
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 3 runs' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /details/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/dismissals/import', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ jobIds: entries.map(({ jobId }) => jobId) }),
    }));
  });

  it('does not combine different terminal statuses or distinct output controls', async () => {
    const entries = [
      job({ status: 'failed', detail: 'Provider unavailable' }),
      job({ jobId: '22222222-2222-4222-8222-222222222222', status: 'cancelled', detail: 'Provider unavailable' }),
      job({ jobId: '33333333-3333-4333-8333-333333333333', title: 'First saved output', status: 'done', viewId: 'first-result', detail: 'Ready' }),
      job({ jobId: '44444444-4444-4444-8444-444444444444', title: 'Second saved output', status: 'done', viewId: 'second-result', detail: 'Ready' }),
      job({ jobId: '55555555-5555-4555-8555-555555555555', kind: 'image', title: 'Image generation', status: 'failed', detail: 'Provider unavailable' }),
    ];
    stubFetch('present', entries);
    const onResult = vi.fn(() => false);
    mount(onResult);
    fireEvent.click(await screen.findByRole('button', { name: 'Show background work: 2 failed' }));
    expect(document.querySelectorAll('.jobs-history-entry')).toHaveLength(5);
    expect(screen.queryByText(/runs$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /First saved output Research · done/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onResult).toHaveBeenLastCalledWith('first-result', 'open');
    fireEvent.click(screen.getByRole('button', { name: 'Background work' }));
    fireEvent.click(screen.getByRole('button', { name: /Second saved output Research · done/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onResult).toHaveBeenLastCalledWith('second-result', 'open');
    expect(screen.getByText(/Started/).textContent).toContain('Run 44444444');
    expect(screen.queryByText(/Triggered|Trigger:/)).toBeNull();
  });

  it('keeps pending legacy dismissals hidden on failed import and offers visible refresh recovery', async () => {
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    localStorage.setItem(key, JSON.stringify([job().jobId]));
    const fetchMock = stubFetch('present', [job({ status: 'failed' })]);
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => String(input).endsWith('/dismissals/import')
      ? Promise.resolve(json({}, 503)) : respond(input, init));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Show background work: needs attention' }));
    expect(screen.getByRole('alert').textContent).toContain('remain hidden on this device');
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    expect(screen.queryByText('No background work to show.')).toBeNull();
    expect(localStorage.getItem(key)).toBe(JSON.stringify([job().jobId]));
    fetchMock.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('No background work to show.')).not.toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByRole('button', { name: 'Close job details' })).not.toBeNull();
  });

  it('shows pending legacy sync instead of a falsely successful empty list', async () => {
    localStorage.setItem('jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]', JSON.stringify([job().jobId]));
    const fetchMock = stubFetch('present', [job({ status: 'failed' })]);
    const respond = fetchMock.getMockImplementation()!;
    let confirm!: (response: Response) => void;
    fetchMock.mockImplementation((input, init) => String(input).endsWith('/dismissals/import')
      ? new Promise<Response>((resolve) => { confirm = resolve; }) : respond(input, init));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Show background work' }));
    expect(screen.getByText('Syncing saved dismissals…')).not.toBeNull();
    expect(screen.queryByText('No background work to show.')).toBeNull();
    await waitFor(() => expect(confirm).toBeTypeOf('function'));
    await act(async () => { confirm(json({ dismissedJobIds: [job().jobId] })); });
    expect(screen.queryByText('Syncing saved dismissals…')).toBeNull();
    expect(screen.getByText('No background work to show.')).not.toBeNull();
  });

  it('hides running header work only for this mount without dismissing its lifecycle or history', async () => {
    const fetchMock = stubFetch('present', [job()]);
    const first = mount();
    const hide = await screen.findByRole('button', { name: /Hide Research.*from header/ });
    hide.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: /Research running/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show background work' })).not.toBeNull();
    expect(hasRunningJob('research')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show background work' }));
    expect(screen.getByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Dismiss Research.*from header/ })).toBeNull();
    first.unmount();
    resetJobsForTests(false);
    mount();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/jobs'))).toHaveLength(2));
    act(() => publishJob(job({ step: 2, updatedAt: '2026-10-07T12:00:20.000Z' })));
    expect(screen.getByRole('button', { name: /Research running/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show background work' }));
    expect(screen.getByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).not.toBeNull();
    expect(hasRunningJob('research')).toBe(true);
    expect(localStorage.getItem('jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]')).toBeNull();
  });

  it('does not share dismissals between authenticated accounts', async () => {
    stubFetch('present', [job()]);
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Hide Research.*from header/ }));
    first.unmount();
    mount(vi.fn(() => true), 'different-owner');
    expect(await screen.findByRole('button', { name: /Research running/ })).not.toBeNull();
  });

  it('returns to the filtered list when another tab dismisses the open run', async () => {
    const fetchMock = stubFetch('present', [job({ status: 'failed' })]);
    mount();
    await screen.findByRole('button', { name: /Show background work/ });
    openHistoryJob(/Research: Microsoft Foundry IQ Research · failed/);
    await act(async () => {
      await fetchMock(`https://api.example.com/jobs/${job().jobId}/dismiss`, { method: 'POST' });
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.queryByRole('group', { name: 'Research: Microsoft Foundry IQ details' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Background work' })).toBe(document.activeElement);
    expect(screen.getByText('No background work to show.')).not.toBeNull();
  });

  it('does not share dismissals between backend projects', async () => {
    stubFetch('present', [job()]);
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Hide Research.*from header/ }));
    first.unmount();
    render(<JobsChip accountId="fixture-owner" backendUrl="https://other-api.example.com" getAccessToken={getAccessToken} onResult={() => true} />);
    expect(await screen.findByRole('button', { name: /Research running/ })).not.toBeNull();
  });

  it('reports malformed stored visibility without discarding the job history', async () => {
    localStorage.setItem('jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]', 'broken');
    stubFetch('present', [job()]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work: needs attention/ }));
    expect(screen.getByRole('alert').textContent).toContain('could not be restored');
    expect(screen.getByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).not.toBeNull();
  });

  it('keeps failed dismissals visible with recovery and does not claim empty success', async () => {
    const fetchMock = stubFetch('present', [job({ status: 'failed' })]);
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => init?.method === 'POST' ? Promise.resolve(json({}, 503)) : respond(input, init));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss Research.*from header/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be confirmed'));
    expect(screen.getByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).not.toBeNull();
    expect(screen.queryByText('No background work to show.')).toBeNull();
    fetchMock.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss Research.*from header/ }));
    await waitFor(() => expect(screen.getByText('No background work to show.')).not.toBeNull());
  });

  it('shows history load failure and can refresh without losing newer live progress', async () => {
    const fetchMock = stubFetch('present');
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => new URL(String(input)).pathname === '/jobs'
      ? Promise.resolve(json({}, 503))
      : respond(input, init));
    mount();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === '/jobs')).toBe(true));
    act(() => publishJob(job({ step: 2, updatedAt: '2026-10-07T12:00:20.000Z' })));
    fireEvent.click(await screen.findByRole('button', { name: /Show background work: needs attention/ }));
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    expect(screen.queryByRole('img', { name: 'Background work: idle' })).toBeNull();
    fetchMock.mockImplementation(async (input) => new URL(String(input)).pathname === '/jobs' ? json({ jobs: [job()] }) : json({}));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: /Research running:.*2\/3/ })).not.toBeNull();
  });

  it('retains completed results on reload without reopening them and reports an unavailable result window', async () => {
    stubFetch('present', [job({ status: 'done', viewId: 'saved-result', step: 3 })]);
    const onResult = vi.fn(() => false);
    mount(onResult);
    await screen.findByRole('button', { name: 'Show background work' });
    expect(onResult).not.toHaveBeenCalled();
    openHistoryJob(/Research: Microsoft Foundry IQ Research · done/);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onResult).toHaveBeenCalledWith('saved-result', 'open');
    expect(screen.getByRole('alert').textContent).toContain('not available in this workspace');
    expect(screen.getByRole('button', { name: 'Open' })).not.toBeNull();
    onResult.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show background work' })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('group', { name: /details/ })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismissing…' })).toBeNull());
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · done/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('delivers a hydrated running job when it finishes, even if other live updates arrive during result-window hydration', async () => {
    stubFetch('present', [job()]);
    const onResult = vi.fn(() => true).mockReturnValueOnce(false);
    mount(onResult);
    await screen.findByRole('button', { name: /Research running/ });
    act(() => publishJob(job({ status: 'done', step: 3, viewId: 'new-result', updatedAt: '2026-10-07T12:01:00.000Z' })));
    await waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    act(() => publishJob(job({ jobId: '22222222-2222-4222-8222-222222222222', title: 'Another live job' })));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(onResult).toHaveBeenLastCalledWith('new-result', 'open');
    expect(screen.getByRole('button', { name: /Research running: Another live job/ })).not.toBeNull();
  });

  it('restores keyboard focus on Escape and offers a separate accessible close control', async () => {
    stubFetch('present', [job()]);
    mount();
    const chip = await screen.findByRole('button', { name: /Research running/ });
    fireEvent.click(chip);
    expect(screen.getByRole('group', { name: /details/ })).toBe(document.activeElement);
    await userEvent.keyboard('{Escape}');
    expect(chip).toBe(document.activeElement);
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: 'Close job details' }));
    expect(chip).toBe(document.activeElement);
  });

  it('keeps all running jobs and the latest 100 terminal runs without conflating equal titles or accepting terminal regression', async () => {
    const terminal = Array.from({ length: 120 }, (_, index) => job({
      jobId: `${String(index + 1).padStart(8, '0')}-2222-4222-8222-222222222222`,
      status: 'failed', startedAt: new Date(Date.parse(job().startedAt) + index * 1000).toISOString(),
    }));
    stubFetch('present', [...terminal, job()]);
    mount();
    await screen.findByRole('button', { name: 'Show background work: 100 failed' });
    expect(hasRunningJob('research')).toBe(true);
    act(() => publishJob({ ...terminal[119]!, status: 'running', updatedAt: '2026-10-08T00:00:00.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: /Show background work/ }));
    expect(screen.getAllByRole('button', { name: /Research: Microsoft Foundry IQ · 100 runs Research · failed/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).toHaveLength(1);
  });
});
