import type { ReactNode } from 'react';
import { formatNumber } from './formatters';

export function StatTile({ label, value, unit, note, comparison }: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  note?: ReactNode;
  comparison?: ReactNode;
}) {
  const known = value !== null && value !== undefined &&
    (typeof value !== 'number' || Number.isFinite(value)) && (typeof value !== 'string' || value.length > 0);
  const display = typeof value === 'number' ? formatNumber(value) : value || 'Unknown';
  return <article className="daily-stat-tile">
    <h3>{label}</h3>
    <p className="daily-stat-value">{display}{known && unit ? <span className="daily-stat-unit"> {unit}</span> : null}</p>
    {note && <p className="daily-stat-note">{note}</p>}
    {comparison && <p className="daily-stat-comparison">{comparison}</p>}
  </article>;
}
