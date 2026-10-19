import { dailyQuerySources as sources, isDailyQuery, type DailyCursor, type DailyJson, type DailyQuery, type DailySourceId } from '@jarvis/contracts';
import type { ChartSeries } from '../chart-data';
import { isDailyPeriod } from './period';
import { dailyLocale, formatDate, formatNumber, formatTime } from './ui/formatters';

/** `purpose` is static plain-English copy for the overview: what the collection is for, never a figure. */
export const dailySources: readonly { id: DailySourceId; label: string; dated: boolean; purpose: string }[] = [
  { id: sources.metrics, label: 'Measurements', dated: true,
    purpose: 'Health readings synced from your phone.' },
  { id: sources.sleep, label: 'Sleep', dated: true,
    purpose: 'Nightly time asleep and in bed.' },
  { id: sources.workouts, label: 'Workouts', dated: true,
    purpose: 'Workouts recorded by your phone.' },
  { id: sources.meals, label: 'Food history', dated: true,
    purpose: 'Logged meals; deleted ones stay, marked.' },
  { id: sources.favorites, label: 'Saved favourites', dated: false,
    purpose: 'Saved foods for quick logging.' },
  { id: sources.plans, label: 'Meal plans', dated: false,
    purpose: 'Saved meal plans.' },
  { id: sources.briefs, label: 'Brief history', dated: false,
    purpose: 'Past daily briefs, as stored.' },
  { id: sources.sync, label: 'Sync evidence', dated: false,
    purpose: 'Whether your phone is sending data.' },
];
export type Row = Record<string, DailyJson>;
export interface Column { key: string; label: string; unit?: string; numeric?: boolean }
const columns: Record<DailySourceId, readonly Column[]> = {
  [sources.metrics]: [{ key: 'metric_date', label: 'Date' }, { key: 'metric_name', label: 'Measurement' }, { key: 'value', label: 'Value', numeric: true }, { key: 'avg_value', label: 'Average', numeric: true }, { key: 'unit', label: 'Unit' }],
  [sources.metricCatalog]: [{ key: 'metric_name', label: 'Measurement' }, { key: 'units', label: 'Units' }, { key: 'first_date', label: 'First date' }, { key: 'last_date', label: 'Last date' }, { key: 'day_count', label: 'Days measured', numeric: true }],
  [sources.sleep]: [{ key: 'sleep_date', label: 'Date' }, { key: 'asleep_hours', label: 'Asleep', unit: 'h' }, { key: 'total_sleep_hours', label: 'Total sleep', unit: 'h' }, { key: 'in_bed_hours', label: 'In bed', unit: 'h' }],
  [sources.workouts]: [{ key: 'workout_date', label: 'Date' }, { key: 'workout_type', label: 'Workout' }, { key: 'duration_seconds', label: 'Duration', unit: 's' }, { key: 'avg_heart_rate', label: 'Average heart rate', unit: 'bpm' }],
  [sources.workout]: [{ key: 'id', label: 'Workout ID' }],
  [sources.heartRate]: [{ key: 'sample_minute', label: 'Minute' }, { key: 'min_value', label: 'Minimum', numeric: true }, { key: 'avg_value', label: 'Average', numeric: true }, { key: 'max_value', label: 'Maximum', numeric: true }, { key: 'unit', label: 'Unit' }],
  [sources.meals]: [{ key: 'meal_date', label: 'Date' }, { key: 'meal_name', label: 'Food' }, { key: 'energy_kcal', label: 'Energy', unit: 'kcal' }, { key: 'confidence', label: 'Confidence' }],
  [sources.days]: [{ key: 'meal_date', label: 'Date' }, { key: 'meal_count', label: 'Meals', numeric: true }, { key: 'energy_kcal', label: 'Energy', unit: 'kcal' }, { key: 'protein_grams', label: 'Protein', unit: 'g' }, { key: 'carbohydrates_grams', label: 'Carbohydrates', unit: 'g' }, { key: 'fat_grams', label: 'Fat', unit: 'g' }, { key: 'fiber_grams', label: 'Fiber', unit: 'g' }, { key: 'unknown_nutrients', label: 'Unknown nutrients' }, { key: 'partial_nutrients', label: 'Partial nutrients' }],
  [sources.favorites]: [{ key: 'favorite_name', label: 'Favourite' }, { key: 'aliases_json', label: 'Aliases' }, { key: 'energy_kcal', label: 'Energy', unit: 'kcal' }, { key: 'confidence', label: 'Confidence' }],
  [sources.plans]: [{ key: 'plan_name', label: 'Plan' }, { key: 'energy_kcal', label: 'Energy', unit: 'kcal' }, { key: 'protein_grams', label: 'Protein', unit: 'g' }, { key: 'revision', label: 'Revision' }],
  [sources.briefs]: [{ key: 'started_at', label: 'Started as recorded' }, { key: 'trigger', label: 'Trigger' }, { key: 'status', label: 'Historical status' }, { key: 'delivery_status', label: 'Historical delivery' }],
  [sources.brief]: [{ key: 'id', label: 'Brief ID' }, { key: 'started_at', label: 'Started as recorded' }, { key: 'status', label: 'Historical status' }, { key: 'delivery_status', label: 'Historical delivery' }],
  [sources.sync]: [{ key: 'feed_kind', label: 'Feed' }, { key: 'accepted_evidence_at', label: 'Accepted' }, { key: 'processed_committed_at', label: 'Processed' }],
};
export function dailyColumns(source: DailySourceId) { return columns[source]; }
// A column that carries a unit or is flagged numeric holds quantities even when a page records none of them.
export function isNumericColumn(column: Column) { return column.numeric ?? column.unit !== undefined; }
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
export function initialDailyPeriod(now = new Date()) {
  const parts = Object.fromEntries(calendar.formatToParts(now).map(part => [part.type, part.value]));
  const endDate = `${parts.year}-${parts.month}-${parts.day}`;
  const start = new Date(`${endDate}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
export function dailyRequest(source: DailySourceId, period: { startDate: string; endDate: string }, cursor?: DailyCursor, recordId?: string): DailyQuery | null {
  if ([sources.metrics, sources.sleep, sources.workouts, sources.meals].some(id => id === source) && !isDailyPeriod(period)) return null;
  const value = source === sources.sync ? { source } : source === sources.workout ? { source, workoutId: recordId } :
    source === sources.brief ? { source, briefId: recordId } :
    source === sources.heartRate ? { source, workoutId: recordId, limit: 50, ...(cursor ? { cursor } : {}) } :
      source === sources.favorites || source === sources.plans || source === sources.briefs ? { source, limit: 50, ...(cursor ? { cursor } : {}) } :
        { source, ...period, limit: 50, ...(cursor ? { cursor } : {}) };
  return isDailyQuery(value) ? value : null;
}
export function readable(value: string) {
  const text = value.replace(/_/gu, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function dailyValue(value: DailyJson | undefined, locale = dailyLocale()): string {
  if (value === undefined || value === null) return 'Unknown';
  if (typeof value === 'number') return formatNumber(value, 3, locale);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value))) return formatDate(value);
    if (/^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))) return formatTime(value);
    return value;
  }
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.length ? value.join(', ') : 'None';
  return JSON.stringify(value, null, 2);
}
export function dailyCellValue(source: DailySourceId, field: string, value: DailyJson | undefined) {
  if ((source === sources.briefs || source === sources.brief) && typeof value === 'string') return value;
  return field === 'metric_name' && typeof value === 'string' ? readable(value) : dailyValue(value);
}
export function dailyRowKey(row: Row, source: DailySourceId, ordinal: number) {
  if (typeof row.id === 'string') return `${source}:${row.id}`;
  if (source === sources.metrics) return `${row.metric_date}:${row.metric_name}:${ordinal}`;
  if (source === sources.sleep) return String(row.sleep_date);
  if (source === sources.heartRate) return `${row.sample_minute}:${row.metric_name}`;
  if (source === sources.sync) return String(row.feed_kind);
  return `${source}:${ordinal}`;
}
export interface DailyPlot { id: string; label: string; unit: string; series: ChartSeries[] }
export function dailyPlots(source: DailySourceId, rows: readonly Row[], locale = dailyLocale()): DailyPlot[] {
  const groups = new Map<string, { label: string; unit: string; points: ChartSeries['points'] }>();
  rows.forEach((row, index) => {
    const fields = source === sources.metrics ? ['value', 'avg_value'] : source === sources.sleep ? ['asleep_hours', 'total_sleep_hours'] :
      source === sources.heartRate ? ['avg_value'] : [];
    for (const field of fields) {
      const value = row[field];
      const unit = source === sources.sleep ? 'h' : typeof row.unit === 'string' ? row.unit : null;
      if (typeof value !== 'number' || !Number.isFinite(value) || !unit) continue;
      const name = source === sources.metrics && typeof row.metric_name === 'string' ? row.metric_name : source === sources.sleep ? field : 'average_heart_rate';
      const id = JSON.stringify([name, field, unit]);
      const label = `${readable(name)}${source === sources.metrics && field === 'avg_value' ? ' average' : ''} (${unit})`;
      const group = groups.get(id) ?? { label, unit, points: [] };
      const date = row.metric_date ?? row.sleep_date ?? row.sample_minute;
      // Observation ordinals keep same-date points distinct; bars never imply interpolation over missing values.
      const axisLabel = source === sources.heartRate && typeof date === 'string' && Number.isFinite(Date.parse(date))
        ? formatTime(date) : dailyValue(date, locale);
      group.points.push({ x: `${index + 1}: ${axisLabel}`, y: value });
      groups.set(id, group);
    }
  });
  return [...groups].map(([id, group]) => ({ id, label: group.label, unit: group.unit,
    series: [{ name: group.label, points: group.points }] }));
}
