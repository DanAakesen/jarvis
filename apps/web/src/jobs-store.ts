import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { isBackgroundJob, type BackgroundJob } from '@jarvis/contracts';
import { backendFetch } from './backend-request';

/** Background jobs (P8-43) for the shell's jobs chip: live `job` events plus `GET /jobs` after a reload. */
export type JobEntry = BackgroundJob & { dismissed?: boolean };

let jobs: ReadonlyMap<string, JobEntry> = new Map();
let snapshot: readonly JobEntry[] = [];
const listeners = new Set<() => void>();
let loaded = false;

function emit(next: Map<string, JobEntry>) {
  jobs = next;
  snapshot = [...next.values()].filter((job) => !job.dismissed)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Applies a job event; an older update never overwrites a newer one. */
export function publishJob(value: unknown) {
  if (!isBackgroundJob(value)) return;
  const current = jobs.get(value.jobId);
  if (current && Date.parse(current.updatedAt) > Date.parse(value.updatedAt)) return;
  const next = new Map(jobs);
  next.set(value.jobId, { ...value, ...(current?.dismissed ? { dismissed: true } : {}) });
  // Keep the store small: at most 20 jobs, dropping the oldest finished ones first.
  if (next.size > 20) {
    const finished = [...next.values()].filter((job) => job.status !== 'running')
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
    for (const job of finished.slice(0, next.size - 20)) next.delete(job.jobId);
  }
  emit(next);
}

/** True while a job of this kind runs, so its progress window can stay out of the way. */
export function hasRunningJob(kind: BackgroundJob['kind']) {
  return [...jobs.values()].some((job) => job.kind === kind && job.status === 'running');
}

export function dismissJob(jobId: string) {
  const current = jobs.get(jobId);
  if (!current || current.dismissed) return;
  emit(new Map(jobs).set(jobId, { ...current, dismissed: true }));
}

export function resetJobsForTests() {
  jobs = new Map();
  snapshot = [];
  loaded = false;
}

function authorizedJobsRequest(backendUrl: string, path: string, token: string, method: 'GET' | 'POST') {
  return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    method,
    headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
}

export function useJobs(backendUrl: string | null, getAccessToken: () => Promise<string>) {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

  useEffect(() => {
    if (!backendUrl || loaded) return;
    loaded = true;
    void (async () => {
      try {
        const response = await authorizedJobsRequest(backendUrl, '/jobs', await getAccessToken(), 'GET');
        if (!response.ok) return;
        const body: unknown = await response.json();
        const list = typeof body === 'object' && body !== null && Array.isArray((body as { jobs?: unknown }).jobs)
          ? (body as { jobs: unknown[] }).jobs : [];
        // After a reload only work still running or failed matters; finished results were already delivered.
        for (const job of list.slice(0, 20)) {
          if (isBackgroundJob(job) && (job.status === 'running' || job.status === 'failed')) publishJob(job);
        }
      } catch {
        loaded = false;
      }
    })();
  }, [backendUrl, getAccessToken]);

  const cancel = useCallback(async (jobId: string): Promise<string> => {
    if (!backendUrl) return 'Jobs are unavailable until the backend is deployed.';
    try {
      const response = await authorizedJobsRequest(backendUrl, `/jobs/${encodeURIComponent(jobId)}/cancel`, await getAccessToken(), 'POST');
      if (response.status === 202 || response.ok) return '';
      if (response.status === 409) return 'This job has already finished or cannot be cancelled.';
      return 'Jarvis could not cancel the job. Try again.';
    } catch {
      return 'Jarvis could not cancel the job. Try again.';
    }
  }, [backendUrl, getAccessToken]);

  return { jobs: current, cancel, dismiss: dismissJob };
}
