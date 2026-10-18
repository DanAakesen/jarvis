import type { DailyPeriod } from './sections/types';

export type DailyPeriodPreset = '7' | '30' | '90' | 'year' | 'custom';

const day = 86_400_000;
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function isDailyPeriod(value: DailyPeriod): boolean {
  const valid = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
    const parsed = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  if (!valid(value.startDate) || !valid(value.endDate) || value.startDate > value.endDate) return false;
  const elapsed = Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`);
  return elapsed >= 0 && elapsed / day + 1 <= 366;
}

export function copenhagenDate(now = new Date()) {
  const parts = Object.fromEntries(dateParts.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dailyPeriodFor(preset: Exclude<DailyPeriodPreset, 'custom'>, now = new Date()): DailyPeriod {
  const endDate = copenhagenDate(now);
  const start = new Date(`${endDate}T12:00:00Z`);
  if (preset === 'year') return { startDate: `${endDate.slice(0, 4)}-01-01`, endDate };
  start.setUTCDate(start.getUTCDate() - (Number(preset) - 1));
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

export function initialDailyPeriodForShell(now = new Date()) {
  return dailyPeriodFor('7', now);
}
