import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@jarvis/contracts';
import { publishJob, resetJobsForTests, useJobs } from './jobs-store';

const getAccessToken = async () => 'fixture-token';
const job: BackgroundJob = {
  jobId: '11111111-1111-4111-8111-111111111111', title: 'First account job',
  kind: 'embedding', status: 'failed', step: 1, steps: 2, detail: 'interrupted by restart',
  startedAt: '2026-10-16T08:00:00.000Z', updatedAt: '2026-10-16T08:05:07.000Z',
};
const json = (jobs: BackgroundJob[]) => new Response(JSON.stringify({ jobs }));

afterEach(() => {
  resetJobsForTests();
  vi.unstubAllGlobals();
});

describe('job hydration ownership', () => {
  it('aborts the old authenticated read and ignores its late response after an account switch', async () => {
    let finishFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const secondJob = { ...job, jobId: '22222222-2222-4222-8222-222222222222', title: 'Second account job' };
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(first).mockResolvedValueOnce(json([secondJob]));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ account }) => useJobs('https://api.example.com', getAccessToken, account), {
      initialProps: { account: 'first-owner' },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const firstSignal = fetchMock.mock.calls[0]![1]!.signal!;
    act(() => publishJob(job));
    expect(result.current.history[0]?.title).toBe('First account job');
    rerender({ account: 'second-owner' });
    await waitFor(() => expect(result.current.history[0]?.title).toBe('Second account job'));
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { finishFirst(json([job])); });
    expect(result.current.history.map(({ title }) => title)).toEqual(['Second account job']);
  });

  it('shows malformed hydration as unavailable rather than a successful empty history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jobs: [{ ...job, jobId: 'invalid' }] }))));
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.error).toContain('could not be loaded'));
    expect(result.current.history).toEqual([]);
  });
});
