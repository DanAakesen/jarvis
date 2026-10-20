import { Sparkline } from '../../ui/Sparkline';
import { formatDuration, formatNumber } from '../../ui/formatters';
import type { DailyPages } from '../../ui/useDailyPages';
import type { Workout } from '../workouts/summary';
import { pagesState } from './block-state';
import { Tile, TopCard, type BlockState } from './TopBlocks';
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
    value={trend === null ? null : `${formatNumber(trend.latest, 1)}${trend.unit ? ` ${trend.unit}` : ''}`}
    chart={trend === null ? null : <Sparkline values={trend.values} label={`${label} trend`} />} />;
}

export function BodyCard({ title, to, state, onRetry, period, workoutsState, catalogueState, data, names, trendPeriod }: {
  title: string;
  to: string;
  state: BlockState;
  onRetry: () => void;
  period: OverviewWindow;
  workoutsState: BlockState;
  catalogueState: BlockState;
  data: { workouts: DailyPages; body: Record<BodyMetricKey, DailyPages> };
  names: Record<BodyMetricKey, string | null>;
  trendPeriod: { startDate: string; endDate: string };
}) {
  const sessions = windowWorkouts(data.workouts.items as Workout[], period);
  const note = sessions.partial ? 'lower bound' : null;
  return <TopCard title={title} to={to} state={state} onRetry={onRetry}>
    <div className="daily-top-tiles daily-top-tiles--three">
      <Tile label="Sessions" state={workoutsState} unavailable="Workouts are not served." value={formatNumber(sessions.sessions, 0)} />
      <Tile label="Calories" state={workoutsState} unavailable="Workouts are not served." note={note}
        value={sessions.kcal === null ? 'Unknown' : `${formatNumber(sessions.kcal, 0)} kcal`} />
      <Tile label="Duration" state={workoutsState} unavailable="Workouts are not served." note={note}
        value={sessions.sessions === 0 ? '0 min' : formatDuration(sessions.durationSeconds)} />
    </div>
    <div className="daily-top-tiles">
      {trends.map(({ key, label }) => <Trend key={key} label={label} name={names[key]} catalogue={catalogueState}
        pages={data.body[key]} period={trendPeriod} />)}
    </div>
  </TopCard>;
}
