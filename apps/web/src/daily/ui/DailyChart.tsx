import { chartLayout, xPosition, yPosition, type ChartSeries } from '../../chart-data';
import { formatNumber } from './formatters';
import { ScrollTable } from './ScrollTable';

const width = 640;
const height = 260;
const margin = { top: 12, right: 16, bottom: 32, left: 48 };
const colours = ['var(--glass-edge-cool)', 'var(--glass-glow-warm)'];

export function DailyChart({ kind, name, series }: {
  kind: 'line' | 'bar' | 'area';
  name: string;
  series: readonly ChartSeries[];
}) {
  const layout = chartLayout([...series], kind === 'bar', kind !== 'line');
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const px = (point: ChartSeries['points'][number]) => margin.left + xPosition(layout, point.x, kind === 'bar') * plotWidth;
  const py = (value: number) => margin.top + (1 - yPosition(layout, value)) * plotHeight;
  const baseline = py(Math.max(layout.yMin, Math.min(0, layout.yMax)));
  const barWidth = Math.min(28, plotWidth / Math.max(1, layout.categories.length) * 0.65 / Math.max(1, series.length));

  return <figure className="daily-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={name} width="100%" height={height}
      preserveAspectRatio="xMidYMid meet">
      {layout.yTicks.map(tick => <g className="daily-chart-grid" key={tick}>
        <line x1={margin.left} x2={width - margin.right} y1={py(tick)} y2={py(tick)} />
        <text x={margin.left - 8} y={py(tick)} textAnchor="end" dominantBaseline="middle">{formatNumber(tick)}</text>
      </g>)}
      {series.map((entry, seriesIndex) => {
        const colour = colours[seriesIndex % colours.length];
        if (kind === 'bar') return <g key={entry.name} fill={colour} className="daily-chart-bars">
          {entry.points.map((point, index) => {
            const x = px(point) - barWidth * series.length / 2 + barWidth * seriesIndex;
            const y = py(point.y);
            return <rect key={`${point.x}-${index}`} x={x} y={Math.min(y, baseline)}
              width={barWidth} height={Math.max(1, Math.abs(baseline - y))}>
              <title>{`${entry.name}, ${point.x}: ${formatNumber(point.y)}`}</title>
            </rect>;
          })}
        </g>;
        const points = [...entry.points].sort((a, b) => String(a.x).localeCompare(String(b.x)));
        const line = points.map((point, index) => `${index ? 'L' : 'M'}${px(point).toFixed(1)},${py(point.y).toFixed(1)}`).join(' ');
        const first = points[0];
        const last = points.at(-1);
        return <g key={entry.name} className="daily-chart-series" style={{ color: colour }}>
          {kind === 'area' && first && last && points.length > 1 &&
            <path className="daily-chart-area" d={`${line} L${px(last).toFixed(1)},${baseline} L${px(first).toFixed(1)},${baseline} Z`} />}
          <path className="daily-chart-line" d={line} />
          {points.map((point, index) => <circle key={`${point.x}-${index}`} cx={px(point)} cy={py(point.y)} r="3">
            <title>{`${entry.name}, ${point.x}: ${formatNumber(point.y)}`}</title>
          </circle>)}
        </g>;
      })}
    </svg>
    <ScrollTable label={`${name} data`}>
      <table>
        <caption>{name} data</caption>
        <thead><tr><th scope="col">Series</th><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
        <tbody>{series.flatMap(entry => entry.points.map((point, index) =>
          <tr key={`${entry.name}-${index}`}><th scope="row">{entry.name}</th><td>{String(point.x)}</td><td>{formatNumber(point.y)}</td></tr>))}</tbody>
      </table>
    </ScrollTable>
  </figure>;
}
