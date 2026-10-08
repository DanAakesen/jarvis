import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@jarvis/contracts';
import { JobsChip } from './JobsChip';
import { publishJob, resetJobsForTests } from './jobs-store';
import { resetPresenceForTests } from './presence-store';

const getAccessToken = vi.fn(async () => 'token');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const job = (patch: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId: '11111111-1111-4111-8111-111111111111', kind: 'research', title: 'Research: Microsoft Foundry IQ', status: 'running', step: 1, steps: 3,
  detail: 'Searching: Key findings', startedAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:10.000Z', ...patch,
});

function stubFetch(mode: 'present' | 'away') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/presence') return json({ mode, source: 'manual', changedAt: null });
    if (path === '/jobs') return json({ jobs: [] });
    if (path === '/jobs/11111111-1111-4111-8111-111111111111/cancel' && init?.method === 'POST') return new Response(null, { status: 202 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetJobsForTests();
  resetPresenceForTests();
});

describe('job tabs', () => {
  it('shows running progress, peeks at the step and cancels', async () => {
    const fetchMock = stubFetch('present');
    render(<JobsChip backendUrl="https://api.example.com" getAccessToken={getAccessToken} onResult={() => true} />);
    expect(screen.queryByRole('button', { name: /Show details/ })).toBeNull();

    act(() => publishJob(job()));
    const chip = screen.getByRole('button', { name: /Research running: Research: Microsoft Foundry IQ · 1\/3/ });
    fireEvent.click(chip);
    expect(screen.getByText('Searching: Key findings')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/11111111-1111-4111-8111-111111111111/cancel', expect.objectContaining({ method: 'POST' })));

    act(() => publishJob(job({ jobId: '22222222-2222-4222-8222-222222222222', title: 'Research: Work IQ', startedAt: '2026-10-07T12:00:05.000Z' })));
    expect(screen.getAllByRole('button', { name: /Research running/ })).toHaveLength(2);
  });

  it('opens a finished result while present and parks it in the chip while away', async () => {
    stubFetch('present');
    const onResult = vi.fn(() => true);
    const { unmount } = render(<JobsChip backendUrl="https://api.example.com" getAccessToken={getAccessToken} onResult={onResult} />);
    act(() => publishJob(job({ status: 'done', step: 3, viewId: 'research-1', updatedAt: '2026-10-07T12:01:00.000Z' })));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('research-1', 'open'));
    unmount();
    resetJobsForTests();
    resetPresenceForTests();

    stubFetch('away');
    const parked = vi.fn(() => true);
    render(<JobsChip backendUrl="https://api.example.com" getAccessToken={getAccessToken} onResult={parked} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/presence', expect.anything()));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    act(() => publishJob(job({ jobId: '99999999-9999-4999-8999-999999999999', status: 'done', step: 3, viewId: 'research-9', updatedAt: '2026-10-07T12:01:00.000Z' })));
    await waitFor(() => expect(parked).toHaveBeenCalledWith('research-9', 'park'));
    fireEvent.click(screen.getByRole('button', { name: /Research ready/ }));
    expect(await screen.findByText('Waiting here while you are away.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(parked).toHaveBeenLastCalledWith('research-9', 'open');
  });

  it('shows a failed job in amber with its reason, Retry and Dismiss', () => {
    stubFetch('present');
    render(<JobsChip backendUrl="https://api.example.com" getAccessToken={getAccessToken} onResult={() => true} />);
    act(() => publishJob(job({ status: 'failed', detail: 'The web search timed out.', updatedAt: '2026-10-07T12:02:00.000Z' })));
    const chip = screen.getByRole('button', { name: /Research failed/ });
    expect(chip.closest('.job-tab')?.getAttribute('data-tone')).toBe('failed');
    fireEvent.click(chip);
    expect(screen.getByText('The web search timed out.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: /Research failed/ })).toBeNull();
  });
});
