// Scales for generated chart views (P8-14 `chart`): numeric x values plot on a linear axis, anything else is a
// category in first-seen order. Y always includes zero so bars and areas start from a real baseline.

export type ChartPoint = { x: number | string; y: number };
export type ChartSeries = { name: string; points: ChartPoint[] };

export interface ChartLayout {
  categorical: boolean;
  categories: string[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  yTicks: number[];
}

function niceStep(span: number, count: number) {
  const raw = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  return (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
}

export function chartLayout(series: readonly ChartSeries[], forceCategorical = false, includeZero = true): ChartLayout {
  const points = series.flatMap((entry) => entry.points);
  const categorical = forceCategorical || points.some((point) => typeof point.x !== 'number');
  const categories: string[] = [];
  if (categorical) {
    for (const point of points) {
      const label = String(point.x);
      if (!categories.includes(label)) categories.push(label);
    }
  }
  const xs = categorical ? [0, Math.max(0, categories.length - 1)] : points.map((point) => point.x as number);
  const ys = points.map((point) => point.y);
  // Bars and areas need a zero baseline; lines read better fitted to their data.
  let yMin = includeZero ? Math.min(0, ...ys) : Math.min(...ys);
  let yMax = includeZero ? Math.max(0, ...ys) : Math.max(...ys);
  if (yMin === yMax) yMax = yMin + 1;
  const step = niceStep(yMax - yMin, 4);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;
  const yTicks: number[] = [];
  for (let tick = yMin; tick <= yMax + step / 2; tick += step) yTicks.push(Number(tick.toPrecision(12)));
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  return { categorical, categories, xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin, yMax, yTicks };
}

/** Position of a point's x on a 0–1 axis: categories sit at even steps (bar groups centre within their slot). */
export function xPosition(layout: ChartLayout, x: number | string, bars: boolean) {
  if (layout.categorical) {
    const index = layout.categories.indexOf(String(x));
    const count = Math.max(1, layout.categories.length);
    return bars ? (index + 0.5) / count : count === 1 ? 0.5 : index / (count - 1);
  }
  return ((x as number) - layout.xMin) / (layout.xMax - layout.xMin);
}

export function yPosition(layout: ChartLayout, y: number) {
  return (y - layout.yMin) / (layout.yMax - layout.yMin);
}

/** X labels: years and other four-digit integers print as written (2019, not 2,019). */
export function formatChartX(value: number) {
  return Number.isInteger(value) && Math.abs(value) >= 1000 && Math.abs(value) < 10000 ? String(value) : formatChartNumber(value);
}

export function formatChartNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })}B`;
  if (absolute >= 1e6) return `${(value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (absolute >= 1e4) return `${(value / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
