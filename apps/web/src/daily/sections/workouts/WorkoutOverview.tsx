import { Link } from 'react-router-dom';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import type { DailySectionProps } from '../types';
import { DailyChart } from '../../ui/DailyChart';
import { DailyState } from '../../ui/DailyState';
import { Ring } from '../../ui/Ring';
import { formatDuration, formatNumber } from '../../ui/formatters';
import { useDailyPages, type DailyPages } from '../../ui/useDailyPages';
import { summarizeWorkouts, type Workout } from './summary';
import { activityFigures, availableData, calories, classifyWorkout, nonnegative, periodTarget, sumKnown, trainingSummary } from './training';

export function TrainingRing({ label, count, target, days }: {
  label: string; count: number | null; target: number | null; days: number;
}) {
  const goal = periodTarget(target, days);
  return <div className="workouts-mini-ring">
    <Ring label={label} value={count} target={goal} centre={count === null ? '—' : formatNumber(count)}
      caption="Sessions in selected period"
      summary={`${count === null ? 'Not received' : `${count} sessions`}; ${goal === null ? 'no target set' : `${formatNumber(goal)} target for this period (${target} per week)`}`} />
    <p>{goal === null ? <Link to="/settings#training-targets">No target set</Link>
      : `${formatNumber(goal)} in period · ${target} / week`}</p>
  </div>;
}

function Figure({ label, value, loading = false }: { label: string; value: string | null; loading?: boolean }) {
  return <div><dt>{label}</dt><dd>{loading ? 'Loading…' : value ?? 'Not received'}</dd></div>;
}

function classFigures(rows: Workout[]) {
  const summary = summarizeWorkouts(rows);
  const averages = rows.flatMap(row => nonnegative(row.avg_heart_rate) === null ? [] : [Number(row.avg_heart_rate)]);
  const maxima = rows.flatMap(row => nonnegative(row.max_heart_rate) === null ? [] : [Number(row.max_heart_rate)]);
  return {
    time: summary.durationSeconds === null ? null : formatDuration(summary.durationSeconds),
    energy: sumKnown(rows.map(row => calories(row.active_energy_value, row.active_energy_unit))),
    distance: summary.distance.values.length ? summary.distance.values.map(item => `${formatNumber(item.value)} ${item.unit}`).join(' · ') : null,
    average: averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null,
    maximum: maxima.length ? Math.max(...maxima) : null,
  };
}

function ReadStatus({ pages, served, name }: { pages: DailyPages; served: boolean; name: string }) {
  return <div className="workouts-card-status" role="status">
    {!served ? <p>Unavailable. {name} is not served.</p>
      : pages.error ? <DailyState status="error" message={`Could not load ${name}. Please retry.`}
        onRetry={pages.reload} retryLabel={`Retry ${name}`} />
        : <p>{pages.status === 'loading' || pages.status === 'idle' ? `Loading ${name}…`
          : pages.loadingMore ? `Loading more ${name}…`
            : pages.hasMore || pages.last?.status === 'partial' ? `Partial ${name}: only loaded records are shown.`
              : `Loaded ${name} for the selected period; source completeness is unknown.`}</p>}
  </div>;
}

export function WorkoutOverview({ pages, rows, ...props }: DailySectionProps & { pages: DailyPages; rows: Workout[] }) {
  const hasMetrics = props.sources.includes(sources.metrics);
  const hasCatalogue = props.sources.includes(sources.metricCatalog);
  const metrics = useDailyPages(props.backendUrl, props.getAccessToken,
    hasMetrics ? { source: sources.metrics, ...props.period, limit: 500 } : null,
    props.refreshVersion, { autoLoad: true, maxPages: 10, settle: true });
  const catalogue = useDailyPages(props.backendUrl, props.getAccessToken,
    hasCatalogue ? { source: sources.metricCatalog, ...props.period, limit: 500 } : null,
    props.refreshVersion, { autoLoad: true, maxPages: 5, settle: true });
  const summary = trainingSummary(rows, props.period);
  const activity = activityFigures(metrics.items, props.period);
  const inventory = availableData(pages.items, catalogue.items, props.period);
  const pending = pages.first === null && pages.items.length === 0;
  const loading = pending && !pages.error;
  const metricsLoading = hasMetrics && metrics.first === null && metrics.error === null;
  const partial = pages.hasMore || pages.error !== null || pages.loadingMore || pages.status === 'loading' || pages.last?.status === 'partial';
  const amount = (value: number | null, unit: string) => value === null ? null : `${formatNumber(value)} ${unit}`;
  // A complete read with no sessions is a received zero; partial or loading reads stay unknown.
  const complete = !pending && !partial;
  return <div className="workouts-overview">
    <section className="daily-stat-tile workouts-training" aria-labelledby="workouts-training-heading">
      <h3 id="workouts-training-heading">Training</h3>
      <div className="workouts-training-body">
        <dl className="workouts-training-totals" aria-label="Workout summary">
          <Figure label="Sessions" value={pending ? null : formatNumber(summary.count)} loading={loading} />
          <Figure label="Calories burned" value={pending ? null : amount(complete && summary.count === 0 ? 0 : summary.energy, 'kcal')} loading={loading} />
        </dl>
        <div className="workouts-training-rings">
          {(['Gym', 'Run'] as const).map(label => <TrainingRing key={label} label={label}
            count={pending ? null : summary.rows.filter(row => classifyWorkout(row) === label).length} target={null} days={summary.days} />)}
        </div>
      </div>
      <p className="workouts-summary-note">Calories include only recorded workout energy with known units.
        Activity and unclassified workouts appear under Other. Days without received energy are gaps, not zero.
        Bars read Gym, Run, Other from left to right.</p>
      <div className="workouts-day-chart">
        {pages.first === null ? <p role="status">{pages.error ? 'Training unavailable. Retry the workout read below.' : 'Loading training…'}</p>
          : summary.count === 0 ? <p>No workouts in the selected period or type.</p>
            : <DailyChart kind="bar" name="Calories burned by Copenhagen day (kcal)"
              description="Recorded workout energy only. Missing values are gaps; totals may be lower bounds."
              series={(['Gym', 'Run', 'Other'] as const).map(name => ({
                name, points: summary.buckets.map(bucket => ({ x: bucket.date, y: bucket.values[name] })),
              }))} />}
      </div>
      <ul className="workouts-energy-legend" aria-label="Workout energy legend">
        {['Gym', 'Run', 'Other'].map((name, index) => <li key={name}><span aria-hidden="true">{index + 1}</span>{name}</li>)}
      </ul>
      <div className="workouts-card-status" role="status"><p>
        {pages.status === 'loading' || pages.loadingMore ? 'Loading workouts…'
          : pages.error ? 'Workout read incomplete. Retry below.'
            : partial ? 'Partial workout history.' : 'Selected period · Europe/Copenhagen · source completeness unknown'}
      </p><p>{partial ? `Lower bound in the ${summary.count} loaded. ` : ''}
        {summary.missingEnergy > 0 ? `${summary.missingEnergy} workout energy figures not received.` : ''}</p></div>
    </section>
    <div className="workouts-classes">
      {(['Gym', 'Run'] as const).map(name => {
        const classRows = summary.rows.filter(row => classifyWorkout(row) === name);
        const figures = classFigures(classRows);
        const none = complete && classRows.length === 0;
        return <section className="daily-stat-tile workouts-class" key={name} aria-label={`${name} class`}>
          <h3>{name}</h3>
          <dl className="workouts-class-figures">
            <Figure label="Time" value={pending ? null : none ? '0 min' : figures.time} loading={loading} />
            <Figure label="Energy" value={pending ? null : none ? '0 kcal' : amount(figures.energy, 'kcal')} loading={loading} />
            {name === 'Run' && <Figure label="Distance" value={pending ? null : figures.distance} loading={loading} />}
            <Figure label="Average heart rate" value={pending ? null : amount(figures.average, 'bpm')} loading={loading} />
            <Figure label="Maximum heart rate" value={pending ? null : amount(figures.maximum, 'bpm')} loading={loading} />
          </dl>
          <div className="workouts-card-status"><p>Known figures only{partial ? `, in the ${summary.count} loaded` : ''}.
            Average heart rate is the mean of received session averages, not a sample-weighted average.</p></div>
        </section>;
      })}
      <section className="daily-stat-tile workouts-class" aria-label="Activity class">
        <h3>Activity</h3>
        <dl className="workouts-class-figures">
          <Figure label="Steps" value={amount(activity.steps, 'steps')} loading={metricsLoading} />
          <Figure label="Active energy" value={amount(activity.energy, 'kcal')} loading={metricsLoading} />
          <Figure label="Activity time" value={activity.seconds === null ? null : formatDuration(activity.seconds)} loading={metricsLoading} />
        </dl>
        <ReadStatus pages={metrics} served={hasMetrics} name="activity metrics" />
        <p className="workouts-summary-note">Metrics per day, not a sum of workouts. Known values only; missing days are not zero.</p>
      </section>
    </div>
    <section className="daily-stat-tile workouts-inventory" aria-labelledby="workouts-inventory-heading">
      <h3 id="workouts-inventory-heading">Available data</h3>
      <p>Fields found in loaded workouts and the period’s metric catalogue. Catalogue entries identify retained records, not complete coverage or non-null values.</p>
      <div className="workouts-inventory-groups">{Object.entries(inventory).map(([group, entries]) =>
        <section key={group} aria-label={group}><h4>{group}</h4>
          <div className="workouts-inventory-list" tabIndex={0} role="region" aria-label={`${group} inventory`}>
            {entries.length ? <ul>{entries.map(entry => <li key={entry}>{entry}</li>)}</ul>
              : <p>No received fields in the loaded records.</p>}
          </div>
        </section>)}</div>
      <ReadStatus pages={catalogue} served={hasCatalogue} name="metric catalogue" />
      <p className="workouts-summary-note">{partial ? 'Workout inventory is partial. ' : ''}No workout detail or heart-rate samples are fetched for this inventory.</p>
    </section>
  </div>;
}
