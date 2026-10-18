import { formatDuration } from '../../ui/formatters';
import { StatTile } from '../../ui/StatTile';
import { numeric, text, type Workout } from './summary';
import { measurement, setting } from './presentation';
import { DailyGrid } from '../../ui/DailyGrid';

export function UnknownCell({ value }: { value: string | null }) {
  return value === null || value === 'Unknown' ? <span aria-label="Not recorded">Not recorded</span> : <>{value}</>;
}

export function WorkoutFigures({ row }: { row: Workout }) {
  const duration = numeric(row.duration_seconds);
  const average = numeric(row.avg_heart_rate);
  const maximum = numeric(row.max_heart_rate);
  return <DailyGrid columns="two" className="workouts-detail-stats">
    <StatTile compact label="Duration" value={duration === null ? 'Not recorded' : formatDuration(duration)} />
    <StatTile compact label="Distance" value={measurement(row.distance_value, row.distance_unit) ?? 'Not recorded'} />
    <StatTile compact label="Active energy" value={measurement(row.active_energy_value, row.active_energy_unit) ?? 'Not recorded'} />
    <StatTile compact label="Total energy" value={measurement(row.total_energy_value, row.total_energy_unit) ?? 'Not recorded'} />
    <StatTile compact label="Average heart rate" value={average ?? 'Not recorded'} {...(average === null ? {} : { unit: 'bpm' })} />
    <StatTile compact label="Maximum heart rate" value={maximum ?? 'Not recorded'} {...(maximum === null ? {} : { unit: 'bpm' })} />
    <StatTile compact label="Environment" value={setting(row.is_indoor) ?? 'Not recorded'} />
    <StatTile compact label="Source" value={text(row.source_name) ?? 'Not recorded'} />
  </DailyGrid>;
}
