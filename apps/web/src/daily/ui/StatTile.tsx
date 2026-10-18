import type { ReactNode } from 'react';
import { formatNumber } from './formatters';
import { Sparkline } from './Sparkline';

function DeltaArrow({ direction }: { direction: 'up' | 'down' | 'same' }) {
  const path = direction === 'up' ? 'M12 19V5m-6 6 6-6 6 6' : direction === 'down'
    ? 'M12 5v14m-6-6 6 6 6-6' : 'M5 12h14m-6-6 6 6-6 6';
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg>;
}

export function StatTile({ label, value, unit, note, comparison, compact = false, sparkline, delta }: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  note?: ReactNode;
  comparison?: ReactNode;
  compact?: boolean;
  sparkline?: { values: readonly (number | null)[]; label: string };
  delta?: { current: number | null | undefined; previous: number | null | undefined; unit?: string } | null;
}) {
  const known = value !== null && value !== undefined &&
    (typeof value !== 'number' || Number.isFinite(value)) && (typeof value !== 'string' || value.length > 0);
  const display = typeof value === 'number' ? formatNumber(value) : value || 'Unknown';
  const current = delta?.current;
  const previous = delta?.previous;
  const comparable = typeof current === 'number' && Number.isFinite(current) &&
    typeof previous === 'number' && Number.isFinite(previous);
  const difference = comparable ? current - previous : null;
  const deltaText = difference === null ? null : `${difference > 0 ? '+' : ''}${formatNumber(difference)}${delta?.unit ? ` ${delta.unit}` : ''}`;
  return <article className={`daily-stat-tile${compact ? ' daily-stat-tile--compact' : ''}`}>
    <h3>{label}</h3>
    <p className="daily-stat-value">{display}{known && unit ? <span className="daily-stat-unit"> {unit}</span> : null}</p>
    {note && <p className="daily-stat-note">{note}</p>}
    {comparison && <p className="daily-stat-comparison">{comparison}</p>}
    {delta && <p className="daily-stat-delta">
      {difference === null ? 'No comparison' : <><DeltaArrow direction={difference > 0 ? 'up' : difference < 0 ? 'down' : 'same'} />{deltaText}</>}
    </p>}
    {sparkline && <Sparkline {...sparkline} />}
  </article>;
}
