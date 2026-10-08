import { useEffect, useId, useRef, useState } from 'react';
import { chartLayout, formatChartNumber, formatChartX, xPosition, yPosition, type ChartSeries } from './chart-data';

const margin = { top: 14, right: 16, bottom: 34, left: 44 };
// Cyan and amber first (the house pair), then softer versions of each for a third to fifth series.
const colours = [
  'var(--glass-edge-cool)',
  'var(--glass-glow-warm)',
  'color-mix(in srgb, var(--glass-edge-cool) 50%, var(--text))',
  'color-mix(in srgb, var(--glass-glow-warm) 50%, var(--text))',
  'var(--text-muted)',
];

/** A generated `chart` view drawn as SVG: line, bar or area, with a legend and the values one click away. */
export function ChartView({ kind, series, title }: { kind: 'line' | 'bar' | 'area'; series: ChartSeries[]; title: string }) {
  const id = useId();
  const figure = useRef<HTMLElement>(null);
  // The SVG is drawn at its real width so axis text stays legible on a phone instead of shrinking with the chart.
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = figure.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(Math.min(960, Math.max(260, entry?.contentRect.width ?? 640)));
      setWidth((current) => (Math.abs(current - next) > 4 ? next : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = width < 480 ? 220 : 280;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const px = (fraction: number) => margin.left + fraction * plotWidth;
  const py = (fraction: number) => margin.top + (1 - fraction) * plotHeight;
  const bars = kind === 'bar';
  const layout = chartLayout(series, bars, kind !== 'line');
  const numericXs = layout.categorical ? [] : [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x as number)))].sort((a, b) => a - b);
  const maxLabels = width < 480 ? 4 : 8;
  const baseline = py(yPosition(layout, Math.max(layout.yMin, Math.min(0, layout.yMax))));
  const xLabels = layout.categorical
    ? layout.categories.map((label, index) => ({ label, at: xPosition(layout, label, bars), index }))
      .filter((_, index, all) => all.length <= maxLabels || index % Math.ceil(all.length / maxLabels) === 0)
    : numericXs.length <= 24
      // Real x values, thinned evenly, so every label sits exactly under its points.
      ? numericXs.map((value, index) => ({ label: formatChartX(value), at: xPosition(layout, value, false), index }))
        .filter((_, index, all) => all.length <= maxLabels || index % Math.ceil(all.length / maxLabels) === 0)
      : [0, 0.25, 0.5, 0.75, 1].map((fraction, index) => ({
        label: formatChartX(layout.xMin + fraction * (layout.xMax - layout.xMin)), at: fraction, index,
      }));
  const slot = plotWidth / Math.max(1, layout.categories.length);
  const barWidth = Math.min(36, (slot * 0.72) / Math.max(1, series.length));

  return (
    <figure ref={figure} className="generated-chart" aria-labelledby={`${id}-caption`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-caption`} width={width} height={height} preserveAspectRatio="xMidYMid meet">
        {layout.yTicks.map((tick) => (
          <g key={tick} className="chart-grid">
            <line x1={margin.left} x2={width - margin.right} y1={py(yPosition(layout, tick))} y2={py(yPosition(layout, tick))} />
            <text x={margin.left - 8} y={py(yPosition(layout, tick))} textAnchor="end" dominantBaseline="middle">{formatChartNumber(tick)}</text>
          </g>
        ))}
        {xLabels.map(({ label, at, index }) => (
          <text key={`${label}-${index}`} className="chart-x-label" x={px(at)} y={height - 12} textAnchor="middle">{label.length > 14 ? `${label.slice(0, 13)}…` : label}</text>
        ))}
        {series.map((entry, seriesIndex) => {
          const colour = colours[seriesIndex % colours.length];
          if (bars) {
            return (
              <g key={entry.name} fill={colour} className="chart-bars">
                {entry.points.map((point, index) => {
                  const centre = px(xPosition(layout, point.x, true));
                  const x = centre - (barWidth * series.length) / 2 + barWidth * seriesIndex;
                  const top = py(yPosition(layout, point.y));
                  return (
                    <rect key={index} x={x + 1} width={Math.max(1, barWidth - 2)} y={Math.min(top, baseline)} height={Math.max(1, Math.abs(baseline - top))} rx={3}>
                      <title>{`${entry.name}, ${point.x}: ${formatChartNumber(point.y)}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          }
          const ordered = layout.categorical ? entry.points : [...entry.points].sort((a, b) => (a.x as number) - (b.x as number));
          const coordinates = ordered.map((point) => [px(xPosition(layout, point.x, false)), py(yPosition(layout, point.y))] as const);
          const line = coordinates.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          return (
            <g key={entry.name} className="chart-series" style={{ color: colour }}>
              {kind === 'area' && coordinates.length > 1 && (
                <path className="chart-area" d={`${line} L${coordinates.at(-1)![0].toFixed(1)},${baseline} L${coordinates[0]![0].toFixed(1)},${baseline} Z`} />
              )}
              <path className="chart-line" d={line} pathLength={1} />
              {coordinates.length <= 60 && ordered.map((point, index) => (
                <circle key={index} cx={coordinates[index]![0]} cy={coordinates[index]![1]} r={3}>
                  <title>{`${entry.name}, ${point.x}: ${formatChartNumber(point.y)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption id={`${id}-caption`} className="visually-hidden">{`${title}: ${kind} chart of ${series.map((entry) => entry.name).join(', ')}`}</figcaption>
      {series.length > 1 && (
        <ul className="chart-legend" aria-hidden="true">
          {series.map((entry, index) => <li key={entry.name} style={{ color: colours[index % colours.length] }}><span>{entry.name}</span></li>)}
        </ul>
      )}
      <details className="chart-values">
        <summary>Show values</summary>
        <div className="generated-view-table">
          <table aria-label={`${title} values`}>
            <thead><tr><th scope="col">Series</th><th scope="col">X</th><th scope="col">Y</th></tr></thead>
            <tbody>
              {series.flatMap((entry) => entry.points.map((point, index) => (
                <tr key={`${entry.name}-${index}`}><th scope="row">{entry.name}</th><td>{point.x}</td><td>{point.y}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
