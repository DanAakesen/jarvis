import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { Loader } from '../../../Loader';
import { loadNutritionTargets, nutritionTargetsFailureMessage, NutritionTargetsError, type NutritionTargetsState } from '../../nutrition-targets';
import { useDailyPages, type DailyPages } from '../../ui/useDailyPages';
import { DailyState } from '../../ui/DailyState';
import { formatDate, formatDuration, formatNumber } from '../../ui/formatters';
import { dateOnly, type Row as MetricRow } from '../body-sleep/metrics';
import { type Row as SleepRow } from '../body-sleep/metrics';
import { targetBaseline, text, type Row as NutritionRow } from '../nutrition/totals';
import { type Workout, typeLabel } from '../workouts/summary';
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
  return <article className="daily-stat-tile daily-summary-tile" aria-busy={pages.status === 'loading' || pages.loadingMore || undefined}>
    <h4><Link to={`?section=${sections[section]}`}>{title}</Link></h4>
    {pages.status === 'loading' && !hasItems
      ? <Loader label={`Loading ${title.toLowerCase()} summary`} variant="rows" />
      : pages.status === 'error' && !hasItems
        ? <DailyState status="error" message={pages.error ?? 'Daily history could not be loaded.'} onRetry={pages.reload} />
        : pages.status === 'ready' && !hasItems
          ? <DailyState status="empty" emptyMessage={emptyMessage} />
          : children}
    {pages.status === 'loading' && hasItems && <p role="status">Refreshing this summary…</p>}
    {pages.error && hasItems && <DailyState status="error" message={pages.error} onRetry={pages.reload} />}
    {pages.hasMore && <DailyState status="partial" coverage={{ returned: pages.items.length, hasMore: true }}
      {...(!pages.capped && !pages.loadingMore ? { onLoadMore: pages.loadMore } : {})} />}
    {pages.first && <DailyState status="ready" freshness={pages.first.freshness} />}
  </article>;
}

function WorkoutsTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.workouts, ...period.thirtyDays, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 10 });
  const summary = workoutOverview(pages.items as Workout[], period.thirtyDays, period.thisWeek);
  const latest = summary.latest?.row;
  return <SummaryTile title="Workouts" section="workouts" pages={pages} emptyMessage="No workout in the last 30 days">
    {latest && <dl className="daily-summary-facts">
      <div><dt>Most recent</dt><dd>{typeLabel(latest)}</dd></div>
      <div><dt>Date</dt><dd>{formatDate(summary.latest?.date)}</dd></div>
      <div><dt>Duration</dt><dd>{formatDuration(typeof latest.duration_seconds === 'number' ? latest.duration_seconds : null)}</dd></div>
    </dl>}
    <p>This week: {formatNumber(summary.week.count)} workouts · {formatNumber(summary.week.durationSeconds === null
      ? null : summary.week.durationSeconds / 60)} minutes</p>
    {summary.week.missingDuration > 0 && <p>{summary.week.missingDuration} workouts have unknown duration.</p>}
  </SummaryTile>;
}

function NutritionTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.days, ...period.sevenDays, limit: 400,
  }, refreshVersion, { autoLoad: true, maxPages: 5 });
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
      <p>Latest day with meals: {formatDate(text(latest.meal_date, ''))}</p>
      <p>Energy: {formatNumber(values.energy.value)} kcal{partial('energy_kcal') ? ' (lower bound)' : ''}.</p>
      <p>Protein: {formatNumber(values.protein.value)} g{partial('protein_grams') ? ' (lower bound)' : ''}.</p>
      {baseline !== null && <p>Resting burn minus deficit (before activity): {formatNumber(baseline)} kcal baseline allowance.</p>}
      {proteinTarget !== null && <p>Protein: {formatNumber(values.protein.value)} g of {formatNumber(proteinTarget)} g target.</p>}
    </>}
    {latestKey && !currentTargetResult && <Loader label="Loading nutrition targets" variant="inline" />}
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
  }, refreshVersion, { autoLoad: true, maxPages: 5 });
  const measurements = recentMeasurements(pages.items as MetricRow[]);
  return <SummaryTile title="Body" section="body" pages={pages} emptyMessage="No measurements returned in the last 30 days">
    {measurements.length > 0
      ? <dl className="daily-summary-facts">{measurements.map(item => <div key={`${item.name}:${item.unit ?? ''}`}>
        <dt>{item.label}</dt>
        <dd>{formatNumber(item.latest?.value)} {item.unit ?? 'Unknown unit'} · {formatDate(item.latest?.date)}</dd>
        <dd>Change since previous: {formatNumber(item.change)}{item.unit ? ` ${item.unit}` : ''}</dd>
      </div>)}</dl>
      : <p>Unknown</p>}
  </SummaryTile>;
}

function SleepTile({ backendUrl, getAccessToken, refreshVersion, period }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  period: ReturnType<typeof overviewPeriods>;
}) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.sleep, ...period.sevenDays, limit: 500,
  }, refreshVersion, { autoLoad: true, maxPages: 5 });
  const latest = latestSleepNight(pages.items as SleepRow[], period.sevenDays);
  const summary = latest ? sleepSummaryValues(latest) : null;
  return <SummaryTile title="Sleep" section="sleep" pages={pages} emptyMessage="No sleep recorded in the last 7 days">
    {latest && summary && <>
      <p>Latest night: {formatDate(dateOnly(latest.sleep_date))}</p>
      <p>Total: {formatNumber(summary.total)} h · Asleep: {formatNumber(summary.asleep)} h</p>
      <p>{summary.stages.length ? summary.stages.map(stage => `${stage.label}: ${formatNumber(stage.value)} h`).join(' · ') : 'Stages: Unknown'}</p>
    </>}
  </SummaryTile>;
}

function BriefsTile({ backendUrl, getAccessToken, refreshVersion }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
}) {
  const query: DailyQuery = { source: sources.briefs, limit: 50 };
  const pages = useDailyPages(backendUrl, getAccessToken, query, refreshVersion, { autoLoad: true, maxPages: 5 });
  const latest = pages.items[0];
  return <SummaryTile title="Briefs" section="briefs" pages={pages} emptyMessage="No briefs returned">
    {latest && <>
      <p>{text(latest.title) ?? text(latest.kind) ?? 'Unknown'}</p>
      <p>{formatDate(text(latest.started_at, ''))}</p>
    </>}
  </SummaryTile>;
}

export function OverviewSummaryTiles({ backendUrl, getAccessToken, refreshVersion, available }: {
  backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number;
  available: readonly DailySourceId[];
}) {
  const period = overviewPeriods();
  return <section className="daily-summary" aria-label="Recent summaries">
    <h3>Recent summaries</h3>
    <div className="daily-summary-grid">
      {available.includes(sources.workouts) && <WorkoutsTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.days) && available.includes(sources.meals) &&
        <NutritionTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.metrics) && available.includes(sources.metricCatalog) &&
        <BodyTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.sleep) && <SleepTile {...{ backendUrl, getAccessToken, refreshVersion, period }} />}
      {available.includes(sources.briefs) && available.includes(sources.brief) &&
        <BriefsTile backendUrl={backendUrl} getAccessToken={getAccessToken} refreshVersion={refreshVersion} />}
    </div>
  </section>;
}
