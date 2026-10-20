import { Sparkline } from '../../ui/Sparkline';
import { formatDuration, formatNumber } from '../../ui/formatters';
import type { DailyPages } from '../../ui/useDailyPages';
import type { Workout } from '../workouts/summary';
import { pagesState } from './block-state';
import { Figure, Tile, TopCard, type BlockState } from './TopBlocks';
import { bodyTrend, windowWorkouts, type BodyMetricKey } from './overview-values';
import type { OverviewWindow } from './overview-window';

const trends: readonly { key: BodyMetricKey; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'fatMass', label: 'Fat mass' },
  { key: 'fatPercent', label: 'Fat %' },
  { key: 'leanMass', label: 'Lean mass' },
];

/** A measurement trend. A name the catalogue does not serve is not queried and reads as not recorded. */
function Trend({ label, name, catalogue, pages, period }: {
  label: string;
  name: string | null;
  catalogue: BlockState;
  pages: DailyPages;
  period: { startDate: string; endDate: string };
}) {
  const state = catalogue !== 'ready' || name === null ? catalogue : pagesState(pages, true);
  const trend = name === null ? null : bodyTrend(pages.items, period);
  return <Tile label={label} state={state} unavailable="Body measurements are not served."
    value={trend === null ? null : <Figure value={formatNumber(trend.latest, 1)} unit={trend.unit || undefined} />}
    chart={trend === null ? null : <Sparkline values={trend.values} label={`${label} trend`} />} />;
}

export function BodyCard({ title, to, state, stale, onRetry, period, workoutsState, catalogueState, data, names, trendPeriod }: {
  title: string;
  to: string;
  state: BlockState;
  stale: boolean;
  onRetry: () => void;
  period: OverviewWindow;
  workoutsState: BlockState;
  catalogueState: BlockState;
  data: { workouts: DailyPages; body: Record<BodyMetricKey, DailyPages> };
  names: Record<BodyMetricKey, string | null>;
  trendPeriod: { startDate: string; endDate: string };
}) {
  const sessions = windowWorkouts(data.workouts.items as Workout[], period);
  return <TopCard title={title} icon="pulse" to={to} state={state} onRetry={onRetry} stale={stale}>
    <div className="daily-top-tiles daily-top-tiles--three">
      <Tile label="Sessions" state={workoutsState} unavailable="Workouts are not served." value={<Figure value={formatNumber(sessions.sessions, 0)} />} />
      <Tile label="Calories" state={workoutsState} unavailable="Workouts are not served." note={sessions.partialEnergy ? 'lower bound' : null}
        value={sessions.kcal === null ? 'Unknown' : <Figure value={formatNumber(sessions.kcal, 0)} unit="kcal" />} />
      <Tile label="Duration" state={workoutsState} unavailable="Workouts are not served." note={sessions.partialDuration ? 'lower bound' : null}
        value={sessions.sessions === 0 ? <Figure value="0" unit="min" /> : formatDuration(sessions.durationSeconds)} />
    </div>
    <div className="daily-top-chart daily-top-trend-panel">
      <p className="daily-top-chart-title">Body trend</p>
      <div className="daily-top-tiles daily-top-trends">
        {trends.map(({ key, label }) => <Trend key={key} label={label} name={names[key]} catalogue={catalogueState}
          pages={data.body[key]} period={trendPeriod} />)}
      </div>
    </div>
  </TopCard>;
}
