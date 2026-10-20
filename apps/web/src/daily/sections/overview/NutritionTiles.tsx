import { Link } from 'react-router-dom';
import { Loader } from '../../../Loader';
import { formatNumber } from '../../ui/formatters';
import { calorieBalance, type nutritionForWindow } from './overview-values';
import type { NutritionTargetsLoad } from './useNutritionTargets';
import { Tile, type BlockState } from './TopBlocks';

export type NutritionView = {
  state: BlockState;
  figures: ReturnType<typeof nutritionForWindow>;
  targets: NutritionTargetsLoad['current'];
  proteinTarget: number | null;
  baseline: number | null;
  /** More than one day: figures are the average per logged day. */
  range: boolean;
};

const settings = '/settings#nutrition-targets';

function targetNote(view: NutritionView, set: string | null) {
  if (view.targets === null) return <Loader label="Loading nutrition targets" variant="inline" announce={false} />;
  if (view.targets.error !== null) return 'Targets could not load';
  return set ?? <Link to={settings}>No target set</Link>;
}

const joined = (...parts: (string | false | null)[]) => parts.filter(Boolean).join(', ');

export function ProteinTile({ view, label = 'Protein' }: { view: NutritionView; label?: string }) {
  const protein = view.figures?.protein ?? null;
  const known = protein?.value != null;
  return <Tile label={label} state={view.state} unavailable="Nutrition totals are not served."
    value={view.figures === null ? 'Not recorded' : known ? `${formatNumber(protein.value, 0)} g` : 'Unknown'}
    note={view.figures === null ? null : targetNote(view, view.proteinTarget === null ? null
      : joined(`of ${formatNumber(view.proteinTarget, 0)} g`, protein?.partial === true && 'lower bound', view.range && 'average per day'))} />;
}

export function CaloriesLeftTile({ view }: { view: NutritionView }) {
  const balance = calorieBalance(view.figures?.energy, view.baseline);
  const eaten = view.figures?.energy.value ?? null;
  const bound = balance?.bound ?? null;
  const amount = balance === null ? null : formatNumber(balance.amount, 0);
  const spoken = balance === null ? null
    : `${bound === 'at most' ? 'At most ' : bound === 'at least' ? 'At least ' : ''}${amount} kcal ${balance.kind}`;
  const value = view.figures === null ? 'Not recorded'
    : balance === null ? eaten === null ? 'Unknown' : `${formatNumber(eaten, 0)} kcal eaten`
      : <><span aria-hidden="true">{bound === 'at most' ? '≤ ' : bound === 'at least' ? '≥ ' : ''}{amount} kcal</span>
        <span className="visually-hidden">{spoken}</span></>;
  const note = view.figures === null ? null
    : balance === null ? view.baseline === null ? targetNote(view, null) : null
      : joined(balance.kind, bound, view.range && 'average per day');
  return <Tile label="Calories left" state={view.state} unavailable="Nutrition totals are not served." value={value} note={note} />;
}
