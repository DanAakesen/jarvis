import { useId } from 'react';
import { formatDate, formatNumber } from '../../ui/formatters';
import { dateOnly, type Row } from './metrics';
import { nightStages, stages } from './sleep';

export function SleepChart({ rows }: { rows: Row[] }) {
  const id = useId().replace(/:/gu, '');
  const nights = [...rows].filter(row => dateOnly(row.sleep_date))
    .sort((a, b) => String(a.sleep_date).localeCompare(String(b.sleep_date)));
  const values = nights.map(row => {
    const data = nightStages(row);
    return { date: String(row.sleep_date), ...data,
      height: data.recorded.length ? data.recorded.reduce((sum, stage) => sum + stage.value, 0) : data.total ?? 0 };
  });
  const maximum = Math.max(1, ...values.map(night => night.height));
  const width = Math.max(640, values.length * 48 + 64);
  const plotHeight = 190;
  const step = (width - 80) / Math.max(1, values.length);
  const barWidth = Math.min(36, step * .65);
  const y = (value: number) => 220 - value / maximum * plotHeight;
  return <figure className="body-sleep-chart">
    <figcaption>Recorded sleep stages by night</figcaption>
    <p className="body-sleep-note">Hours, stacked from zero. Numbers and patterns identify stages; full values are in the nightly table. Missing stages stay unknown, not zero. Stacks include awake time and need not equal time asleep.</p>
    <ul className="body-sleep-legend" aria-label="Sleep stages legend">
      {stages.map(stage => <li key={stage.key}>{stage.mark} · {stage.label}</li>)}
      <li>T · Stages not recorded</li>
    </ul>
    <div className="body-sleep-plot-scroll" role="region" aria-label="Sleep stage chart, scroll horizontally for more nights" tabIndex={0}>
      {/* Inline size: the shell's `.app-shell svg` icon rule would otherwise override the width/height attributes. */}
      <svg viewBox={`0 0 ${width} 280`} width={width} height="280" style={{ width, height: 280 }} role="img" aria-label="Recorded nightly sleep stages in hours">
        <defs>{stages.map((stage, index) => <pattern id={`${id}-${stage.key}`} key={stage.key}
          width={8 + index * 2} height={8 + index * 2} patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${index * 45})`}>
          <rect width="100%" height="100%" className={`body-sleep-stage body-sleep-stage-${index}`} />
          <path d="M0 0V12" stroke="var(--surface)" strokeWidth={index + 1} />
        </pattern>)}</defs>
        {[0, maximum / 2, maximum].map(tick => <g className="daily-chart-grid" key={tick}>
          <line x1="48" x2={width - 16} y1={y(tick)} y2={y(tick)} />
          <text x="40" y={y(tick)} textAnchor="end" dominantBaseline="middle">{formatNumber(tick)}</text>
        </g>)}
        <text x="8" y="16" className="body-sleep-axis-label">h</text>
        {values.map((night, index) => {
          const x = 48 + step * (index + .5);
          let cumulative = 0;
          return <g key={`${night.date}-${index}`}>
            {night.recorded.map(stage => {
              const base = cumulative;
              cumulative += stage.value;
              return <g key={stage.key}>
                <rect x={x - barWidth / 2} y={y(cumulative)} width={barWidth}
                  height={(stage.value / maximum) * plotHeight} fill={`url(#${id}-${stage.key})`}>
                  <title>{`${night.date}: ${stage.label} ${formatNumber(stage.value)} h`}</title>
                </rect>
                {stage.value / maximum * plotHeight > 18 && <text x={x} y={y(base + stage.value / 2)}
                  textAnchor="middle" dominantBaseline="middle" className="body-sleep-stage-mark">{stage.mark}</text>}
              </g>;
            })}
            {night.total !== null && <rect className="body-sleep-total" x={x - barWidth / 2} y={y(night.total)}
              width={barWidth} height={night.total / maximum * plotHeight}>
              <title>{`${night.date}: ${night.totalLabel} ${formatNumber(night.total)} h. Stages not recorded.`}</title>
            </rect>}
            <text x={x} y={Math.max(16, y(night.height) - 8)} textAnchor="middle" className="body-sleep-axis-label">
              {night.partial ? '?' : !night.recorded.length ? night.total !== null ? 'T' : '?' : ''}
            </text>
            <text transform={`translate(${x},240) rotate(-35)`} textAnchor="end" className="body-sleep-axis-label">{night.date.slice(5)}</text>
            <title>{formatDate(night.date)}{night.partial ? ': partial stages; unrecorded stages unknown' : ''}</title>
          </g>;
        })}
      </svg>
    </div>
    {values.some(night => night.partial) && <p>“?” marks partial stages; unrecorded stages are unknown.</p>}
    {values.some(night => !night.recorded.length) && <p>T: Stages not recorded. Only the recorded total sleep (or asleep when total is unknown) is drawn; “?” means neither is known.</p>}
  </figure>;
}
