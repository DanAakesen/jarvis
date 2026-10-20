import { useMemo, useRef, useState, type ReactNode } from 'react';
import { dailyQuerySources as sources, type DailySourceId } from '@jarvis/contracts';
import type { DailyPages } from '../../ui/useDailyPages';
import { targetBaseline } from '../nutrition/totals';
import { BodyCard } from './BodyCard';
import { combineStates, pagesState, type BlockState } from './block-state';
import { HealthCard } from './HealthCard';
import type { NutritionView } from './NutritionTiles';
import { TrainingCard } from './TrainingCard';
import { nutritionForWindow, noTrainingTargets, type BodyMetricKey } from './overview-values';
import { defaultOverviewPreset, overviewPresets, overviewWindow, type OverviewPresetId } from './overview-window';
import { useNutritionTargets } from './useNutritionTargets';
import { useToday } from './useToday';
import { useTopCardData } from './useTopCardData';

const cards = [
  { id: 'training', title: 'Training', to: '?section=workouts' },
  { id: 'health', title: 'Health', to: '?section=body-sleep' },
  { id: 'body', title: 'Body', to: '?section=body-sleep' },
] as const;

/** On narrow screens the cards are one swipeable row; the dots follow the scroll position and jump to a card. */
function CardCarousel({ titles, children }: { titles: readonly string[]; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const stride = () => {
    const first = track.current?.children[0];
    const second = track.current?.children[1];
    return first instanceof HTMLElement && second instanceof HTMLElement ? second.offsetLeft - first.offsetLeft : 0;
  };
  const onScroll = () => {
    const step = stride();
    if (track.current && step > 0) setActive(Math.max(0, Math.min(titles.length - 1, Math.round(track.current.scrollLeft / step))));
  };
  const show = (index: number) => {
    setActive(index);
    track.current?.scrollTo?.({ left: index * stride() });
  };
  return <>
    <div className="daily-top-track" ref={track} onScroll={onScroll}>{children}</div>
    <div className="daily-top-dots" role="group" aria-label="Choose a card">
      {titles.map((title, index) => <button key={title} className="daily-top-dot" type="button" aria-label={`Show ${title}`}
        aria-current={active === index || undefined} onClick={() => show(index)}><span aria-hidden="true" /></button>)}
    </div>
  </>;
}

const reloadFailed = (...pages: DailyPages[]) => () => {
  for (const page of pages) if (page.status === 'error') page.reload();
};

/**
 * The three cards at the top of the overview: training, health and body. They share one period and read each served source
 * once. Each tile reserves its size, so values arriving, refreshing or failing never move the layout.
 */
export function TopCards({ backendUrl, getAccessToken, refreshVersion, available }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
  refreshVersion: number;
  available: readonly DailySourceId[];
}) {
  const { today, hour } = useToday();
  const [preset, setPreset] = useState<OverviewPresetId>(defaultOverviewPreset);
  const period = useMemo(() => overviewWindow(preset, today), [preset, today]);
  const data = useTopCardData({ backendUrl, getAccessToken, refreshVersion }, period, today, available);
  // Targets are only needed to judge logged values, so nothing is requested for a period with no nutrition record.
  const nutritionTargets = useNutritionTargets(backendUrl, getAccessToken, available.includes(sources.days) && data.days.items.length > 0);
  const has = (id: DailySourceId) => available.includes(id);

  const states = {
    workouts: pagesState(data.workouts, has(sources.workouts)),
    steps: pagesState(data.steps, has(sources.metrics)),
    days: pagesState(data.days, has(sources.days)),
    // Meals are read for a single date only; a range reads the per-day totals instead.
    meals: period.single ? pagesState(data.meals, has(sources.meals)) : 'ready' as BlockState,
    sleep: pagesState(data.sleep, has(sources.sleep)),
    catalogue: pagesState(data.catalogue, has(sources.metrics) && has(sources.metricCatalog)),
  };
  const targetsState = nutritionTargets.current?.state ?? null;
  const nutrition: NutritionView = {
    state: states.days,
    figures: nutritionForWindow(data.days.items, period),
    targets: nutritionTargets.current,
    proteinTarget: targetsState?.targets.proteinGrams ?? null,
    baseline: targetsState ? targetBaseline(targetsState.targets) : null,
    range: !period.single,
  };
  const targetsFailed: BlockState = nutritionTargets.current?.error ? 'error' : 'ready';
  const body = (Object.keys(data.body) as BodyMetricKey[]).filter(key => data.names[key] !== null).map(key => data.body[key]);
  const cardState = {
    training: combineStates(states.workouts, states.steps, states.days, states.meals, targetsFailed),
    health: combineStates(states.sleep, states.days, states.meals, targetsFailed),
    body: combineStates(states.workouts, states.catalogue, ...body.map(pages => pagesState(pages, true))),
  };
  const retryTargets = () => { if (nutritionTargets.current?.error) nutritionTargets.retry(); };
  const retry = {
    training: () => { reloadFailed(data.workouts, data.steps, data.days, data.meals)(); retryTargets(); },
    health: () => { reloadFailed(data.sleep, data.days, data.meals)(); retryTargets(); },
    body: reloadFailed(data.workouts, data.catalogue, ...body),
  };
  const [training, health, bodyCard] = cards;

  return <section className="daily-top" aria-label="Overview cards">
    <div className="daily-view-switch daily-top-presets" role="group" aria-label="Overview period">
      {overviewPresets.map(item => <button key={item.id} className="daily-section-tab" type="button"
        aria-pressed={item.id === preset} onClick={() => setPreset(item.id)}>{item.label}</button>)}
    </div>
    <CardCarousel titles={cards.map(card => card.title)}>
      <TrainingCard {...training} state={cardState.training} onRetry={retry.training} period={period} states={states}
        data={data} nutrition={nutrition} targets={noTrainingTargets} />
      <HealthCard {...health} state={cardState.health} onRetry={retry.health} period={period} today={today} hour={hour}
        states={states} data={data} nutrition={nutrition} />
      <BodyCard {...bodyCard} state={cardState.body} onRetry={retry.body} period={period} workoutsState={states.workouts}
        catalogueState={states.catalogue} data={data} names={data.names} trendPeriod={data.trendPeriod} />
    </CardCarousel>
  </section>;
}
