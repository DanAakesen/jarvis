import { useState } from 'react';
import { healthPeriodFor, initialHealthPeriodForShell, isHealthPeriod, type HealthPeriodPreset } from './period';
import type { HealthPeriod } from './sections/types';

const presets: { id: HealthPeriodPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7', label: 'Last 7 days' },
  { id: '14', label: 'Last 14 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom From/To' },
];

function selectedPreset(period: HealthPeriod): HealthPeriodPreset {
  const preset = presets.find(item => item.id !== 'custom' &&
    JSON.stringify(healthPeriodFor(item.id)) === JSON.stringify(period));
  return preset?.id ?? 'custom';
}

export function HealthPeriodControl({ period, onPeriodChange }: {
  period: HealthPeriod;
  onPeriodChange: (period: HealthPeriod) => void;
}) {
  const [draft, setDraft] = useState<HealthPeriod>(initialHealthPeriodForShell);
  const [error, setError] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const preset = showCustom ? 'custom' : selectedPreset(period);

  return <div className="health-period-control">
    <label>Period<select aria-label="Period" value={preset} onChange={event => {
      const value = event.target.value as HealthPeriodPreset;
      setError(false);
      if (value === 'custom') { setDraft(period); setShowCustom(true); }
      else { setShowCustom(false); onPeriodChange(healthPeriodFor(value)); }
    }}>
      {presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {preset === 'custom' && <form className="health-custom-period" onSubmit={event => {
      event.preventDefault();
      if (isHealthPeriod(draft)) { setError(false); onPeriodChange(draft); }
      else setError(true);
    }}>
      <label>From<input type="date" value={draft.startDate} onChange={event => setDraft(value => ({ ...value, startDate: event.target.value }))} /></label>
      <label>To<input type="date" value={draft.endDate} onChange={event => setDraft(value => ({ ...value, endDate: event.target.value }))} /></label>
      <button className="secondary-button" type="submit" disabled={draft.startDate === period.startDate &&
        draft.endDate === period.endDate}>Apply period</button>
    </form>}
    {error && <p className="error-text" role="alert">Choose valid start and end dates no more than 366 days apart.</p>}
  </div>;
}
