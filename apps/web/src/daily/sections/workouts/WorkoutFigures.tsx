import { formatDuration } from '../../ui/formatters';
import { StatTile } from '../../ui/StatTile';
import { numeric, text, type Workout } from './summary';
import { measurement, setting } from './presentation';

export function UnknownCell({ value }: { value: string | null }) {
  return value === null || value === 'Unknown' ? <span aria-label="Unknown">—</span> : <>{value}</>;
}

export function WorkoutFigures({ row }: { row: Workout }) {
  return <div className="workouts-stats">
    <StatTile label="Duration" value={formatDuration(numeric(row.duration_seconds))} />
    <StatTile label="Distance" value={measurement(row.distance_value, row.distance_unit)} />
    <StatTile label="Active energy" value={measurement(row.active_energy_value, row.active_energy_unit)} />
    <StatTile label="Total energy" value={measurement(row.total_energy_value, row.total_energy_unit)} />
    <StatTile label="Average heart rate" value={numeric(row.avg_heart_rate)} unit="bpm" note="Recorded average for this workout." />
    <StatTile label="Maximum heart rate" value={numeric(row.max_heart_rate)} unit="bpm" />
    <StatTile label="Environment" value={setting(row.is_indoor)} />
    <StatTile label="Source" value={text(row.source_name)} />
  </div>;
}
