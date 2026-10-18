import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuerySources as sources, type DailySourceId } from '@jarvis/contracts';
import { Loader } from '../Loader';
import { ShellIcon, type ShellIconName } from '../ShellIcon';
import { overviewSummary, rowView } from './overview';
import { dailyValue } from './presentation';
import { useDailyProbes, type ProbeRow } from './useDailyProbes';
import { OverviewSummaryTiles } from './sections/overview/SummaryTiles';
import { DailyRefreshContext } from './refresh';
import './daily.css';
import './daily-overview.css';

const icons: Record<'records' | 'none' | 'failed', ShellIconName> = { records: 'done', none: 'idle', failed: 'failed' };

function openButton(root: HTMLElement | null, id: DailySourceId) {
  return root?.querySelector<HTMLButtonElement>(`[data-daily-open="${id}"]`) ?? null;
}

function OverviewRow({ row, onOpen, onRetry, headingLevel = 3 }: {
  row: ProbeRow; onOpen: (id: DailySourceId) => void; onRetry: () => void; headingLevel?: 3 | 4;
}) {
  const { source, probe, pending } = row;
  const view = rowView(probe, pending, source.dated);
  const observedAt = probe && probe.state !== 'failed' ? probe.observedAt : null;
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return <li className="daily-overview-row" aria-busy={pending || undefined}>
    <div className="daily-overview-body">
      <div className="daily-overview-title">
        <Heading>{source.label}</Heading>
        <span className="daily-status" data-tone={view.tone} key={view.tone}>
          {view.tone === 'checking'
            ? <Loader variant="text" size="inline" text="Checking" label={`Checking ${source.label}`} announce={false} />
            : <><ShellIcon name={icons[view.tone]} />{view.label}</>}
        </span>
      </div>
      <p>{source.purpose}</p>
      <p className="daily-meta">{source.dated ? 'Checked for the last 7 days (Europe/Copenhagen).' : 'Not limited to a period.'}</p>
      {'detail' in view && <p className="daily-overview-detail">{view.detail}</p>}
      {observedAt && <p className="daily-meta">Read <time dateTime={observedAt}>{dailyValue(observedAt)}</time>.</p>}
    </div>
    <div className="daily-overview-actions">
      <button className="secondary-button" type="button" data-daily-open={source.id} aria-label={`Open ${source.label}`}
        onClick={() => onOpen(source.id)}>Open</button>
      {probe?.state === 'failed' && <button className="secondary-button" type="button" aria-disabled={pending || undefined}
        aria-label={`${pending ? 'Retrying' : 'Retry'} ${source.label}`}
        onClick={() => { if (!pending) onRetry(); }}>{pending ? 'Retrying' : 'Retry'}</button>}
    </div>
  </li>;
}

/**
 * The Daily landing view: each collection the backend exposes, whether it holds anything, and what it is for.
 * Every figure comes from a read-only one-record query; nothing here is stored, estimated or invented.
 */
export function DailyOverview({ backendUrl, getAccessToken, capabilities, onRetryAvailability, onOpen, returnFocusTo, embedded = false }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  capabilities: { sources?: DailySourceId[] | undefined; error?: string | undefined };
  onRetryAvailability: () => void;
  onOpen: (id: DailySourceId) => void;
  returnFocusTo?: DailySourceId | undefined;
  embedded?: boolean;
}) {
  const { rows, pending, reload } = useDailyProbes(backendUrl, getAccessToken, capabilities.sources);
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const root = useRef<HTMLElement>(null);
  const focusOnMount = useRef(returnFocusTo);
  const failedBefore = useRef(new Set<DailySourceId>());
  useEffect(() => {
    if (focusOnMount.current) openButton(root.current, focusOnMount.current)?.focus();
  }, []);
  useEffect(() => {
    const failed = new Set(rows.filter(row => row.probe?.state === 'failed').map(row => row.source.id));
    const recovered = [...failedBefore.current].find(id => !failed.has(id) && rows.some(row => row.source.id === id));
    failedBefore.current = failed;
    const active = document.activeElement;
    // A retry that succeeds removes the focused Retry button; keep keyboard users in the row.
    if (recovered && (active === null || active === document.body)) openButton(root.current, recovered)?.focus();
  }, [rows]);
  const refreshVersion = useContext(DailyRefreshContext);
  const summary = rows.length > 0 && !pending ? overviewSummary(rows.map(row => row.probe)) : '';
  const healthSources: readonly DailySourceId[] = [sources.metrics,sources.sleep,sources.workouts,sources.sync];
  const healthRows = rows.filter(row => healthSources.includes(row.source.id));
  const healthIsEmpty = !pending && healthRows.length > 0 && healthRows.every(row => row.probe?.state === 'none');
  const refreshOverview = () => {
    if (pending) return;
    reload();
    setSummaryRefresh(value => value + 1);
  };
  const available = capabilities.sources ?? [];
  const hasSummarySource =
    available.includes(sources.workouts) ||
    available.includes(sources.days) && available.includes(sources.meals) ||
    available.includes(sources.metrics) && available.includes(sources.metricCatalog) ||
    available.includes(sources.sleep) ||
    available.includes(sources.briefs) && available.includes(sources.brief);
  return <section className={`daily-page daily-overview${embedded ? ' daily-overview-embedded' : ''}`} aria-labelledby="daily-heading" ref={root}>
    <header className="daily-heading">
      {!embedded && <div>
        <h1 id="daily-heading">Daily</h1>
        <p>Your health, food, workout and brief records. Each collection is checked read-only when this page opens.</p>
      </div>}
      {rows.length > 0 && <div className="daily-heading-actions">
        <button className="secondary-button" type="button" aria-disabled={pending || undefined}
          onClick={refreshOverview}>{pending ? 'Refreshing…' : 'Refresh overview'}</button>
      </div>}
    </header>
    {capabilities.error
      ? <div className="daily-notice" role="alert"><p>{capabilities.error}</p>
        <button className="secondary-button" type="button" onClick={onRetryAvailability}>Retry availability</button></div>
      : !capabilities.sources ? <Loader label="Checking Daily availability" variant="rows" />
        : rows.length === 0 && !hasSummarySource ? <p className="daily-empty" role="status">This backend has not exposed a browsable Daily collection.</p>
          : <>
            {hasSummarySource && <>
              <h2 id="daily-summary-heading">Daily overview</h2>
              <OverviewSummaryTiles backendUrl={backendUrl} getAccessToken={getAccessToken}
                refreshVersion={refreshVersion + summaryRefresh} available={available} />
            </>}
            {rows.length > 0 && <>
              {hasSummarySource
                ? <h3 id="daily-holds-heading">What Daily holds today</h3>
                : <h2 id="daily-holds-heading">What Daily holds today</h2>}
              <ul className="daily-overview-list" aria-labelledby="daily-holds-heading">
                {rows.map(row => <OverviewRow key={row.source.id} row={row} onOpen={onOpen} onRetry={reload}
                  headingLevel={hasSummarySource ? 4 : 3} />)}
              </ul>
              {healthIsEmpty && <p className="daily-meta">No health records were returned. <Link to="/settings#health-upload">Set up Health Auto Export in Settings</Link>.</p>}
            </>}
          </>}
    <p className="visually-hidden" role="status">{summary}</p>
  </section>;
}
