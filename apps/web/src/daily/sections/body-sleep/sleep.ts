import type { DailyPeriod } from '../types';
import { dateOnly, finite, periodDays, type Row } from './metrics';
import { formatTime } from '../../ui/formatters';

export const stages = [
  { key: 'deep_hours', label: 'Deep', mark: '1' },
  { key: 'core_hours', label: 'Core', mark: '2' },
  { key: 'rem_hours', label: 'REM', mark: '3' },
  { key: 'awake_hours', label: 'Awake', mark: '4' },
] as const;

export const sleepFields = [
  { key: 'sleep_start', label: 'Start', time: true },
  { key: 'sleep_end', label: 'End', time: true },
  { key: 'total_sleep_hours', label: 'Total sleep (h)' },
  { key: 'asleep_hours', label: 'Asleep (h)' },
  { key: 'deep_hours', label: 'Deep (h)' },
  { key: 'core_hours', label: 'Core (h)' },
  { key: 'rem_hours', label: 'REM (h)' },
  { key: 'awake_hours', label: 'Awake (h)' },
  { key: 'in_bed_hours', label: 'In bed (h)' },
  { key: 'segment_count', label: 'Segments' },
] as const;

export function hours(value: Row[string] | undefined) {
  const known = finite(value);
  return known !== null && known >= 0 ? known : null;
}

export function nightStages(row: Row) {
  const recorded = stages.flatMap(stage => {
    const value = hours(row[stage.key]);
    return value === null ? [] : [{ ...stage, value }];
  });
  return {
    recorded,
    partial: recorded.length > 0 && recorded.length < stages.length,
    total: recorded.length ? null : hours(row.total_sleep_hours) ?? hours(row.asleep_hours),
    totalLabel: hours(row.total_sleep_hours) !== null ? 'Total sleep' : 'Asleep',
  };
}

export function sleepSummary(rows: readonly Row[], period: DailyPeriod) {
  const nights = rows.flatMap(row => {
    const date = dateOnly(row.sleep_date);
    const value = hours(row.asleep_hours);
    return date && date >= period.startDate && date <= period.endDate && value !== null ? [{ date, value }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const longest = nights.reduce<{ date: string; value: number } | null>((best, night) =>
    !best || night.value > best.value ? night : best, null);
  const shortest = nights.reduce<typeof longest>((best, night) =>
    !best || night.value < best.value ? night : best, null);
  return {
    count: nights.length, total: periodDays(period), longest, shortest,
    average: nights.length ? nights.reduce((sum, night) => sum + night.value, 0) / nights.length : null,
  };
}

// Only offset-qualified instants can be converted safely; naive source times stay verbatim.
export function sleepTime(value: Row[string] | undefined, locale?: string) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) return value;
  return formatTime(value, locale);
}
