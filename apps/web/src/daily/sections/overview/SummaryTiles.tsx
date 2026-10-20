import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { Loader } from '../../../Loader';
import { loadNutritionTargets, nutritionTargetsFailureMessage, NutritionTargetsError, type NutritionTargetsState } from '../../nutrition-targets';
import { useDailyPages, type DailyPages } from '../../ui/useDailyPages';
import { DailyState } from '../../ui/DailyState';
import { DailyGrid } from '../../ui/DailyGrid';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { Meter } from '../../ui/Meter';
import { Sparkline } from '../../ui/Sparkline';
import { WorkoutGlyph } from '../../ui/WorkoutGlyph';
import { formatClockTime, formatDate, formatDuration, formatNumber, formatTime } from '../../ui/formatters';
import { dateOnly, type Row as MetricRow } from '../body-sleep/metrics';
import { type Row as SleepRow } from '../body-sleep/metrics';
import { sumNutrient, targetBaseline, text, type Row as NutritionRow } from '../nutrition/totals';
import { briefLabel } from '../briefs/label';
import { type Workout, typeLabel, workoutType } from '../workouts/summary';
import { latestNutritionDay, latestSleepNight, nutritionSummaryValues, overviewPeriods, recentMeasurements,
  sleepSummaryValues, workoutOverview } from './summary';

const sections = {
  workouts: 'workouts',
  nutrition: 'nutrition',
  body: 'body-sleep',
  sleep: 'body-sleep',
  briefs: 'briefs',
} as const;

function SummaryTile({ title, section, pages, children, emptyMessage }: {
  title: string;
  section: keyof typeof sections;
  pages: DailyPages;
  children: ReactNode;
  emptyMessage: string;
}) {
  const hasItems = pages.items.length > 0;
  const refreshing = pages.status === 'loading' && pages.first !== null;
  // The body and status slots are always mounted and reserve their height, so a tile keeps its size from skeleton to values.
  return <article className="daily-stat-tile daily-summary-tile" data-tile={title.toLowerCase()}
    aria-busy={pages.status === 'loading' || pages.loadingMore || undefined}>
    <h3><Link to={`?section=${sections[section]}`}>{title}</Link></h3>
    <div className="daily-tile-body">
      {pages.status === 'loading' && !pages.first
        ? <Loader label={`Loading ${title.toLowerCase()} summary`} variant="lines" />
        : pages.status === 'error' && !hasItems
          ? <DailyState status="error" message={pages.error ?? 'Daily history could not be loaded.'} onRetry={pages.reload} />
          : pages.first && !hasItems
            ? <DailyState status="empty" emptyMessage={emptyMessage} />
            : children}
    </div>
    {pages.error && hasItems && <DailyState status="error" message={pages.error} onRetry={pages.reload} />}
    {/* A capped tile has no Load more and its freshness line already says "partial", so a loaded tile never gains this row. */}
    {pages.hasMore && !pages.capped && <DailyState status="partial" coverage={{ returned: pages.items.length, hasMore: true }}
      {...(!pages.loadingMore ? { onLoadMore: pages.loadMore } : {})} />}
    <div className="daily-tile-status">
      {refreshing ? <p className="daily-freshness" role="status">Refreshing…</p>
        : pages.first && <FreshnessLine observedAt={pages.first.freshness.observedAt}
          count={pages.items.length} partial={pages.hasMore || pages.error !== null} />}
    </div>
  </article>;
}

function WorkoutsTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.workouts, ...period.thirtyDays, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 10, settle: true });
  const summary = workoutOverview(pages.items as Workout[], period.thirtyDays, period.thisWeek);
  // No sessions is a known zero; unknown only means sessions exist without a recorded duration.
  const weekMinutes = summary.week.count === 0 ? 0
    : summary.week.durationSeconds === null ? null : summary.week.durationSeconds / 60;
  const latest = summary.latest?.row;
  return <SummaryTile title="Workouts" section="workouts" pages={pages} emptyMessage="No workout in the last 30 days">
    {latest ? <>
      <p className="daily-stat-value daily-summary-workout"><WorkoutGlyph type={workoutType(latest)} />{typeLabel(latest)}</p>
      <p>{formatDuration(typeof latest.duration_seconds === 'number' ? latest.duration_seconds : null)}
        {pages.hasMore ? ' · Partial history' : ''}</p>
      <p className="daily-meta">Started {formatClockTime(typeof latest.start_at === 'string' ? latest.start_at : null)}</p>
      <p className="daily-meta">{formatDate(summary.latest?.date)}</p>
    </> : <p>Latest workout: Unknown</p>}
    <p>This week: {formatNumber(summary.week.count)} {summary.week.count === 1 ? 'workout' : 'workouts'} · {formatNumber(weekMinutes)} {weekMinutes === 1 ? 'minute' : 'minutes'}{pages.hasMore || summary.week.missingDuration > 0 ? ' (partial)' : ''}</p>
    {summary.week.missingDuration > 0 && <p>{summary.week.missingDuration} {summary.week.missingDuration === 1 ? 'workout has' : 'workouts have'} unknown duration.</p>}
  </SummaryTile>;
}

function NutritionTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.days, ...period.sevenDays, limit: 400,
  }, refreshVersion, { autoLoad: true, maxPages: 5, settle: true });
  const latest = latestNutritionDay(pages.items as NutritionRow[], period.sevenDays);
  const [targetAttempt, setTargetAttempt] = useState(0);
  const [targetResult, setTargetResult] = useState<{
    key: string; attempt: number; state: NutritionTargetsState | null; error: string | null;
  }>({ key: '', attempt: 0, state: null, error: null });
  const latestKey = latest ? text(latest.meal_date, '') : '';
  useEffect(() => {
    if (!latestKey) return;
    const controller = new AbortController();
    let active = true;
    void loadNutritionTargets(backendUrl, getAccessToken,
      AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])).then(
      state => { if (active) setTargetResult({ key: latestKey, attempt: targetAttempt, state, error: null }); },
      error => {
        if (!active || controller.signal.aborted) return;
        const kind = error instanceof NutritionTargetsError ? error.kind : 'failed';
        setTargetResult({ key: latestKey, attempt: targetAttempt, state: null, error: nutritionTargetsFailureMessage(kind, 'load') });
      },
    );
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, latestKey, targetAttempt]);
  const values = latest ? nutritionSummaryValues(latest) : null;
  const partial = (key: string) => Array.isArray(latest?.partial_nutrients) && latest.partial_nutrients.includes(key);
  const currentTargetResult = targetResult.key === latestKey && targetResult.attempt === targetAttempt ? targetResult : null;
  const baseline = currentTargetResult?.state ? targetBaseline(currentTargetResult.state.targets) : null;
  const proteinTarget = currentTargetResult?.state?.targets.proteinGrams ?? null;
  return <SummaryTile title="Nutrition" section="nutrition" pages={pages} emptyMessage="No meals recorded in the last 7 days">
    {latest && values && <>
      <p className="daily-meta">{latestKey === period.sevenDays.endDate ? 'Today' : `Latest day with meals: ${formatDate(latestKey)}`}</p>
      <p className="daily-stat-value">Energy: {formatNumber(values.energy.value)} kcal{partial('energy_kcal') ? ' (lower bound)' : ''}</p>
      <div className="daily-summary-target">
        {!currentTargetResult && <Loader label="Loading nutrition targets" variant="inline" />}
        {currentTargetResult?.state && (baseline === null || baseline > 0
          ? <Meter label="Energy intake against baseline allowance" value={values.energy.value}
            target={baseline} unit="kcal" partial={partial('energy_kcal')} />
          : <p>Baseline allowance: {formatNumber(baseline)} kcal.</p>)}
      </div>
      <p className="daily-summary-macros">
        <span>Protein: {formatNumber(values.protein.value)} g{partial('protein_grams') ? ' (lower bound)' : ''}.</span>
        <span>Carbohydrate: {formatNumber(sumNutrient([latest], 'carbohydrates_grams').value)} g{partial('carbohydrates_grams') ? ' (lower bound)' : ''}.</span>
        <span>Fat: {formatNumber(sumNutrient([latest], 'fat_grams').value)} g{partial('fat_grams') ? ' (lower bound)' : ''}.</span>
      </p>
      {proteinTarget !== null && <p className="daily-meta">Protein target: {formatNumber(proteinTarget)} g</p>}
    </>}
    {!latest && <p>No meals recorded in the last 7 days</p>}
    {currentTargetResult?.error && <div role="alert"><p>{currentTargetResult.error}</p>
      <button className="secondary-button" type="button" onClick={() => setTargetAttempt(attempt => attempt + 1)}>Retry targets</button>
    </div>}
    {currentTargetResult?.state?.missing.length ? <p>Targets are not set. <Link to="/settings#nutrition-targets">Set them in Settings</Link>.</p> : null}
  </SummaryTile>;
}

function BodyTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.metrics, ...period.thirtyDays, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 5, settle: true });
  const measurements = recentMeasurements(pages.items as MetricRow[]);
  return <SummaryTile title="Body" section="body" pages={pages} emptyMessage="No measurements returned in the last 30 days">
    {measurements[0] ? <>
      <p className="daily-stat-value">{formatNumber(measurements[0].latest?.value)} {measurements[0].unit ?? 'Unknown unit'}
        {pages.hasMore ? ' (partial history)' : ''}</p>
      <p>{measurements[0].label} · {formatDate(measurements[0].latest?.date)}</p>
      <Sparkline values={measurements[0].readings.map(reading => reading.value)}
        label={`${measurements[0].label} (${measurements[0].unit ?? 'unknown unit'}), recorded observations over the last 30 days; gaps are unknown`} />
      <p>Change since previous: {formatNumber(measurements[0].change)}{measurements[0].unit ? ` ${measurements[0].unit}` : ''}</p>
    </> : <p className="daily-stat-value">Unknown</p>}
  </SummaryTile>;
}

function SleepTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.sleep, ...period.sevenDays, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 5, settle: true });
  const latest = latestSleepNight(pages.items as SleepRow[], period.sevenDays);
  const summary = latest ? sleepSummaryValues(latest) : null;
  // Staged exports report asleep as 0 while total sleep is recorded, so total leads and asleep is only a fallback.
  const headline = summary ? summary.total ?? summary.asleep : null;
  const asleepRow = summary !== null && summary.total !== null && summary.asleep !== null &&
    summary.asleep > 0 && summary.asleep !== summary.total;
  return <SummaryTile title="Sleep" section="sleep" pages={pages} emptyMessage="No sleep recorded in the last 7 days">
    {latest && summary && <>
      <p className="daily-stat-value">{headline === null ? 'Unknown' : `${formatNumber(headline)} h ${summary.total === null ? 'asleep' : 'total sleep'}`}{pages.hasMore ? ' (partial history)' : ''}</p>
      <p>Latest night: {formatDate(dateOnly(latest.sleep_date))}</p>
      {asleepRow && <p>Asleep: {formatNumber(summary.asleep)} h</p>}
      <p>{summary.stages.length ? summary.stages.map(stage => `${stage.label}: ${formatNumber(stage.value)} h`).join(' · ') : 'Stages: Unknown'}</p>
    </>}
    {!latest && <p>Latest night: Unknown</p>}
  </SummaryTile>;
}

function BriefsTile({ backendUrl, getAccessToken, refreshVersion }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
}) {
  const query: DailyQuery = { source: sources.briefs, limit: 50 };
  const pages = useDailyPages(backendUrl, getAccessToken, query, refreshVersion, { autoLoad: true, maxPages: 5, settle: true });
  const latest = pages.items[0];
  return <SummaryTile title="Briefs" section="briefs" pages={pages} emptyMessage="No briefs returned">
    {latest && <>
      <p className="daily-stat-value">{briefLabel(latest)}{pages.hasMore ? ' (partial history)' : ''}</p>
      <p>{formatTime(text(latest.started_at, ''))}</p>
    </>}
  </SummaryTile>;
}

export function OverviewSummaryTiles({ backendUrl, getAccessToken, refreshVersion, available }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  available: readonly DailySourceId[];
}) {
  const period = overviewPeriods();
  return <section className="daily-summary" aria-label="Today summaries">
    <DailyGrid className="daily-summary-grid">
      {available.includes(sources.workouts) && <WorkoutsTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.days) && available.includes(sources.meals) &&
        <NutritionTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.metrics) && available.includes(sources.metricCatalog) &&
        <BodyTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.sleep) && <SleepTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.briefs) && available.includes(sources.brief) &&
        <BriefsTile backendUrl={backendUrl} getAccessToken={getAccessToken} refreshVersion={refreshVersion} />}
    </DailyGrid>
  </section>;
}
