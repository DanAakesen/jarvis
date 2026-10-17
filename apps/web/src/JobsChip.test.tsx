import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@jarvis/contracts';
import { JobsChip } from './JobsChip';
import { hasRunningJob, publishJob, resetJobsForTests } from './jobs-store';
import { resetPresenceForTests } from './presence-store';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const job = (patch: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId: '11111111-1111-4111-8111-111111111111', kind: 'research', title: 'Research: Microsoft Foundry IQ', status: 'running', step: 1, steps: 3,
  detail: 'Searching: Key findings', startedAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:10.000Z', ...patch,
});

function stubFetch(mode: 'present' | 'away', jobs: BackgroundJob[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/presence') return json({ mode, source: 'manual', changedAt: null });
    if (path === '/jobs') return json({ jobs });
    if (path === '/jobs/11111111-1111-4111-8111-111111111111/cancel' && init?.method === 'POST') return new Response(null, { status: 202 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mount(onResult = vi.fn(() => true), accountId = 'fixture-owner') {
  return render(<JobsChip accountId={accountId} backendUrl="https://api.example.com" getAccessToken={getAccessToken} onResult={onResult} />);
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
  it('shows only an idle icon with no visible label or zero counts when there are no outcomes', async () => {
    stubFetch('present');
    mount();
    const trigger = screen.getByRole('button', { name: 'Show background work' });
    expect(trigger.textContent).toBe('');
    expect(trigger.title).toBe('Background work: idle');
    expect(screen.getByRole('img', { name: 'Background work: idle' })).not.toBeNull();
    act(() => publishJob(job({ status: 'cancelled' })));
    expect(trigger.textContent).toBe('');
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'Background work' })).not.toBeNull();
  });

  it('counts each undismissed outcome with a distinct icon, accessible name and tooltip', async () => {
    stubFetch('away', [
      job(),
      job({ jobId: '22222222-2222-4222-8222-222222222222', status: 'done', kind: 'embedding' }),
      job({ jobId: '33333333-3333-4333-8333-333333333333', status: 'failed' }),
      job({ jobId: '44444444-4444-4444-8444-444444444444', status: 'failed' }),
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
    expect(screen.queryByRole('img', { name: 'Background work: idle' })).toBeNull();
    const trigger = screen.getByRole('button', { name: /Show background work/ });
    expect(trigger.textContent).toBe('112');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*33333333.*from header/ }));
    expect(screen.queryByRole('img', { name: '2 failed background jobs' })).toBeNull();
    expect(screen.getByRole('img', { name: '1 failed background job' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*44444444.*from header/ }));
    expect(screen.queryByRole('img', { name: /failed background job/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*22222222.*from header/ }));
    expect(screen.queryByRole('img', { name: /done background job/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss .*11111111.*from header/ }));
    expect(screen.queryByRole('img', { name: /running background job/ })).toBeNull();
    expect(screen.queryByText('1 background jobs running')).toBeNull();
    expect(screen.getByRole('img', { name: 'Background work: idle' })).not.toBeNull();
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
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Completed indexing Indexing · done/ })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Background work' })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/jobs'))).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    first.unmount();
    resetJobsForTests(false);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work/ }));
    act(() => publishJob({ ...failed, updatedAt: '2026-10-07T12:03:00.000Z' }));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('shows running progress, peeks at the step and cancels', async () => {
    const fetchMock = stubFetch('present');
    mount();
    expect(screen.queryByRole('button', { name: /Show details/ })).toBeNull();

    act(() => publishJob(job()));
    const chip = screen.getByRole('button', { name: /Research running: Research: Microsoft Foundry IQ · 11111111 · 1\/3/ });
    expect(chip.closest('.job-tab-list')).not.toBeNull();
    fireEvent.click(chip);
    const details = screen.getByRole('group', { name: 'Research: Microsoft Foundry IQ details' });
    expect(details.textContent).toContain('Searching: Key findings');
    expect(details.closest('.job-tab-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/11111111-1111-4111-8111-111111111111/cancel', expect.objectContaining({ method: 'POST' })));

    act(() => publishJob(job({ jobId: '22222222-2222-4222-8222-222222222222', title: 'Research: Work IQ', startedAt: '2026-10-07T12:00:05.000Z' })));
    expect(screen.getAllByRole('button', { name: /Research running/ })).toHaveLength(2);
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

  it('retains a failed run and its reason, with truthful unavailable retry and local Dismiss', () => {
    stubFetch('present');
    mount();
    act(() => publishJob(job({ status: 'failed', detail: 'The web search timed out.', updatedAt: '2026-10-07T12:02:00.000Z' })));
    expect(screen.queryByRole('button', { name: /Research failed/ })).toBeNull();
    openHistoryJob(/Research: Microsoft Foundry IQ Research · failed/);
    expect(screen.getByText('The web search timed out.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('button', { name: 'Show background work' })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole('button', { name: 'Show background work' }));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toBeNull();
    expect(screen.getByText('No background work to show.')).not.toBeNull();
  });

  it('consolidates 18 real interrupted indexing runs without dropping identities or dispatching fake retries', async () => {
    const failures = Array.from({ length: 18 }, (_, index) => job({
      jobId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      kind: 'embedding', title: 'Re-embed memory and vault', status: 'failed',
      detail: 'interrupted by restart', updatedAt: '2026-10-07T12:05:07.000Z',
    }));
    const fetchMock = stubFetch('present', failures);
    mount();
    expect(await screen.findByRole('button', { name: 'Show background work: 18 failed' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Show details/ })).toBeNull();
    expect(document.querySelectorAll('.job-tab')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Show background work/ }));
    expect(screen.getAllByRole('button', { name: /Re-embed memory and vault Indexing · failed/ })).toHaveLength(18);
    fireEvent.click(screen.getAllByRole('button', { name: /Re-embed memory and vault Indexing · failed/ })[0]!);
    expect(screen.getByText('interrupted by restart')).not.toBeNull();
    expect(screen.getByText(/5m 07s/)).not.toBeNull();
    expect(screen.getByText(/No supported indexing retry action/)).not.toBeNull();
    expect(screen.getByText(/not a check of current indexing/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    expect(screen.getByText('interrupted by restart')).not.toBeNull();
  });

  it('hides running work with keyboard, preserves lifecycle and persists scoped visibility across reload and live updates', async () => {
    const fetchMock = stubFetch('present', [job()]);
    const first = mount();
    const hide = await screen.findByRole('button', { name: /Hide Research.*from header/ });
    hide.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: /Research running/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show background work' })).toBe(document.activeElement);
    expect(hasRunningJob('research')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    first.unmount();
    resetJobsForTests(false);
    mount();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/jobs'))).toHaveLength(2));
    act(() => publishJob(job({ step: 2, updatedAt: '2026-10-07T12:00:20.000Z' })));
    expect(screen.queryByRole('button', { name: /Research running/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show background work' }));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).toBeNull();
    expect(screen.getByText('No background work to show.')).not.toBeNull();
    expect(hasRunningJob('research')).toBe(true);
    expect(JSON.parse(localStorage.getItem('jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]')!)).toEqual([job().jobId]);
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
    stubFetch('present', [job({ status: 'failed' })]);
    mount();
    await screen.findByRole('button', { name: /Show background work/ });
    openHistoryJob(/Research: Microsoft Foundry IQ Research · failed/);
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    act(() => {
      localStorage.setItem(key, JSON.stringify([job().jobId]));
      window.dispatchEvent(new StorageEvent('storage', { key }));
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

  it('keeps history and close usable when saving device visibility fails', async () => {
    stubFetch('present', [job()]);
    mount();
    const hide = await screen.findByRole('button', { name: /Hide Research.*from header/ });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(hide);
    expect(screen.queryByRole('button', { name: /Research running/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show background work/ }));
    expect(screen.getByRole('alert').textContent).toContain('could not be saved on this device');
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).toBeNull();
    expect(screen.queryByText('No background work to show.')).toBeNull();
  });

  it('shows history load failure and can refresh without losing newer live progress', async () => {
    const fetchMock = stubFetch('present');
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => new URL(String(input)).pathname === '/jobs'
      ? Promise.resolve(json({}, 503))
      : respond(input, init));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Show background work/ }));
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    expect(screen.getByRole('img', { name: 'Background work needs attention' })).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Background work: idle' })).toBeNull();
    act(() => publishJob(job({ step: 2, updatedAt: '2026-10-07T12:00:20.000Z' })));
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
    expect(screen.getByRole('button', { name: 'Show background work: needs attention' })).not.toBeNull();
    onResult.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Show background work' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show background work' }));
    expect(screen.queryByRole('button', { name: /Research: Microsoft Foundry IQ Research · done/ })).toBeNull();
    expect(screen.getByText('No background work to show.')).not.toBeNull();
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
    expect(screen.getAllByRole('button', { name: /Research: Microsoft Foundry IQ Research · failed/ })).toHaveLength(100);
    expect(screen.getAllByRole('button', { name: /Research: Microsoft Foundry IQ Research · running/ })).toHaveLength(1);
  });
});
