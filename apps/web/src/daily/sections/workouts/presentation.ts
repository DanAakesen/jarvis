import type { DailyJson } from '@jarvis/contracts';
import { formatDate, formatNumber, formatTime } from '../../ui/formatters';
import { numeric, text, type Workout } from './summary';

export function measurement(value: DailyJson | undefined, unit: DailyJson | undefined) {
  const number = numeric(value);
  return number === null ? null : `${formatNumber(number)} ${text(unit) ?? 'Unknown unit'}`;
}

export function setting(value: DailyJson | undefined) {
  return value === true || value === 1 ? 'Indoor' : value === false || value === 0 ? 'Outdoor' : null;
}

export function workoutTime(row: Workout) {
  const start = formatTime(text(row.start_at));
  if (start !== 'Unknown') return start;
  const date = formatDate(text(row.workout_date));
  return date === 'Unknown' ? 'Unknown' : `${date} · Unknown time`;
}
