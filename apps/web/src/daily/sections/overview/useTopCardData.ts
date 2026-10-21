import { dailyQuerySources as sources, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import { useDailyPages } from '../../ui/useDailyPages';
import { dateStep } from '../nutrition/totals';
import { bodyMetricNames } from './overview-values';
import { bodyTrendDays, type OverviewWindow } from './overview-window';

type Shared = { backendUrl: string | null; getAccessToken: () => Promise<string>; refreshVersion: number };

// Each card section publishes once its page chain has settled, so values replace the skeleton in one step.
function usePages({ backendUrl, getAccessToken, refreshVersion }: Shared, query: DailyQuery | null, maxPages: number) {
  return useDailyPages(backendUrl, getAccessToken, query, refreshVersion, { autoLoad: true, settle: true, maxPages });
}

/**
 * Every read behind the three overview cards, owned in one place so a source is read once and the cards stay presentational.
 * A source that is not served is never queried; the card says so instead.
 */
export function useTopCardData(shared: Shared, window: OverviewWindow, today: string, available: readonly DailySourceId[]) {
  const serves = (id: DailySourceId) => available.includes(id);
  const { startDate, endDate } = window;
  const trendPeriod = { startDate: dateStep(today, -(bodyTrendDays - 1)), endDate: today };
  const workouts = usePages(shared, serves(sources.workouts)
    ? { source: sources.workouts, startDate: window.sessionStart, endDate, limit: 200 } : null, 5);
  const steps = usePages(shared, serves(sources.metrics)
    ? { source: sources.metrics, metric: 'step_count', startDate, endDate, limit: 500 } : null, 2);
  const days = usePages(shared, serves(sources.days)
    ? { source: sources.days, startDate, endDate, limit: 400 } : null, 2);
  const meals = usePages(shared, window.single && serves(sources.meals)
    ? { source: sources.meals, startDate: endDate, endDate, limit: 100 } : null, 3);
  const sleep = usePages(shared, serves(sources.sleep)
    ? { source: sources.sleep, startDate: dateStep(startDate, -1), endDate, limit: 500 } : null, 3);
  const catalogue = usePages(shared, serves(sources.metrics) && serves(sources.metricCatalog)
    ? { source: sources.metricCatalog, ...trendPeriod, limit: 500 } : null, 2);
  const names = bodyMetricNames(catalogue.items);
  const trend = (name: string | null) => name
    ? { source: sources.metrics, metric: name, ...trendPeriod, limit: 500 } as const : null;
  const body = {
    weight: usePages(shared, trend(names.weight), 2),
    fatPercent: usePages(shared, trend(names.fatPercent), 2),
    leanMass: usePages(shared, trend(names.leanMass), 2),
  };
  return { workouts, steps, days, meals, sleep, catalogue, names, body, trendPeriod };
}

export type TopCardData = ReturnType<typeof useTopCardData>;
