import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  activityCategories,
  activityHref,
  agentNames,
  formatDuration,
  formatTime,
  type ActivityItem,
  type NowFeed,
} from './activity';

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

export function ActivityPanel({ feed, onDismiss }: {
  feed: NowFeed;
  onDismiss?: (id: number) => Promise<void>;
}) {
  const ready = feed.status === 'ready';
  const now = useNow(ready && feed.running.length > 0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());

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
    <section className="panel" aria-labelledby="now-heading">
      <h2 id="now-heading" ref={heading} tabIndex={-1}>Now</h2>
      {feed.status === 'unavailable' ? <p>{feed.message}</p> : (
        <>
          <p className="freshness">Updated <time dateTime={feed.updatedAt}>{formatTime(feed.updatedAt)}</time></p>
          {!onDismiss && <p id="dismiss-status" className="freshness">Dismissing isn&apos;t available yet.</p>}

          <section aria-labelledby="now-running-heading">
            <h3 id="now-running-heading">Running tasks</h3>
            {feed.running.length === 0 ? <p>No tasks are running.</p> : (
              <ul className="activity-list">
                {feed.running.map((task) => (
                  <li key={task.id}>
                    <Link className="activity-title" to={`/factory/tasks/${task.id}`}>{task.title}</Link>
                    <dl className="activity-meta">
                      <dt>Project</dt><dd>{task.project}</dd>
                      <dt>Agent</dt><dd>{agentNames[task.agent]}</dd>
                      <dt>Activity</dt><dd>{task.activity}</dd>
                      <dt>Duration</dt><dd>{formatDuration(task.startedAt, now)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
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
    </section>
  );
}
