import { useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionProps } from '../types';
import { DailyChart } from '../../ui/DailyChart';
import { DailyCoverageNote } from '../../ui/DailyCoverageNote';
import { DailyState } from '../../ui/DailyState';
import { ScrollTable } from '../../ui/ScrollTable';
import { StatTile } from '../../ui/StatTile';
import { formatDuration, formatNumber } from '../../ui/formatters';
import { useWorkoutPages } from './useWorkoutPages';
import { loadedScope, numeric, summarizeWorkouts, text, typeLabel, volumeBuckets, workoutType, type Workout } from './summary';
import { UnknownCell } from './WorkoutFigures';
import { measurement, setting, workoutTime } from './presentation';
import { WorkoutDetail } from './WorkoutDetail';
import './workouts.css';

type Sort = 'date' | 'duration' | 'distance' | 'energy';

function sortedWorkouts(rows: readonly Workout[], sort: Sort) {
  return [...rows].sort((a, b) => {
    if (sort === 'date') {
      const left = Date.parse(text(a.start_at) ?? text(a.workout_date) ?? '');
      const right = Date.parse(text(b.start_at) ?? text(b.workout_date) ?? '');
      return (Number.isFinite(right) ? right : -Infinity) - (Number.isFinite(left) ? left : -Infinity) || 0;
    }
    const field = sort === 'duration' ? 'duration_seconds' : sort === 'distance' ? 'distance_value' : 'active_energy_value';
    const left = numeric(a[field]);
    const right = numeric(b[field]);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    if (sort !== 'duration') {
      const unit = sort === 'distance' ? 'distance_unit' : 'active_energy_unit';
      const order = (text(a[unit]) ?? '').localeCompare(text(b[unit]) ?? '');
      if (order) return order;
    }
    return right - left;
  });
}

function WorkoutSummary({ rows, partial, period }: { rows: Workout[]; partial: boolean; period: DailySectionProps['period'] }) {
  const summary = summarizeWorkouts(rows);
  const volume = volumeBuckets(rows, period);
  const scope = loadedScope(rows.length, partial);
  const unitValues = (values: typeof summary.distance.values) => values.length
    ? values.map(item => `${formatNumber(item.value)} ${item.unit}`).join('\n') : null;
  return <>
    <div className="workouts-stats" aria-label="Workout summary">
      <StatTile label="Workouts" value={summary.count} note={scope} />
      <StatTile label="Active days" value={summary.activeDays} note={`Distinct workout_date values ${scope}; missing dates excluded.`} />
      <StatTile label="Total time" value={formatDuration(summary.durationSeconds)}
        note={`${summary.missingDuration} workouts without duration; ${scope}.`} />
      <StatTile label="Distance" value={unitValues(summary.distance.values)}
        note={`${summary.distance.missing} workouts without distance; ${scope}.`} />
      <StatTile label="Active energy" value={unitValues(summary.energy.values)}
        note={`${summary.energy.missing} workouts without active energy; ${scope}.`} />
    </div>
    <DailyCoverageNote summary="Units are kept separate; unknown values are not summed.">
      <p>Distance and energy are grouped only by their recorded unit. Values without a unit remain individual observations, and missing durations are not treated as zero.</p>
    </DailyCoverageNote>
    <section aria-labelledby="workouts-volume">
      <h3 id="workouts-volume">Workout volume</h3>
      <p>Total recorded minutes per {volume.grain} {scope}. Weeks start on Monday; dates use Europe/Copenhagen.
        Missing durations are excluded, not treated as zero.</p>
      <DailyChart kind="bar" name={`Workout minutes per ${volume.grain} ${scope}`} series={[{
        name: 'Recorded minutes',
        points: volume.buckets.flatMap(bucket => bucket.minutes === null ? [] : [{ x: bucket.start, y: bucket.minutes }]),
      }]} />
      {volume.buckets.some(bucket => bucket.minutes === null || bucket.missingDuration > 0) &&
        <ScrollTable label="Workout volume missing observations">
          <table><caption>Volume coverage by {volume.grain}</caption>
            <thead><tr><th scope="col">Starting</th><th scope="col">Recorded coverage</th></tr></thead>
            <tbody>{volume.buckets.filter(bucket => bucket.minutes === null || bucket.missingDuration > 0).map(bucket =>
              <tr key={bucket.start}><th scope="row">{bucket.start}</th>
                <td>{bucket.count === 0 ? `No workouts recorded${partial ? ' in the loaded workouts' : ''}`
                  : `${bucket.missingDuration} workouts without duration`}</td></tr>)}</tbody>
          </table>
        </ScrollTable>}
    </section>
  </>;
}

function WorkoutList({ rows, onOpen }: { rows: Workout[]; onOpen: (row: Workout, button: HTMLButtonElement) => void }) {
  const open = (row: Workout) => text(row.id) ? <button type="button" className="secondary-button"
    data-workout-id={String(row.id)} onClick={event => onOpen(row, event.currentTarget)}
    aria-label={`Open ${typeLabel(row)}, ${workoutTime(row)}`}>Open</button> : <span>Detail unavailable: unknown id</span>;
  return <>
    <div className="workouts-wide">
      <ScrollTable label="Workouts in the loaded rows">
        <table><caption>Recorded workouts; unknown values are not zero</caption>
          <thead><tr>{['Date and time', 'Type', 'Duration', 'Distance', 'Active energy', 'Average HR (bpm)', 'Maximum HR (bpm)', 'Environment', 'Source', 'Detail']
            .map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={text(row.id) ?? `unknown-${index}`}>
            <th scope="row"><UnknownCell value={workoutTime(row)} /></th><td>{typeLabel(row)}</td>
            <td><UnknownCell value={formatDuration(numeric(row.duration_seconds))} /></td>
            <td><UnknownCell value={measurement(row.distance_value, row.distance_unit)} /></td>
            <td><UnknownCell value={measurement(row.active_energy_value, row.active_energy_unit)} /></td>
            <td><UnknownCell value={numeric(row.avg_heart_rate) === null ? null : formatNumber(numeric(row.avg_heart_rate))} /></td>
            <td><UnknownCell value={numeric(row.max_heart_rate) === null ? null : formatNumber(numeric(row.max_heart_rate))} /></td>
            <td><UnknownCell value={setting(row.is_indoor)} /></td>
            <td><UnknownCell value={text(row.source_name)} /></td><td>{open(row)}</td>
          </tr>)}</tbody>
        </table>
      </ScrollTable>
    </div>
    <ul className="workouts-narrow">
      {rows.map((row, index) => <li key={text(row.id) ?? `unknown-${index}`}>
        <p><strong>{typeLabel(row)}</strong> · <UnknownCell value={workoutTime(row)} /></p>
        <dl>
          <div><dt>Duration</dt><dd><UnknownCell value={formatDuration(numeric(row.duration_seconds))} /></dd></div>
          <div><dt>Distance</dt><dd><UnknownCell value={measurement(row.distance_value, row.distance_unit)} /></dd></div>
          <div><dt>Active energy</dt><dd><UnknownCell value={measurement(row.active_energy_value, row.active_energy_unit)} /></dd></div>
          <div><dt>Average / maximum HR</dt><dd><UnknownCell value={numeric(row.avg_heart_rate) === null ? null : `${formatNumber(numeric(row.avg_heart_rate))} bpm`} />
            {' / '}<UnknownCell value={numeric(row.max_heart_rate) === null ? null : `${formatNumber(numeric(row.max_heart_rate))} bpm`} /></dd></div>
          <div><dt>Environment</dt><dd><UnknownCell value={setting(row.is_indoor)} /></dd></div>
          <div><dt>Source</dt><dd><UnknownCell value={text(row.source_name)} /></dd></div>
        </dl>
        {open(row)}
      </li>)}
    </ul>
  </>;
}

export default function WorkoutsSection(props: DailySectionProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get('workout');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('date');
  const [opened, setOpened] = useState<{ period: string; row: Workout } | null>(null);
  const periodKey = JSON.stringify(props.period);
  const result = useWorkoutPages(props.backendUrl, props.getAccessToken,
    props.sources.includes(sources.workouts) ? { source: sources.workouts, ...props.period, limit: 500 } : null,
    props.refreshVersion);
  const loadedRow = result.items.find(item => item.id === selected);
  if (selected && loadedRow && (opened?.row !== loadedRow || opened.period !== periodKey)) {
    setOpened({ period: periodKey, row: loadedRow });
  }
  const row = loadedRow ??
    (opened?.period === periodKey && opened.row.id === selected &&
      (result.status === 'loading' || result.loadingMore || result.hasMore) ? opened.row : undefined);
  const types = [...new Set(result.items.map(workoutType))];
  const filtered = result.items.filter(item => !filter || workoutType(item) === filter);
  const partial = result.hasMore || result.error !== null || result.loadingMore || result.status === 'loading';
  const previousSelected = useRef<string | null>(null);
  const focusedDetail = useRef<string | null>(null);
  const returnTarget = useRef<HTMLButtonElement | null>(null);
  const scrollPositions = useRef<{ element: HTMLElement; top: number; left: number }[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (selected && row && selected !== focusedDetail.current) {
      document.getElementById('workouts-detail-heading')?.focus({ preventScroll: true });
      focusedDetail.current = selected;
    }
    let frame: number | undefined;
    if (!selected && previousSelected.current) {
      focusedDetail.current = null;
      const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-workout-id]') ?? [])];
      const target = returnTarget.current?.isConnected ? returnTarget.current :
        buttons.find(button => button.dataset.workoutId === previousSelected.current && button.getClientRects().length > 0);
      (target ?? heading.current)?.focus({ preventScroll: true });
      const restore = () => {
        for (const saved of scrollPositions.current) {
          saved.element.scrollTop = saved.top;
          saved.element.scrollLeft = saved.left;
        }
      };
      restore();
      frame = requestAnimationFrame(restore);
    }
    previousSelected.current = selected;
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [selected, row]);

  const back = () => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete('workout');
    return next;
  }, { replace: true });
  const onOpen = (workout: Workout, button: HTMLButtonElement) => {
    returnTarget.current = button;
    const positions = [];
    for (let element: HTMLElement | null = button; element; element = element.parentElement) {
      positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
    if (document.scrollingElement instanceof HTMLElement) {
      positions.push({ element: document.scrollingElement, top: document.scrollingElement.scrollTop, left: document.scrollingElement.scrollLeft });
    }
    scrollPositions.current = positions;
    setOpened({ period: periodKey, row: workout });
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('workout', String(workout.id));
      return next;
    });
  };

  return <section className="workouts-section" aria-labelledby="workouts-heading">
    <h2 id="workouts-heading" ref={heading} tabIndex={-1}>Workouts</h2>
    <p>Recorded activity only. Logging and corrections stay in chat. Original Daily remains canonical.</p>
    {selected && row && <WorkoutDetail key={String(row.id)} {...props} row={row} onBack={back} />}
    {selected && row && !loadedRow && <p role="status">
      This workout’s summary is from the previous read while the refreshed period is incomplete.
    </p>}
    {selected && !row && <>
      <button type="button" className="secondary-button" onClick={back}>Back to workouts</button>
      {result.status === 'loading' || result.status === 'idle' || result.loadingMore || result.hasMore && !result.capped && !result.error
        ? <DailyState status="loading" />
        : <p role="status">Workout not found in the loaded period.</p>}
    </>}
    <div ref={list} hidden={selected !== null} aria-busy={result.status === 'loading' || result.loadingMore}>
      <div className="daily-toolbar">
        <label>Workout type
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="">All ({result.items.length})</option>
            {types.map(type => <option key={type} value={type}>
              {typeLabel(result.items.find(item => workoutType(item) === type)!)} ({result.items.filter(item => workoutType(item) === type).length})
            </option>)}
          </select>
        </label>
        <label>Sort loaded workouts
          <select value={sort} onChange={event => setSort(event.target.value as Sort)}>
            <option value="date">Date, newest first</option><option value="duration">Duration, longest first</option>
            <option value="distance">Distance, by unit then highest</option><option value="energy">Active energy, by unit then highest</option>
          </select>
        </label>
      </div>
      <p className="daily-meta">Filtering and sorting apply only to loaded rows. Distance and energy sort within each unit.</p>
      {(result.status === 'idle' || result.status === 'loading') && result.items.length === 0 && <DailyState status="loading" />}
      {result.items.length > 0 && <>
        <WorkoutSummary rows={filtered} partial={partial} period={props.period} />
        <section aria-labelledby="workouts-list-heading">
          <h3 id="workouts-list-heading">Workout history</h3>
          {filtered.length === 0 ? <p>No loaded workouts match this type. Choose All to see the loaded period.</p>
            : <WorkoutList rows={sortedWorkouts(filtered, sort)} onOpen={onOpen} />}
        </section>
      </>}
      {result.status === 'ready' && result.items.length === 0 && !result.error && <DailyState status="empty" />}
    </div>
    {result.error && <DailyState status="error" message={result.error} onRetry={result.reload} />}
    {result.hasMore && <div className="workouts-coverage" role="status">
      <p>Showing {result.items.length} workouts; more exist in this period</p>
      {result.loadingMore && <p>Loading more workouts…</p>}
      {result.capped && <button className="secondary-button" type="button" onClick={result.loadMore}>Load more</button>}
    </div>}
    <DailyCoverageNote summary="Returned workout records do not prove source completeness.">
      <p>Source: daily.health.workouts. Summaries use loaded records only; freshness and source completeness remain unknown.</p>
    </DailyCoverageNote>
    {result.first && <DailyState status="ready" freshness={result.first.freshness} />}
    {result.status === 'loading' && result.items.length > 0 && <p className="daily-meta" role="status">Refreshing recorded workouts…</p>}
  </section>;
}
