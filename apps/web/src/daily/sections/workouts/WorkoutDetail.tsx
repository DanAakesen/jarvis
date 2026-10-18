import { useState } from 'react';
import { dailyQuerySources as sources, type DailyJson } from '@jarvis/contracts';
import type { ChartSeries } from '../../../chart-data';
import type { DailySectionProps } from '../types';
import { useDailyQuery } from '../../useDailyQuery';
import { useWorkoutPages } from './useWorkoutPages';
import { DailyChart } from '../../ui/DailyChart';
import { DailyState } from '../../ui/DailyState';
import { formatTime } from '../../ui/formatters';
import { numeric, text, typeLabel, type Workout } from './summary';
import { WorkoutFigures } from './WorkoutFigures';
import { workoutTime } from './presentation';

function HeartRate({ row, ...props }: DailySectionProps & { row: Workout }) {
  const [chosenMetric, setChosenMetric] = useState<string | null>(null);
  const result = useWorkoutPages(props.backendUrl, props.getAccessToken,
    { source: sources.heartRate, workoutId: String(row.id), limit: 500 }, props.refreshVersion);
  const groups = [...new Set(result.items.map(item => text(item.metric_name) ?? 'Unknown metric'))];
  const metric = chosenMetric && groups.includes(chosenMetric) ? chosenMetric
    : groups.find(name => /heart.?rate/iu.test(name)) ?? groups[0];
  const samples = result.items.filter(item => (text(item.metric_name) ?? 'Unknown metric') === metric);
  const units = [...new Set(samples.map(item => text(item.unit) ?? 'Unknown unit'))];
  const times = samples.map(item => Date.parse(text(item.sample_minute) ?? '')).filter(Number.isFinite);
  const recordedStart = Date.parse(text(row.start_at) ?? '');
  const start = Number.isFinite(recordedStart) ? recordedStart : times.length ? Math.min(...times) : 0;
  return <section className="workouts-heart-rate" aria-labelledby="workouts-heart-rate"
    aria-busy={result.status === 'loading' || result.loadingMore}>
    <h3 id="workouts-heart-rate">Heart rate</h3>
    <p>X: minutes from {Number.isFinite(recordedStart) ? 'workout start' : 'the first returned sample'}.
      Lines show the recorded minute average (solid), minimum (dashed) and maximum (dotted); gaps are not zero.</p>
    {groups.length > 1 && <label className="workouts-field">Metric
      <select value={metric} onChange={event => setChosenMetric(event.target.value)}>
        {groups.map(name => <option key={name}>{name}</option>)}
      </select>
    </label>}
    {(result.status === 'loading' || result.status === 'idle') && result.items.length === 0 && <DailyState status="loading" />}
    {result.error && <DailyState status="error" message={result.error} onRetry={result.reload} />}
    {result.status === 'ready' && result.items.length === 0 &&
      <p role="status">No heart-rate samples were returned for this workout; that does not prove none were recorded</p>}
    {result.hasMore && <p role="status">Showing {result.items.length} samples; more exist for this workout.
      {result.capped && <button type="button" className="secondary-button" onClick={result.loadMore}>Load more samples</button>}
    </p>}
    {units.map(unit => {
      const series: ChartSeries[] = [
        ['Average', 'avg_value'], ['Minimum', 'min_value'], ['Maximum', 'max_value'],
      ].map(([name, key]) => ({
        name: `${name} (${unit})`,
        points: samples.filter(item => (text(item.unit) ?? 'Unknown unit') === unit).flatMap(item => {
          const time = Date.parse(text(item.sample_minute) ?? '');
          const value = numeric(item[key!]);
          return Number.isFinite(time) && value !== null ? [{ x: (time - start) / 60_000, y: value }] : [];
        }),
      }));
      return <DailyChart key={unit} kind="line" name={`${metric} (${unit}), elapsed minutes${result.hasMore ? ', loaded samples only' : ''}`} series={series} />;
    })}
    {result.status === 'loading' && result.items.length > 0 && <p role="status">Refreshing recorded samples…</p>}
  </section>;
}

function RecordedDetail({ workoutId, ...props }: DailySectionProps & { workoutId: string }) {
  const result = useDailyQuery(props.backendUrl, props.getAccessToken,
    { source: sources.workout, workoutId }, props.refreshVersion);
  return <details className="daily-record-details">
    <summary>Recorded detail</summary>
    {result.pending && <DailyState status="loading" />}
    {result.error && <DailyState status="error" message={result.error} onRetry={result.reload} />}
    {result.data && result.data.items.length === 0 && <p>No recorded detail was returned for this workout.</p>}
    {result.data?.items.map((item: Record<string, DailyJson>, index) =>
      <pre key={index}>{JSON.stringify(item.detail, null, 2)}</pre>)}
  </details>;
}

export function WorkoutDetail({ row, onBack, ...props }: DailySectionProps & { row: Workout; onBack: () => void }) {
  return <div className="workouts-detail">
    <button type="button" className="secondary-button" onClick={onBack}>Back to workouts</button>
    <h3 tabIndex={-1} id="workouts-detail-heading">{typeLabel(row)} · {workoutTime(row)}
      {' to '}{formatTime(text(row.end_at))}</h3>
    <WorkoutFigures row={row} />
    {props.sources.includes(sources.heartRate) && <HeartRate {...props} row={row} />}
    {props.sources.includes(sources.workout) && <RecordedDetail {...props} workoutId={String(row.id)} />}
  </div>;
}
