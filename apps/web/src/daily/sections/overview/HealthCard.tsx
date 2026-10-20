import type { ReactNode } from 'react';
import { MiniChart } from '../../ui/MiniChart';
import { formatDate, formatNumber } from '../../ui/formatters';
import type { DailyPages } from '../../ui/useDailyPages';
import { Loader } from '../../../Loader';
import { DailyUnavailable } from '../../ui/DailyUnavailable';
import type { Row as NutritionRow } from '../nutrition/totals';
import { ProteinTile, type NutritionView } from './NutritionTiles';
import { Tile, TopCard, type BlockState } from './TopBlocks';
import { cumulativeProtein, dailyProtein, sleepForWindow } from './overview-values';
import type { OverviewWindow } from './overview-window';

function ChartSlot({ state, children }: { state: BlockState; children: ReactNode }) {
  if (state === 'ready') return children;
  return <div className="daily-minichart daily-minichart--empty">
    {state === 'loading' ? <Loader label="Loading protein chart" variant="inline" announce={false} />
      : state === 'error' ? <span>Could not load</span>
        : <DailyUnavailable>Nutrition is not served.</DailyUnavailable>}
  </div>;
}

export function HealthCard({ title, to, state, onRetry, period, today, hour, states, data, nutrition }: {
  title: string;
  to: string;
  state: BlockState;
  onRetry: () => void;
  period: OverviewWindow;
  today: string;
  hour: number;
  states: { sleep: BlockState; meals: BlockState; days: BlockState };
  data: { sleep: DailyPages; meals: DailyPages; days: DailyPages };
  nutrition: NutritionView;
}) {
  const sleep = sleepForWindow(data.sleep.items, period);
  const target = nutrition.proteinTarget;
  const day = cumulativeProtein(data.meals.items as NutritionRow[], period.endDate, period.endDate === today ? hour : null);
  const points = period.single ? day.total === null ? [] : day.points : dailyProtein(data.days.items as NutritionRow[], period);
  return <TopCard title={title} to={to} state={state} onRetry={onRetry}>
    <div className="daily-top-tiles">
      <Tile label="Sleep" state={states.sleep} unavailable="Sleep is not served."
        value={sleep === null ? null : `${formatNumber(sleep.value, 1)} h`}
        note={sleep === null ? null : sleep.date !== null ? formatDate(sleep.date)
          : `average of ${sleep.nights} ${sleep.nights === 1 ? 'night' : 'nights'}`} />
      <ProteinTile view={nutrition} />
    </div>
    <ChartSlot state={period.single ? states.meals : states.days}>
      <MiniChart label={period.single ? 'Protein across the day' : 'Protein per day'} points={points}
        kind={period.single ? 'line' : 'bars'} target={target} unit="g"
        startLabel={period.single ? '00:00' : formatDate(period.startDate)}
        endLabel={period.single ? '24:00' : formatDate(period.endDate)} />
    </ChartSlot>
  </TopCard>;
}
