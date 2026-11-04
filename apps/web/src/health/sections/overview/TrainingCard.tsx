import { Link } from 'react-router-dom';
import { Loader } from '../../../Loader';
import { HealthUnavailable } from '../../ui/HealthUnavailable';
import { Ring } from '../../ui/Ring';
import type { HealthIconName } from '../../ui/icons';
import { formatClockTime, formatNumber } from '../../ui/formatters';
import type { HealthPages } from '../../ui/useHealthPages';
import { deleted, numeric, text, type Row as NutritionRow } from '../nutrition/totals';
import type { Workout } from '../workouts/summary';
import { CaloriesLeftTile, ProteinTile, type NutritionView } from './NutritionTiles';
import { TopCard, type BlockState } from './TopBlocks';
import { scaledTarget, stepsForWindow } from './overview-values';
import { sessionScope, type OverviewWindow } from './overview-window';
import { trainingCounts } from './summary';
import { readTarget, type TargetRead, type TrainingTargetsView } from '../../training-targets';

const noValueCaption: Record<Exclude<BlockState, 'ready'>, string> = {
  loading: 'Loading', error: 'Could not load', unavailable: 'Unavailable',
};

/** One ring. Every state renders the same ring and caption line, so nothing moves when values arrive. */
function Gauge({ label, state, value, target, periods, unit, singular = unit, tone, icon }: {
  label: string; state: BlockState; value: number | null; target: TargetRead; periods: number; unit: string; singular?: string;
  tone: 'gym' | 'run' | 'activity'; icon: HealthIconName;
}) {
  if (state !== 'ready') {
    return <Ring label={label} value={null} target={null} centre="—" caption={noValueCaption[state]}
      summary={noValueCaption[state].toLowerCase()} tone={tone} icon={icon} />;
  }
  if (value === null) return <Ring label={label} value={null} target={null} centre="—" caption="Not recorded" summary="not recorded" tone={tone} icon={icon} />;
  const shown = formatNumber(value, 0);
  const goal = target.status === 'ready' ? scaledTarget(target.value, periods) : null;
  // Only a target the owner never set offers the way to set one; a target of 0 is a real target and reads "of 0".
  const caption = target.status === 'loading' ? 'Loading target' : target.status === 'failed' ? 'Targets unavailable'
    : goal === null ? <Link to="/settings#training-targets">No target set</Link> : `of ${formatNumber(goal, 0)}`;
  const spoken = target.status === 'loading' ? 'loading target' : target.status === 'failed' ? 'targets unavailable'
    : goal === null ? 'no target set' : `of ${formatNumber(goal, 0)}`;
  return <Ring label={label} value={value} target={goal} centre={shown} caption={caption} tone={tone} icon={icon}
    summary={`${shown} ${value === 1 ? singular : unit}${goal === null ? ', ' : ' '}${spoken}`} />;
}

function MealStrip({ pages, state }: { pages: HealthPages; state: BlockState }) {
  const meals = (pages.items as NutritionRow[]).filter(row => !deleted(row)).sort((a, b) => {
    const first = Date.parse(text(a.occurred_at, ''));
    const second = Date.parse(text(b.occurred_at, ''));
    return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity);
  });
  return <div className="health-top-strip" data-state={state}>
    {state === 'loading' ? <Loader label="Loading meals" variant="inline" announce={false} />
      : state === 'error' ? <span>Could not load meals</span>
        : state === 'unavailable' ? <HealthUnavailable>Meals are not served.</HealthUnavailable>
          : meals.length === 0 ? <span>No meals logged</span>
            : <div role="region" aria-label="Meals" tabIndex={0}>
              <ul>
                {meals.map((row, index) => {
                  const kcal = numeric(row.energy_kcal);
                  return <li key={text(row.id, `meal-${index}`)}>
                    <span className="health-top-strip-time">{typeof row.occurred_at === 'string' ? formatClockTime(row.occurred_at) : 'Time unknown'}</span>
                    <span className="health-top-strip-name">{text(row.meal_name, 'Unnamed meal')}</span>
                    <span className="health-top-strip-kcal">{kcal === null ? 'kcal unknown' : `${formatNumber(kcal, 0)} kcal`}</span>
                  </li>;
                })}
              </ul>
            </div>}
  </div>;
}

export function TrainingCard({ title, to, state, stale, onRetry, period, states, data, nutrition, targets }: {
  title: string;
  to: string;
  state: BlockState;
  stale: boolean;
  onRetry: () => void;
  period: OverviewWindow;
  states: { workouts: BlockState; steps: BlockState; meals: BlockState };
  data: { workouts: HealthPages; steps: HealthPages; meals: HealthPages };
  nutrition: NutritionView;
  targets: TrainingTargetsView;
}) {
  const counts = trainingCounts(data.workouts.items as Workout[], { startDate: period.sessionStart, endDate: period.endDate });
  const steps = stepsForWindow(data.steps.items, period);
  const scope = sessionScope(period);
  return <TopCard title={title} icon="gym" to={to} state={state} onRetry={onRetry} stale={stale}>
    <div className="health-top-rings">
      <Gauge label="Gym" state={states.workouts} value={counts.strength} unit={`sessions, ${scope}`} singular={`session, ${scope}`}
        tone="gym" icon="gym" target={readTarget(targets, 'gymSessionsPerWeek')} periods={period.sessionWeeks} />
      <Gauge label="Run" state={states.workouts} value={counts.running} unit={`sessions, ${scope}`} singular={`session, ${scope}`}
        tone="run" icon="run" target={readTarget(targets, 'runSessionsPerWeek')} periods={period.sessionWeeks} />
      <Gauge label="Activity" state={states.steps} value={steps?.total ?? null} unit="steps" singular="step"
        tone="activity" icon="steps" target={readTarget(targets, 'dailySteps')} periods={period.days} />
    </div>
    <div className="health-top-tiles">
      <ProteinTile view={nutrition} />
      <CaloriesLeftTile view={nutrition} />
    </div>
    {period.single && <div className="health-top-meals">
      <p className="health-top-strip-label" aria-hidden="true">Meals</p>
      <MealStrip pages={data.meals} state={states.meals} />
    </div>}
  </TopCard>;
}
