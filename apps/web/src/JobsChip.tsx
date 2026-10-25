import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { BackgroundJob } from '@jarvis/contracts';
import { usePresence } from './presence-store';
import { useJobs, type JobEntry } from './jobs-store';
import { WorkingCore } from './ToolCallChip';
import { ShellIcon } from './ShellIcon';
import { AttentionPopover } from './AttentionPopover';
import type { FeedAttention } from './activity';
import { formatDateTime } from './format/date-time';
import { returnFocusAfterOutsidePress } from './overlay-focus';
import { useOverlayMotion } from './overlay-motion';

/** Opens (or just reveals) a job's result window; returns false while the window does not exist yet. */
export type ResultWindowAction = (viewId: string, mode: 'open' | 'park') => boolean;

const kindLabel: Record<BackgroundJob['kind'], string> = { research: 'Research', image: 'Image', html_app: 'App', embedding: 'Memory re-embed', proactive: 'Proactive check' };

function interrupted(job: JobEntry) {
  return job.status === 'failed' && (job.detail === 'interrupted by restart' || job.detail === 'Interrupted by a backend restart');
}

function reason(job: JobEntry) {
  return interrupted(job) ? 'Interrupted by a restart' : job.detail;
}

function groupJobs(jobs: readonly JobEntry[]) {
  const groups = new Map<string, JobEntry[]>();
  for (const job of jobs) {
    // Embedding view IDs are backfill markers, not result windows with an Open action.
    const hasResult = Boolean(job.viewId) && job.kind !== 'embedding';
    const key = job.status === 'running' || hasResult ? job.jobId : JSON.stringify([job.kind, job.status, reason(job) ?? '']);
    const group = groups.get(key);
    if (group) group.push(job);
    else groups.set(key, [job]);
  }
  return [...groups.values()];
}

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

export function JobsChip({ backendUrl, getAccessToken, onResult, accountId = null, attention = null, proactiveEnabled = false }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  onResult: ResultWindowAction;
  accountId?: string | null;
  attention?: FeedAttention | null;
  proactiveEnabled?: boolean;
}) {
  const { jobs, error, refresh, cancel, openResult: openSavedResult, dismiss, dismissMany, dismissing, syncingDismissals, headerHiddenJobIds } = useJobs(backendUrl, getAccessToken, accountId);
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
  const [opening, setOpening] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const headerScope = JSON.stringify([backendUrl, accountId]);
  const [hiddenRunning, setHiddenRunning] = useState<{ scope: string; ids: ReadonlySet<string> }>({ scope: headerScope, ids: new Set() });
  const root = useRef<HTMLDivElement>(null);
  const handled = useRef(new Set<string>());
  const deliveries = useRef(new Map<string, number>());
  const historyButton = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const popoverRef = useOverlayMotion(popover, 'menu');
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();
  const away = presence.status === 'ready' && presence.mode !== 'present';

  // A finished job opens its result (flying out of the chip) or parks it in the chip while Dan is away.
  useEffect(() => {
    for (const job of jobs) {
      if (handled.current.has(job.jobId) || deliveries.current.has(job.jobId) ||
          job.restored || job.status !== 'done' || job.kind === 'embedding' ||
          job.resultId && job.resultDelivery !== 'delivered') continue;
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
              void dismiss(job.jobId);
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
      if (!root.current?.contains(event.target as Node)) {
        if (root.current?.contains(document.activeElement)) returnFocusAfterOutsidePress(returnFocus.current?.isConnected ? returnFocus.current : historyButton.current);
        setOpenId(null);
        setShowHistory(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => { window.clearInterval(tick); document.removeEventListener('pointerdown', close); };
  }, [open, showList]);

  useEffect(() => {
    if (open || showList) popover.current?.focus();
  }, [openId, open, showList]);

  const visible = jobs.filter((job) => !(job.status === 'running' && (headerHiddenJobIds.has(job.jobId) || hiddenRunning.scope === headerScope && hiddenRunning.ids.has(job.jobId))) &&
    (job.status === 'running' || job.status === 'done' && waiting.has(job.jobId)));
  const groups = groupJobs(jobs);
  const peekGroup = peek ? groups.find((group) => group.some((job) => job.jobId === peek.jobId)) ?? [peek] : [];
  const outcomes = (['running', 'done', 'failed'] as const).map((status) => ({
    status, count: jobs.filter((job) => job.status === status && !interrupted(job)).length,
  })).filter(({ count }) => count > 0);
  const failures = outcomes.find(({ status }) => status === 'failed')?.count ?? 0;
  const needsAttention = Boolean(error) || jobs.some((job) => Boolean(errors[job.jobId]));
  const summary = outcomes.map(({ status, count }) => `${count} ${status} background ${count === 1 ? 'job' : 'jobs'}`).join(', ');
  const attentionCount = (attention?.items.length ?? 0) + (attention?.confirmations.length ?? 0);
  const hasHistory = jobs.length > 0;

  const closePopover = () => {
    setOpenId(null);
    setShowHistory(false);
    const target = returnFocus.current?.isConnected ? returnFocus.current
      : historyButton.current ?? root.current?.querySelector<HTMLButtonElement>('.attention-summary') ??
        document.querySelector<HTMLButtonElement>('.presence-chip-trigger') ??
        document.querySelector<HTMLAnchorElement>('.settings-link');
    target?.focus();
  };

  const hide = (job: JobEntry) => {
    const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`);
    const next = tab?.nextElementSibling?.querySelector<HTMLButtonElement>('button') ??
      tab?.previousElementSibling?.querySelector<HTMLButtonElement>('button');
    if (job.status === 'running') setHiddenRunning((current) => ({
      scope: headerScope, ids: new Set(current.scope === headerScope ? current.ids : []).add(job.jobId),
    }));
    else void dismiss(job.jobId);
    setOpenId(null);
    (next ?? historyButton.current ?? root.current?.querySelector<HTMLButtonElement>('.attention-summary') ??
      document.querySelector<HTMLButtonElement>('.presence-chip-trigger') ??
      document.querySelector<HTMLAnchorElement>('.settings-link'))?.focus();
  };

  const openResult = (job: JobEntry) => {
    if (job.resultId) {
      const id = job.jobId;
      setOpening((current) => new Set(current).add(id));
      void openSavedResult(id).then((message) => {
        if (message) {
          setErrors((current) => ({ ...current, [id]: message }));
          return;
        }
        setErrors((current) => ({ ...current, [id]: '' }));
        void dismiss(id);
        closePopover();
      }).finally(() => {
        setOpening((current) => { const next = new Set(current); next.delete(id); return next; });
      });
      return;
    }
    if (job.viewId && onResult(job.viewId, 'open')) {
      setErrors((current) => ({ ...current, [job.jobId]: '' }));
      const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`) ?? null;
      window.requestAnimationFrame(() => flyFromChip(tab, job.viewId!));
      void dismiss(job.jobId);
      closePopover();
    } else {
      setErrors((current) => ({ ...current, [job.jobId]: 'The saved result window is not available in this workspace.' }));
    }
  };

  return (
    <div ref={root} className="job-tabs" hidden={!hasHistory && !needsAttention && attentionCount === 0 && !syncingDismissals && !open && !showList} onKeyDown={(event) => {
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
      {(hasHistory || needsAttention || syncingDismissals) && <span className="workspace-tab-item job-history-tab" data-selected={showList || open}>
        <button ref={historyButton} type="button" className="workspace-tab jobs-summary" aria-label={`Show background work${needsAttention ? ': needs attention' : failures ? `: ${failures} failed` : ''}`}
          aria-description={summary || (needsAttention ? 'Needs attention' : undefined)}
          title={`Background work${needsAttention ? ': needs attention' : ''}${summary ? `: ${summary}` : ''}`}
          aria-expanded={showList || open} aria-controls={popoverId} onClick={(event) => {
            returnFocus.current = event.currentTarget;
            setOpenId(null);
            setShowHistory(!showList || open);
          }}>
          {outcomes.map(({ status, count }) => {
            const label = `${count} ${status} background ${count === 1 ? 'job' : 'jobs'}`;
            return <span key={status} className="jobs-outcome" data-status={status} role="img" aria-label={label} title={label}>
              <ShellIcon name={status} /><span aria-hidden="true">{count}</span>
            </span>;
          })}
          {(hasHistory || syncingDismissals) && outcomes.length === 0 && <span className="jobs-outcome" data-status="idle" role="img" aria-label={hasHistory ? 'Background work history available' : 'Background work dismissals syncing'} title={hasHistory ? 'Background work history available' : 'Background work dismissals syncing'}><ShellIcon name="idle" /></span>}
        </button>
      </span>}
      <AttentionPopover attention={attention} />
      <span className="visually-hidden" role="status" aria-live="polite">
        {jobs.some((job) => job.status === 'running') ? `${jobs.filter((job) => job.status === 'running').length} background jobs running` : ''}
      </span>
      {(peek || showList) && (
        <div ref={popoverRef} tabIndex={-1} id={popoverId} className="jobs-popover" role="group" aria-label={peek ? `${peek.title} details` : 'Background work'}>
          <div className="jobs-popover-heading">
            {peek ? <button type="button" className="jobs-action" onClick={() => { setOpenId(null); setShowHistory(true); }}>Background work</button> : <span>Background work</span>}
            <button type="button" className="workspace-tab-close" aria-label="Close job details" onClick={closePopover}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {error && <p className="jobs-item-error" role="alert">{error}</p>}
          {showList && !peek && <>
            <p className="jobs-history-note">Research, images, apps and memory re-embedding, separate from Factory tasks. Dismiss syncs across your devices; it does not delete saved records or results.</p>
            <div className="jobs-history-actions">
             <button type="button" className="jobs-action" disabled={refreshing} onClick={() => {
               setRefreshing(true);
               void refresh().finally(() => setRefreshing(false));
             }}>{refreshing ? 'Refreshing…' : 'Refresh work'}</button>
             <button type="button" className="jobs-action" disabled={dismissing || !jobs.some((job) => job.status !== 'running')} onClick={() => {
               void dismissMany().then(() => popover.current?.focus());
             }}>{dismissing ? 'Dismissing…' : 'Dismiss all finished'}</button>
            </div>
            {syncingDismissals && <p className="jobs-history-note" role="status">Syncing saved dismissals…</p>}
            {jobs.length === 0 && !error && !syncingDismissals && <p className="jobs-history-note" role="status">No background work to show.</p>}
            <ul className="jobs-list">
              {groups.map((group) => {
                const job = group[0]!;
                return <li key={job.jobId} className="jobs-history-row">
                <button type="button" className="jobs-history-entry" title={`Run ${job.jobId}`} onClick={() => { setNow(Date.now()); setShowHistory(false); setOpenId(job.jobId); }}>
                  {job.status === 'running' ? <ProgressRing value={job.step / Math.max(1, job.steps)} /> : <StatusMark status={interrupted(job) ? 'cancelled' : job.status} />}
                  <span><span className="jobs-item-title">{job.title}{group.length > 1 ? ` · ${group.length} runs` : ''}</span>{' '}
                    <span className="jobs-item-meta">{kindLabel[job.kind]} · {interrupted(job) ? 'interrupted' : job.status} · {job.jobId.slice(0, 8)}</span>{' '}
                    <span className="jobs-item-meta">Started <time dateTime={job.startedAt}>{formatDateTime(job.startedAt)}</time>{group.length > 1 ? ' · latest run' : ''}</span>
                    {reason(job) && <span className="jobs-item-detail">{reason(job)}</span>}
                    {errors[job.jobId] && <span className="jobs-item-error">{errors[job.jobId]}</span>}
                  </span>
                </button>
                {job.status !== 'running' && <button type="button" className="workspace-tab-close" disabled={dismissing}
                  aria-label={group.length > 1 ? `Dismiss ${group.length} ${kindLabel[job.kind]} runs` : `Dismiss ${jobLabel(job)} from header`} onClick={() => {
                  void dismissMany(group.map(({ jobId }) => jobId)).then(() => popover.current?.focus());
                }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
              </li>;
              })}
            </ul>
          </>}
          {peek && <>
          <div className="jobs-item" data-status={interrupted(peek) ? 'interrupted' : peek.status}>
            <span className="jobs-item-icon">{peek.status === 'running' ? <WorkingCore /> : <StatusMark status={interrupted(peek) ? 'cancelled' : peek.status} />}</span>
            <span className="jobs-item-body">
              <span className="jobs-item-title">{peek.title}{peekGroup.length > 1 ? ` · ${peekGroup.length} runs` : ''}</span>
              <span className="jobs-item-meta">Run {peek.jobId} · Started <time dateTime={peek.startedAt}>{formatDateTime(peek.startedAt)}</time></span>
              <span className="jobs-item-meta">
                {kindLabel[peek.kind]}
                {peek.status === 'running' ? ` · step ${peek.step} of ${peek.steps}` : peek.status === 'done' ? ' · ready' : interrupted(peek) ? ' · interrupted' : peek.status === 'failed' ? ' · failed' : ' · cancelled'}
                {` · ${elapsed(peek.startedAt, peek.status === 'running' ? now : Date.parse(peek.updatedAt))}`}
              </span>
              {reason(peek) && <span className="jobs-item-detail">{reason(peek)}</span>}
              {peek.resultId && peek.resultDelivery !== 'delivered' && <span className="jobs-item-detail">
                {peek.resultDelivery === 'pending' ? 'Report saved. Workspace delivery is pending.'
                  : peek.resultDelivery === 'unknown' ? 'Report saved. Workspace delivery is unconfirmed.'
                    : 'Report saved. Workspace delivery failed.'}
              </span>}
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
              {peek.status === 'done' && peek.resultId && <button type="button" className="jobs-action jobs-action-primary"
                disabled={opening.has(peek.jobId)} aria-busy={opening.has(peek.jobId)}
                onClick={() => openResult(peek)}>{opening.has(peek.jobId) ? 'Opening…' : 'Open report'}</button>}
              {peek.status === 'done' && !peek.resultId && peek.viewId && peek.kind !== 'embedding' &&
                <button type="button" className="jobs-action jobs-action-primary" onClick={() => openResult(peek)}>Open</button>}
              {proactiveEnabled && peek.kind === 'proactive' &&
                (peek.status === 'done' || peek.status === 'failed' || peek.status === 'cancelled') &&
                <Link className="jobs-action jobs-action-primary" to="/proactive" onClick={closePopover}>Open</Link>}
              {peek.status === 'failed' && (
                <button type="button" className="jobs-action" disabled aria-describedby={`${popoverId}-retry`}>Retry</button>
              )}
              {peek.status === 'running'
                ? <button type="button" className="jobs-action" onClick={() => hide(peek)}>Hide from header</button>
                : <button type="button" className="jobs-action" disabled={dismissing} onClick={() => {
                  void dismissMany(peekGroup.map(({ jobId }) => jobId)).then((message) => { if (!message) closePopover(); });
                }}>{dismissing ? 'Dismissing…' : peekGroup.length > 1 ? `Dismiss ${peekGroup.length} runs` : 'Dismiss'}</button>}
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
