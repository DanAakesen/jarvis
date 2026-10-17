import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { dailyQuerySources as sources, type DailyCursor, type DailyJson, type DailySourceId } from '@jarvis/contracts';
import type { AreaProps } from '../areas';
import { ChartView } from '../ChartView';
import { Loader } from '../Loader';
import { DailyReadError, loadDailySources } from './client';
import { dailyColumns, dailyPlots, dailyRequest, dailyRowKey, dailySources, dailyValue, initialDailyPeriod, readable, type Row } from './presentation';
import { DailyRefreshContext } from './refresh';
import { useDailyQuery } from './useDailyQuery';
import './daily.css';

function object(value: DailyJson | undefined): value is Row {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
function SyncEvidence({ item }: { item: Row }) {
  const feeds = Array.isArray(item.feeds) ? item.feeds.filter(object) : [];
  return <>
    <p>Upload receipt, successful processing and phone contact are separate evidence.</p>
    <dl className="daily-facts">
      <div><dt>Phone last contacted</dt><dd>{dailyValue(object(item.heartbeat) ? item.heartbeat.last_received_at : null)}</dd></div>
      <div><dt>Pending uploads</dt><dd>{dailyValue(object(item.inbox) ? item.inbox.pending : null)}</dd></div>
      <div><dt>Quarantined uploads</dt><dd>{dailyValue(object(item.inbox) ? item.inbox.quarantined : null)}</dd></div>
    </dl>
    <Records source={sources.sync} rows={feeds} />
  </>;
}
function Records({ source, rows, onWorkout }: { source: DailySourceId; rows: readonly Row[]; onWorkout?: (id: string) => void }) {
  const columns = dailyColumns(source);
  return <div className="daily-table-wrap" role="region" aria-label="Daily record table" tabIndex={0}>
    <table className={`daily-table${columns.length > 3 ? ' daily-table-wide' : ''}`}>
      <caption className="visually-hidden">Recorded Daily values; unknown values are not zero</caption>
      <thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.label}{column.unit ? ` (${column.unit})` : ''}</th>)}<th scope="col">Inspect</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={dailyRowKey(row, source, index)}>
        {columns.map(column => <td key={column.key} title={typeof row[column.key] === 'number' ? String(row[column.key]) : undefined}>
          {column.key === 'metric_name' && typeof row[column.key] === 'string' ? readable(String(row[column.key])) : dailyValue(row[column.key])}
          {column.key === 'meal_name' || column.key === 'plan_name' ? row.deleted_at != null && <span className="daily-deleted">Deleted record</span> : null}
        </td>)}
        <td>
          {onWorkout && typeof row.id === 'string' && row.id.length > 0 && <button className="secondary-button" type="button" onClick={() => {
            const id = row.id; if (typeof id === 'string') onWorkout(id);
          }}>Open workout</button>}
          <details className="daily-record-details"><summary>Record details</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function DailyPage({ backendUrl, getAccessToken }: AreaProps) {
  const refreshVersion = useContext(DailyRefreshContext);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const capabilityKey = JSON.stringify([backendUrl, capabilityRetry]);
  const [capabilities, setCapabilities] = useState<{ key: string; sources?: DailySourceId[]; error?: string }>({ key: capabilityKey });
  const [source, setSource] = useState<DailySourceId>(sources.metrics);
  const [period, setPeriod] = useState(initialDailyPeriod);
  const [draftPeriod, setDraftPeriod] = useState(initialDailyPeriod);
  const [cursors, setCursors] = useState<DailyCursor[]>([]);
  const [workout, setWorkout] = useState<{ id: string; heartRate: boolean } | null>(null);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [plotId, setPlotId] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);
  const workoutCursors = useRef<DailyCursor[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void loadDailySources(backendUrl, getAccessToken, controller.signal).then(
      available => { if (!controller.signal.aborted) setCapabilities({ key: capabilityKey, sources: available }); },
      error => {
        if (!controller.signal.aborted) setCapabilities({ key: capabilityKey,
          error: error instanceof DailyReadError ? error.message : 'Daily availability could not be checked. Retry without changing your data.' });
      },
    );
    return () => controller.abort();
  }, [backendUrl, getAccessToken, capabilityKey]);
  const current = capabilities.key === capabilityKey ? capabilities : { key: capabilityKey };
  const available = dailySources.filter(item => current.sources?.includes(item.id));
  const selected = available.find(item => item.id === source) ?? available[0];
  const actualSource = workout ? workout.heartRate ? sources.heartRate : sources.workout : selected?.id;
  const query = actualSource ? dailyRequest(actualSource, period, cursors.at(-1), workout?.id) : null;
  const result = useDailyQuery(backendUrl, getAccessToken, query, refreshVersion);
  const data = result.data;
  useEffect(() => {
    if (data && !result.pending && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    }
  }, [data, result.pending]);
  const plots = data ? dailyPlots(data.source, data.items) : [];
  const plot = plots.find(item => item.id === plotId) ?? plots[0];
  const dirtyPeriod = period.startDate !== draftPeriod.startDate || period.endDate !== draftPeriod.endDate;
  const draftValid = selected ? dailyRequest(selected.id, draftPeriod) !== null : false;
  const changeSource = (value: DailySourceId) => { focusAfterLoad.current = false; setSource(value); setCursors([]); setWorkout(null); setView('table'); setPlotId(''); };
  const applyPeriod = (event: FormEvent) => { event.preventDefault(); if (draftValid) { focusAfterLoad.current = true; setPeriod(draftPeriod); setCursors([]); } };
  const title = workout ? workout.heartRate ? 'Workout heart rate' : 'Workout details' : selected?.label ?? 'Records';
  return <section className="daily-page" aria-labelledby="daily-heading">
    <header className="daily-heading"><div><h1 id="daily-heading">Daily</h1><p>Browse recorded health, food and workouts. Dates use Europe/Copenhagen.</p></div>
      <button className="secondary-button" type="button" disabled={result.pending || !query} onClick={result.reload}>Refresh records</button>
    </header>
    {current.error ? <div className="daily-notice" role="alert"><p>{current.error}</p><button className="secondary-button" type="button" onClick={() => setCapabilityRetry(value => value + 1)}>Retry availability</button></div> :
      !current.sources ? <Loader label="Checking Daily availability" variant="rows" /> : <>
        <div className="daily-toolbar">
          <label>Browse<select value={selected?.id ?? ''} disabled={available.length === 0} onChange={event => {
            const selected = available.find(item => item.id === event.target.value); if (selected) changeSource(selected.id);
          }}>
            {available.length === 0 && <option value="">No collections available</option>}
            {available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          {selected?.dated && !workout && <form className="daily-period" onSubmit={applyPeriod}>
            <label>From<input type="date" value={draftPeriod.startDate} onChange={event => setDraftPeriod(value => ({ ...value, startDate: event.target.value }))} /></label>
            <label>To<input type="date" value={draftPeriod.endDate} onChange={event => setDraftPeriod(value => ({ ...value, endDate: event.target.value }))} /></label>
            <button className="secondary-button" type="submit" disabled={!draftValid || !dirtyPeriod}>Apply period</button>
          </form>}
        </div>
        {selected?.dated && !workout && <p className="daily-meta">Edit the dates, then Apply period. The recorded evidence below names the period actually loaded.</p>}
        {available.length === 0 && <p role="status">This backend has not exposed a browsable Daily collection.</p>}
        {selected?.dated && !workout && !draftValid && <p className="error-text" role="alert">Choose valid start and end dates in chronological order.</p>}
        {dirtyPeriod && selected?.dated && !workout && draftValid && <p className="daily-meta">The edited period is not applied yet.</p>}
        <section className="daily-records" aria-labelledby="daily-records-heading" aria-busy={result.pending} data-pending={result.pending || undefined}>
          <div className="daily-records-heading"><h2 id="daily-records-heading" ref={heading} tabIndex={-1}>{title}</h2>
            {workout && <div className="daily-workout-actions">
              <button className="secondary-button" type="button" onClick={() => { focusAfterLoad.current = true; setWorkout(null); setCursors(workoutCursors.current); setView('table'); }}>Back to workouts</button>
              {!workout.heartRate && current.sources?.includes(sources.heartRate) && <button className="secondary-button" type="button" onClick={() => { focusAfterLoad.current = true; setWorkout({ ...workout, heartRate: true }); setCursors([]); }}>Heart rate samples</button>}
            </div>}
          </div>
          {result.error && <div role="alert" className="daily-notice"><p>{result.error}</p>{data && <p>Previously loaded records remain below; their original read time is unchanged.</p>}
            <button className="secondary-button" type="button" onClick={result.reload} disabled={result.pending}>Retry records</button></div>}
          {result.pending && (data ? <p role="status">Refreshing recorded evidence...</p> : <Loader label="Loading Daily records" variant="rows" />)}
          {data && <>
            <div className="daily-evidence">
              {data.period && <p>Applied period: {dailyValue(data.period.startDate)} to {dailyValue(data.period.endDate)}.</p>}
              <p>Retained Daily SQL records. Read <time dateTime={data.freshness.observedAt}>{dailyValue(data.freshness.observedAt)}</time>.</p>
              <p>Last successful source processing: {dailyValue(data.freshness.sourceProcessedCommittedAt)}. Source freshness and completeness are not established.</p>
            </div>
            {data.status === 'empty' ? <p className="daily-empty">No records were returned for this source and period. This does not prove the original source is empty.</p> :
              data.source === sources.sync ? <SyncEvidence item={data.items[0]!} /> : <>
                {plots.length > 0 && <div className="daily-view-options">
                  <div className="daily-view-switch" role="group" aria-label="Record presentation">
                    <button className="secondary-button" type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
                    <button className="secondary-button" type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
                  </div>
                  {view === 'chart' && <label>Recorded measure<select value={plot?.id ?? ''} onChange={event => setPlotId(event.target.value)}>
                    {plots.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select></label>}
                </div>}
                {view === 'chart' && plot ? <div className="daily-plot">
                  <p>{plot.label}. One bar per numeric recorded observation on this page; unknown values remain in the table. No averaging or interpolation.</p>
                  <ChartView kind="bar" series={plot.series} title={`${plot.label}, recorded Copenhagen dates`} />
                  <p className="daily-meta">X: recorded observation and Copenhagen date. Y: {plot.unit}. Other pages are not included in this chart.</p>
                </div> : <Records source={data.source} rows={data.items} {...(data.source === sources.workouts && current.sources?.includes(sources.workout)
                  ? { onWorkout: (id: string) => { workoutCursors.current = cursors; focusAfterLoad.current = true; setWorkout({ id, heartRate: false }); setCursors([]); setView('table'); } } : {})} />}
              </>}
            <footer className="daily-pagination">
              <p role="status">{data.coverage.returned} {data.coverage.returned === 1 ? 'record' : 'records'} on page {cursors.length + 1}. {data.coverage.hasMore ? 'More records are available.' : 'End of returned records; original-source coverage remains unknown.'}</p>
              <div><button className="secondary-button" type="button" disabled={result.pending || cursors.length === 0} onClick={() => { focusAfterLoad.current = true; setCursors(value => value.slice(0, -1)); }}>Previous page</button>
                <button className="secondary-button" type="button" disabled={result.pending || !data.coverage.hasMore} onClick={() => {
                  const next = data.coverage.next; if (next) { focusAfterLoad.current = true; setCursors(value => [...value, next]); }
                }}>Next page</button></div>
            </footer>
            <details className="daily-contract-details"><summary>Source, units and coverage</summary>
              <dl className="daily-facts"><div><dt>Source</dt><dd>{data.source}</dd></div>
                <div><dt>Consistency</dt><dd>Independent committed reads, not an atomic snapshot</dd></div>
                <div><dt>Latest returned update</dt><dd>{dailyValue(data.freshness.latestReturnedRecordUpdatedAt)}</dd></div>
                {Object.entries(data.units).map(([field, unit]) => <div key={field}><dt>{readable(field)}</dt><dd>{unit}</dd></div>)}</dl>
            </details>
          </>}
        </section>
      </>}
  </section>;
}
