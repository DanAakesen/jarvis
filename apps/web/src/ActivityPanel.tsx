import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GeneratedView } from '@jarvis/contracts';
import {
  activityCategories,
  activityHref,
  agentNames,
  formatDuration,
  formatTime,
  type BrowserConfirmation,
  type ConfirmationActionKind,
  type ActivityItem,
  type NowFeed,
  type NowFeedStreamStatus,
} from './activity';
import { GeneratedViewRenderer } from './GeneratedViewRenderer';
import { Loader } from './Loader';
import { CollapsibleSection } from './CollapsibleSection';

function confirmationLabel(kind: ConfirmationActionKind): string {
  const words = kind.replaceAll('_', ' ');
  return `${words[0]!.toUpperCase()}${words.slice(1)}`;
}

function BrowserConfirmationList({
  confirmations,
  message,
  onResolve,
  onMessage,
}: {
  confirmations: readonly BrowserConfirmation[];
  message: string;
  onResolve?: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  async function resolve(confirmation: BrowserConfirmation, decision: 'approve' | 'reject') {
    if (!onResolve || pending.has(confirmation.id)) return;
    setPending((current) => new Set(current).add(confirmation.id));
    setFailed((current) => without(current, confirmation.id));
    onMessage('');
    try {
      await onResolve(confirmation.id, decision);
      onMessage(decision === 'approve' ? 'Approval recorded.' : 'Request rejected.');
    } catch {
      setFailed((current) => new Set(current).add(confirmation.id));
    } finally {
      setPending((current) => without(current, confirmation.id));
    }
  }

  if (confirmations.length === 0) return message ? <p role="status">{message}</p> : null;
  return (
    <section aria-labelledby="now-confirmations-heading">
      <h3 id="now-confirmations-heading">Pending confirmations</h3>
      <p>Review each request before it expires.</p>
      {message && <p role="status">{message}</p>}
      {!onResolve && <p id="confirmation-unavailable">Browser approvals are unavailable.</p>}
      <ul className="activity-list">
        {confirmations.map((confirmation) => {
          const busy = pending.has(confirmation.id);
          return (
            <li key={confirmation.id} className="activity-item">
              <div>
                <h4>{confirmationLabel(confirmation.actionKind)}</h4>
                <p className="confirmation-summary">{confirmation.summary}</p>
                <p className="activity-time">
                  Expires <time dateTime={confirmation.expiresAt}>{formatTime(confirmation.expiresAt)}</time>
                </p>
                {failed.has(confirmation.id) && (
                  <p className="error-text" role="alert">Jarvis could not record your response. Try again.</p>
                )}
              </div>
              <div className="action-row">
                <button
                  className="primary-button"
                  type="button"
                  aria-label={`Approve ${confirmationLabel(confirmation.actionKind)}`}
                  aria-describedby={onResolve ? undefined : 'confirmation-unavailable'}
                  disabled={!onResolve || busy}
                  onClick={() => { void resolve(confirmation, 'approve'); }}
                >
                  {busy ? 'Sending…' : 'Approve'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  aria-label={`Reject ${confirmationLabel(confirmation.actionKind)}`}
                  aria-describedby={onResolve ? undefined : 'confirmation-unavailable'}
                  disabled={!onResolve || busy}
                  onClick={() => { void resolve(confirmation, 'reject'); }}
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function without<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

export function ActivityPanel({ feed, onDismiss, onResolveConfirmation, onRetry, streamStatus }: {
  feed: NowFeed;
  onDismiss?: (id: string) => Promise<void>;
  onResolveConfirmation?: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onRetry?: () => void;
  streamStatus?: NowFeedStreamStatus;
}) {
  const ready = feed.status === 'ready';
  const now = useNow(ready && feed.running.length > 0);
  const heading = useRef<HTMLButtonElement>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const runningTasksView: Extract<GeneratedView, { renderer: 'list' }> | null = feed.status === 'ready' ? {
    version: 1,
    title: 'Running tasks',
    renderer: 'list',
    source: { id: 'now', status: 'complete', updatedAt: feed.updatedAt },
    data: {
      items: feed.running.map((task) => ({
        title: task.title,
        action: { type: 'open-route', route: `/factory/tasks/${task.id}` },
        details: [
          { label: 'Project', value: task.project },
          { label: 'Agent', value: agentNames[task.agent] },
          { label: 'Activity', value: task.activity },
          { label: 'Duration', value: formatDuration(task.startedAt, now) },
        ],
      })),
    },
  } : null;
  const [confirmationMessage, setConfirmationMessage] = useState('');

  async function dismiss(item: ActivityItem) {
    if (!onDismiss || pending.has(item.id)) return;
    setPending((current) => new Set(current).add(item.id));
    setFailed((current) => without(current, item.id));
    try {
      await onDismiss(item.id);
      setDismissed((current) => new Set(current).add(item.id));
      heading.current?.focus();
    } catch {
      setFailed((current) => new Set(current).add(item.id));
    } finally {
      setPending((current) => without(current, item.id));
    }
  }

  return (
    <CollapsibleSection storageKey="settings.now" className="panel now-panel" headingId="now-heading" title="Now" toggleRef={heading}>
      {feed.status === 'loading' ? <Loader variant="rows" label="Loading current activity…" /> : feed.status === 'unavailable' ? (
        <>
          <p>{feed.message}</p>
          {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Retry</button>}
        </>
      ) : (
        <>
          <p className="freshness">Updated <time dateTime={feed.updatedAt}>{formatTime(feed.updatedAt)}</time></p>
          <p className="freshness" role="status">{feed.awayMode ? 'Away' : 'Present'}</p>
          {streamStatus === 'connected' && <p className="freshness" role="status">Live updates connected.</p>}
          {streamStatus === 'reconnecting' && (
            <p className="freshness" role="status">Live updates are reconnecting; showing the last feed snapshot.</p>
          )}
          {streamStatus === 'unavailable' && (
            <>
              <p className="freshness" role="status">Live updates are unavailable; reconnect to check for changes.</p>
              {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Reconnect</button>}
            </>
          )}
          {!onDismiss && <p id="dismiss-status" className="freshness">Dismiss unavailable.</p>}

          <BrowserConfirmationList
            confirmations={feed.confirmations}
            message={confirmationMessage}
            onMessage={setConfirmationMessage}
            {...(onResolveConfirmation ? { onResolve: onResolveConfirmation } : {})}
          />

          <section aria-labelledby="now-running-heading">
            <h3 id="now-running-heading">Running tasks</h3>
            {feed.running.length === 0 ? <p>No tasks are running.</p> : (
              runningTasksView && <GeneratedViewRenderer view={runningTasksView} className="activity-list" />
            )}
          </section>

          {activityCategories.map((category) => {
            const items = feed.items.filter((item) => item.category === category.id && !dismissed.has(item.id));
            return (
              <section key={category.id} aria-labelledby={`now-${category.id}-heading`}>
                <h3 id={`now-${category.id}-heading`}>{category.heading}</h3>
                {items.length === 0 ? <p>{category.empty}</p> : (
                  <ul className="activity-list">
                    {items.map((item) => {
                      const href = activityHref(item.link);
                      const busy = pending.has(item.id);
                      return (
                        <li key={item.id} className="activity-item">
                          <div>
                            {href
                              ? <Link className="activity-title" to={href}>{item.title}</Link>
                              : <span className="activity-title">{item.title}</span>}
                            <p className="activity-time"><time dateTime={item.at}>{formatTime(item.at)}</time></p>
                            {failed.has(item.id) && (
                              <p className="error-text" role="alert">Jarvis could not dismiss this item. Try again.</p>
                            )}
                          </div>
                          <button
                            className="secondary-button"
                            type="button"
                            aria-label={`${busy ? 'Dismissing' : 'Dismiss'} ${item.title}`}
                            aria-describedby={onDismiss ? undefined : 'dismiss-status'}
                            disabled={!onDismiss || busy}
                            onClick={() => { void dismiss(item); }}
                          >
                            {busy ? 'Dismissing…' : 'Dismiss'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </CollapsibleSection>
  );
}
