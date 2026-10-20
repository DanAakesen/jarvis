import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuerySources as sources, type DailySourceId } from '@jarvis/contracts';
import { Loader } from '../../../Loader';
import { loadNutritionTargets, nutritionTargetsFailureMessage, NutritionTargetsError, type NutritionTargetsState } from '../../nutrition-targets';
import { DailyState } from '../../ui/DailyState';
import { DailyUnavailable } from '../../ui/DailyUnavailable';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { Ring } from '../../ui/Ring';
import { copenhagenDate } from '../../period';
import { formatClockTime, formatNumber } from '../../ui/formatters';
import { useDailyPages, type DailyPages } from '../../ui/useDailyPages';
import { deleted, numeric, targetBaseline, text, type Row as NutritionRow } from '../nutrition/totals';
import type { Workout } from '../workouts/summary';
import { latestNutritionDay, nutritionSummaryValues, overviewPeriods, trainingCounts } from './summary';

type Shared = {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  refreshVersion: number;
  today: string;
};

// Midday UTC of a calendar date is the same Copenhagen date, so it is safe to derive the periods from it.
const noonOf = (date: string) => new Date(`${date}T12:00:00Z`);

// The Copenhagen date, advanced at midnight, on focus and on becoming visible. Queries are keyed by it, so every
// refresh after a rollover asks for the new day instead of re-reading the old one under today's label.
function useToday() {
  const [today, setToday] = useState(() => copenhagenDate());
  useEffect(() => {
    const advance = () => setToday(copenhagenDate());
    const timer = setInterval(advance, 60_000);
    window.addEventListener('focus', advance);
    document.addEventListener('visibilitychange', advance);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', advance);
      document.removeEventListener('visibilitychange', advance);
    };
  }, []);
  return today;
}

function TodayCard({ title, section, pages, empty, emptyMessage, className = '', children }: {
  title: string;
  section: string;
  pages: DailyPages;
  empty: boolean;
  emptyMessage: string;
  className?: string;
  children: ReactNode;
}) {
  const hasItems = pages.items.length > 0;
  const refreshing = pages.status === 'loading' && pages.first !== null;
  // The body and status slots are always mounted and reserve their height, so a card keeps its size from skeleton to values.
  return <article className={`daily-stat-tile daily-today-card ${className}`.trim()} data-card={title.toLowerCase()}
    aria-busy={pages.status === 'loading' || pages.loadingMore || undefined}>
    <h3><Link to={`?section=${section}`}>{title}</Link></h3>
    <div className="daily-tile-body">
      {pages.status === 'loading' && !pages.first
        ? <Loader label={`Loading ${title.toLowerCase()}`} variant="lines" />
        : pages.status === 'error' && !hasItems
          ? <DailyState status="error" message={pages.error ?? 'Health history could not be loaded.'} onRetry={pages.reload} />
          : pages.first && empty
            ? <DailyState status="empty" emptyMessage={emptyMessage} />
            : children}
    </div>
    {pages.error && hasItems && <DailyState status="error" message={pages.error} onRetry={pages.reload} />}
    <div className="daily-tile-status">
      {refreshing ? <p className="daily-freshness" role="status">Refreshing…</p>
        : pages.first && <FreshnessLine observedAt={pages.first.freshness.observedAt}
          count={pages.items.length} partial={pages.hasMore || pages.error !== null} />}
    </div>
  </article>;
}

function UnavailableCard({ title, children, className = '' }: { title: string; children: string; className?: string }) {
  return <article className={`daily-stat-tile daily-today-card ${className}`.trim()}>
    <h3>{title}</h3>
    <DailyUnavailable>{children}</DailyUnavailable>
  </article>;
}

function TrainingCard({ backendUrl, getAccessToken, refreshVersion, today }: Shared) {
  const period = overviewPeriods(noonOf(today));
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.workouts, ...period.thisWeek, limit: 200,
  }, refreshVersion, { autoLoad: true, maxPages: 5, settle: true });
  const counts = trainingCounts(pages.items as Workout[], period.thisWeek);
  const rings = [
    { label: 'Strength', count: counts.strength },
    { label: 'Running', count: counts.running },
    { label: 'Other', count: counts.other },
  ];
  return <TodayCard title="Training this week" section="workouts" pages={pages} empty={pages.items.length === 0}
    emptyMessage="No workouts this week" className="daily-today-training">
    <div className="daily-today-rings">
      {rings.map(ring => <Ring key={ring.label} label={ring.label} value={ring.count} target={null}
        centre={formatNumber(ring.count)} summary={`${ring.count} ${ring.count === 1 ? 'session' : 'sessions'} this week, no target`} />)}
    </div>
    <DailyUnavailable>Weekly session targets are not served, so the rings show counts only.</DailyUnavailable>
    {pages.hasMore && <p className="daily-meta">Partial history</p>}
  </TodayCard>;
}

function useNutritionTargets({ backendUrl, getAccessToken }: Shared, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: NutritionTargetsState | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    void loadNutritionTargets(backendUrl, getAccessToken,
      AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])).then(
      state => { if (active) setResult({ attempt, state, error: null }); },
      error => {
        if (!active || controller.signal.aborted) return;
        const kind = error instanceof NutritionTargetsError ? error.kind : 'failed';
        setResult({ attempt, state: null, error: nutritionTargetsFailureMessage(kind, 'load') });
      },
    );
    return () => { active = false; controller.abort(); };
  }, [backendUrl, getAccessToken, attempt, enabled]);
  return { current: result?.attempt === attempt ? result : null, retry: () => setAttempt(value => value + 1) };
}

function TargetNote({ targets, retry, missing }: {
  targets: ReturnType<typeof useNutritionTargets>['current']; retry: () => void; missing: boolean;
}) {
  // The wrapper is always mounted, so the line the note needs is reserved before the targets arrive.
  return <div className="daily-today-note">
    {!targets ? <Loader label="Loading nutrition targets" variant="inline" />
      : targets.error ? <div role="alert"><p>{targets.error}</p>
        <button className="secondary-button" type="button" onClick={retry}>Retry targets</button></div>
        : missing ? <p className="daily-meta">Not set. <Link to="/settings#nutrition-targets">Set it in Settings</Link>.</p> : null}
  </div>;
}

function NutritionCards(shared: Shared) {
  const { backendUrl, getAccessToken, refreshVersion, today } = shared;
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.days, startDate: today, endDate: today, limit: 10,
  }, refreshVersion, { autoLoad: true, maxPages: 2, settle: true });
  const latest = latestNutritionDay(pages.items as NutritionRow[], { startDate: today, endDate: today });
  const targets = useNutritionTargets(shared, latest !== null);
  const values = latest ? nutritionSummaryValues(latest) : null;
  const partial = (key: string) => Array.isArray(latest?.partial_nutrients) && latest.partial_nutrients.includes(key);
  const state = targets.current?.state ?? null;
  const proteinTarget = state?.targets.proteinGrams ?? null;
  const baseline = state ? targetBaseline(state.targets) : null;
  const protein = values?.protein.value ?? null;
  const energy = values?.energy.value ?? null;
  const left = baseline !== null && energy !== null ? baseline - energy : null;
  // A lower-bound eaten total makes "left" an upper bound and "over" a lower bound, so the card says so in words too.
  const bound = partial('energy_kcal');
  const leftKind = left === null ? '' : left >= 0 ? 'left' : 'over';
  const leftBound = !bound || left === null ? '' : left >= 0 ? 'at most' : 'at least';
  return <>
    <TodayCard title="Protein today" section="nutrition" pages={pages} empty={!latest} emptyMessage="No meals logged today" className="daily-today-protein">
      <Ring label="Protein" value={protein} target={proteinTarget} reserveCaption
        centre={protein === null ? 'Unknown' : `${formatNumber(protein)} g`}
        caption={proteinTarget === null ? undefined : `of ${formatNumber(proteinTarget)} g${partial('protein_grams') ? ', lower bound' : ''}`}
        summary={protein === null ? 'unknown' : `${formatNumber(protein)} g${proteinTarget === null ? ', no target set' : ` of ${formatNumber(proteinTarget)} g`}`} />
      <TargetNote targets={targets.current} retry={targets.retry} missing={state !== null && proteinTarget === null} />
    </TodayCard>
    <TodayCard title="Calories left today" section="nutrition" pages={pages} empty={!latest} emptyMessage="No meals logged today" className="daily-today-calories">
      <Ring label="Calories" value={energy} target={baseline} reserveCaption
        centre={left === null ? (energy === null ? 'Unknown' : `${formatNumber(energy)} kcal`)
          : `${leftBound === 'at most' ? '≤ ' : leftBound === 'at least' ? '≥ ' : ''}${formatNumber(Math.abs(left))}`}
        caption={left === null ? undefined : `kcal ${leftKind}${leftBound ? `, ${leftBound}` : ''}`}
        summary={left === null ? (energy === null ? 'unknown' : `${formatNumber(energy)} kcal eaten${bound ? ' (lower bound)' : ''}, no baseline set`)
          : `${leftBound ? `${leftBound === 'at most' ? 'At most' : 'At least'} ` : ''}${formatNumber(Math.abs(left))} kcal ${leftKind} of ${formatNumber(baseline)} kcal${bound ? ', eaten is a lower bound' : ''}`} />
      <div className="daily-today-note daily-today-burn">{left !== null && <p className="daily-meta">Resting burn minus deficit, before activity{bound ? '. Eaten is a lower bound' : ''}</p>}</div>
      <TargetNote targets={targets.current} retry={targets.retry} missing={state !== null && baseline === null} />
    </TodayCard>
  </>;
}

function MealStrip({ backendUrl, getAccessToken, refreshVersion, today }: Shared) {
  const pages = useDailyPages(backendUrl, getAccessToken, {
    source: sources.meals, startDate: today, endDate: today, limit: 100,
  }, refreshVersion, { autoLoad: true, maxPages: 3, settle: true });
  const meals = (pages.items as NutritionRow[]).filter(row => !deleted(row)).sort((a, b) => {
    const first = Date.parse(text(a.occurred_at, ''));
    const second = Date.parse(text(b.occurred_at, ''));
    return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity);
  });
  return <TodayCard title="Meals today" section="nutrition" pages={pages} empty={meals.length === 0}
    emptyMessage="No meals logged today" className="daily-today-meals">
    <ul className="daily-meal-strip">
      {meals.map((row, index) => {
        const kcal = numeric(row.energy_kcal);
        return <li key={text(row.id, `meal-${index}`)}>
          <span className="daily-meal-time">{typeof row.occurred_at === 'string' ? formatClockTime(row.occurred_at) : 'Time unknown'}</span>
          <span className="daily-meal-name">{text(row.meal_name, 'Unnamed meal')}</span>
          <span className="daily-meal-kcal">{kcal === null ? 'kcal unknown' : `${formatNumber(kcal)} kcal`}</span>
        </li>;
      })}
    </ul>
    {pages.hasMore && <p className="daily-meta">Partial history</p>}
  </TodayCard>;
}

/** Today at a glance. Each card reads only served Daily sources; anything else says so. */
export function TodayCards({ backendUrl, getAccessToken, refreshVersion, available }: Omit<Shared, 'today'> & {
  available: readonly DailySourceId[];
}) {
  const today = useToday();
  const shared: Shared = { backendUrl, getAccessToken, refreshVersion, today };
  return <section className="daily-today" aria-label="Today at a glance">
    <div className="daily-today-grid">
      {available.includes(sources.workouts) ? <TrainingCard {...shared} />
        : <UnavailableCard title="Training this week" className="daily-today-training">Workouts are not served.</UnavailableCard>}
      {available.includes(sources.days) ? <NutritionCards {...shared} /> : <>
        <UnavailableCard title="Protein today">Nutrition totals for the day are not available.</UnavailableCard>
        <UnavailableCard title="Calories left today">Nutrition totals for the day are not available.</UnavailableCard>
      </>}
    </div>
    {available.includes(sources.meals) ? <MealStrip {...shared} />
      : <UnavailableCard title="Meals today" className="daily-today-meals">Meals are not served.</UnavailableCard>}
  </section>;
}
