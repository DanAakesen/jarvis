import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyQuery } from '@jarvis/contracts';
import { Loader } from '../../../Loader';
import { loadNutritionTargets, nutritionTargetsFailureMessage, NutritionTargetsError, type NutritionTargetValues, type NutritionTargetsState } from '../../nutrition-targets';
import { copenhagenDate } from '../../period';
import { DailyChart } from '../../ui/DailyChart';
import { DailySectionHeader } from '../../ui/DailySectionHeader';
import { DailyState } from '../../ui/DailyState';
import { DailyUnavailable } from '../../ui/DailyUnavailable';
import { FreshnessLine } from '../../ui/FreshnessLine';
import { ScrollTable } from '../../ui/ScrollTable';
import { formatClockTime, formatDate, formatNumber, formatTime } from '../../ui/formatters';
import { useDailyPages, type DailyPages } from '../../ui/useDailyPages';
import type { DailySectionProps } from '../types';
import { balancePoints, deleted, mealDate, nutrients, numeric, nutritionPeriodAverages, planItems, readableJson, sumNutrient, targetBaseline, text, trendPoints, type Row } from './totals';
import './nutrition.css';

const tabs = ['day', 'trend', 'library'] as const;
type View = typeof tabs[number];
const display = (value: number | null, unit: string) => value === null ? 'Not recorded' : `${formatNumber(value)} ${unit}`;
const macros = nutrients.slice(0, 4);
const nutrientLabel = (key: string, label: string) => key === 'energy_kcal' ? 'Calories' : label;
const dayWord = (count: number) => count === 1 ? 'day' : 'days';

function useTodayDate() {
  const [today, setToday] = useState(() => copenhagenDate());
  useEffect(() => {
    const refresh = () => setToday(copenhagenDate());
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}

function NutrientList({ row }: { row: Row }) {
  return <dl>{nutrients.map(nutrient => <div key={nutrient.key}>
    <dt>{nutrient.label}</dt><dd>{display(numeric(row[nutrient.key]), nutrient.unit)}</dd>
  </div>)}</dl>;
}

function PlanTotals({ row }: { row: Row }) {
  const items = planItems(row.items_json);
  if (items === null) return <>
    <p>Plan items unreadable; stored totals shown.</p>
    <NutrientList row={row} />
  </>;
  return <>
    <dl>{nutrients.map(nutrient => {
      const total = sumNutrient(items, nutrient.key);
      return <div key={nutrient.key}><dt>{nutrient.label}</dt><dd>{display(total.value, nutrient.unit)}
        {total.missing > 0 ? ` (${total.value === null ? 'unknown' : 'lower bound'}: at least, ${total.missing} ${total.missing === 1 ? 'item has' : 'items have'} no value)` : ''}</dd></div>;
    })}</dl>
  </>;
}

function RecordDetails({ row, name, meal = false }: { row: Row; name: string; meal?: boolean }) {
  return <details className="nutrition-record">
    <summary><span className="nutrition-summary-content"><span>{name}</span>
      {meal && <span>{typeof row.occurred_at === 'string' ? <time dateTime={row.occurred_at}>{formatTime(row.occurred_at)}</time> : 'Time unknown'}</span>}
      <span className="nutrition-meal-macros">{macros.map(nutrient => <span className="nutrition-macro-chip" key={nutrient.key}>
        {nutrientLabel(nutrient.key, nutrient.label)}: {display(numeric(row[nutrient.key]), nutrient.unit)}
      </span>)}</span>
    </span></summary>
    <NutrientList row={row} />
    {!meal && <p>Aliases: {readableJson(row.aliases_json)}</p>}
    {meal && <p>Type: {text(row.meal_type, 'Other')}. Confidence: {text(row.confidence)}. Capture method: {text(row.capture_method)}. Source: {text(row.source)}. Revision: {text(String(row.revision ?? 'Unknown'))}.</p>}
    <details><summary>Components</summary><pre>{readableJson(row.components_json)}</pre></details>
    <details><summary>Nutrient provenance</summary><pre>{readableJson(row.nutrient_provenance_json)}</pre></details>
  </details>;
}

function PagesState({ pages, label }: { pages: DailyPages; label: string }) {
  return <>
    {pages.status === 'loading' && <DailyState status="loading" />}
    {pages.error && <DailyState status="error" message={`${label}: ${pages.error}`} onRetry={pages.reload} />}
    {pages.hasMore && <>
      <DailyState status="partial" coverage={{ returned: pages.items.length, hasMore: true }}
        {...(!pages.capped ? { onLoadMore: pages.loadMore } : {})} />
      {pages.capped && <p>Page limit reached.</p>}
    </>}
  </>;
}

function targetLink() {
  return <Link to="/settings#nutrition-targets">Set targets in Settings</Link>;
}

function remaining(value: number | null, target: number | null, partial: boolean, unit: string, targetPending: boolean, targetError: boolean) {
  if (target === null) return targetPending ? 'Loading target' : targetError ? 'Target unavailable' : 'Target not set';
  if (value === null) return 'Not recorded';
  const amount = target - value;
  if (amount >= 0) return `${partial ? 'At most ' : ''}${formatNumber(amount)} ${unit} left`;
  return `${partial ? 'At least ' : ''}${formatNumber(-amount)} ${unit} over`;
}

function TodaySoFar({ props, targets }: {
  props: DailySectionProps;
  targets: { state: NutritionTargetsState | null; pending: boolean; error: string | null; retry: () => void };
}) {
  const today = useTodayDate();
  const served = props.sources.includes(sources.days);
  const pages = useDailyPages(props.backendUrl, props.getAccessToken,
    served ? { source: sources.days, startDate: today, endDate: today, limit: 1 } : null,
    props.refreshVersion, { autoLoad: true, maxPages: 1, settle: true });
  const row = pages.items[0] as Row | undefined;
  const energy = row ? numeric(row.energy_kcal) : pages.status === 'ready' ? 0 : null;
  const protein = row ? numeric(row.protein_grams) : pages.status === 'ready' ? 0 : null;
  const count = row ? numeric(row.meal_count) : pages.status === 'ready' ? 0 : null;
  const baseline = targets.state ? targetBaseline(targets.state.targets) : null;
  const proteinTarget = targets.state?.targets.proteinGrams ?? null;
  const partial = (key: string) => Array.isArray(row?.partial_nutrients) && row.partial_nutrients.includes(key);
  const hasTargetMissing = targets.state !== null &&
    (baseline === null || proteinTarget === null);
  return <article className="daily-stat-tile daily-today-card nutrition-today-card" aria-busy={pages.status === 'loading' || undefined}>
    <h3>Today so far</h3>
    <div className="daily-tile-body nutrition-today-body">
      {!served ? <DailyUnavailable>Daily nutrition day totals are not served.</DailyUnavailable>
        : pages.status === 'loading' && !pages.first ? <DailyState status="loading" />
          : pages.status === 'error' && !row ? <DailyState status="error" message={pages.error ?? 'Today’s nutrition totals could not be loaded.'} onRetry={pages.reload} />
            : <>
              <dl className="nutrition-today-values">
                <div><dt>kcal left</dt><dd>{remaining(energy, baseline, partial('energy_kcal'), 'kcal', targets.pending, targets.error !== null)}</dd></div>
                <div><dt>Protein left</dt><dd>{remaining(protein, proteinTarget, partial('protein_grams'), 'g', targets.pending, targets.error !== null)}</dd></div>
                <div><dt>Logged meals</dt><dd>{count === null ? 'Not recorded' : formatNumber(count)}</dd></div>
              </dl>
              {hasTargetMissing && <p className="nutrition-target-link">One or more targets are not set. {targetLink()}.</p>}
              {targets.pending && <Loader label="Loading nutrition targets" variant="inline" />}
              {targets.error && <DailyState status="error" message={targets.error} onRetry={targets.retry} />}
              {pages.error && row && <DailyState status="error" message={pages.error} onRetry={pages.reload} />}
            </>}
    </div>
    <div className="daily-tile-status">
      <p className="nutrition-freshness-pill" role="status">Staleness unknown</p>
      {pages.first && <FreshnessLine observedAt={pages.first.freshness.observedAt} count={count} recordLabel="meals"
        partial={pages.hasMore || pages.error !== null} />}
    </div>
  </article>;
}

function balanceLabel(value: number | null, lowerBound: boolean, count: number, missing: number) {
  if (value === null) return 'Not recorded';
  const direction = value >= 0 ? 'below' : 'above';
  const amount = `${formatNumber(Math.abs(value))} kcal ${direction} baseline`;
  const bound = lowerBound ? value >= 0 ? `At most ${amount}` : `At least ${amount}` : amount;
  return `${bound}; average over ${count} known ${dayWord(count)}${missing ? `, excluding ${missing} with unknown energy` : ''}`;
}

function averageProtein(value: number | null, lowerBound: boolean, count: number, missing: number) {
  if (value === null) return 'Not recorded';
  return `${lowerBound ? 'At least ' : ''}${formatNumber(value)} g/day${lowerBound ? ' (lower bound)' : ''}; average over ${count} known ${dayWord(count)}${missing ? `, excluding ${missing} with unknown protein` : ''}`;
}

function balanceValue(value: number | null, lowerBound: boolean) {
  if (value === null) return 'Not recorded';
  const direction = value >= 0 ? 'below' : 'above';
  const amount = `${formatNumber(Math.abs(value))} kcal ${direction} baseline`;
  return lowerBound ? value >= 0 ? `At most ${amount}` : `At least ${amount}` : amount;
}

function trendDataTable(rows: Row[], kind: 'balance' | 'protein', baseline: number | null) {
  const isBalance = kind === 'balance';
  const title = isBalance ? 'Daily calorie balance' : 'Daily protein intake';
  return <ScrollTable label={`${title} chart data`}><table>
    <caption>{title}; averages use known logged days only</caption>
    <thead><tr><th scope="col">Date</th><th scope="col">{isBalance ? 'Balance' : 'Protein'}</th><th scope="col">Data quality</th></tr></thead>
    <tbody>{rows.map(row => {
      const key = isBalance ? 'energy_kcal' : 'protein_grams';
      const raw = numeric(row[key]);
      const value = isBalance && raw !== null && baseline !== null ? baseline - raw : isBalance ? null : raw;
      const lowerBound = Array.isArray(row.partial_nutrients) && row.partial_nutrients.includes(key);
      const shown = isBalance ? balanceValue(value, lowerBound) : value === null
        ? 'Not recorded' : `${lowerBound ? 'At least ' : ''}${formatNumber(value)} g${lowerBound ? ' (lower bound)' : ''}`;
      return <tr key={text(row.meal_date)}><th scope="row">{text(row.meal_date)}</th><td>{shown}</td>
        <td>{lowerBound ? 'Lower-bound source total' : raw === null ? 'Not recorded' : 'Recorded'}</td></tr>;
    })}</tbody>
  </table></ScrollTable>;
}

function Trend({ days, targets, period, targetPending, targetError, retryTargets }: {
  days: DailyPages;
  targets: NutritionTargetValues | null;
  period: DailySectionProps['period'];
  targetPending: boolean;
  targetError: string | null;
  retryTargets: () => void;
}) {
  const rows = days.items;
  const periodDays = Math.round((Date.parse(period.endDate) - Date.parse(period.startDate)) / 86_400_000) + 1;
  const baseline = targets ? targetBaseline(targets) : null;
  const averages = nutritionPeriodAverages(rows, period, baseline);
  const hasMore = days.hasMore || days.capped;
  const partialDays = rows.filter(row => Array.isArray(row.partial_nutrients) && row.partial_nutrients.length > 0);
  const inventoryLabel = `${averages.daysWithData} of ${periodDays} ${dayWord(periodDays)} have meals; ${averages.partialDays} ${averages.partialDays === 1 ? 'day has' : 'days have'} partial nutrients.`;
  return <section className="nutrition-block nutrition-trend" aria-labelledby="nutrition-trend-heading">
    <h3 id="nutrition-trend-heading">Nutrition trend</h3>
    {targetPending && <Loader label="Loading nutrition targets" variant="inline" />}
    {targetError && <DailyState status="error" message={targetError} onRetry={retryTargets} />}
    <PagesState pages={days} label="Trend" />
    {(days.status === 'ready' || rows.length > 0) &&
      <p className="nutrition-inventory">{inventoryLabel}{hasMore ? ' Day inventory is partial.' : ''}</p>}
    {partialDays.length > 0 && <details className="nutrition-partial-days">
      <summary>Partial days ({partialDays.length})</summary>
      <ul>{partialDays.map(row => {
        const keys = Array.isArray(row.partial_nutrients) ? row.partial_nutrients : [];
        return <li key={text(row.meal_date)}>
          {text(row.meal_date)}: lower-bound {keys.map(key =>
            nutrients.find(nutrient => nutrient.key === String(key))?.label ?? String(key)).join(', ')}
        </li>;
      })}</ul>
    </details>}
    {days.status === 'ready' && !rows.length && <DailyState status="empty" />}
    {rows.length > 0 && <>
      <dl className="nutrition-period-averages">
        <div><dt>Average daily balance</dt><dd>{balanceLabel(averages.balance.value, averages.balance.lowerBound, averages.balance.count, averages.balance.missing)}</dd></div>
        <div><dt>Average protein</dt><dd>{averageProtein(averages.protein.value, averages.protein.lowerBound, averages.protein.count, averages.protein.missing)}</dd></div>
      </dl>
          {baseline === null && targets !== null && <p className="nutrition-partial">Calorie balance needs both resting energy and deficit targets. {targetLink()}.</p>}
      {rows.some(row => Array.isArray(row.partial_nutrients) && row.partial_nutrients.includes('energy_kcal')) &&
        <p className="nutrition-partial">Partial energy totals are lower bounds, so their calorie balances are upper bounds.</p>}
      {averages.protein.lowerBound && <p className="nutrition-partial">Partial protein totals are lower bounds.</p>}
      <div className="nutrition-charts">
        <DailyChart name="Daily calorie balance (kcal)" kind="bar"
          description="Balance is the resting-energy-minus-deficit target less logged energy. Positive values are below baseline; partial energy makes balance an upper bound."
          series={[{ name: 'Balance vs baseline (kcal)', points: balancePoints(rows, baseline) }]}
          target={{ value: 0, label: 'Baseline (0 kcal)' }} dataTable={trendDataTable(rows, 'balance', baseline)} />
        <DailyChart name="Daily protein intake (g)" kind="line"
          description="Daily logged protein. Partial protein totals are lower bounds."
          series={[{ name: 'Protein (g)', points: trendPoints(rows, 'protein_grams') }]}
          {...(targets?.proteinGrams !== null && targets ? { target: { value: targets.proteinGrams, label: 'Protein target (g)' } } : {})}
          dataTable={trendDataTable(rows, 'protein', baseline)} />
      </div>
    </>}
  </section>;
}

function componentEntries(value: Row[string] | undefined): unknown[] | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value.length > 16_000) return null;
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  return Array.isArray(parsed) ? parsed : null;
}

function componentRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function componentName(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value;
  const record = componentRecord(value);
  return typeof record?.name === 'string' && record.name.trim() ? record.name
    : typeof record?.food === 'string' && record.food.trim() ? record.food : 'Not recorded';
}

function componentQuantity(value: unknown) {
  const record = componentRecord(value);
  if (!record) return 'Not recorded';
  if (typeof record.grams === 'number' && Number.isFinite(record.grams)) return `${formatNumber(record.grams)} g`;
  const quantity = record.quantity ?? record.amount;
  if ((typeof quantity === 'number' && Number.isFinite(quantity) || typeof quantity === 'string' && quantity.trim()) &&
      typeof record.unit === 'string' && record.unit.trim()) return `${String(quantity)} ${record.unit}`;
  return 'Not recorded';
}

function mealProvenance(row: Row, key: string) {
  const parsed = componentRecord(row.nutrient_provenance_json);
  const sourceKey = key.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
  const entry = componentRecord(parsed?.[sourceKey]);
  return typeof entry?.source === 'string' ? entry.source : null;
}

function MealEntry({ row }: { row: Row }) {
  const components = componentEntries(row.components_json);
  const occurredAt = typeof row.occurred_at === 'string' && Number.isFinite(Date.parse(row.occurred_at)) ? row.occurred_at : null;
  const date = mealDate(row);
  const confidence = text(row.confidence, 'Not recorded');
  return <li className="nutrition-meal">
    <article>
      <h4>{text(row.meal_name, 'Not recorded')}</h4>
      {deleted(row) && <p className="nutrition-meal-deleted">Deleted</p>}
      <p className="nutrition-meal-time">{date && occurredAt
        ? <time dateTime={occurredAt}>{formatDate(date)} · {formatClockTime(occurredAt)}</time>
        : 'Not recorded'}</p>
      <dl className="nutrition-meal-macros">
        {macros.map(nutrient => {
          const value = numeric(row[nutrient.key]);
          const provenance = mealProvenance(row, nutrient.key);
          return <div key={nutrient.key}><dt>{nutrientLabel(nutrient.key, nutrient.label)}</dt>
            <dd>{display(value, nutrient.unit)}{value !== null && provenance === 'estimate' ? ' (estimate)' : ''}</dd></div>;
        })}
      </dl>
      <dl className="nutrition-meal-fields">
        <div><dt>Components</dt><dd>{components === null ? 'Not recorded' : components.length === 0 ? 'No components recorded' :
          <ul>{components.map((component, index) => <li key={index}>
            {componentName(component)} · {componentQuantity(component)}
          </li>)}</ul>}</dd></div>
        <div><dt>Confidence / uncertainty</dt><dd>{confidence}</dd></div>
        <div><dt>Capture method</dt><dd>{text(row.capture_method, 'Not recorded')}</dd></div>
        <div><dt>Export state</dt><dd>Not recorded (not served)</dd></div>
      </dl>
    </article>
  </li>;
}

function PeriodMeals({ props }: { props: DailySectionProps }) {
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [previous, setPrevious] = useState<Row[]>([]);
  const query: DailyQuery | null = props.sources.includes(sources.meals)
    ? { source: sources.meals, ...props.period, limit: 100, ...(cursor ? { cursor } : {}) } : null;
  const pages = useDailyPages(props.backendUrl, props.getAccessToken, query, props.refreshVersion, { maxPages: 50 });
  const rows = [...previous, ...pages.items as Row[]].sort((a, b) => {
    const first = Date.parse(text(a.occurred_at, ''));
    const second = Date.parse(text(b.occurred_at, ''));
    return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity);
  });
  const continuePages = () => {
    const next = pages.last?.coverage.next;
    if (!next || !('createdAt' in next) || !('id' in next)) return;
    setPrevious(rows);
    setCursor({ createdAt: next.createdAt, id: next.id });
  };
  return <section className="nutrition-block nutrition-meals-list" aria-labelledby="nutrition-meals-heading"
    aria-busy={pages.status === 'loading' || pages.loadingMore || undefined}>
    <h3 id="nutrition-meals-heading">Meals</h3>
    {!query ? <DailyUnavailable>Nutrition meals are not served.</DailyUnavailable> : <>
      {pages.status === 'loading' && !rows.length && <DailyState status="loading" />}
      {pages.error && <DailyState status="error" message={pages.error} onRetry={pages.reload} />}
      {pages.status === 'ready' && !rows.length && <DailyState status="empty" emptyMessage="No meals recorded in this period." />}
      <ul className="nutrition-meal-list">{rows.map((row, index) =>
        <MealEntry key={text(row.id, `meal-${index}`)} row={row} />)}</ul>
      {pages.hasMore && <p className="nutrition-page-status" role="status">
        Showing {formatNumber(rows.length)} meals.
        {pages.capped
          ? <> <button className="secondary-button" type="button" onClick={continuePages}>Continue loading meals</button></>
          : <> <button className="secondary-button" type="button" onClick={pages.loadMore}>Load more meals</button></>}
      </p>}
    </>}
  </section>;
}

function LibraryCollection({ props, kind, filter }: { props: DailySectionProps; kind: 'favorites' | 'plans'; filter: string }) {
  const query: DailyQuery = { source: sources[kind], limit: 100 };
  const pages = useDailyPages(props.backendUrl, props.getAccessToken, query, props.refreshVersion, { autoLoad: true, maxPages: 5 });
  const nameKey = kind === 'favorites' ? 'favorite_name' : 'plan_name';
  const matches = pages.items.filter(row => !deleted(row) &&
    [text(row[nameKey], ''), row.aliases_json ? readableJson(row.aliases_json) : '',
      kind === 'plans' ? text(row.description, '') : '',
      kind === 'plans' && row.items_json ? readableJson(row.items_json) : ''].join(' ').toLowerCase().includes(filter.toLowerCase()));
  return <section className="nutrition-block"><h3>{kind === 'favorites' ? 'Favourites' : 'Meal plans'}</h3>
    <PagesState pages={pages} label={kind === 'favorites' ? 'Favourites' : 'Meal plans'} />
    {pages.status === 'ready' && !matches.length && <p>{filter ? 'No matches' : kind === 'favorites' ? 'No favourites' : 'No meal plans'}</p>}
    {matches.map((row, index) => kind === 'favorites'
      ? <RecordDetails key={text(row.id, `favorite-${index}`)} row={row} name={text(row[nameKey], 'Unnamed favourite')} />
      : <details className="nutrition-record" key={text(row.id, `plan-${index}`)}><summary>{text(row[nameKey], 'Unnamed plan')}</summary>
        {text(row.description, '') && <p>{text(row.description, '')}</p>}
        <PlanTotals row={row} />
        <details><summary>Plan items</summary><pre>{readableJson(row.items_json)}</pre></details>
      </details>)}
  </section>;
}

export default function NutritionSection(props: DailySectionProps) {
  const [search, setSearch] = useSearchParams();
  const requestedView = search.get('nutritionView');
  const view: View = tabs.includes(requestedView as View) ? requestedView as View : 'day';
  const [filter, setFilter] = useState('');
  const [targetAttempt, setTargetAttempt] = useState(0);
  const [targetResult, setTargetResult] = useState<{ state: NutritionTargetsState | null; pending: boolean; error: string | null }>({ state: null, pending: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadNutritionTargets(props.backendUrl, props.getAccessToken, AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])).then(
      state => { if (active) setTargetResult({ state, pending: false, error: null }); },
      error => { if (active) setTargetResult({ state: null, pending: false, error: nutritionTargetsFailureMessage(error instanceof NutritionTargetsError ? error.kind : 'failed', 'load') }); },
    );
    return () => { active = false; controller.abort(); };
  }, [props.backendUrl, props.getAccessToken, props.refreshVersion, targetAttempt]);
  const update = (nextView: View) => setSearch(previous => {
    const next = new URLSearchParams(previous);
    next.set('nutritionView', nextView);
    return next;
  });
  const days = useDailyPages(props.backendUrl, props.getAccessToken,
    props.sources.includes(sources.days) ? { source: sources.days, ...props.period, limit: 400 } : null,
    props.refreshVersion, { autoLoad: true, maxPages: 1, settle: true });
  const targetProps = { ...targetResult, retry: () => setTargetAttempt(attempt => attempt + 1) };
  const availableTabs = tabs.filter(tab => tab === 'day' || tab === 'trend' && props.sources.includes(sources.days) ||
    tab === 'library' && (props.sources.includes(sources.favorites) || props.sources.includes(sources.plans)));
  const activeView = availableTabs.includes(view) ? view : 'day';
  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = availableTabs.indexOf(activeView);
    const next = event.key === 'ArrowRight' ? (index + 1) % availableTabs.length : event.key === 'ArrowLeft' ? (index - 1 + availableTabs.length) % availableTabs.length :
      event.key === 'Home' ? 0 : event.key === 'End' ? availableTabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    update(availableTabs[next]!);
    document.getElementById(`nutrition-tab-${availableTabs[next]}`)?.focus();
  }
  return <section className="daily-nutrition" aria-labelledby="nutrition-heading">
    <DailySectionHeader title="Nutrition" headingId="nutrition-heading" headingTabIndex={null}
      controls={<div className="daily-section-tabs" role="tablist" aria-label="Nutrition views" onKeyDown={onTabKeyDown}>
        {availableTabs.map(tab => <button type="button" className="daily-section-tab" role="tab" key={tab}
          id={`nutrition-tab-${tab}`} aria-controls="nutrition-panel" aria-selected={tab === activeView}
          tabIndex={tab === activeView ? 0 : -1} onClick={() => update(tab)}>{tab[0]!.toUpperCase() + tab.slice(1)}</button>)}
      </div>} />
    <div role="tabpanel" id="nutrition-panel" aria-labelledby={`nutrition-tab-${activeView}`} className="nutrition-block">
      {activeView === 'day' && <>
        <TodaySoFar props={props} targets={targetProps} />
        <PeriodMeals key={`${props.backendUrl}:${props.period.startDate}:${props.period.endDate}:${props.refreshVersion}`} props={props} />
      </>}
      {activeView === 'trend' && <>
        <Trend days={days} targets={targetResult.state?.targets ?? null} period={props.period}
          targetPending={targetResult.pending} targetError={targetResult.error} retryTargets={targetProps.retry} />
      </>}
      {activeView === 'library' && <>
        <label className="nutrition-filter">Filter loaded library <input type="search" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        {(['favorites', 'plans'] as const).filter(kind => props.sources.includes(sources[kind]))
          .map(kind => <LibraryCollection props={props} kind={kind} filter={filter} key={kind} />)}
      </>}
    </div>
  </section>;
}
