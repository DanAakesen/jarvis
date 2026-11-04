import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { healthQuerySources as sources, type HealthCursor, type HealthJson, type HealthSourceId } from '@jarvis/contracts';
import type { AreaProps } from '../areas';
import { Loader } from '../Loader';
import { healthPlots, healthRequest, healthSources, healthValue, healthSourceLabel, initialHealthPeriod, readable, type Row } from './presentation';
import { HealthRefreshContext } from './refresh';
import { useHealthCapabilities } from './useHealthCapabilities';
import { useHealthQuery } from './useHealthQuery';
import { HealthState } from './ui/HealthState';
import { HealthChart } from './ui/HealthChart';
import { HealthSectionHeader } from './ui/HealthSectionHeader';
import { FreshnessLine } from './ui/FreshnessLine';
import { formatDate } from './ui/formatters';
import { DataRecords as Records, RecordFields } from './sections/data/DataRecords';
import './ui/health-ui.css';
import './health.css';

function object(value: HealthJson | undefined): value is Row {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
function SyncEvidence({ item }: { item: Row }) {
  const feeds = Array.isArray(item.feeds) ? item.feeds.filter(object) : [];
  return <>
    <dl className="health-facts">
      <div><dt>Phone last contacted</dt><dd>{healthValue(object(item.heartbeat) ? item.heartbeat.last_received_at : null)}</dd></div>
      <div><dt>Accepted uploads</dt><dd>{healthValue(object(item.inbox) ? item.inbox.accepted ?? item.inbox.pending : null)}</dd></div>
      <div><dt>Processing uploads</dt><dd>{healthValue(object(item.inbox) ? item.inbox.processing : null)}</dd></div>
      <div><dt>Succeeded uploads</dt><dd>{healthValue(object(item.inbox) ? item.inbox.succeeded : null)}</dd></div>
      <div><dt>Quarantined uploads</dt><dd>{healthValue(object(item.inbox) ? item.inbox.quarantined : null)}</dd></div>
    </dl>
    <Records source={sources.sync} rows={feeds} />
  </>;
}
function BriefBody({ item }: { item: Row }) {
  return <>
    <Records source={sources.brief} rows={[item]} />
    <section aria-label="Stored brief body">
      <h3>Stored brief body</h3>
      {typeof item.preview_text === 'string' && item.preview_text.length > 0 && <p className="health-brief-text">{item.preview_text}</p>}
      {item.body_json == null ? <p>No stored brief body is available.</p> :
        typeof item.body_json === 'string' ? <p className="health-brief-text">{item.body_json || 'The stored brief body is empty.'}</p> :
          object(item.body_json) ? <RecordFields source={sources.brief} row={item.body_json} /> :
            <p>{healthValue(item.body_json)}</p>}
    </section>
  </>;
}

/**
 * The record browser. Used on its own it checks availability itself; the Health home passes what it already knows
 * (`knownSources`), the collection the user opened (`initialSource`) and a way back to the overview (`onBack`).
 */
export function HealthPage({ backendUrl, getAccessToken, knownSources, initialSource, onBack, onSourceChange, sharedPeriod,
  onPeriodChange, embedded = false, embeddedClassName, availabilityError, onRetryAvailability }: AreaProps & {
  knownSources?: readonly HealthSourceId[] | undefined;
  initialSource?: HealthSourceId | undefined;
  onBack?: () => void;
  onSourceChange?: ((source: HealthSourceId) => void) | undefined;
  sharedPeriod?: { startDate: string; endDate: string } | undefined;
  onPeriodChange?: ((period: { startDate: string; endDate: string }) => void) | undefined;
  embedded?: boolean;
  embeddedClassName?: string | undefined;
  availabilityError?: string | undefined;
  onRetryAvailability?: (() => void) | undefined;
}) {
  const refreshVersion = useContext(HealthRefreshContext);
  const loaded = useHealthCapabilities(backendUrl, getAccessToken, knownSources === undefined);
  const current = knownSources !== undefined ? {
    sources: knownSources, error: availabilityError, reload: onRetryAvailability ?? loaded.reload,
  } : loaded;
  const [source, setSource] = useState<HealthSourceId>(initialSource ?? sources.metrics);
  const [localPeriod, setLocalPeriod] = useState(initialHealthPeriod);
  const period = sharedPeriod ?? localPeriod;
  const [draftPeriod, setDraftPeriod] = useState(period);
  const [cursors, setCursors] = useState<HealthCursor[]>([]);
  const [workout, setWorkout] = useState<{ id: string; heartRate: boolean } | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [plotId, setPlotId] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);
  const collectionCursors = useRef<HealthCursor[]>([]);
  const available = healthSources.filter(item => current.sources?.includes(item.id));
  const selected = available.find(item => item.id === source) ?? available[0];
  const actualSource = briefId !== null ? sources.brief : workout ? workout.heartRate ? sources.heartRate : sources.workout : selected?.id;
  const query = actualSource ? healthRequest(actualSource, period, cursors.at(-1), briefId ?? workout?.id) : null;
  const result = useHealthQuery(backendUrl, getAccessToken, query, refreshVersion);
  const data = result.data;
  useEffect(() => {
    if (data && !result.pending && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    }
  }, [data, result.pending]);
  const plots = data ? healthPlots(data.source, data.items) : [];
  const plot = plots.find(item => item.id === plotId) ?? plots[0];
  const dirtyPeriod = period.startDate !== draftPeriod.startDate || period.endDate !== draftPeriod.endDate;
  const draftValid = selected ? healthRequest(selected.id, draftPeriod) !== null : false;
  const changeSource = (value: HealthSourceId) => { focusAfterLoad.current = false; setSource(value); onSourceChange?.(value); setCursors([]); setWorkout(null); setBriefId(null); setView('table'); setPlotId(''); };
  const applyPeriod = (event: FormEvent) => { event.preventDefault(); if (draftValid) { focusAfterLoad.current = true; (onPeriodChange ?? setLocalPeriod)(draftPeriod); setCursors([]); } };
  const title = briefId !== null ? 'Brief details' : workout ? workout.heartRate ? 'Workout heart rate' : 'Workout details' : selected?.label ?? 'Records';
  const detailSource = data?.source === sources.workouts ? sources.workout : data?.source === sources.briefs ? sources.brief : null;
  const canOpenRecord = detailSource !== null && current.sources?.includes(detailSource);
  return <section className={`health-page health-data-page${embedded ? ' health-data-embedded' : ''}${embeddedClassName ? ` ${embeddedClassName}` : ''}`} aria-labelledby={embedded ? 'health-records-heading' : 'health-heading'}>
    {!embedded
      ? <header className="health-heading"><div><h1 id="health-heading" tabIndex={-1}>Health</h1></div>
        {onBack && <button className="secondary-button" type="button" onClick={onBack}>Back to overview</button>}
      </header>
      : null}
    <HealthSectionHeader title={title} headingId="health-records-heading" headingRef={heading}
      actions={embedded && onBack ? <button className="secondary-button" type="button" aria-label="Back to overview" onClick={onBack}>Overview</button> : undefined}
      controls={available.length > 0 && <>
        <div className="health-toolbar">
          <label>Browse<select aria-label="Browse" value={selected?.id ?? ''} disabled={available.length === 0} onChange={event => {
            const selected = available.find(item => item.id === event.target.value); if (selected) changeSource(selected.id);
          }}>
            {available.length === 0 && <option value="">No collections available</option>}
            {available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          <button className="secondary-button" type="button" aria-label="Refresh records" disabled={result.pending || !query} onClick={result.reload}>Refresh</button>
          {selected?.dated && !workout && sharedPeriod === undefined && <form className="health-period" onSubmit={applyPeriod}>
            <label>From<input type="date" value={draftPeriod.startDate} onChange={event => setDraftPeriod(value => ({ ...value, startDate: event.target.value }))} /></label>
            <label>To<input type="date" value={draftPeriod.endDate} onChange={event => setDraftPeriod(value => ({ ...value, endDate: event.target.value }))} /></label>
            <button className="secondary-button" type="submit" disabled={!draftValid || !dirtyPeriod}>Apply period</button>
          </form>}
        </div>
      </>}
      freshness={data && <FreshnessLine observedAt={data.freshness.observedAt} count={data.coverage.returned} partial={data.coverage.hasMore} />} />
    {current.error ? <div className="health-notice" role="alert"><p>{current.error}</p><button className="secondary-button" type="button" onClick={current.reload}>Retry availability</button></div> :
      !current.sources ? <Loader label="Checking Health availability" variant="rows" /> : <>
        {available.length === 0 && <><HealthState status="empty" emptyMessage="No Health data" /><a href="/settings#health-upload">Settings, Health upload</a></>}
        {selected?.dated && !workout && sharedPeriod === undefined && !draftValid && <p className="error-text" role="alert">Choose valid start and end dates in chronological order.</p>}
        <section className="health-records" aria-labelledby="health-records-heading" aria-busy={result.pending} data-pending={result.pending || undefined}>
          <div className="health-records-heading">
            {workout && <div className="health-workout-actions">
              <button className="secondary-button" type="button" onClick={() => { focusAfterLoad.current = true; setWorkout(null); setCursors(collectionCursors.current); setView('table'); }}>Back to workouts</button>
              {!workout.heartRate && current.sources?.includes(sources.heartRate) && <button className="secondary-button" type="button" onClick={() => { focusAfterLoad.current = true; setWorkout({ ...workout, heartRate: true }); setCursors([]); }}>Heart rate samples</button>}
            </div>}
            {briefId !== null && <button className="secondary-button" type="button" onClick={() => {
              focusAfterLoad.current = true; setBriefId(null); setCursors(collectionCursors.current); setView('table');
            }}>Back to brief history</button>}
          </div>
          {result.error && !data && <HealthState status="error" message={result.error} retryLabel="Retry records" onRetry={result.reload} />}
          {result.error && data && <div role="alert" className="health-notice"><p>{result.error}</p><p>Showing the last loaded records.</p>
            <button className="secondary-button" type="button" onClick={result.reload} disabled={result.pending}>Retry records</button></div>}
          {result.pending && (data ? <p role="status">Refreshing…</p> : <HealthState status="loading" />)}
          {data && <>
            {data.status === 'empty' ? <><HealthState status="empty" /><a href="/settings#health-upload">Settings, Health upload</a></> :
              data.source === sources.brief ? <BriefBody item={data.items[0]!} /> :
              data.source === sources.sync ? <SyncEvidence item={data.items[0]!} /> : <>
                {plots.length > 0 && <div className="health-view-options">
                  <div className="health-view-switch" role="group" aria-label="Record presentation">
                    <button className="health-section-tab" type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
                    <button className="health-section-tab" type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
                  </div>
                  {view === 'chart' && <label>Recorded measure<select aria-label="Recorded measure" value={plot?.id ?? ''} onChange={event => setPlotId(event.target.value)}>
                    {plots.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select></label>}
                </div>}
                {view === 'chart' && plot ? <div className="health-plot">
                  <HealthChart kind="bar" series={plot.series} name={`${plot.label}, recorded Copenhagen dates`}
                    dataTable={<Records source={data.source} rows={data.items} units={data.units} />} />
                  <p className="health-meta">{plot.unit} · This page only</p>
                </div> : <Records key={`${data.source}:${cursors.length}`} source={data.source} rows={data.items} units={data.units} {...(canOpenRecord ? {
                  openLabel: data.source === sources.workouts ? 'Open workout' : 'Open brief',
                  onOpenRecord: (id: string) => {
                    collectionCursors.current = cursors; focusAfterLoad.current = true; setCursors([]); setView('table');
                    if (data.source === sources.workouts) setWorkout({ id, heartRate: false }); else setBriefId(id);
                  },
                } : {})} />}
              </>}
            <footer className="health-pagination">
              <p role="status">Page {cursors.length + 1}, {data.coverage.returned} {data.coverage.returned === 1 ? 'record' : 'records'}, {data.coverage.hasMore ? 'more available' : 'end of returned records'}.</p>
              <div><button className="secondary-button" type="button" aria-label="Previous page" aria-describedby="health-pagination-reason" disabled={result.pending || cursors.length === 0} onClick={() => { focusAfterLoad.current = true; setCursors(value => value.slice(0, -1)); }}>Previous</button>
                <button className="secondary-button" type="button" aria-label="Next page" aria-describedby="health-pagination-reason" disabled={result.pending || !data.coverage.hasMore} onClick={() => {
                  const next = data.coverage.next; if (next) { focusAfterLoad.current = true; setCursors(value => [...value, next]); }
                }}>Next</button></div>
              <p id="health-pagination-reason" className="visually-hidden">{result.pending ? 'Loading records; pagination is unavailable.' :
                `${cursors.length === 0 ? 'Previous unavailable: this is the first page. ' : ''}${!data.coverage.hasMore ? 'Next unavailable: no more returned records.' : ''}`}</p>
            </footer>
            <details className="health-contract-details"><summary>Source, units and coverage</summary>
              {data.period && <p>Applied period: {formatDate(data.period.startDate)} to {formatDate(data.period.endDate)} (Europe/Copenhagen).</p>}
              <p>Last source processing: {healthValue(data.freshness.sourceProcessedCommittedAt)}. Freshness and completeness not established.</p>
              <dl className="health-facts"><div><dt>Source</dt><dd>{healthSourceLabel(data.source)}</dd></div>
                <div><dt>Consistency</dt><dd>Independent committed reads, not an atomic snapshot</dd></div>
                <div><dt>Latest returned update</dt><dd>{healthValue(data.freshness.latestReturnedRecordUpdatedAt)}</dd></div>
                {Object.entries(data.units).map(([field, unit]) => <div key={field}><dt>{readable(field)}</dt><dd>{unit}</dd></div>)}</dl>
            </details>
          </>}
        </section>
      </>}
  </section>;
}
