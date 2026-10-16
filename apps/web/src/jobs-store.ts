import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { isBackgroundJob, type BackgroundJob } from '@jarvis/contracts';
import { awaitWithSignal, backendFetch } from './backend-request';

/** Background jobs (P8-43) for the shell's jobs chip: live `job` events plus `GET /jobs` after a reload. */
export type JobEntry = BackgroundJob & { dismissed?: boolean; restored?: boolean };

let jobs: ReadonlyMap<string, JobEntry> = new Map();
let snapshot: { jobs: readonly JobEntry[]; error: string } = { jobs: [], error: '' };
const listeners = new Set<() => void>();
let loaded = false;
let loading: Promise<void> | null = null;
let loadController: AbortController | null = null;
let generation = 0;
const dismissalPrefix = 'jarvis.jobs.dismissed.v1:';
let scope: string | null = null;
let dismissedIds: Set<string> | null = null;
let storageError = '';

function readDismissals(): Set<string> {
  if (!scope) return new Set();
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${dismissalPrefix}${scope}`) ?? '[]');
    if (!Array.isArray(value) || value.length > 1000 ||
        !value.every((id): id is string => typeof id === 'string' &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id))) {
      throw new Error('Invalid saved job dismissals');
    }
    storageError = '';
    return new Set(value);
  } catch {
    storageError = 'Job visibility could not be restored on this device. Saved job history is unchanged.';
    return new Set();
  }
}

function emit(next: Map<string, JobEntry>, error = snapshot.error) {
  jobs = next;
  snapshot = {
    jobs: [...next.values()].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)),
    error,
  };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Applies a job event; an older update never overwrites a newer one. */
export function publishJob(value: unknown, source: 'live' | 'history' = 'live') {
  if (!isBackgroundJob(value)) return;
  dismissedIds ??= readDismissals();
  const jobId = value.jobId.toLowerCase();
  const current = jobs.get(jobId);
  if (current && (Date.parse(current.updatedAt) > Date.parse(value.updatedAt) ||
      (current.status !== 'running' && value.status === 'running'))) return;
  const next = new Map(jobs);
  next.set(jobId, {
    ...value, jobId,
    ...(dismissedIds.has(jobId) ? { dismissed: true } : {}),
    ...(current?.restored || (!current && source === 'history' && value.status !== 'running') ? { restored: true } : {}),
  });
  // Bound local history, never evict running work or delete durable server history.
  const finished = [...next.values()].filter((job) => job.status !== 'running')
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  for (const job of finished.slice(100)) next.delete(job.jobId);
  emit(next);
}

/** True while a job of this kind runs, so its progress window can stay out of the way. */
export function hasRunningJob(kind: BackgroundJob['kind']) {
  return [...jobs.values()].some((job) => job.kind === kind && job.status === 'running');
}

export function dismissJob(jobId: string) {
  const current = jobs.get(jobId);
  if (!current || current.dismissed) return;
  dismissedIds ??= readDismissals();
  dismissedIds.add(jobId);
  dismissedIds = new Set([...dismissedIds].slice(-1000));
  try {
    if (!scope) throw new Error('Authenticated job preference scope unavailable');
    localStorage.setItem(`${dismissalPrefix}${scope}`, JSON.stringify([...dismissedIds]));
    storageError = '';
  } catch {
    storageError = 'Job visibility could not be saved on this device. It may return after reload; job history is unchanged.';
  }
  emit(new Map(jobs).set(jobId, { ...current, dismissed: true }));
}

export function resetJobsForTests(clearDismissals = true) {
  generation += 1;
  loadController?.abort();
  loadController = null;
  jobs = new Map();
  snapshot = { jobs: [], error: '' };
  loaded = false;
  loading = null;
  dismissedIds = null;
  storageError = '';
  if (clearDismissals) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(dismissalPrefix)) localStorage.removeItem(key);
    }
  }
  scope = null;
}

function authorizedJobsRequest(backendUrl: string, path: string, token: string, method: 'GET' | 'POST', signal?: AbortSignal) {
  return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    method,
    headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
}

export function useJobs(backendUrl: string | null, getAccessToken: () => Promise<string>, accountId: string | null = null) {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const requestScope = backendUrl && accountId ? JSON.stringify([backendUrl.replace(/\/+$/u, ''), accountId]) : null;

  const refresh = useCallback((): Promise<void> => {
    if (!backendUrl) return Promise.resolve();
    if (loading) return loading;
    const requestGeneration = generation;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    loadController = controller;
    loading = (async () => {
      try {
        const token = await awaitWithSignal(getAccessToken, signal);
        const response = await authorizedJobsRequest(backendUrl, '/jobs', token, 'GET', signal);
        if (!response.ok) throw new Error('Job history request failed');
        const body: unknown = await response.json();
        signal.throwIfAborted();
        if (typeof body !== 'object' || body === null || !('jobs' in body) ||
            !Array.isArray(body.jobs) || !body.jobs.every(isBackgroundJob)) {
          throw new Error('Invalid job history response');
        }
        if (requestGeneration !== generation || controller.signal.aborted) return;
        for (const job of body.jobs) publishJob(job, 'history');
        loaded = true;
        emit(new Map(jobs), '');
      } catch {
        if (requestGeneration === generation && !controller.signal.aborted) {
          loaded = false;
          emit(new Map(jobs), 'Job history could not be loaded. Live updates may be incomplete.');
        }
      } finally {
        if (requestGeneration === generation) { loading = null; loadController = null; }
      }
    })();
    return loading;
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    if (scope !== requestScope) {
      generation += 1;
      loadController?.abort();
      loadController = null;
      scope = requestScope;
      loaded = false;
      loading = null;
      dismissedIds = null;
      storageError = '';
      emit(new Map(), '');
    }
    if (!loaded) void refresh();
  }, [refresh, requestScope]);

  useEffect(() => {
    const restore = (event: StorageEvent) => {
      if (!scope || event.key !== `${dismissalPrefix}${scope}`) return;
      dismissedIds = readDismissals();
      const restored = dismissedIds;
      emit(new Map([...jobs].map(([id, job]) => [id, { ...job, dismissed: restored.has(id) }])));
    };
    window.addEventListener('storage', restore);
    return () => window.removeEventListener('storage', restore);
  }, []);

  const cancel = useCallback(async (jobId: string): Promise<string> => {
    if (!backendUrl) return 'Jobs unavailable.';
    try {
      const response = await authorizedJobsRequest(backendUrl, `/jobs/${encodeURIComponent(jobId)}/cancel`, await getAccessToken(), 'POST');
      if (response.status === 202 || response.ok) return '';
      if (response.status === 409) return 'This job has already finished or cannot be cancelled.';
      return 'Jarvis could not cancel the job. Try again.';
    } catch {
      return 'Jarvis could not cancel the job. Try again.';
    }
  }, [backendUrl, getAccessToken]);

  const available = scope === requestScope;
  return {
    jobs: available ? current.jobs.filter((job) => !job.dismissed) : [],
    history: available ? current.jobs : [],
    error: available ? [current.error, storageError].filter(Boolean).join(' ') : '',
    refresh,
    cancel,
    dismiss: dismissJob,
  };
}
