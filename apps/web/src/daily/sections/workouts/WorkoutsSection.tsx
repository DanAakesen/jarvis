import { useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionProps } from '../types';
import { DailyState } from '../../ui/DailyState';
import { ScrollTable } from '../../ui/ScrollTable';
import { DailySectionHeader } from '../../ui/DailySectionHeader';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { WorkoutGlyph } from '../../ui/WorkoutGlyph';
import { formatDuration, formatNumber } from '../../ui/formatters';
import { useWorkoutPages } from './useWorkoutPages';
import { numeric, text, typeLabel, workoutType, type Workout } from './summary';
import { UnknownCell } from './WorkoutFigures';
import { classifyWorkout } from './training';
import { measurement, setting, workoutTime } from './presentation';
import { WorkoutDetail } from './WorkoutDetail';
import { WorkoutOverview } from './WorkoutOverview';
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

function WorkoutTable({ rows, onOpen }: { rows: Workout[]; onOpen: (row: Workout, button: HTMLButtonElement) => void }) {
  const [tableOpen, setTableOpen] = useState(false);
  const open = (row: Workout) => text(row.id) ? <button type="button" className="secondary-button"
    data-workout-id={String(row.id)} onClick={event => onOpen(row, event.currentTarget)}
    aria-label={`Open ${typeLabel(row)}, ${workoutTime(row)}`}>Open</button> : <span>No detail</span>;
  return <details className="workouts-view-table" open={tableOpen}>
    <summary onClick={() => setTableOpen(open => !open)}>View as table</summary>
    {tableOpen && <ScrollTable label="Workouts in the loaded rows">
      <table><caption>Recorded workouts</caption>
        <thead><tr>{['Date and time', 'Type', 'Duration', 'Distance', 'Active energy', 'Average HR (bpm)', 'Maximum HR (bpm)', 'Environment', 'Source', 'Detail']
          .map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={text(row.id) ?? `unknown-${index}`}>
          <th scope="row"><UnknownCell value={workoutTime(row)} /></th><td>{typeLabel(row)}</td>
          <td><UnknownCell value={formatDuration(numeric(row.duration_seconds))} /></td>
          <td><UnknownCell value={measurement(row.distance_value, row.distance_unit)} /></td>
          <td><UnknownCell value={measurement(row.active_energy_value, row.active_energy_unit)} /></td>
          <td><UnknownCell value={numeric(row.avg_heart_rate) === null ? null : `${formatNumber(numeric(row.avg_heart_rate))} bpm`} /></td>
          <td><UnknownCell value={numeric(row.max_heart_rate) === null ? null : `${formatNumber(numeric(row.max_heart_rate))} bpm`} /></td>
          <td><UnknownCell value={setting(row.is_indoor)} /></td>
          <td><UnknownCell value={text(row.source_name)} /></td><td>{open(row)}</td>
        </tr>)}</tbody>
      </table>
    </ScrollTable>}
  </details>;
}

function WorkoutList({ rows, onOpen }: { rows: Workout[]; onOpen: (row: Workout, button: HTMLButtonElement) => void }) {
  const open = (row: Workout) => text(row.id) ? <button type="button" className="secondary-button"
    data-workout-id={String(row.id)} onClick={event => onOpen(row, event.currentTarget)}
    aria-label={`Open ${typeLabel(row)}, ${workoutTime(row) === 'Unknown' ? 'Not recorded' : workoutTime(row)}`}>Open</button> : <span>No detail</span>;
  return <>
    <ul className="workouts-history" aria-label="Recorded workout history">
      {rows.map((row, index) => {
        const time = workoutTime(row);
        const average = numeric(row.avg_heart_rate);
        const maximum = numeric(row.max_heart_rate);
        const duration = numeric(row.duration_seconds);
        return <li className="workouts-history-row" key={text(row.id) ?? `unknown-${index}`}>
          <div className="workouts-history-heading">
            <span className="workouts-history-glyph" data-class={classifyWorkout(row).toLowerCase()}><WorkoutGlyph type={workoutType(row)} /></span>
            <div><strong className="workouts-type-name" title={typeLabel(row)}>{typeLabel(row)}</strong><span>{time === 'Unknown' ? 'Not recorded' : time}</span></div>
          </div>
          <div className="workouts-history-values">
            <span><small>Duration</small>{duration === null || duration < 0 ? 'Not recorded' : formatDuration(duration)}</span>
            <span><small>Distance</small>{measurement(row.distance_value, row.distance_unit) ?? 'Not recorded'}</span>
            <span><small>Energy</small>{measurement(row.active_energy_value, row.active_energy_unit) ?? 'Not recorded'}</span>
            <span><small>Average HR</small>{average === null ? 'Not recorded' : `${formatNumber(average)} bpm`}</span>
            <span><small>Maximum HR</small>{maximum === null ? 'Not recorded' : `${formatNumber(maximum)} bpm`}</span>
          </div>
          <div className="workouts-history-action">{open(row)}</div>
        </li>;
      })}
    </ul>
    <WorkoutTable rows={rows} onOpen={onOpen} />
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
    <DailySectionHeader title="Workouts" headingId="workouts-heading" headingRef={heading}
      controls={!selected && <div className="daily-toolbar">
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
      </div>}
      freshness={result.last && <FreshnessLine observedAt={result.last.freshness.observedAt} count={result.items.length}
        partial={partial || result.last.status === 'partial'} />} />
    {selected && row && <WorkoutDetail key={String(row.id)} {...props} row={row} onBack={back} />}
    {selected && row && !loadedRow && <p role="status">Summary from the previous read.</p>}
    {selected && !row && <>
      <button type="button" className="secondary-button" onClick={back}>Back to workouts</button>
      {result.status === 'loading' || result.status === 'idle' || result.loadingMore || result.hasMore && !result.capped && !result.error
        ? <DailyState status="loading" />
        : <p role="status">Workout not found in the loaded period.</p>}
    </>}
    <div ref={list} hidden={selected !== null} aria-busy={result.status === 'loading' || result.loadingMore}>
      <WorkoutOverview {...props} pages={result} rows={filtered} />
      {(result.status === 'idle' || result.status === 'loading') && result.items.length === 0 && <DailyState status="loading" />}
      {result.items.length > 0 && <>
        <section className="workouts-history-card" aria-labelledby="workouts-list-heading">
          <h3 id="workouts-list-heading">Workout history</h3>
          {filtered.length === 0 ? <p>No workouts of this type.</p>
            : <WorkoutList rows={sortedWorkouts(filtered, sort)} onOpen={onOpen} />}
        </section>
      </>}
      {result.status === 'ready' && result.items.length === 0 && !result.error && <DailyState status="empty" />}
    </div>
    {result.error && <DailyState status="error" message={result.error} onRetry={result.reload} />}
    {result.hasMore && <div className="workouts-coverage" role="status">
      <p>Showing {result.items.length} workouts; more exist</p>
      {result.loadingMore && <p>Loading more workouts…</p>}
      {result.capped && <button className="secondary-button" type="button" onClick={result.loadMore}>Load more</button>}
    </div>}
    {result.status === 'loading' && result.items.length > 0 && <p className="daily-meta" role="status">Refreshing…</p>}
  </section>;
}
