import { useState } from 'react';
import { dailyPeriodFor, initialDailyPeriodForShell, isDailyPeriod, type DailyPeriodPreset } from './period';
import type { DailyPeriod } from './sections/types';

const presets: { id: DailyPeriodPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7', label: 'Last 7 days' },
  { id: '14', label: 'Last 14 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom From/To' },
];

function selectedPreset(period: DailyPeriod): DailyPeriodPreset {
  const preset = presets.find(item => item.id !== 'custom' &&
    JSON.stringify(dailyPeriodFor(item.id)) === JSON.stringify(period));
  return preset?.id ?? 'custom';
}

export function DailyPeriodControl({ period, onPeriodChange }: {
  period: DailyPeriod;
  onPeriodChange: (period: DailyPeriod) => void;
}) {
  const [draft, setDraft] = useState<DailyPeriod>(initialDailyPeriodForShell);
  const [error, setError] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const preset = showCustom ? 'custom' : selectedPreset(period);

  return <div className="daily-period-control">
    <label>Period<select aria-label="Period" value={preset} onChange={event => {
      const value = event.target.value as DailyPeriodPreset;
      setError(false);
      if (value === 'custom') { setDraft(period); setShowCustom(true); }
      else { setShowCustom(false); onPeriodChange(dailyPeriodFor(value)); }
    }}>
      {presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {preset === 'custom' && <form className="daily-custom-period" onSubmit={event => {
      event.preventDefault();
      if (isDailyPeriod(draft)) { setError(false); onPeriodChange(draft); }
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
