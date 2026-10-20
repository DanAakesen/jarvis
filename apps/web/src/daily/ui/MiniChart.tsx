import { formatNumber } from './formatters';

export type MiniChartPoint = { label: string; value: number | null };

const width = 200;
const height = 64;
const inset = 4;

function describe(label: string, points: readonly MiniChartPoint[], target: number | null, unit: string) {
  const known = points.flatMap(point => point.value === null ? [] : [point.value]);
  const parts = [`${known.length} of ${points.length} recorded`, `latest ${formatNumber(known.at(-1), 1)} ${unit}`,
    `highest ${formatNumber(Math.max(...known), 1)} ${unit}`];
  if (target !== null) parts.push(`target ${formatNumber(target, 1)} ${unit}`);
  return `${label}: ${parts.join(', ')}`;
}

/**
 * A small trend for a card: a line with area, or bars, and an optional dashed target. The numbers live in the
 * accessible name; the picture carries no text of its own. It always fills the same box, so it never moves its card.
 */
export function MiniChart({ label, points, kind, target, unit, startLabel, endLabel }: {
  label: string;
  points: readonly MiniChartPoint[];
  kind: 'line' | 'bars';
  target: number | null;
  unit: string;
  startLabel: string;
  endLabel: string;
}) {
  const known = points.flatMap((point, index) => point.value === null ? [] : [{ index, value: point.value }]);
  if (known.length === 0) {
    return <div className="daily-minichart daily-minichart--empty"><span>Nothing recorded</span></div>;
  }
  const top = Math.max(1, target ?? 0, ...known.map(point => point.value));
  const y = (value: number) => height - inset - (value / top) * (height - inset * 2);
  const slot = (width - inset * 2) / points.length;
  const x = (index: number) => kind === 'bars' ? inset + (index + 0.5) * slot
    : points.length <= 1 ? width / 2 : inset + index / (points.length - 1) * (width - inset * 2);
  const line = known.map((point, order) => `${order === 0 ? 'M' : 'L'}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const last = known.at(-1)!;
  const first = known[0]!;
  return <div className="daily-minichart">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={describe(label, points, target, unit)}>
      {kind === 'bars'
        ? known.map(point => <rect key={point.index} className="daily-minichart-bar" x={x(point.index) - slot * 0.35}
          y={y(point.value)} width={slot * 0.7} height={Math.max(0, height - inset - y(point.value))} rx="1.5" />)
        : <>
          <path className="daily-minichart-area" d={`${line} L${x(last.index).toFixed(1)},${height - inset} L${x(first.index).toFixed(1)},${height - inset} Z`} />
          <path className="daily-minichart-line" d={line} />
        </>}
      {target !== null && <line className="daily-minichart-target" x1={inset} x2={width - inset} y1={y(target)} y2={y(target)} />}
    </svg>
    <div className="daily-minichart-axis" aria-hidden="true"><span>{startLabel}</span><span>{endLabel}</span></div>
  </div>;
}
