import { DailyChart } from '../../ui/DailyChart';
import { dateOnly, periodDates, type Row } from './metrics';
import { hours, nightStages, stages } from './sleep';
import type { DailySectionProps } from '../types';

export function SleepChart({ rows, period }: { rows: Row[]; period: DailySectionProps['period'] }) {
  const byDate = new Map(rows.flatMap(row => {
    const date = dateOnly(row.sleep_date);
    return date ? [[date, row] as const] : [];
  }));
  const dates = periodDates(period);
  const series = [
    { name: 'Asleep (h)', value: (row: Row) => hours(row.asleep_hours) },
    ...stages.map(stage => ({ name: `${stage.label} (h)`, value: (row: Row) => nightStages(row).recorded.find(item => item.key === stage.key)?.value ?? null })),
  ];
  return <DailyChart kind="line" name="Sleep and recorded stages by night" series={series.map(entry => ({
    name: entry.name,
    points: dates.map(date => ({ x: date, y: entry.value(byDate.get(date) ?? {}) })),
  }))} />;
}
