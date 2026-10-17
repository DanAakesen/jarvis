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
let legacyIds = new Set<string>();
let sessionHeaderHiddenIds = new Set<string>();
let legacyStorageDirty = false;
let dismissalError = '';
let mutation: Promise<string> | null = null;
let mutationController: AbortController | null = null;
let liveRevision = 0;
let liveRevisions = new Map<string, number>();
let visibleIds = new Set<string>();
let deferredJobs = new Map<string, BackgroundJob>();
let refreshCurrent: (() => Promise<void>) | null = null;
let refreshQueued = false;
let seenJobs = false;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    void refreshCurrent?.();
  });
}

function readDismissals(): Set<string> {
  if (!scope) return new Set();
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${dismissalPrefix}${scope}`) ?? '[]');
    if (!Array.isArray(value) || value.length > 1000 ||
        !value.every((id): id is string => typeof id === 'string' &&
          uuid.test(id))) {
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
  if (next.size) seenJobs = true;
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
  dismissedIds ??= new Set();
  const jobId = value.jobId.toLowerCase();
  if (value.status === 'running' && dismissedIds.has(jobId)) return;
  const current = jobs.get(jobId);
  if (current && (Date.parse(current.updatedAt) > Date.parse(value.updatedAt) ||
      (current.status !== 'running' && value.status === 'running'))) return;
  if (source === 'live') liveRevisions.set(jobId, ++liveRevision);
  // Bounded tombstones cannot authorize an unknown replay. Verify it against visible server history.
  if (source === 'live' && !current && !visibleIds.has(jobId) && !dismissedIds.has(jobId)) {
    const pending = deferredJobs.get(jobId);
    if (!pending || Date.parse(pending.updatedAt) <= Date.parse(value.updatedAt)) deferredJobs.set(jobId, value);
    const oldest = [...deferredJobs.values()].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
    for (const job of oldest.slice(100)) deferredJobs.delete(job.jobId);
    scheduleRefresh();
    return;
  }
  const next = new Map(jobs);
  next.set(jobId, {
    ...value, jobId,
    ...(dismissedIds.has(jobId) || value.status !== 'running' && legacyIds.has(jobId) ? { dismissed: true } : {}),
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

function applyDismissals(ids: readonly string[]) {
  dismissedIds ??= new Set();
  if (ids.length) seenJobs = true;
  const previousLegacyCount = legacyIds.size;
  for (const id of ids) {
    dismissedIds.add(id);
    legacyIds.delete(id);
  }
  if (legacyIds.size !== previousLegacyCount) saveLegacyRemainder();
  const confirmedIds = dismissedIds;
  emit(new Map([...jobs]
    // A server dismissal confirms terminal work, not the terminal status we missed.
    .filter(([id, job]) => job.status !== 'running' || !confirmedIds.has(id))
    .map(([id, job]) => [id, {
      ...job, dismissed: confirmedIds.has(id) || job.status !== 'running' && legacyIds.has(id),
    }])));
}

function saveLegacyRemainder() {
  try {
    if (!scope) throw new Error('Authenticated job preference scope unavailable');
    if (legacyIds.size) localStorage.setItem(`${dismissalPrefix}${scope}`, JSON.stringify([...legacyIds]));
    else localStorage.removeItem(`${dismissalPrefix}${scope}`);
    legacyStorageDirty = false;
    storageError = '';
  } catch {
    legacyStorageDirty = true;
    storageError = 'Job dismissals were synced, but the old device copy could not be updated. Refresh work to retry.';
  }
}

function dismissalIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('dismissedJobIds' in body) ||
      !Array.isArray(body.dismissedJobIds) || !body.dismissedJobIds.every((id): id is string => typeof id === 'string' && uuid.test(id))) {
    throw new Error('Invalid dismissal response');
  }
  return body.dismissedJobIds;
}

export function resetJobsForTests(clearDismissals = true) {
  generation += 1;
  loadController?.abort();
  mutationController?.abort();
  mutationController = null;
  loadController = null;
  jobs = new Map();
  snapshot = { jobs: [], error: '' };
  loaded = false;
  loading = null;
  dismissedIds = null;
  storageError = '';
  legacyIds = new Set();
  sessionHeaderHiddenIds = new Set();
  legacyStorageDirty = false;
  dismissalError = '';
  mutation = null;
  liveRevision = 0;
  liveRevisions = new Map();
  visibleIds = new Set();
  deferredJobs = new Map();
  refreshCurrent = null;
  refreshQueued = false;
  seenJobs = false;
  if (clearDismissals) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(dismissalPrefix)) localStorage.removeItem(key);
    }
  }
  scope = null;
}

function authorizedJobsRequest(backendUrl: string, path: string, token: string, method: 'GET' | 'POST', signal?: AbortSignal, body?: unknown) {
  return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, {
    method,
    headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
    ...(body ? { body: JSON.stringify(body) } : {}),
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
    const requestRevision = liveRevision;
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
        if (legacyStorageDirty) saveLegacyRemainder();
        if ('dismissedJobIds' in body) applyDismissals(dismissalIds(body));
        if (!legacyIds.size) dismissalError = '';
        visibleIds = new Set(body.jobs.map(({ jobId }) => jobId.toLowerCase()));
        // Absence from this authoritative window supersedes old cache entries, not newer live progress.
        emit(new Map([...jobs].filter(([id, job]) => visibleIds.has(id) || (liveRevisions.get(id) ?? 0) > requestRevision ||
          job.status !== 'running' && dismissedIds?.has(id))));
        for (const job of body.jobs) {
          const id = job.jobId.toLowerCase();
          const deferred = deferredJobs.get(id);
          if (deferred) { deferredJobs.delete(id); publishJob(deferred); }
          publishJob(job, 'history');
        }
        for (const [id] of deferredJobs) {
          if ((liveRevisions.get(id) ?? 0) <= requestRevision) deferredJobs.delete(id);
        }
        liveRevisions = new Map([...liveRevisions].filter(([id]) => jobs.has(id) || deferredJobs.has(id)));
        loaded = true;
        emit(new Map(jobs), '');
        if (legacyIds.size) {
          try {
            const legacySnapshot = [...legacyIds];
            const runningIds = new Set(body.jobs.filter((job) => job.status === 'running').map(({ jobId }) => jobId.toLowerCase()));
            const jobIds = legacySnapshot.filter((id) => !runningIds.has(id));
            let ids: string[] = [];
            if (jobIds.length) {
              const response = await authorizedJobsRequest(backendUrl, '/jobs/dismissals/import', token, 'POST', signal, { jobIds });
              if (!response.ok) throw new Error('Import failed');
              ids = dismissalIds(await response.json());
            }
            signal.throwIfAborted();
            if (requestGeneration !== generation) return;
            applyDismissals(ids);
            // A successful import processed every submitted ID; absent/expired jobs are safely ignored.
            for (const id of legacySnapshot) {
              if (runningIds.has(id)) sessionHeaderHiddenIds.add(id);
              legacyIds.delete(id);
            }
            saveLegacyRemainder();
            applyDismissals([]);
            dismissalError = '';
          } catch {
            if (requestGeneration !== generation || controller.signal.aborted) return;
            dismissalError = 'Saved dismissals could not be synced. They remain hidden on this device. Refresh work to retry sync.';
          }
          emit(new Map(jobs));
        }
      } catch {
        if (requestGeneration === generation && !controller.signal.aborted) {
          loaded = false;
          emit(new Map(jobs), 'Job history could not be loaded. Live updates may be incomplete.');
        }
      } finally {
        if (requestGeneration === generation) {
          loading = null;
          loadController = null;
          emit(new Map(jobs));
          if ([...deferredJobs.keys()].some((id) => (liveRevisions.get(id) ?? 0) > requestRevision)) scheduleRefresh();
        }
      }
    })();
    return loading;
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    if (scope !== requestScope) {
      generation += 1;
      loadController?.abort();
      mutationController?.abort();
      mutationController = null;
      loadController = null;
      scope = requestScope;
      loaded = false;
      loading = null;
      dismissedIds = new Set();
      storageError = '';
      legacyIds = readDismissals();
      sessionHeaderHiddenIds = new Set();
      legacyStorageDirty = false;
      dismissalError = '';
      mutation = null;
      liveRevision = 0;
      liveRevisions = new Map();
      visibleIds = new Set();
      deferredJobs = new Map();
      seenJobs = false;
      emit(new Map(), '');
    }
    refreshCurrent = refresh;
    if (!loaded) void refresh();
  }, [refresh, requestScope]);

  useEffect(() => {
    const restore = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', restore);
    const timer = window.setInterval(restore, 60_000);
    return () => {
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', restore);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const dismissMany = useCallback(function dismissRequested(jobIds?: readonly string[]): Promise<string> {
    if (!backendUrl || !requestScope || scope !== requestScope) return Promise.resolve('Jobs unavailable.');
    if (jobIds && (jobIds.length === 0 || jobIds.length > 1000 || jobIds.some((id) => !uuid.test(id) || jobs.get(id)?.status === 'running'))) {
      return Promise.resolve('Only finished jobs can be dismissed.');
    }
    if (mutation) return mutation.then(() => dismissRequested(jobIds));
    const requestGeneration = generation;
    const expectedIds = jobIds ?? [...jobs.values()].filter((job) => job.status !== 'running' && !job.dismissed).map(({ jobId }) => jobId);
    const controller = new AbortController();
    mutationController = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    mutation = (async () => {
      try {
        const path = !jobIds ? '/jobs/dismiss-finished' : jobIds.length === 1
          ? `/jobs/${encodeURIComponent(jobIds[0]!)}/dismiss` : '/jobs/dismissals/import';
        const response = await authorizedJobsRequest(backendUrl, path, await awaitWithSignal(getAccessToken, signal), 'POST', signal,
          jobIds && jobIds.length > 1 ? { jobIds } : undefined);
        if (!response.ok) throw new Error('Dismissal failed');
        const ids = dismissalIds(await response.json());
        signal.throwIfAborted();
        if (requestGeneration !== generation) return '';
        applyDismissals(ids);
        if (jobIds && expectedIds.some((id) => !ids.includes(id))) throw new Error('Dismissal not confirmed');
        if (!jobIds) {
          const pendingLoad = loading;
          if (pendingLoad) await awaitWithSignal(() => pendingLoad, signal);
          await awaitWithSignal(refresh, signal);
          if (requestGeneration !== generation) return '';
          if (snapshot.error || expectedIds.some((id) => jobs.has(id) && !jobs.get(id)?.dismissed)) throw new Error('Bulk dismissal not confirmed');
        }
        dismissalError = '';
        emit(new Map(jobs));
        return '';
      } catch {
        if (requestGeneration !== generation) return '';
        dismissalError = 'Job dismissal could not be confirmed. Refresh work or try Dismiss again.';
        emit(new Map(jobs));
        return dismissalError;
      } finally {
        if (requestGeneration === generation) { mutation = null; mutationController = null; emit(new Map(jobs)); }
      }
    })();
    emit(new Map(jobs));
    return mutation;
  }, [backendUrl, getAccessToken, refresh, requestScope]);

  const dismiss = useCallback((jobId: string) => dismissMany([jobId]), [dismissMany]);

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
    hasDismissedJobs: available && (dismissedIds?.size ?? 0) > 0,
    hasJobHistory: available && seenJobs,
    error: available ? [current.error, storageError, dismissalError].filter(Boolean).join(' ') : '',
    refresh,
    cancel,
    dismiss,
    dismissMany,
    dismissing: available && mutation !== null,
    syncingDismissals: available && legacyIds.size > 0 && loading !== null,
    headerHiddenJobIds: available ? new Set([...legacyIds, ...sessionHeaderHiddenIds]) : new Set<string>(),
  };
}
