import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { AreaProps } from './areas';
import { CollapsibleSection } from './CollapsibleSection';
import { Loader } from './Loader';
import { saveSignInReturnPath } from './auth';
import { ItemActionControls } from './ProactiveItemActions';
import { ProactiveItemPage as LegacyProactiveItemPage } from './ProactiveItemPage';
import {
  copenhagenClock, formatTime, isProactiveItem, isProactiveStatus, isRecord, isRun,
  outcomeLabel, proactiveJson, proactiveRequest, runReason, sourceLabels, sourceReason,
  timeAgo, type ItemAction, type ProactiveItem, type ProactiveStatus, type RunSummary,
} from './proactive-data';
import './proactive.css';

type Load<T> =
  | { state: 'loading'; value: null }
  | { state: 'loaded'; value: T }
  | { state: 'error'; value: null; message: string }
  | { state: 'sign-in'; value: null }
  | { state: 'unavailable'; value: null };

const pending = (): Load<never> => ({ state: 'loading', value: null });

const categoryLabels: Record<NonNullable<ProactiveItem['category']>, string> = {
  deadline: 'Deadline', clash: 'Calendar clash', travel: 'Travel', todo: 'Todo',
  prep: 'Preparation', news: 'News', weather: 'Weather', status: 'Status', suggestion: 'Suggestion',
};

const urgencyLabels: Record<ProactiveItem['urgency'], string> = {
  time_critical: 'Time-critical',
  normal: 'Normal',
  fyi: 'FYI',
};

function authError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('sign-in needs attention');
}

function feedbackText(action: ItemAction, item: ProactiveItem, snoozeUntil?: string): string {
  if (action === 'dismiss') return 'Dismissed';
  if (action === 'snooze') return `Snoozed until ${copenhagenClock(snoozeUntil!)}`;
  if (action === 'useful') return 'Marked useful';
  if (action === 'wrong') return 'Marked wrong';
  return `Opened ${item.title}`;
}

function runTitle(run: RunSummary): string {
  const time = run.slot?.match(/\b\d{2}:\d{2}\b/u)?.[0];
  if (run.trigger === 'manual') return 'Proactive check (manual)';
  if (run.trigger === 'catchup') return `Proactive check (${time ?? 'scheduled'}, late)`;
  return `Proactive check (${time ?? 'scheduled'})`;
}

function SourceRow({ source, now }: { source: ProactiveStatus['sources'][number]; now: number }) {
  let state: string;
  if (source.state === 'disabled' || !source.enabled) state = 'Off';
  else if (source.state === 'not_run') state = 'Not run yet';
  else if (source.state === 'unavailable') state = `Unavailable: ${sourceReason(source.reason)}`;
  else if (source.state === 'stale') state = `Stale, last read ${source.observedAt ? timeAgo(source.observedAt, now) : 'some time ago'}`;
  else state = source.observedAt ? `Read at ${copenhagenClock(source.observedAt)}` : 'Read recently';
  return (
    <li className="proactive-source-row">
      <span>{sourceLabels[source.id]}</span>
      <span>{state}</span>
    </li>
  );
}

function Urgency({ urgency }: { urgency: ProactiveItem['urgency'] }) {
  return <span className="proactive-urgency">
    <svg className="proactive-urgency-icon" aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" />
      {urgency === 'time_critical' ? <path d="M8 4.5v4M8 11.1v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        : urgency === 'normal' ? <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          : <><path d="M8 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="8" cy="4.7" r=".8" fill="currentColor" /></>}
    </svg>
    {urgencyLabels[urgency]}
  </span>;
}

function ItemContent({ item, showTitle = true, expanded = false }: {
  item: ProactiveItem;
  showTitle?: boolean;
  expanded?: boolean;
}) {
  const evidence = [...new Set(item.evidence.map(({ label }) => label).filter(Boolean))];
  return <>
    <div className="proactive-item-heading">
      <Urgency urgency={item.urgency} />
      {item.state === 'new' && <span className="proactive-new">New</span>}
      {item.kind === 'test' && <span>Test notification</span>}
      {item.todoAdded && <span>Todo added</span>}
    </div>
    {showTitle && <h3 lang={item.language ?? undefined}>{item.title}</h3>}
    <p className={`proactive-item-text${expanded ? ' is-expanded' : ''}`} lang={item.language ?? undefined}>{item.body}</p>
    <div className="proactive-item-meta">
      {item.category && <span>{categoryLabels[item.category]}</span>}
      {item.dueAt && <span>Due <time dateTime={item.dueAt}>{formatTime(item.dueAt, item.language ?? 'en')}</time></span>}
      {evidence.length > 0 && <span>From {evidence.join(' and ')}</span>}
      <span>Arrived <time dateTime={item.createdAt}>{formatTime(item.createdAt, item.language ?? 'en')}</time></span>
      <span>State: {item.state === 'new' ? 'New' : item.state === 'seen' ? 'Seen' :
        item.state === 'dismissed' ? 'Dismissed' : `Snoozed${item.snoozedUntil ? ` until ${formatTime(item.snoozedUntil, item.language ?? 'en')}` : ''}`}</span>
    </div>
    <span className="proactive-item-feedback-state">
      Feedback: {item.feedback === 'useful' ? 'Useful' : item.feedback === 'wrong' ? 'Wrong' : 'Not rated'}
    </span>
  </>;
}

function ItemLink({ item }: { item: ProactiveItem }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <Link className="proactive-item-link" to={`/proactive/${encodeURIComponent(item.id)}`}
      data-item-link={item.id} aria-label={`Open ${item.title}`} lang={item.language ?? undefined}>
      <ItemContent item={item} expanded={expanded} />
    </Link>
    {item.body.length > 220 && <button type="button" className="proactive-text-toggle"
      aria-expanded={expanded} aria-label={`${expanded ? 'Show less' : 'Show more'} ${item.title}`}
      onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : 'Show more'}</button>}
  </>;
}

function StatusOutcome({ run }: { run: RunSummary | null }) {
  if (!run) return <span>No check yet</span>;
  return <span>Last check <time dateTime={run.finishedAt ?? run.startedAt}>
    {formatTime(run.finishedAt ?? run.startedAt)}
  </time> · {outcomeLabel(run.status)}{run.findingCount ? ` · ${run.findingCount} findings` : ''}</span>;
}

function StatusSentence({ status }: { status: ProactiveStatus }) {
  if (status.lastRun?.status === 'running') return <>Checking now</>;
  if (status.paused) return <>Paused</>;
  if (status.quietNow) return <>Quiet hours, scheduled checks resume at 07:00</>;
  return status.nextSlotAt
    ? <>Next check at <time dateTime={status.nextSlotAt}>{formatTime(status.nextSlotAt)}</time></>
    : <>No scheduled check is available</>;
}

function sourceStateReason(status: ProactiveStatus | null): string | null {
  if (!status) return null;
  if (status.lastRun?.status === 'running') return 'A check is running.';
  if (status.paused) return 'Proactive is paused.';
  if (status.budget.state === 'exhausted') return 'The monthly budget is used up.';
  if (status.sources.length === 0 || status.sources.every(({ enabled }) => !enabled)) return 'Every source is switched off.';
  return null;
}

export function ProactiveArea({ backendUrl, getAccessToken, signIn, now: injectedClock }: AreaProps & {
  signIn?: () => Promise<void>;
  now?: () => number;
}) {
  const [status, setStatus] = useState<Load<ProactiveStatus>>(pending());
  const [items, setItems] = useState<Load<ProactiveItem[]>>(pending());
  const [runs, setRuns] = useState<Load<RunSummary[]>>(pending());
  const [earlier, setEarlier] = useState<Load<ProactiveItem[]> | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const now = injectedClock ?? Date.now;
  const location = useLocation();
  const statusRequest = useRef<AbortController | null>(null);
  const itemsRequest = useRef<AbortController | null>(null);
  const runsRequest = useRef<AbortController | null>(null);
  const activePoll = useRef<AbortController | null>(null);
  const itemHeading = useRef<HTMLHeadingElement>(null);
  const rowFocusId = useRef<string | null>(null);
  const rowFocusPending = useRef(false);
  const itemsValue = useRef<ProactiveItem[]>([]);

  const loadStatus = useCallback(async (signal?: AbortSignal, background = false) => {
    const controller = signal ? null : new AbortController();
    const requestSignal = signal ?? controller!.signal;
    statusRequest.current?.abort();
    statusRequest.current = controller;
    if (!background) setStatus(pending());
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/status', { signal: requestSignal });
      if (response.status === 404) {
        if (!requestSignal.aborted) setStatus({ state: 'unavailable', value: null });
        return 'unavailable' as const;
      }
      const value: unknown = await proactiveJson(response);
      if (requestSignal.aborted) return null;
      if (!isProactiveStatus(value)) throw new Error('Invalid status');
      setStatus({ state: 'loaded', value });
      return value;
    } catch (error) {
      if (requestSignal.aborted) return null;
      if (authError(error)) setSignInRequired(true);
      setStatus({ state: 'error', value: null, message: 'Proactive status could not be loaded. Try again.' });
      return null;
    } finally {
      if (controller && statusRequest.current === controller) statusRequest.current = null;
    }
  }, [backendUrl, getAccessToken]);

  const loadItems = useCallback(async (state: 'open' | 'all' = 'open') => {
    const controller = new AbortController();
    if (state === 'open') {
      itemsRequest.current?.abort();
      itemsRequest.current = controller;
      setItems(pending());
    }
    if (state === 'all') setEarlier(pending());
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken,
        `/proactive/items?state=${state}&limit=50`, { signal: controller.signal });
      const body: unknown = await proactiveJson(response);
      if (controller.signal.aborted) return;
      const values = isRecord(body) ? body.items : null;
      if (!Array.isArray(values) || values.some((item) => !isProactiveItem(item))) throw new Error('Invalid items');
      if (state === 'open') {
        itemsValue.current = values;
        setItems({ state: 'loaded', value: values });
      } else setEarlier({ state: 'loaded', value: values });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (authError(error)) setSignInRequired(true);
      const failure = { state: 'error' as const, value: null, message: 'Items could not be loaded. Try again.' };
      if (state === 'open') setItems(failure);
      else setEarlier(failure);
    } finally {
      if (itemsRequest.current === controller) itemsRequest.current = null;
    }
  }, [backendUrl, getAccessToken]);

  const loadRuns = useCallback(async () => {
    const controller = new AbortController();
    runsRequest.current?.abort();
    runsRequest.current = controller;
    setRuns(pending());
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/runs?limit=10', { signal: controller.signal });
      const body: unknown = await proactiveJson(response);
      if (controller.signal.aborted) return;
      const values = isRecord(body) ? body.runs : null;
      if (!Array.isArray(values) || values.some((run) => !isRun(run))) throw new Error('Invalid runs');
      setRuns({ state: 'loaded', value: values });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (authError(error)) setSignInRequired(true);
      setRuns({ state: 'error', value: null, message: 'Recent checks could not be loaded. Try again.' });
    } finally {
      if (runsRequest.current === controller) runsRequest.current = null;
    }
  }, [backendUrl, getAccessToken]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      void loadStatus();
      void loadItems();
      void loadRuns();
    });
    return () => {
      active = false;
      statusRequest.current?.abort();
      itemsRequest.current?.abort();
      runsRequest.current?.abort();
      activePoll.current?.abort();
    };
  }, [loadItems, loadRuns, loadStatus]);

  useEffect(() => {
    if (!rowFocusPending.current) return;
    const id = rowFocusId.current;
    rowFocusId.current = null;
    rowFocusPending.current = false;
    const next = id ? document.querySelector<HTMLAnchorElement>(`[data-item-link="${id}"]`) : null;
    if (next) next.focus();
    else itemHeading.current?.focus();
  }, [items]);

  const beginSignIn = () => {
    saveSignInReturnPath(`${location.pathname}${location.search}${location.hash}`);
    void signIn?.();
  };

  const actionItem = useCallback(async (item: ProactiveItem, action: ItemAction, snoozeUntil?: string) => {
    const before = itemsValue.current;
    const index = before.findIndex(({ id }) => id === item.id);
    const nextId = index >= 0 ? before[index + 1]?.id ?? before[index - 1]?.id ?? null : null;
    if (action === 'dismiss' || action === 'snooze') {
      const optimistic = action === 'dismiss'
        ? { ...item, state: 'dismissed' as const }
        : { ...item, state: 'snoozed' as const, snoozedUntil: snoozeUntil ?? null };
      itemsValue.current = before.map((current) => current.id === item.id ? optimistic : current);
      setItems({ state: 'loaded', value: itemsValue.current });
    } else {
      itemsValue.current = before.map((current) => current.id === item.id
        ? { ...current, feedback: action === 'useful' || action === 'wrong' ? action : current.feedback } : current);
      setItems({ state: 'loaded', value: itemsValue.current });
    }
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, `/proactive/items/${encodeURIComponent(item.id)}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ action, ...(action === 'snooze' ? { snoozeUntil } : {}) }),
      });
      if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention.');
      const value: unknown = await proactiveJson(response);
      if (!isProactiveItem(value)) throw new Error('Invalid item');
      if (action === 'dismiss' || action === 'snooze') {
        itemsValue.current = itemsValue.current.filter(({ id }) => id !== item.id);
        rowFocusId.current = nextId;
        rowFocusPending.current = true;
        setItems({ state: 'loaded', value: itemsValue.current });
      } else {
        itemsValue.current = itemsValue.current.map((current) => current.id === item.id ? value : current);
        setItems({ state: 'loaded', value: itemsValue.current });
      }
      setAnnouncement(feedbackText(action, item, snoozeUntil));
    } catch (error) {
      if (authError(error)) setSignInRequired(true);
      itemsValue.current = [...itemsValue.current.filter(({ id }) => id !== item.id), item]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      setItems({ state: 'loaded', value: itemsValue.current });
      throw error;
    }
  }, [backendUrl, getAccessToken]);

  const startCheck = async () => {
    if (checking || status.state !== 'loaded') return;
    setChecking(true);
    setCheckMessage('');
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken, '/proactive/runs', { method: 'POST' });
      if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention.');
      if (response.status !== 202) {
        let errorCode: unknown = null;
        if (response.status === 409) {
          const body: unknown = await response.json().catch(() => null);
          errorCode = isRecord(body) ? body.error : null;
        }
        const messages: Record<string, string> = {
          already_running: 'A check is already running.',
          paused: 'Proactive is paused.',
          budget_exhausted: 'The monthly budget is used up.',
          no_sources: 'Every source is switched off.',
        };
        setCheckMessage(response.status === 404 ? 'Check now is not available on this backend yet.'
          : response.status === 429 ? 'Checked a moment ago. Try again in a few minutes.'
            : response.status === 409 && typeof errorCode === 'string' ? messages[errorCode] ?? 'Could not start a check. Try again.'
              : 'Could not start a check. Try again.');
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const run = isRecord(body) ? body.run : null;
      if (!isRun(run)) throw new Error('Invalid run');
      if (status.state === 'loaded') setStatus({ state: 'loaded', value: { ...status.value, lastRun: run as RunSummary } });
      const controller = new AbortController();
      activePoll.current?.abort();
      activePoll.current = controller;
      const started = now();
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 4 * 60_000);
      const waitForVisibleTick = () => new Promise<void>((resolve) => {
        let timer: number | undefined;
        const finish = () => {
          document.removeEventListener('visibilitychange', visibility);
          controller.signal.removeEventListener('abort', finish);
          if (timer !== undefined) window.clearTimeout(timer);
          resolve();
        };
        const visibility = () => {
          if (!document.hidden) {
            if (timer !== undefined) window.clearTimeout(timer);
            timer = window.setTimeout(finish, 3_000);
          } else if (timer !== undefined) {
            window.clearTimeout(timer);
            timer = undefined;
          }
        };
        controller.signal.addEventListener('abort', finish, { once: true });
        document.addEventListener('visibilitychange', visibility);
        visibility();
      });
      while (!controller.signal.aborted) {
        if (now() - started >= 4 * 60_000) {
          timedOut = true;
          break;
        }
        await waitForVisibleTick();
        if (controller.signal.aborted) break;
        if (document.hidden) continue;
        const latest = await loadStatus(controller.signal, true);
        if (latest === 'unavailable') break;
        if (latest && latest.lastRun && latest.lastRun.id === run.id && latest.lastRun.status !== 'running') {
          await Promise.all([loadItems(), loadRuns()]);
          break;
        }
      }
      window.clearTimeout(timeoutId);
      controller.abort();
      if (activePoll.current === controller) activePoll.current = null;
      if (timedOut) setCheckMessage('Still running. Progress is in Background work.');
    } catch (error) {
      if (authError(error)) setSignInRequired(true);
      if (error instanceof Error && error.message.includes('sign-in needs attention')) {
        setCheckMessage('Sign in again to start a check.');
      } else setCheckMessage('Could not start a check. Try again.');
    } finally {
      setChecking(false);
    }
  };

  const loadedStatus = status.state === 'loaded' ? status.value : null;
  const disabledReason = sourceStateReason(loadedStatus) ??
    (status.state === 'loading' ? 'Checking availability.' : status.state === 'loaded' ? null : 'Status is unavailable.');

  return (
    <main className="proactive-page" aria-labelledby="proactive-page-heading">
      <h1 id="proactive-page-heading">Proactive</h1>
      {signInRequired && <div className="proactive-sign-in" role="alert">
        <p>Your sign-in has expired. Sign in again to check proactive items.</p>
        <button className="secondary-button" type="button" onClick={beginSignIn}>Sign in again</button>
      </div>}
      <section className="proactive-block" aria-labelledby="proactive-status-heading">
        <h2 id="proactive-status-heading">Status</h2>
        {status.state === 'loading' && <Loader variant="inline" label="Loading proactive status…" />}
        {status.state === 'unavailable' && <p role="status">Proactive is not turned on for this backend.</p>}
        {status.state === 'error' && <div role="alert"><p>{status.message}</p>
          <button className="secondary-button" type="button" onClick={() => { void loadStatus(); }}>Retry</button></div>}
        {loadedStatus && <>
          <p className="proactive-status-line"><StatusSentence status={loadedStatus} /></p>
          <p><StatusOutcome run={loadedStatus.lastRun} /></p>
          <p className="proactive-check-action">
            <button className="primary-button" type="button" disabled={Boolean(disabledReason) || checking}
              aria-describedby={disabledReason ? 'proactive-check-reason' : undefined} onClick={() => { void startCheck(); }}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
            {disabledReason && <span id="proactive-check-reason">{disabledReason}</span>}
          </p>
          {checkMessage && <p role="status">{checkMessage}</p>}
        </>}
      </section>

      <section className="proactive-block" aria-labelledby="proactive-items-heading">
        <h2 id="proactive-items-heading" ref={itemHeading} tabIndex={-1}>Open items</h2>
        {items.state === 'loading' && <Loader variant="rows" label="Loading open items…" />}
        {items.state === 'error' && <div role="alert"><p>{items.message}</p>
          <button className="secondary-button" type="button" onClick={() => { void loadItems(); }}>Retry</button></div>}
        {items.state === 'loaded' && items.value.length === 0 && <p>Nothing needs you right now. {loadedStatus?.lastRun
          ? <>Last check <time dateTime={loadedStatus.lastRun.finishedAt ?? loadedStatus.lastRun.startedAt}>
            {formatTime(loadedStatus.lastRun.finishedAt ?? loadedStatus.lastRun.startedAt)}</time>.</>
          : 'No check has run yet.'}</p>}
        {items.state === 'loaded' && items.value.length > 0 && <ul className="proactive-item-list">
          {items.value.map((item) => <li key={item.id} className="proactive-item-row">
            <ItemLink item={item} />
            <ItemActionControls item={item} now={now()} onAction={actionItem} />
          </li>)}
        </ul>}
        <details className="proactive-earlier" onToggle={(event) => {
          if ((event.currentTarget as HTMLDetailsElement).open && earlier === null) void loadItems('all');
        }}>
          <summary>Earlier items</summary>
          {earlier?.state === 'loading' && <Loader variant="rows" label="Loading earlier items…" />}
          {earlier?.state === 'error' && <div role="alert"><p>{earlier.message}</p>
            <button className="secondary-button" type="button" onClick={() => { void loadItems('all'); }}>Retry</button></div>}
          {earlier?.state === 'loaded' && earlier.value.length === 0 && <p>No earlier items.</p>}
          {earlier?.state === 'loaded' && earlier.value.length > 0 && <ul className="proactive-item-list">
            {earlier.value.map((item) => <li key={item.id} className="proactive-item-row proactive-earlier-row">
              <ItemLink item={item} />
            </li>)}
          </ul>}
        </details>
      </section>

      <section className="proactive-block" aria-labelledby="proactive-sources-heading">
        <h2 id="proactive-sources-heading">Sources</h2>
        {status.state === 'loading' && <Loader variant="rows" label="Loading source status…" />}
        {status.state === 'error' && <div role="alert"><p>Source status could not be loaded.</p>
          <button className="secondary-button" type="button" aria-label="Retry source status"
            onClick={() => { void loadStatus(); }}>Retry</button></div>}
        {loadedStatus && <>
          <ul className="proactive-source-list">{loadedStatus.sources.map((source) =>
            <SourceRow key={source.id} source={source} now={now()} />)}</ul>
          <Link to="/settings#proactive-settings">Manage sources in Settings</Link>
        </>}
      </section>

      <section className="proactive-block" aria-labelledby="proactive-budget-heading">
        <h2 id="proactive-budget-heading">Budget</h2>
        {status.state === 'loading' && <Loader variant="inline" label="Loading monthly budget…" />}
        {status.state === 'error' && <div role="alert"><p>Budget status could not be loaded.</p>
          <button className="secondary-button" type="button" aria-label="Retry budget status"
            onClick={() => { void loadStatus(); }}>Retry</button></div>}
        {loadedStatus && <div className="proactive-budget" data-state={loadedStatus.budget.state}>
          <p><svg className="proactive-budget-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" />
            {loadedStatus.budget.state === 'ok' ? <path d="m4.5 8.2 2.1 2.1 4.7-4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              : loadedStatus.budget.state === 'warn' ? <path d="M8 4.5v4M8 11.1v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                : <path d="M5 5h6v6H5z" fill="currentColor" />}
          </svg>{' '}
            {loadedStatus.budget.state === 'ok' ? 'Within the monthly limit'
              : loadedStatus.budget.state === 'warn' ? 'Close to the monthly limit' : 'Limit reached'}
          </p>
          <meter min="0" max={Math.max(1, loadedStatus.budget.monthlyLimitDkk)}
            value={Math.min(loadedStatus.budget.estimatedSpendDkk, Math.max(1, loadedStatus.budget.monthlyLimitDkk))}
            aria-label="Estimated monthly proactive spend"
            aria-valuetext={`Estimated ${loadedStatus.budget.estimatedSpendDkk} of ${loadedStatus.budget.monthlyLimitDkk} DKK this month.`} />
          <p>Estimated {loadedStatus.budget.estimatedSpendDkk} of {loadedStatus.budget.monthlyLimitDkk} DKK this month. This is an estimate.</p>
          {loadedStatus.budget.state === 'exhausted' && <p>Limit reached. Proactive checks are paused until next month or until you raise the limit in Settings.</p>}
          <Link to="/settings#proactive-settings">Change the budget in Settings</Link>
        </div>}
      </section>

      <CollapsibleSection storageKey="proactive.recent-runs" headingId="proactive-runs-heading"
        title="Recent checks" className="proactive-block" persist={false} initiallyOpen={false}>
        {runs.state === 'loading' && <Loader variant="rows" label="Loading recent checks…" />}
        {runs.state === 'error' && <div role="alert"><p>{runs.message}</p>
          <button className="secondary-button" type="button" onClick={() => { void loadRuns(); }}>Retry</button></div>}
        {runs.state === 'loaded' && runs.value.length === 0 && <p>No checks yet.</p>}
        {runs.state === 'loaded' && runs.value.length > 0 && <ul className="proactive-runs-list">
          {runs.value.map((run) => <li key={run.id}>
            <strong>{runTitle(run)}</strong>
            <span>{outcomeLabel(run.status)}</span>
            {runReason(run.reason) && <span>{runReason(run.reason)}</span>}
            <span>{run.findingCount} {run.findingCount === 1 ? 'finding' : 'findings'}</span>
          </li>)}
        </ul>}
      </CollapsibleSection>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    </main>
  );
}

type ProactiveItemPageProps = AreaProps & {
  signIn: () => Promise<void>;
  proactiveEnabled?: boolean;
  now?: () => number;
};

export function ProactiveItemPage(props: ProactiveItemPageProps) {
  return props.proactiveEnabled
    ? <FullProactiveItemPage {...props} />
    : <LegacyProactiveItemPage backendUrl={props.backendUrl} getAccessToken={props.getAccessToken} signIn={props.signIn} />;
}

function FullProactiveItemPage({ backendUrl, getAccessToken, signIn, proactiveEnabled = false,
  now: injectedClock }: ProactiveItemPageProps) {
  const { id = '' } = useParams();
  const location = useLocation();
  const [item, setItem] = useState<Load<ProactiveItem>>(pending());
  const [requestKey, setRequestKey] = useState(0);
  const [signInRequired, setSignInRequired] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const now = injectedClock ?? Date.now;
  const seen = useRef(new Set<string>());

  const load = useCallback(async (signal: AbortSignal) => {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(id)) {
      setItem({ state: 'unavailable', value: null });
      return;
    }
    setItem(pending());
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken,
        `/proactive/items/${encodeURIComponent(id)}`, { signal });
      if (response.status === 401) {
        setSignInRequired(true);
        setItem({ state: 'sign-in', value: null });
        return;
      }
      if (response.status === 404) { setItem({ state: 'unavailable', value: null }); return; }
      const value: unknown = await proactiveJson(response);
      if (signal.aborted || !isProactiveItem(value) || value.id !== id) throw new Error('Invalid item');
      if (!proactiveEnabled && value.kind !== 'test') throw new Error('Invalid item');
      setItem({ state: 'loaded', value });
      if (proactiveEnabled && value.state === 'new' && !seen.current.has(value.id)) {
        seen.current.add(value.id);
        void proactiveRequest(backendUrl, getAccessToken, `/proactive/items/${encodeURIComponent(value.id)}/feedback`, {
          method: 'POST', body: JSON.stringify({ action: 'seen' }), signal,
        }).catch(() => {});
      }
    } catch (error) {
      if (signal.aborted) return;
      if (authError(error)) {
        setSignInRequired(true);
        setItem({ state: 'sign-in', value: null });
      } else setItem({ state: 'error', value: null, message: 'This item could not be loaded. Try again.' });
    }
  }, [backendUrl, getAccessToken, id, proactiveEnabled]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(controller.signal); });
    return () => { active = false; controller.abort(); };
  }, [load, requestKey]);

  const action = async (current: ProactiveItem, type: ItemAction, snoozeUntil?: string) => {
    const optimistic: ProactiveItem = type === 'dismiss' ? { ...current, state: 'dismissed' }
      : type === 'snooze' ? { ...current, state: 'snoozed' as const, snoozedUntil: snoozeUntil ?? null }
        : type === 'useful' || type === 'wrong' ? { ...current, feedback: type } : current;
    setItem({ state: 'loaded', value: optimistic });
    try {
      const response = await proactiveRequest(backendUrl, getAccessToken,
        `/proactive/items/${encodeURIComponent(current.id)}/feedback`, {
          method: 'POST', body: JSON.stringify({ action: type, ...(type === 'snooze' ? { snoozeUntil } : {}) }),
        });
      if (response.status === 401) throw new Error('Your Microsoft sign-in needs attention.');
      const value: unknown = await proactiveJson(response);
      if (!isProactiveItem(value)) throw new Error('Invalid item');
      setItem({ state: 'loaded', value });
      setAnnouncement(feedbackText(type, current, snoozeUntil));
    } catch (error) {
      setItem({ state: 'loaded', value: current });
      if (authError(error)) setSignInRequired(true);
      throw error;
    }
  };

  const beginSignIn = () => {
    saveSignInReturnPath(`${location.pathname}${location.search}${location.hash}`);
    void signIn();
  };

  return <main className="proactive-page proactive-detail" aria-labelledby="proactive-detail-heading">
    <h1 id="proactive-detail-heading" lang={item.state === 'loaded' ? item.value.language ?? undefined : undefined}>
      {item.state === 'loaded' ? item.value.title : 'Proactive item'}
    </h1>
    <Link to="/proactive">All open items</Link>
    {signInRequired && <div role="alert"><p>Your sign-in has expired. Sign in again to open this item.</p>
      <button className="secondary-button" type="button" onClick={beginSignIn}>Sign in again</button></div>}
    {item.state === 'loading' && <Loader variant="lines" label="Loading item…" />}
    {item.state === 'unavailable' && <p role="status">This item was not found or is not available to this account.</p>}
    {item.state === 'error' && <div role="alert"><p>{item.message}</p>
      <button className="secondary-button" type="button" onClick={() => setRequestKey((value) => value + 1)}>Retry</button></div>}
    {item.state === 'loaded' && <>
      <article className="proactive-detail-item" lang={item.value.language ?? undefined}>
        <ItemContent item={item.value} showTitle={false} />
        <ItemActionControls item={item.value} now={now()} onAction={action} />
      </article>
    </>}
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
  </main>;
}
