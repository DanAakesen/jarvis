export function Sparkline({ values, label }: { values: readonly (number | null)[]; label: string }) {
  const known = values.flatMap((value, index) =>
    value !== null && Number.isFinite(value) ? [{ value, index }] : []);
  if (!known.length) return <span className="daily-sparkline-empty">No trend available</span>;
  const minimum = Math.min(...known.map(point => point.value));
  const maximum = Math.max(...known.map(point => point.value));
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
  return <svg className="daily-sparkline" viewBox="0 0 120 32" role="img" aria-label={label}>
    <path d={path} />
  </svg>;
}
