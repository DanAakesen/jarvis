import { formatNumber } from './formatters';

const listedObservationLimit = 7;

function describeTrend(label: string, values: readonly (number | null)[], recorded: readonly number[]) {
  if (values.length <= listedObservationLimit) {
    return `${label}: ${values.map((value, index) =>
      `observation ${index + 1}, ${value !== null && Number.isFinite(value) ? formatNumber(value) : 'Not recorded'}`).join('; ')}`;
  }
  return `${label}: ${recorded.length} of ${values.length} observations recorded; first ${formatNumber(recorded[0])}, `
    + `last ${formatNumber(recorded.at(-1))}, lowest ${formatNumber(Math.min(...recorded))}, highest ${formatNumber(Math.max(...recorded))}`;
}

export function Sparkline({ values, label }: { values: readonly (number | null)[]; label: string }) {
  const known = values.flatMap((value, index) =>
    value !== null && Number.isFinite(value) ? [{ value, index }] : []);
  if (!known.length) return <span className="daily-sparkline-empty">No trend available</span>;
  const recorded = known.map(point => point.value);
  const textAlternative = describeTrend(label, values, recorded);
  const minimum = Math.min(...recorded);
  const maximum = Math.max(...recorded);
  const scale = maximum === minimum ? 1 : maximum - minimum;
  const x = (index: number) => values.length <= 1 ? 60 : 4 + index / (values.length - 1) * 112;
  const y = (value: number) => 28 - ((value - minimum) / scale) * 24;
  const path = values.reduce<{ path: string; drawing: boolean }>((state, value, index) => {
    if (value === null || !Number.isFinite(value)) return { ...state, drawing: false };
    return {
      path: `${state.path}${state.path ? ' ' : ''}${state.drawing ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
      drawing: true,
    };
  }, { path: '', drawing: false }).path;
  return <svg className="daily-sparkline" viewBox="0 0 120 32" role="img" aria-label={textAlternative}>
    <path d={path} />
  </svg>;
}
