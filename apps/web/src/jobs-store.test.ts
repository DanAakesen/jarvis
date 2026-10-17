import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@jarvis/contracts';
import { hasRunningJob, publishJob, resetJobsForTests, useJobs } from './jobs-store';

const getAccessToken = async () => 'fixture-token';
const job: BackgroundJob = {
  jobId: '11111111-1111-4111-8111-111111111111', title: 'First account job',
  kind: 'embedding', status: 'failed', step: 1, steps: 2, detail: 'interrupted by restart',
  startedAt: '2026-10-16T08:00:00.000Z', updatedAt: '2026-10-16T08:05:07.000Z',
};
const json = (jobs: BackgroundJob[]) => new Response(JSON.stringify({ jobs }));

afterEach(() => {
  vi.restoreAllMocks();
  resetJobsForTests();
  vi.unstubAllGlobals();
});

describe('job hydration ownership', () => {
  it('uses backend dismissals after reload and cleared local storage and ignores later live updates', async () => {
    const dismissed = new Set<string>();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        dismissed.add(job.jobId);
        return new Response(JSON.stringify({ dismissedJobIds: [...dismissed] }));
      }
      return new Response(JSON.stringify({ jobs: dismissed.has(job.jobId) ? [] : [job], dismissedJobIds: [...dismissed] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(first.result.current.jobs).toHaveLength(1));
    await act(async () => { expect(await first.result.current.dismiss(job.jobId)).toBe(''); });
    expect(first.result.current.jobs).toEqual([]);
    expect(first.result.current.history).toEqual([expect.objectContaining({ ...job, dismissed: true })]);
    act(() => publishJob({ ...job, updatedAt: '2026-10-16T08:06:00.000Z' }));
    await act(async () => first.result.current.refresh());
    expect(first.result.current.jobs).toEqual([]);
    expect(first.result.current.history[0]?.status).toBe('failed');
    expect(hasRunningJob('embedding')).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    first.unmount();
    resetJobsForTests();
    localStorage.clear();
    const restored = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(restored.result.current.hasDismissedJobs).toBe(true));
    expect(restored.result.current.jobs).toEqual([]);
    expect(restored.result.current.history).toEqual([]);
    act(() => publishJob({ ...job, updatedAt: '2026-10-16T08:07:00.000Z' }));
    expect(restored.result.current.jobs).toEqual([]);
  });

  it('does not dismiss running work or store new dismissals locally', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json([{ ...job, status: 'running' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { expect(await result.current.dismiss(job.jobId)).toContain('Only finished'); });
    expect(result.current.jobs).toHaveLength(1);
    expect(hasRunningJob('embedding')).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(localStorage.length).toBe(0);
  });

  it('accepts complete dismissal metadata beyond the import limit and does not resurrect known IDs from a shortened refresh', async () => {
    let dismissedJobIds = [job.jobId, ...Array.from({ length: 1100 }, (_, index) =>
      `${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`)];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jobs: [job], dismissedJobIds }))));
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.jobs).toEqual([]);
    expect(result.current.error).toBe('');
    dismissedJobIds = [];
    await act(async () => result.current.refresh());
    act(() => publishJob({ ...job, updatedAt: '2026-10-16T08:06:00.000Z' }));
    expect(result.current.jobs).toEqual([]);
    expect(result.current.error).toBe('');
  });

  it('removes obsolete running cache entries when another device dismissed a missed terminal update', async () => {
    const running = { ...job, status: 'running' as const };
    let remoteDismissed = false;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      jobs: remoteDismissed ? [] : [running],
      dismissedJobIds: remoteDismissed ? [job.jobId] : [],
    }))));
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(hasRunningJob('embedding')).toBe(true);
    remoteDismissed = true;
    await act(async () => result.current.refresh());
    expect(result.current.jobs).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(hasRunningJob('embedding')).toBe(false);
    act(() => publishJob({ ...running, updatedAt: '2026-10-16T08:06:00.000Z' }));
    expect(result.current.history).toEqual([]);
    expect(hasRunningJob('embedding')).toBe(false);
    act(() => publishJob({ ...job, status: 'done', updatedAt: '2026-10-16T08:07:00.000Z' }));
    expect(result.current.jobs).toEqual([]);
    expect(result.current.history).toEqual([expect.objectContaining({ status: 'done', dismissed: true })]);
    expect(hasRunningJob('embedding')).toBe(false);
  });

  it('keeps failed mutations visible and retries only with server confirmation', async () => {
    let confirm = false;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify(confirm ? { dismissedJobIds: [job.jobId] } : {}), { status: confirm ? 200 : 503 })
      : json([job]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.dismiss(job.jobId); });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.error).toContain('could not be confirmed');
    confirm = true;
    await act(async () => { await result.current.dismiss(job.jobId); });
    expect(result.current.jobs).toEqual([]);
    expect(result.current.error).toBe('');
    expect(localStorage.length).toBe(0);
  });

  it('imports legacy IDs once, preserving hidden pending IDs and the local copy on failure', async () => {
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    localStorage.setItem(key, JSON.stringify([job.jobId]));
    let confirm = false;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: confirm ? [job.jobId] : [] }), { status: confirm ? 200 : 503 })
      : json([job]));
    vi.stubGlobal('fetch', fetchMock);
    const first = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(first.result.current.error).toContain('could not be synced'));
    expect(first.result.current.jobs).toEqual([]);
    expect(localStorage.getItem(key)).toBe(JSON.stringify([job.jobId]));
    act(() => publishJob({ ...job, updatedAt: '2026-10-16T08:06:00.000Z' }));
    expect(first.result.current.jobs).toEqual([]);
    first.unmount();
    resetJobsForTests(false);
    const second = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(second.result.current.error).toContain('could not be synced'));
    confirm = true;
    await act(async () => second.result.current.refresh());
    expect(second.result.current.jobs).toEqual([]);
    expect(second.result.current.error).toBe('');
    expect(localStorage.getItem(key)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/dismissals/import', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ jobIds: [job.jobId] }),
    }));
    const imports = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length;
    await act(async () => second.result.current.refresh());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(imports);
  });

  it('clears safely ignored absent legacy IDs after successful import and rejects invalid legacy UUIDs', async () => {
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    const other = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem(key, JSON.stringify([job.jobId, other]));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: [job.jobId] }))
      : json([job])));
    const first = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(first.result.current.error).toBe('');
    expect(first.result.current.jobs).toEqual([]);
    first.unmount();
    resetJobsForTests();
    localStorage.setItem(key, JSON.stringify(['invalid']));
    const fetchMock = vi.fn<typeof fetch>(async () => json([job]));
    vi.stubGlobal('fetch', fetchMock);
    const second = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(second.result.current.jobs).toHaveLength(1));
    expect(second.result.current.error).toContain('could not be restored');
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('migrates old running hides separately without sending them to import or preserving durable hiding', async () => {
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    const running = { ...job, jobId: '22222222-2222-4222-8222-222222222222', status: 'running' as const };
    localStorage.setItem(key, JSON.stringify([job.jobId, running.jobId]));
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: [job.jobId] })) : json([job, running]));
    vi.stubGlobal('fetch', fetchMock);
    const first = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(first.result.current.jobs).toEqual([expect.objectContaining({ jobId: running.jobId })]);
    expect(first.result.current.headerHiddenJobIds.has(running.jobId)).toBe(true);
    expect(first.result.current.error).toBe('');
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/dismissals/import', expect.objectContaining({
      body: JSON.stringify({ jobIds: [job.jobId] }),
    }));
    first.unmount();
    resetJobsForTests(false);
    const second = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(second.result.current.jobs).toHaveLength(2));
    expect(second.result.current.headerHiddenJobIds.size).toBe(0);
  });

  it('cleans up a legacy running-only hide without a forbidden dismissal request', async () => {
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    localStorage.setItem(key, JSON.stringify([job.jobId]));
    const fetchMock = vi.fn<typeof fetch>(async () => json([{ ...job, status: 'running' }]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(result.current.headerHiddenJobIds.has(job.jobId)).toBe(true);
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]?.dismissed).toBe(false);
    expect(result.current.error).toBe('');
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('dismisses all finished server-side and refreshes remote dismissals without hiding running jobs', async () => {
    const running = { ...job, jobId: '22222222-2222-4222-8222-222222222222', status: 'running' as const };
    let dismissed: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') dismissed = [job.jobId];
      return new Response(JSON.stringify(init?.method === 'POST' ? { dismissedJobIds: dismissed } : { jobs: [job, running], dismissedJobIds: dismissed }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => { await result.current.dismissMany(); });
    expect(result.current.jobs).toEqual([expect.objectContaining({ jobId: running.jobId })]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/jobs/dismiss-finished', expect.objectContaining({ method: 'POST' }));
    act(() => publishJob({ ...job, updatedAt: '2026-10-16T08:06:00.000Z' }));
    expect(result.current.jobs).toHaveLength(1);
    act(() => publishJob({ ...running, status: 'done', updatedAt: '2026-10-16T08:07:00.000Z' }));
    dismissed.push(running.jobId);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.jobs).toEqual([]);
  });

  it('keeps unconfirmed group members visible and rejects oversized or malformed import requests', async () => {
    const other = { ...job, jobId: '22222222-2222-4222-8222-222222222222' };
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: [job.jobId] })) : json([job, other]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => { await result.current.dismissMany([job.jobId, other.jobId]); });
    expect(result.current.jobs).toEqual([expect.objectContaining({ jobId: other.jobId })]);
    expect(result.current.error).toContain('could not be confirmed');
    const count = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.dismissMany(Array.from({ length: 1001 }, () => other.jobId));
      await result.current.dismissMany(['invalid']);
    });
    expect(fetchMock.mock.calls).toHaveLength(count);
  });

  it('does not report an empty bulk confirmation as success when finished work remains', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: [] })) : json([job])));
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.dismissMany(); });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.error).toContain('could not be confirmed');
  });

  it('serializes concurrent dismissals without losing a second completed job', async () => {
    const other = { ...job, jobId: '22222222-2222-4222-8222-222222222222' };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: [String(input).split('/')[4]] })) : json([job, other]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => { await Promise.all([result.current.dismiss(job.jobId), result.current.dismiss(other.jobId)]); });
    expect(result.current.jobs).toEqual([]);
    expect(result.current.error).toBe('');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });

  it('retries cleanup of the legacy local copy after confirmed sync despite storage failure', async () => {
    const key = 'jarvis.jobs.dismissed.v1:["https://api.example.com","fixture-owner"]';
    localStorage.setItem(key, JSON.stringify([job.jobId]));
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ dismissedJobIds: [job.jobId] })) : json([job]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useJobs('https://api.example.com', getAccessToken, 'fixture-owner'));
    await waitFor(() => expect(result.current.error).toContain('old device copy'));
    expect(result.current.jobs).toEqual([]);
    expect(localStorage.getItem(key)).not.toBeNull();
    remove.mockRestore();
    await act(async () => result.current.refresh());
    expect(result.current.error).toBe('');
    expect(localStorage.getItem(key)).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('aborts a dismissal waiting for an old account token without sending a stale mutation', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json([job]));
    vi.stubGlobal('fetch', fetchMock);
    let resolveToken!: (token: string) => void;
    const accessToken = vi.fn(getAccessToken);
    const { result, rerender } = renderHook(({ account }) => useJobs('https://api.example.com', accessToken, account), {
      initialProps: { account: 'first-owner' },
    });
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    accessToken.mockReturnValueOnce(new Promise<string>((resolve) => { resolveToken = resolve; }));
    let dismissal!: Promise<string>;
    act(() => { dismissal = result.current.dismiss(job.jobId); });
    expect(result.current.dismissing).toBe(true);
    rerender({ account: 'second-owner' });
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { resolveToken('old-token'); await dismissal; });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.error).toBe('');
  });

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
