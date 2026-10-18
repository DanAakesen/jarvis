import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dailyQuerySources as sources, type DailyQuery } from '@jarvis/contracts';
import { Loader } from '../../../Loader';
import { loadNutritionTargets, nutritionTargetsFailureMessage, NutritionTargetsError, type NutritionTargetsState } from '../../nutrition-targets';
import { copenhagenDate, isDailyPeriod } from '../../period';
import { DailyChart } from '../../ui/DailyChart';
import { DailyState } from '../../ui/DailyState';
import { ScrollTable } from '../../ui/ScrollTable';
import { StatTile } from '../../ui/StatTile';
import { formatNumber, formatTime } from '../../ui/formatters';
import { useDailyPages, type DailyPages } from '../../ui/useDailyPages';
import { useDailyQuery } from '../../useDailyQuery';
import type { DailySectionProps } from '../types';
import { dateStep, deleted, groupedMeals, mealDate, nutrients, numeric, planItems, proteinTargetComparison, readableJson, sumNutrient, targetBaseline, text, trendSeries, weeklyAverages, type Row } from './totals';
import './nutrition.css';

const tabs = ['day', 'trend', 'library'] as const;
type View = typeof tabs[number];
const display = (value: number | null, unit: string) => value === null ? 'Unknown' : `${formatNumber(value)} ${unit}`;

function NutrientList({ row }: { row: Row }) {
  return <dl>{nutrients.map(nutrient => <div key={nutrient.key}>
    <dt>{nutrient.label}</dt><dd>{display(numeric(row[nutrient.key]), nutrient.unit)}</dd>
  </div>)}</dl>;
}

function PlanTotals({ row }: { row: Row }) {
  const items = planItems(row.items_json);
  if (items === null) return <>
    <p>Plan items could not be interpreted. Stored plan totals follow; their item-level completeness is unknown.</p>
    <NutrientList row={row} />
  </>;
  return <>
    <p>Totals from {items.length} stored plan items; missing values are unknown, not zero.</p>
    <dl>{nutrients.map(nutrient => {
      const total = sumNutrient(items, nutrient.key);
      return <div key={nutrient.key}><dt>{nutrient.label}</dt><dd>{display(total.value, nutrient.unit)}
        {total.missing > 0 ? ` (${total.value === null ? 'unknown' : 'lower bound'}: at least, ${total.missing} items have no value)` : ''}</dd></div>;
    })}</dl>
  </>;
}

function RecordDetails({ row, name, meal = false }: { row: Row; name: string; meal?: boolean }) {
  return <details className="nutrition-record">
    <summary><span className="nutrition-summary-content"><span>{name}</span>
      {meal && <span>{typeof row.occurred_at === 'string' ? <time dateTime={row.occurred_at}>{formatTime(row.occurred_at)}</time> : 'Time unknown'}</span>}
      <span className="nutrition-meal-macros">{meal ? `Type: ${text(row.meal_type, 'Other')} · ` : 'Serving macros: '}
        {nutrients.map(nutrient => `${nutrient.label}: ${display(numeric(row[nutrient.key]), nutrient.unit)}`).join(' · ')}</span>
    </span></summary>
    <NutrientList row={row} />
    {meal && <p>Confidence: {text(row.confidence)}. Capture method: {text(row.capture_method)}. Source: {text(row.source)}. Revision: {text(String(row.revision ?? 'Unknown'))}.</p>}
    <details><summary>Components</summary><pre>{readableJson(row.components_json)}</pre></details>
    <details><summary>Nutrient provenance</summary><pre>{readableJson(row.nutrient_provenance_json)}</pre></details>
  </details>;
}

function PagesState({ pages, label }: { pages: DailyPages; label: string }) {
  return <>
    {pages.status === 'loading' && <DailyState status="loading" />}
    {pages.error && <DailyState status="error" message={`${label}: ${pages.error}`} onRetry={pages.reload} />}
    {pages.hasMore && <><p>Partial {label.toLowerCase()}: only loaded records are shown{pages.capped ? ' (page limit reached)' : ''}.</p>
      <DailyState status="partial" coverage={{ returned: pages.items.length, hasMore: true }}
        {...(!pages.capped ? { onLoadMore: pages.loadMore } : {})} /></>}
  </>;
}

function Targets({ state, pending, error, retry, rows, showProgress = true }: {
  state: NutritionTargetsState | null; pending: boolean; error: string | null; retry: () => void; rows: Row[]; showProgress?: boolean;
}) {
  const protein = proteinTargetComparison(rows, state?.targets.proteinGrams ?? null);
  const baseline = state ? targetBaseline(state.targets) : null;
  return <div className="nutrition-block">
    {pending && <Loader label="Loading nutrition targets" variant="inline" />}
    {error && <DailyState status="error" message={error} onRetry={retry} />}
    {state && <>
      {showProgress && protein !== null && <div>
        <p>Protein: {display(protein.value, 'g')} of {formatNumber(protein.target)} g target{protein.missing ? ' (lower bound)' : ''}.</p>
        {protein.progressValue !== null && <progress aria-label="Protein target progress"
          value={protein.progressValue} max={protein.target} />}
      </div>}
      {baseline !== null && <p>Resting burn minus deficit (before activity): {formatNumber(baseline)} kcal baseline allowance. Active energy is not included; this is not the full daily allowance.</p>}
      {state.missing.length > 0 && <p>Targets are not set. <Link to="/settings#nutrition-targets">Set them in Settings</Link>.</p>}
    </>}
  </div>;
}

function Day({ props, date, setDate, days, targets }: {
  props: DailySectionProps; date: string; setDate: (date: string) => void; days: DailyPages;
  targets: Omit<Parameters<typeof Targets>[0], 'rows'>;
}) {
  const today = copenhagenDate();
  const query: DailyQuery | null = props.sources.includes(sources.meals)
    ? { source: sources.meals, startDate: date, endDate: date, limit: 100 } : null;
  const result = useDailyQuery(props.backendUrl, props.getAccessToken, query, props.refreshVersion);
  const rows = (result.data?.items ?? []).filter(row => mealDate(row) === date);
  const active = rows.filter(row => !deleted(row));
  const removed = rows.filter(deleted);
  const knownDays = days.items.map(row => text(row.meal_date)).filter(day => day <= today).sort();
  const previous = knownDays.filter(day => day < date).at(-1);
  const next = knownDays.find(day => day > date);
  return <div className="nutrition-block">
    <div className="nutrition-controls">
      <button type="button" className="secondary-button" aria-label={`Previous day, ${dateStep(date, -1)}`} onClick={() => setDate(dateStep(date, -1))}>Previous day</button>
      <label>Meal date <input aria-label="Meal date" type="date" value={date} max={today}
        onChange={event => {
          const value = event.target.value;
          if (isDailyPeriod({ startDate: value, endDate: value }) && value <= today) setDate(value);
        }} /></label>
      <button type="button" className="secondary-button" aria-label={`Next day, ${dateStep(date, 1)}`} disabled={date >= today} onClick={() => setDate(dateStep(date, 1))}>Next day</button>
      <button type="button" className="secondary-button" aria-label={`Today, ${today}`} disabled={date === today} onClick={() => setDate(today)}>Today</button>
    </div>
    <div className="nutrition-block nutrition-day-content">
    {result.pending && <DailyState status="loading" />}
    {result.error && <DailyState status="error" message={result.error} onRetry={result.reload} />}
    {result.data && <>
      {result.data.coverage.hasMore && <p role="status">Partial day: showing {result.data.coverage.returned} meals from the first page (up to 100). Totals cover only displayed non-deleted meals and are lower bounds.</p>}
      <div className="nutrition-stats">{nutrients.map(nutrient => {
        const total = sumNutrient(rows, nutrient.key);
        return <StatTile key={nutrient.key} label={nutrient.label} value={total.value} unit={nutrient.unit}
          note={total.missing ? `Partial: at least, ${total.missing} meals have no value for ${nutrient.label.toLowerCase()}. Known values only.` :
            result.data?.coverage.hasMore ? 'Partial page: lower bound.' : undefined} />;
      })}</div>
      <Targets {...targets} rows={rows} />
      {!active.length && <div>
        <p>No meals recorded for this day. That does not prove nothing was eaten.</p>
        {props.sources.includes(sources.days) && <><p>Known logged days in {props.period.startDate}–{props.period.endDate}:</p>
          {previous && <button className="secondary-button" type="button" onClick={() => setDate(previous)}>Previous logged day: {previous}</button>}
          {next && <button className="secondary-button" type="button" onClick={() => setDate(next)}>Next logged day: {next}</button>}
          {!previous && !next && <p>No other logged days returned in this period.</p>}
          <PagesState pages={days} label="Logged days" /></>}
      </div>}
      {groupedMeals(rows).map(([group, meals]) => <section className="nutrition-block" key={group}>
        <h3>{group}</h3>{meals.map((row, index) => <RecordDetails key={text(row.id, `unknown-${index}`)} row={row} name={text(row.meal_name, 'Unnamed meal')} meal />)}
      </section>)}
      {removed.length > 0 && <details><summary>Deleted meals ({removed.length}; excluded from totals)</summary>
        {removed.map((row, index) => <RecordDetails key={text(row.id, `deleted-${index}`)} row={row} name={text(row.meal_name, 'Unnamed deleted meal')} meal />)}
      </details>}
      <DailyState status="ready" freshness={result.data.freshness} />
    </>}
    </div>
  </div>;
}

function Trend({ days, select, targets, period }: { days: DailyPages; select: (date: string) => void; targets: NutritionTargetsState | null; period: DailySectionProps['period'] }) {
  const rows = days.items;
  const periodDays = Math.round((Date.parse(period.endDate) - Date.parse(period.startDate)) / 86_400_000) + 1;
  return <div className="nutrition-block">
    <PagesState pages={days} label="Trend" />
    {(days.status === 'ready' || rows.length > 0) &&
      <p>{rows.length} of {periodDays} days in this period have meals{days.hasMore ? ' (partial loaded history)' : ''}. Europe/Copenhagen. Missing days are not zero and lines do not bridge gaps. Partial nutrients are lower bounds.</p>}
    {days.status === 'ready' && !rows.length && <DailyState status="empty" />}
    {rows.length > 0 && <>
      {nutrients.filter(nutrient => nutrient.key === 'energy_kcal' || nutrient.key === 'protein_grams').map(nutrient =>
        <DailyChart key={nutrient.key} name={`${nutrient.label} (${nutrient.unit}) by logged date`} kind="line"
          series={trendSeries(rows, nutrient.key, targets ? nutrient.key === 'energy_kcal' ? targetBaseline(targets.targets) : targets.targets.proteinGrams : null)} />)}
      <ScrollTable label="Nutrition days"><table><caption>Logged day totals</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Meals</th>{nutrients.map(nutrient => <th scope="col" key={nutrient.key}>{nutrient.label} ({nutrient.unit})</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={text(row.meal_date)}><th scope="row"><button type="button" className="secondary-button" disabled={text(row.meal_date) > copenhagenDate()}
          title={text(row.meal_date) > copenhagenDate() ? 'Future meal dates cannot be opened.' : undefined}
          onClick={() => select(text(row.meal_date))}>{text(row.meal_date)}</button></th><td>{text(String(row.meal_count))}</td>
          {nutrients.map(nutrient => <td key={nutrient.key}>{display(numeric(row[nutrient.key]), nutrient.unit)}
            {Array.isArray(row.partial_nutrients) && row.partial_nutrients.includes(nutrient.key) ? ' (lower bound)' : ''}</td>)}
        </tr>)}</tbody></table></ScrollTable>
      <ScrollTable label="Weekly nutrition averages"><table><caption>Monday-based weekly averages over logged days only</caption>
        <thead><tr><th scope="col">Week starting</th><th scope="col">Logged days</th>{nutrients.map(nutrient => <th scope="col" key={nutrient.key}>{nutrient.label}</th>)}</tr></thead>
        <tbody>{weeklyAverages(rows).map(week => <tr key={week.week}><th scope="row">{week.week}</th><td>Average over {week.days} logged days</td>
          {week.values.map((value, index) => <td key={value.key}>{display(value.value, nutrients[index]!.unit)}
            {value.missing > 0 ? ` (partial: excludes ${value.missing} unknown logged days)` : ''}
            {value.lowerBound ? ' (includes lower-bound day totals)' : ''} · {value.count} known days</td>)}</tr>)}</tbody>
      </table></ScrollTable>
    </>}
  </div>;
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
    <p>Filter covers {pages.items.length} loaded records only; up to five pages are loaded automatically. Source completeness is unknown.</p>
    <PagesState pages={pages} label={kind === 'favorites' ? 'Favourites' : 'Meal plans'} />
    {pages.status === 'ready' && !matches.length && <p>No {filter ? 'matching loaded ' : 'loaded '}{kind === 'favorites' ? 'favourites' : 'plans'}.</p>}
    {matches.map((row, index) => kind === 'favorites'
      ? <div key={text(row.id, `favorite-${index}`)}><RecordDetails row={row} name={text(row[nameKey], 'Unnamed favourite')} />
        <p>Aliases: {readableJson(row.aliases_json)}</p></div>
      : <details className="nutrition-record" key={text(row.id, `plan-${index}`)}><summary>{text(row[nameKey], 'Unnamed plan')}</summary>
        <p>{text(row.description, 'No description recorded.')}</p>
        <PlanTotals row={row} />
        <details><summary>Plan items</summary><pre>{readableJson(row.items_json)}</pre></details>
      </details>)}
  </section>;
}

export default function NutritionSection(props: DailySectionProps) {
  const [search, setSearch] = useSearchParams();
  const today = copenhagenDate();
  const requestedDate = search.get('nutritionDate') ?? today;
  const date = isDailyPeriod({ startDate: requestedDate, endDate: requestedDate }) && requestedDate <= today ? requestedDate : today;
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
  const update = (nextView: View, nextDate = date) => setSearch(previous => {
    const next = new URLSearchParams(previous);
    next.set('nutritionView', nextView);
    next.set('nutritionDate', nextDate);
    return next;
  });
  const setDate = (nextDate: string) => { if (nextDate <= today) update('day', nextDate); };
  const days = useDailyPages(props.backendUrl, props.getAccessToken,
    props.sources.includes(sources.days) ? { source: sources.days, ...props.period, limit: 400 } : null,
    props.refreshVersion, { autoLoad: true, maxPages: 5 });
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
    <h2 id="nutrition-heading">Nutrition</h2>
    <div className="daily-section-tabs" role="tablist" aria-label="Nutrition views" onKeyDown={onTabKeyDown}>
      {availableTabs.map(tab => <button type="button" className="daily-section-tab" role="tab" key={tab}
        id={`nutrition-tab-${tab}`} aria-controls="nutrition-panel" aria-selected={tab === activeView}
        tabIndex={tab === activeView ? 0 : -1} onClick={() => update(tab)}>{tab[0]!.toUpperCase() + tab.slice(1)}</button>)}
    </div>
    <div role="tabpanel" id="nutrition-panel" aria-labelledby={`nutrition-tab-${activeView}`} className="nutrition-block">
      {activeView === 'day' && <Day props={props} date={date} setDate={setDate} days={days} targets={targetProps} />}
      {activeView === 'trend' && <><Targets {...targetProps} rows={[]} showProgress={false} /><Trend days={days} select={setDate} targets={targetResult.state} period={props.period} /></>}
      {activeView === 'library' && <>
        <label>Filter loaded library <input type="search" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <p>Search names, aliases, and plan descriptions or items among loaded records.</p>
        {(['favorites', 'plans'] as const).filter(kind => props.sources.includes(sources[kind]))
          .map(kind => <LibraryCollection props={props} kind={kind} filter={filter} key={kind} />)}
      </>}
    </div>
  </section>;
}
