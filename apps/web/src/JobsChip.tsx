import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { BackgroundJob } from '@jarvis/contracts';
import { usePresence } from './presence-store';
import { useJobs, type JobEntry } from './jobs-store';
import { WorkingCore } from './ToolCallChip';

/** Opens (or just reveals) a job's result window; returns false while the window does not exist yet. */
export type ResultWindowAction = (viewId: string, mode: 'open' | 'park') => boolean;

const kindLabel: Record<BackgroundJob['kind'], string> = { research: 'Research', image: 'Image', html_app: 'App', embedding: 'Indexing' };

function elapsed(from: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 7;
  return (
    <svg className="jobs-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle className="jobs-ring-track" cx="9" cy="9" r="7" />
      <circle className="jobs-ring-value" cx="9" cy="9" r="7"
        style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - Math.max(0.06, Math.min(1, value))) } as CSSProperties} />
    </svg>
  );
}

function StatusMark({ status }: { status: BackgroundJob['status'] }) {
  return (
    <svg className="jobs-mark" data-status={status} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" />
      {status === 'done' ? <path d="m4.8 8.2 2.1 2.1 4.3-4.6" /> : status === 'failed' ? <path d="M8 4.5v4.2M8 11.3v.2" /> : <path d="M5 8h6" />}
    </svg>
  );
}

/** The flying-out effect: the result window grows out of the chip into its place. */
function flyFromChip(chip: HTMLElement | null, viewId: string) {
  const reduced = (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) || document.documentElement.dataset.motion === 'reduced';
  const target = document.querySelector<HTMLElement>(`.workspace-window[data-view-id="${CSS.escape(viewId)}"]`);
  if (!chip || !target || reduced || typeof target.animate !== 'function') return;
  const from = chip.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!to.width || !to.height) return;
  target.animate([
    { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.2 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 },
  ], { duration: 560, easing: 'cubic-bezier(.2, .9, .3, 1.05)' });
}

function jobLabel(job: JobEntry) {
  return `${job.title} · ${job.jobId.slice(0, 8)}`;
}

export function JobsChip({ backendUrl, getAccessToken, onResult, accountId = null }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  onResult: ResultWindowAction;
  accountId?: string | null;
}) {
  const { jobs, history, error, refresh, cancel, dismiss } = useJobs(backendUrl, getAccessToken, accountId);
  const { presence } = usePresence(backendUrl, getAccessToken);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const peek = jobs.find((job) => job.jobId === openId);
  const open = Boolean(peek);
  const showList = showHistory || openId !== null && !peek;
  const [now, setNow] = useState(() => Date.now());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(new Set());
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const handled = useRef(new Set<string>());
  const deliveries = useRef(new Map<string, number>());
  const historyButton = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();
  const away = presence.status === 'ready' && presence.mode !== 'present';

  // A finished job opens its result (flying out of the chip) or parks it in the chip while Dan is away.
  useEffect(() => {
    for (const job of jobs) {
      if (handled.current.has(job.jobId) || deliveries.current.has(job.jobId) ||
          job.restored || job.status !== 'done' || job.kind === 'embedding') continue;
      if (job.viewId) {
        const viewId = job.viewId;
        const mode = away ? 'park' : 'open';
        let attempts = 0;
        const deliver = () => {
          attempts += 1;
          if (onResult(viewId, mode)) {
            deliveries.current.delete(job.jobId);
            handled.current.add(job.jobId);
            if (mode === 'open') {
              const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`) ?? null;
              window.requestAnimationFrame(() => flyFromChip(tab, viewId));
              dismiss(job.jobId);
            } else {
              setWaiting((current) => new Set(current).add(job.jobId));
            }
          } else if (attempts < 20) {
            deliveries.current.set(job.jobId, window.setTimeout(deliver, 300));
          } else {
            deliveries.current.delete(job.jobId);
            handled.current.add(job.jobId);
            setErrors((current) => ({ ...current, [job.jobId]: 'The saved result window is not available in this workspace.' }));
          }
        };
        deliveries.current.set(job.jobId, window.setTimeout(deliver, 0));
      }
    }
  }, [away, dismiss, jobs, onResult]);

  useEffect(() => {
    const timers = deliveries.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    for (const [id, timer] of deliveries.current) {
      if (jobs.some((job) => job.jobId === id)) continue;
      window.clearTimeout(timer);
      deliveries.current.delete(id);
    }
  }, [jobs]);

  useEffect(() => {
    if (!open && !showList) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpenId(null); setShowHistory(false); }
    };
    document.addEventListener('pointerdown', close);
    return () => { window.clearInterval(tick); document.removeEventListener('pointerdown', close); };
  }, [open, showList]);

  useEffect(() => {
    if (open || showList) popover.current?.focus();
  }, [openId, open, showList]);

  const visible = jobs.filter((job) => job.status === 'running' || job.status === 'done' && waiting.has(job.jobId));
  if (history.length === 0 && !error) return null;
  const failures = jobs.filter((job) => job.status === 'failed').length;
  const needsAttention = Boolean(error) || jobs.some((job) => Boolean(errors[job.jobId]));
  const historyLabel = needsAttention ? 'Background work · needs attention' : failures > 0 ? `Background work · ${failures} failed` : 'Background work';

  const closePopover = () => {
    setOpenId(null);
    setShowHistory(false);
    (returnFocus.current?.isConnected ? returnFocus.current : historyButton.current)?.focus();
  };

  const hide = (job: JobEntry) => {
    const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`);
    const next = tab?.nextElementSibling?.querySelector<HTMLButtonElement>('button') ??
      tab?.previousElementSibling?.querySelector<HTMLButtonElement>('button');
    dismiss(job.jobId);
    setOpenId(null);
    (next ?? historyButton.current)?.focus();
  };

  const openResult = (job: JobEntry) => {
    if (job.viewId && onResult(job.viewId, 'open')) {
      setErrors((current) => ({ ...current, [job.jobId]: '' }));
      const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`) ?? null;
      window.requestAnimationFrame(() => flyFromChip(tab, job.viewId!));
      dismiss(job.jobId);
      closePopover();
    } else {
      setErrors((current) => ({ ...current, [job.jobId]: 'The saved result window is not available in this workspace.' }));
    }
  };

  return (
    <div ref={root} className="job-tabs" onKeyDown={(event) => {
      if (event.key !== 'Escape' || (!open && !showList)) return;
      event.preventDefault();
      event.stopPropagation();
      closePopover();
    }}>
      <div className="job-tab-list">
        {visible.map((job) => {
          const label = job.status === 'running' ? `${jobLabel(job)} · ${job.step}/${job.steps}` : jobLabel(job);
          const status = job.status === 'running' ? 'running' : job.status === 'done' ? 'ready' : job.status === 'failed' ? 'failed' : 'cancelled';
          return (
            <span key={job.jobId} className="workspace-tab-item job-tab" data-job-id={job.jobId} data-tone={job.status} data-selected={openId === job.jobId}>
              <button className="workspace-tab" type="button" aria-expanded={openId === job.jobId} aria-controls={popoverId}
                aria-label={`${kindLabel[job.kind]} ${status}: ${label}. Show details`} title={label}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setShowHistory(false);
                  setNow(Date.now());
                  setOpenId((current) => current === job.jobId ? null : job.jobId);
                }}>
                {job.status === 'running' ? <ProgressRing value={job.step / Math.max(1, job.steps)} /> : <StatusMark status={job.status} />}
                <span>{label}</span>
              </button>
              <button type="button" className="workspace-tab-close" aria-label={`Hide ${jobLabel(job)} from header`}
                title="Hide from header without cancelling work" onClick={() => hide(job)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </span>
          );
        })}
      </div>
      <span className="workspace-tab-item job-history-tab" data-selected={showList || open}>
        <button ref={historyButton} type="button" className="workspace-tab" aria-label={`Show background work${needsAttention ? ': needs attention' : failures ? `: ${failures} failed` : ''}`}
          aria-expanded={showList || open} aria-controls={popoverId} onClick={(event) => {
            returnFocus.current = event.currentTarget;
            setOpenId(null);
            setShowHistory(!showList || open);
          }}>
          {(failures > 0 || needsAttention) && <StatusMark status="failed" />}
          <span>{historyLabel}</span>
        </button>
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {history.some((job) => job.status === 'running') ? `${history.filter((job) => job.status === 'running').length} background jobs running` : ''}
      </span>
      {(peek || showList) && (
        <div ref={popover} tabIndex={-1} id={popoverId} className="jobs-popover" role="group" aria-label={peek ? `${peek.title} details` : 'Background work'}>
          <div className="jobs-popover-heading">
            {peek ? <button type="button" className="jobs-action" onClick={() => { setOpenId(null); setShowHistory(true); }}>Background work</button> : <span>Background work</span>}
            <button type="button" className="workspace-tab-close" aria-label="Close job details" onClick={closePopover}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {error && <p className="jobs-item-error" role="alert">{error}</p>}
          {showList && !peek && <>
            <p className="jobs-history-note">Research, images, apps and indexing, separate from Factory tasks. Dismiss hides an entry on this device, not the work or saved record.</p>
            <button type="button" className="jobs-action" disabled={refreshing} onClick={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}>{refreshing ? 'Refreshing…' : 'Refresh work'}</button>
            {jobs.length === 0 && !error && <p className="jobs-history-note" role="status">No background work to show.</p>}
            <ul className="jobs-list">
              {jobs.map((job) => <li key={job.jobId} className="jobs-history-row">
                <button type="button" className="jobs-history-entry" title={`Run ${job.jobId}`} onClick={() => { setNow(Date.now()); setShowHistory(false); setOpenId(job.jobId); }}>
                  {job.status === 'running' ? <ProgressRing value={job.step / Math.max(1, job.steps)} /> : <StatusMark status={job.status} />}
                  <span><span className="jobs-item-title">{job.title}</span>{' '}
                    <span className="jobs-item-meta">{kindLabel[job.kind]} · {job.status} · {job.jobId.slice(0, 8)}</span>{' '}
                    <time className="jobs-item-meta" dateTime={job.startedAt}>{new Date(job.startedAt).toLocaleString()}</time>
                    {errors[job.jobId] && <span className="jobs-item-error">{errors[job.jobId]}</span>}
                  </span>
                </button>
                <button type="button" className="workspace-tab-close" aria-label={`Dismiss ${jobLabel(job)} from header`} onClick={() => {
                  dismiss(job.jobId);
                  popover.current?.focus();
                }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
              </li>)}
            </ul>
          </>}
          {peek && <>
          <div className="jobs-item" data-status={peek.status}>
            <span className="jobs-item-icon">{peek.status === 'running' ? <WorkingCore /> : <StatusMark status={peek.status} />}</span>
            <span className="jobs-item-body">
              <span className="jobs-item-title">{peek.title}</span>
              <span className="jobs-item-meta">Run {peek.jobId} · <time dateTime={peek.startedAt}>{new Date(peek.startedAt).toLocaleString()}</time></span>
              <span className="jobs-item-meta">
                {kindLabel[peek.kind]}
                {peek.status === 'running' ? ` · step ${peek.step} of ${peek.steps}` : peek.status === 'done' ? ' · ready' : peek.status === 'failed' ? ' · failed' : ' · cancelled'}
                {` · ${elapsed(peek.startedAt, peek.status === 'running' ? now : Date.parse(peek.updatedAt))}`}
              </span>
              {peek.detail && <span className="jobs-item-detail">{peek.detail}</span>}
              {peek.status === 'failed' && <span className="jobs-item-meta">This is a previous run, not a check of current indexing or service health.</span>}
              {peek.status === 'done' && waiting.has(peek.jobId) && <span className="jobs-item-detail">Waiting here while you are away.</span>}
              {errors[peek.jobId] && <span className="jobs-item-error" role="alert">{errors[peek.jobId]}</span>}
            </span>
            <span className="jobs-item-actions">
              {peek.status === 'running' && (
                <button type="button" className="jobs-action" disabled={cancelling.has(peek.jobId)} onClick={() => {
                  const id = peek.jobId;
                  setCancelling((current) => new Set(current).add(id));
                  void cancel(id).then((message) => setErrors((current) => ({ ...current, [id]: message }))).finally(() => {
                    setCancelling((current) => { const next = new Set(current); next.delete(id); return next; });
                  });
                }}>{cancelling.has(peek.jobId) ? 'Cancelling…' : 'Cancel'}</button>
              )}
              {peek.status === 'done' && peek.viewId && peek.kind !== 'embedding' && <button type="button" className="jobs-action jobs-action-primary" onClick={() => openResult(peek)}>Open</button>}
              {peek.status === 'failed' && (
                <button type="button" className="jobs-action" disabled aria-describedby={`${popoverId}-retry`}>Retry</button>
              )}
              {!peek.dismissed && <button type="button" className="jobs-action" onClick={() => { dismiss(peek.jobId); closePopover(); }}>{peek.status === 'running' ? 'Hide from header' : 'Dismiss'}</button>}
            </span>
          </div>
          {peek.status === 'failed' && <p id={`${popoverId}-retry`} className="jobs-history-note">
            {peek.kind === 'embedding'
              ? 'No supported indexing retry action is available here. Check Status for current health; this interrupted or failed run remains in history.'
              : peek.kind === 'research'
                ? `Header retry is unavailable. Ask Jarvis to check job ${peek.jobId} for saved research retry availability. Nothing has been restarted.`
                : 'No supported retry action is available here. Start a new request if needed; this failure remains in history.'}
          </p>}
          </>}
        </div>
      )}
    </div>
  );
}
