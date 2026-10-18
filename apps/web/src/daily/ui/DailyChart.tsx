import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chartLayout, xPosition, yPosition, type ChartPoint } from '../../chart-data';
import { formatNumber } from './formatters';
import { ScrollTable } from './ScrollTable';

type DailyChartPoint = Omit<ChartPoint, 'y'> & { y: number | null; low?: number | null; high?: number | null };
type DailyChartSeries = { name: string; points: readonly DailyChartPoint[] };

const margin = { top: 12, right: 16, bottom: 32, left: 48 };
const colours = ['var(--glass-edge-cool)', 'var(--glass-glow-warm)'];
const linePatterns = [undefined, '6 3', '2 4'];

function label(point: DailyChartPoint) {
  const value = point.y === null ? 'Not recorded' : formatNumber(point.y);
  return `${String(point.x)}: ${value}`;
}

function pathSegments(points: readonly DailyChartPoint[], px: (point: DailyChartPoint) => number, py: (value: number) => number) {
  let drawing = false;
  return points.map(point => {
    if (point.y === null) {
      drawing = false;
      return '';
    }
    const command = `${drawing ? 'L' : 'M'}${px(point).toFixed(1)},${py(point.y).toFixed(1)}`;
    drawing = true;
    return command;
  }).filter(Boolean).join(' ');
}

function bandSegments(points: readonly DailyChartPoint[], px: (point: DailyChartPoint) => number, py: (value: number) => number) {
  const segments: DailyChartPoint[][] = [];
  for (const point of points) {
    if (point.low == null || point.high == null) {
      if (segments.at(-1)?.length) segments.push([]);
      continue;
    }
    if (!segments.length) segments.push([]);
    segments.at(-1)!.push(point);
  }
  return segments.filter(points => points.length).map(points => {
    const upper = points.map(point => `${px(point).toFixed(1)},${py(point.high!).toFixed(1)}`).join(' L');
    const lower = [...points].reverse().map(point => `${px(point).toFixed(1)},${py(point.low!).toFixed(1)}`).join(' L');
    return `M${upper} L${lower} Z`;
  });
}

function barPath(x: number, y: number, baseline: number, barWidth: number) {
  const top = Math.min(y, baseline);
  const bottom = Math.max(y, baseline);
  const radius = Math.min(5, barWidth / 2, (bottom - top) / 2);
  return `M${x},${bottom} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + barWidth - radius} Q${x + barWidth},${top} ${x + barWidth},${top + radius} V${bottom} Z`;
}

export function DailyChart({ kind, name, series, target, rangeLabel, dataTable }: {
  kind: 'line' | 'bar' | 'area';
  name: string;
  series: readonly DailyChartSeries[];
  target?: { value: number; label: string };
  rangeLabel?: string;
  dataTable?: ReactNode;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(800);
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const measure = (nextWidth: number) => {
      if (Number.isFinite(nextWidth) && nextWidth > 0) setWidth(Math.max(1, Math.round(nextWidth)));
    };
    measure(figure.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries.find(item => item.target === figure);
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);
  const height = Math.max(220, Math.min(320, width * .5));
  const interactivePoints = series.flatMap((entry, seriesIndex) => entry.points.map((point, index) => ({
    point, seriesIndex, index, key: `${entry.name}-${index}`,
  })));
  if (!series.some(entry => entry.points.some(point => point.y !== null || point.low != null || point.high != null))) {
    return <figure ref={figureRef} className="daily-chart">
      <figcaption>{name}</figcaption>
      <p>No recorded values to chart.</p>
      {dataTable != null && <details className="daily-chart-table" open={tableOpen}>
        <summary onClick={event => { event.preventDefault(); setTableOpen(open => !open); }}>View data table</summary>
        {tableOpen && dataTable}
      </details>}
    </figure>;
  }
  const domainPoints = series.flatMap(entry => entry.points);
  const targetPoint = target && domainPoints[0];
  const valueLayout = chartLayout([
    ...series.map(entry => ({
      name: entry.name,
      points: entry.points.flatMap(point => point.y === null
        ? [point.low, point.high].flatMap(value => value == null ? [] : [{ x: point.x, y: value }])
        : [{ ...point, y: point.y }]),
    })),
    ...(target && targetPoint ? [{ name: target.label, points: [{ x: targetPoint.x, y: target.value }] }] : []),
  ], kind === 'bar', kind !== 'line');
  const categorical = kind === 'bar' || domainPoints.some(point => typeof point.x !== 'number');
  const categories = categorical ? [...new Set(domainPoints.map(point => String(point.x)))] : [];
  const xs = categorical ? [0, Math.max(0, categories.length - 1)] : domainPoints.map(point => Number(point.x));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const layout = { ...valueLayout, categorical, categories, xMin, xMax: xMax === xMin ? xMin + 1 : xMax };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const px = (point: Pick<DailyChartPoint, 'x'>) => margin.left + xPosition(layout, point.x, kind === 'bar') * plotWidth;
  const py = (value: number) => margin.top + (1 - yPosition(layout, value)) * plotHeight;
  const baseline = py(Math.max(layout.yMin, Math.min(0, layout.yMax)));
  const barWidth = Math.min(72, plotWidth / Math.max(1, layout.categories.length) * 0.62 / Math.max(1, series.length));
  const readout = activePoint === null ? null : interactivePoints[activePoint];
  const tickCount = Math.max(2, Math.floor(plotWidth / 100));

  return <figure ref={figureRef} className="daily-chart">
    <figcaption>{name}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={name} tabIndex={0} aria-roledescription="chart"
      onFocus={() => setActivePoint(current => current ?? (interactivePoints.length ? 0 : null))}
      onBlur={() => setActivePoint(null)}
      onKeyDown={event => {
        if (!interactivePoints.length) return;
        const current = activePoint ?? 0;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          setActivePoint(Math.min(interactivePoints.length - 1, current + 1));
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          setActivePoint(Math.max(0, current - 1));
        } else if (event.key === 'Home') {
          event.preventDefault();
          setActivePoint(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          setActivePoint(interactivePoints.length - 1);
        }
      }}>
      {layout.yTicks.map(tick => <g className="daily-chart-grid" key={tick}>
        <line x1={margin.left} x2={width - margin.right} y1={py(tick)} y2={py(tick)} />
        <text x={margin.left - 8} y={py(tick)} textAnchor="end" dominantBaseline="middle">{formatNumber(tick)}</text>
      </g>)}
      {target && <g className="daily-chart-target">
        <line x1={margin.left} x2={width - margin.right} y1={py(target.value)} y2={py(target.value)} />
        <text x={width - margin.right} y={py(target.value) - 5} textAnchor="end">{target.label}</text>
      </g>}
      <g className="daily-chart-xaxis">
        {(layout.categorical
          ? layout.categories.map((category, index) => ({ x: category, position: layout.categories.length <= tickCount || index % Math.ceil((layout.categories.length - 1) / (tickCount - 1)) === 0 || index === layout.categories.length - 1
            ? xPosition(layout, category, kind === 'bar') : null }))
          : [layout.xMin, layout.xMax].map(value => ({ x: value, position: xPosition(layout, value, kind === 'bar') }))
        ).filter(item => item.position !== null).map(item => <text key={String(item.x)} x={margin.left + item.position! * plotWidth}
          y={height - 7} textAnchor={item.position! < .1 ? 'start' : item.position! > .9 ? 'end' : 'middle'}>{String(item.x)}</text>)}
      </g>
      {series.map((entry, seriesIndex) => {
        const colour = colours[seriesIndex % colours.length];
        if (kind === 'bar') return <g key={`${entry.name}-${seriesIndex}`} fill={colour} className="daily-chart-bars">
          {entry.points.map((point, index) => {
            if (point.y === null) return null;
            const x = px(point) - barWidth * series.length / 2 + barWidth * seriesIndex;
            const y = py(point.y);
            const key = `${entry.name}-${index}`;
            return <path key={key} d={barPath(x, y, baseline, barWidth)}
              onMouseEnter={() => setActivePoint(interactivePoints.findIndex(item => item.key === key))}
              onMouseLeave={() => setActivePoint(current => current === interactivePoints.findIndex(item => item.key === key) ? null : current)}>
              <title>{`${entry.name}, ${label(point)}`}</title>
            </path>;
          })}
        </g>;
        const orderedPoints = layout.categorical ? entry.points : [...entry.points].sort((a, b) => Number(a.x) - Number(b.x));
        const line = pathSegments(orderedPoints, px, py);
        const last = orderedPoints.filter(point => point.y !== null).at(-1);
        const first = orderedPoints.find(point => point.y !== null);
        return <g key={`${entry.name}-${seriesIndex}`} className="daily-chart-series" style={{ color: colour }} data-series-index={seriesIndex}>
          {orderedPoints.some(point => point.low != null && point.high != null) &&
            <g className="daily-chart-range">{bandSegments(orderedPoints, px, py).map((path, index) => <path key={index} d={path} />)}</g>}
          {kind === 'area' && first && last && first !== last && first.y !== null && last.y !== null &&
            <path className="daily-chart-area" d={`${line} L${px(last)},${baseline} L${px(first)},${baseline} Z`} />}
          <path className="daily-chart-line" d={line} strokeDasharray={linePatterns[seriesIndex]} />
          {orderedPoints.map((point, index) => point.y === null ? null : <circle key={`${point.x}-${index}`} cx={px(point)} cy={py(point.y)} r="3"
            onMouseEnter={() => setActivePoint(interactivePoints.findIndex(item => item.key === `${entry.name}-${index}`))}
            onMouseLeave={() => setActivePoint(current => current === interactivePoints.findIndex(item => item.key === `${entry.name}-${index}`) ? null : current)}>
            <title>{`${entry.name}, ${label(point)}`}</title>
          </circle>)}
        </g>;
      })}
      {readout && <g className="daily-chart-active-point" aria-hidden="true">
        <circle cx={px(readout.point)} cy={readout.point.y === null ? margin.top : py(readout.point.y)} r="7" />
        {width >= 480 && <text x={Math.min(width - margin.right, Math.max(margin.left + 90, px(readout.point)))}
          y={Math.max(margin.top + 14, (readout.point.y === null ? margin.top : py(readout.point.y)) - 12)} textAnchor="middle">
          {series[readout.seriesIndex]?.name}: {label(readout.point)}
        </text>}
      </g>}
    </svg>
    <ul className="daily-chart-legend" aria-label={`${name} legend`}>
      {rangeLabel && <li><span className="daily-chart-legend-range" aria-hidden="true" />{rangeLabel}</li>}
      {series.map((entry, index) => entry.points.length === 0 ? null : <li key={`${entry.name}-${index}`}>
        {kind === 'bar'
          ? <span className="daily-chart-legend-mark daily-chart-legend-mark--bar" style={{ color: colours[index % colours.length] }} aria-hidden="true" />
          : <svg className="daily-chart-legend-swatch" viewBox="0 0 24 12" style={{ color: colours[index % colours.length] }} aria-hidden="true">
            {kind === 'area' && <rect x="0" y="2" width="24" height="8" fill="currentColor" opacity=".16" />}
            <line x1="0" x2="24" y1="8" y2="8" stroke="currentColor" strokeWidth="2" strokeDasharray={linePatterns[index]} />
          </svg>}
        {entry.name}
      </li>)}
    </ul>
    <p className="daily-chart-readout" aria-live="polite" role="status">
      {readout ? `${series[readout.seriesIndex]?.name}, ${label(readout.point)}` : 'Focus chart and use arrow keys to inspect recorded values.'}
    </p>
    <details className="daily-chart-table" open={tableOpen}>
      <summary onClick={event => { event.preventDefault(); setTableOpen(open => !open); }}>View data table</summary>
      {tableOpen && (dataTable ?? <ScrollTable label={`${name} data`}>
        <table>
          <caption>{name} data</caption>
          <thead><tr><th scope="col">Series</th><th scope="col">X</th><th scope="col">Value</th><th scope="col">Minimum</th><th scope="col">Maximum</th></tr></thead>
          <tbody>{series.flatMap((entry, seriesIndex) => entry.points.map((point, index) =>
            <tr key={`${seriesIndex}-${index}`}><th scope="row">{entry.name}</th><td>{String(point.x)}</td>
              <td>{point.y === null ? 'Not recorded' : formatNumber(point.y)}</td>
              <td>{point.low == null ? 'Not recorded' : formatNumber(point.low)}</td>
              <td>{point.high == null ? 'Not recorded' : formatNumber(point.high)}</td></tr>))}</tbody>
        </table>
      </ScrollTable>)}
    </details>
  </figure>;
}
