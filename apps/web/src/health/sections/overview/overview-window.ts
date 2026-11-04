import { dateStep } from '../nutrition/totals';

export type OverviewPresetId = 'today' | 'yesterday' | 'week' | 'fortnight' | 'month';

export const overviewPresets: readonly { id: OverviewPresetId; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'yesterday', label: 'Yesterday', days: 1 },
  { id: 'week', label: '1 week', days: 7 },
  { id: 'fortnight', label: '2 weeks', days: 14 },
  { id: 'month', label: '1 month', days: 30 },
];

export const defaultOverviewPreset: OverviewPresetId = 'today';

/** The body trend is a fixed look-back so it does not change with the preset. */
export const bodyTrendDays = 90;

export type OverviewWindow = {
  preset: OverviewPresetId;
  startDate: string;
  endDate: string;
  days: number;
  /** One-day presets show a single date; longer ones aggregate a range. */
  single: boolean;
  /** Where session counts start: the Monday of that week for one-day presets, the window start otherwise. */
  sessionStart: string;
  /** Whole weeks the weekly session targets are multiplied by. */
  sessionWeeks: number;
};

export function overviewWindow(preset: OverviewPresetId, today: string): OverviewWindow {
  const entry = overviewPresets.find(item => item.id === preset) ?? overviewPresets[0]!;
  const endDate = entry.id === 'yesterday' ? dateStep(today, -1) : today;
  const startDate = dateStep(endDate, -(entry.days - 1));
  const single = entry.days === 1;
  const weekday = new Date(`${endDate}T12:00:00Z`).getUTCDay();
  return {
    preset: entry.id, startDate, endDate, days: entry.days, single,
    sessionStart: single ? dateStep(endDate, -((weekday + 6) % 7)) : startDate,
    sessionWeeks: single ? 1 : Math.max(1, Math.round(entry.days / 7)),
  };
}

/** What a session count covers, for captions and accessible text. */
export function sessionScope(window: OverviewWindow) {
  return window.single ? 'week to date' : `last ${window.days} days`;
}
