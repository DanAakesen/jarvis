import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { BackgroundJob } from '@jarvis/contracts';
import { useConversationIntents } from './conversation-intents';
import { usePresence } from './presence-store';
import { useJobs, type JobEntry } from './jobs-store';
import { WorkingCore } from './ToolCallChip';

/** Opens (or just reveals) a job's result window; returns false while the window does not exist yet. */
export type ResultWindowAction = (viewId: string, mode: 'open' | 'park') => boolean;

const kindLabel: Record<BackgroundJob['kind'], string> = { research: 'Research', image: 'Image', html_app: 'App' };

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

/**
 * The jobs chip in the top bar (P8-43): running background work as a progress ring with its title, a peek with the
 * current step, elapsed time and Cancel, a pulse and fly-out when the result is ready (or the result waits in the chip
 * while Dan is away), and an amber state with Retry when it fails.
 */
export function JobsChip({ backendUrl, getAccessToken, onResult }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  onResult: ResultWindowAction;
}) {
  const { jobs, cancel, dismiss } = useJobs(backendUrl, getAccessToken);
  const { presence } = usePresence(backendUrl, getAccessToken);
  const intents = useConversationIntents();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId !== null;
  const [now, setNow] = useState(() => Date.now());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const handled = useRef(new Set<string>());
  const popoverId = useId();
  const away = presence.status === 'ready' && presence.mode !== 'present';

  // A finished job opens its result (flying out of the chip) or parks it in the chip while Dan is away.
  useEffect(() => {
    const timers: number[] = [];
    for (const job of jobs) {
      if (handled.current.has(job.jobId) || job.status === 'running') continue;
      handled.current.add(job.jobId);
      if (job.status === 'cancelled') {
        timers.push(window.setTimeout(() => dismiss(job.jobId), 4000));
      } else if (job.status === 'done' && job.viewId) {
        const viewId = job.viewId;
        const mode = away ? 'park' : 'open';
        let attempts = 0;
        const deliver = () => {
          attempts += 1;
          if (onResult(viewId, mode)) {
            if (mode === 'open') {
              const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`) ?? null;
              window.requestAnimationFrame(() => flyFromChip(tab, viewId));
              // The job's tab hands over to its result window's tab.
              timers.push(window.setTimeout(() => dismiss(job.jobId), 900));
            } else {
              setWaiting((current) => new Set(current).add(job.jobId));
            }
          } else if (attempts < 20) {
            timers.push(window.setTimeout(deliver, 300));
          }
        };
        timers.push(window.setTimeout(deliver, 0));
      }
    }
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [away, dismiss, jobs, onResult]);

  useEffect(() => {
    if (!open) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpenId(null); };
    document.addEventListener('pointerdown', close);
    return () => { window.clearInterval(tick); document.removeEventListener('pointerdown', close); };
  }, [open]);

  const visible = jobs.filter((job) => job.status !== 'done' || waiting.has(job.jobId));
  if (visible.length === 0) return null;
  const peek = jobs.find((job) => job.jobId === openId);

  const openResult = (job: JobEntry) => {
    if (job.viewId && onResult(job.viewId, 'open')) {
      const tab = root.current?.querySelector<HTMLElement>(`[data-job-id="${job.jobId}"]`) ?? null;
      window.requestAnimationFrame(() => flyFromChip(tab, job.viewId!));
      dismiss(job.jobId);
      setOpenId(null);
    }
  };

  return (
    <div ref={root} className="job-tabs" onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      const id = openId;
      setOpenId(null);
      root.current?.querySelector<HTMLElement>(`[data-job-id="${id}"] .workspace-tab`)?.focus();
    }}>
      {visible.map((job) => {
        const label = job.status === 'running' ? `${job.title} · ${job.step}/${job.steps}` : job.title;
        const status = job.status === 'running' ? 'running' : job.status === 'done' ? 'ready' : job.status === 'failed' ? 'failed' : 'cancelled';
        return (
          <span key={job.jobId} className="workspace-tab-item job-tab" data-job-id={job.jobId} data-tone={job.status}>
            <button className="workspace-tab" type="button" aria-expanded={openId === job.jobId} aria-controls={popoverId}
              aria-label={`${kindLabel[job.kind]} ${status}: ${label}. Show details`} title={label}
              onClick={() => { setNow(Date.now()); setOpenId((current) => current === job.jobId ? null : job.jobId); }}>
              {job.status === 'running' ? <ProgressRing value={job.step / Math.max(1, job.steps)} /> : <StatusMark status={job.status} />}
              <span>{label}</span>
            </button>
          </span>
        );
      })}
      <span className="visually-hidden" role="status" aria-live="polite">
        {visible.some((job) => job.status === 'running') ? `${visible.filter((job) => job.status === 'running').length} background job running` : ''}
      </span>
      {peek && (
        <div id={popoverId} className="jobs-popover luminous-glass" role="group" aria-label={`${peek.title} details`}>
          <div className="jobs-item" data-status={peek.status}>
            <span className="jobs-item-icon">{peek.status === 'running' ? <WorkingCore /> : <StatusMark status={peek.status} />}</span>
            <span className="jobs-item-body">
              <span className="jobs-item-title">{peek.title}</span>
              <span className="jobs-item-meta">
                {kindLabel[peek.kind]}
                {peek.status === 'running' ? ` · step ${peek.step} of ${peek.steps}` : peek.status === 'done' ? ' · ready' : peek.status === 'failed' ? ' · failed' : ' · cancelled'}
                {` · ${elapsed(peek.startedAt, peek.status === 'running' ? now : Date.parse(peek.updatedAt))}`}
              </span>
              {peek.detail && <span className="jobs-item-detail">{peek.detail}</span>}
              {peek.status === 'done' && waiting.has(peek.jobId) && <span className="jobs-item-detail">Waiting here while you are away.</span>}
              {errors[peek.jobId] && <span className="jobs-item-error" role="alert">{errors[peek.jobId]}</span>}
            </span>
            <span className="jobs-item-actions">
              {peek.status === 'running' && (
                <button type="button" className="jobs-action" onClick={() => {
                  void cancel(peek.jobId).then((message) => setErrors((current) => ({ ...current, [peek.jobId]: message })));
                }}>Cancel</button>
              )}
              {peek.status === 'done' && peek.viewId && <button type="button" className="jobs-action jobs-action-primary" onClick={() => openResult(peek)}>Open</button>}
              {peek.status === 'failed' && (
                <button type="button" className="jobs-action jobs-action-primary" onClick={() => {
                  intents.sendMessage(`Please try that ${kindLabel[peek.kind].toLowerCase()} again: ${peek.title}`);
                  dismiss(peek.jobId);
                  setOpenId(null);
                }}>Retry</button>
              )}
              {peek.status !== 'running' && <button type="button" className="jobs-action" onClick={() => { dismiss(peek.jobId); setOpenId(null); }}>Dismiss</button>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
