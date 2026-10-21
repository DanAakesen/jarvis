import { useEffect, useId, useRef, useState } from 'react';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { DailyReadError, requestJson } from '../../../client';
import { useDailyQuery } from '../../../useDailyQuery';
import type { DailySectionProps } from '../../types';
import { feedSource, record, waitingRows, type WaitingRow } from './data';
import { FeedMessage, FeedState } from './FeedState';

type Props = Pick<DailySectionProps, 'backendUrl' | 'getAccessToken' | 'sources' | 'refreshVersion'>;
const lists = [
  { bucket: 'waiting_for_you', title: 'Waiting for you' },
  { bucket: 'waiting_on_others', title: 'Waiting on others' },
] as const;

export function WaitingLists(props: Props) {
  const enabled = props.sources.includes(sources.attention);
  const read = useDailyQuery(props.backendUrl, props.getAccessToken, enabled ? { source: sources.attention } : null, props.refreshVersion);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, { revision: string; hidden: boolean }>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const action = useRef<AbortController | null>(null);
  const focusTarget = useRef<string | null>(null);
  const prefix = useId();
  useEffect(() => () => { action.current?.abort(); }, [props.backendUrl, props.getAccessToken, enabled]);

  let rows: WaitingRow[] = [];
  let invalid = false;
  let disconnected = false;
  if (read.data) {
    try {
      const feed = feedSource(read.data, 'Gmail');
      disconnected = feed.status === 'Missing' || feed.capturedAt === null;
      rows = waitingRows(read.data).map(row => ({
        ...row, hidden: overrides[row.suppressionKey]?.revision === read.data!.revision
          ? overrides[row.suppressionKey]!.hidden : row.hidden,
      }));
    } catch { invalid = true; }
  }
  const hiddenRows = rows.filter(row => row.hidden);
  const changeVisibility = async (row: WaitingRow, hidden: boolean) => {
    if (action.current || !enabled || !read.data) return;
    const revision = read.data.revision;
    const controller = new AbortController();
    action.current = controller;
    setPending(row.suppressionKey); setActionError(null);
    try {
      const response = await requestJson(props.backendUrl, `/daily/feeds/${hidden ? 'hide' : 'restore'}`,
        props.getAccessToken, controller.signal,
        hidden ? { id: row.id } : { type: 'thread', key: row.suppressionKey });
      if (!record(response) || (response.status !== (hidden ? 'hidden' : 'restored') && response.status !== 'unchanged')) {
        throw new Error('Invalid action response');
      }
      if (!controller.signal.aborted) {
        focusTarget.current = `${hidden ? 'undo' : 'expand'}:${row.suppressionKey}`;
        setOverrides(previous => ({ ...previous, [row.suppressionKey]: { revision, hidden } }));
        read.reload();
      }
    } catch (error) {
      if (!controller.signal.aborted) setActionError(error instanceof DailyReadError ? error.message :
        `Could not ${hidden ? 'hide' : 'restore'} this thread. Try again.`);
    } finally {
      if (action.current === controller) action.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  };

  if (!enabled) return <section className="attention-card attention-waiting-unavailable" aria-label="Waiting lists">
    <h3>Waiting lists</h3><p role="status">Gmail waiting lists unavailable. This source is not offered by the backend.</p>
  </section>;

  return <div className="attention-waiting">
    {lists.map(list => {
      const visible = rows.filter(row => row.bucket === list.bucket && !row.hidden);
      return <section key={list.bucket} className="attention-card attention-list" aria-labelledby={`${prefix}-${list.bucket}`} aria-busy={read.pending}>
        <header className="attention-heading"><h3 id={`${prefix}-${list.bucket}`}>{list.title}</h3>
          <span className="attention-chip" aria-label={`${visible.length} threads`}>{read.data && !invalid && !disconnected ? visible.length : '—'}</span></header>
        <div className="attention-scroll" tabIndex={0} role="region" aria-label={`${list.title} threads`}>
          {!read.data || invalid || disconnected
            ? <FeedMessage pending={read.pending} error={invalid ? 'Incomplete feed evidence.' : read.error} retry={read.reload} noun="Gmail" />
            : <>
              {read.error && <FeedMessage pending={false} error={read.error} retry={read.reload} noun="Gmail" />}
              {!visible.length ? <p className="attention-empty">Nothing waiting here.</p> : <ul className="attention-threads">
                {visible.map((row, index) => {
                  const detailId = `${prefix}-${list.bucket}-${index}`;
                  const open = expanded.has(row.suppressionKey);
                  return <li key={row.suppressionKey} className="attention-thread">
                    <div className="attention-thread-heading">
                      <button type="button" className="ghost-button attention-expand" aria-expanded={open} aria-controls={detailId}
                        ref={element => {
                          if (element && focusTarget.current === `expand:${row.suppressionKey}`) {
                            element.focus(); focusTarget.current = null;
                          }
                        }}
                        onClick={() => setExpanded(previous => {
                          const next = new Set(previous);
                          if (next.has(row.suppressionKey)) next.delete(row.suppressionKey); else next.add(row.suppressionKey);
                          return next;
                        })}><span aria-hidden="true">{open ? '⌄' : '›'}</span><span>{row.title}</span></button>
                      <span className="attention-chip">{row.ageBusinessDays} business {row.ageBusinessDays === 1 ? 'day' : 'days'}</span>
                    </div>
                    {open && <div id={detailId} className="attention-detail">{row.sender && <p>{row.sender}</p>}<p>{row.detail}</p></div>}
                    <button type="button" className="ghost-button attention-hide" disabled={pending !== null}
                      aria-label={`Hide ${row.title}`} onClick={() => { void changeVisibility(row, true); }}>
                      {pending === row.suppressionKey ? 'Hiding…' : 'Hide'}</button>
                  </li>;
                })}
              </ul>}
            </>}
        </div>
      </section>;
    })}
    <div className="attention-feedback" aria-live="polite">
      {actionError && <p role="alert">{actionError}</p>}
      {hiddenRows.length > 0 && <div className="attention-hidden attention-scroll" role="region" aria-label="Hidden threads" tabIndex={0}>
      {hiddenRows.map(row => <div className="attention-undo" key={row.suppressionKey}>
        <span>Hidden: {row.title}</span>
        <button type="button" className="secondary-button" disabled={pending !== null}
          ref={element => {
            if (element && focusTarget.current === `undo:${row.suppressionKey}`) {
              element.focus(); focusTarget.current = null;
            }
          }}
          aria-label={`Undo hide ${row.title}`} onClick={() => { void changeVisibility(row, false); }}>
          {pending === row.suppressionKey ? 'Restoring…' : 'Undo'}</button>
      </div>)}
      </div>}
    </div>
    {read.data && !invalid && <FeedState result={read.data} source="Gmail" />}
  </div>;
}
