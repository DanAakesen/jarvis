import { formatDateOnly as formatSharedDate, formatDateTime, formatTimeOnly } from '../../format/date-time';

const timezone = 'Europe/Copenhagen';

export function dailyLocale() {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en';
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2, locale = dailyLocale()) {
  if (value == null || !Number.isFinite(value)) return 'Unknown';
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export function formatUnit(value: number | null | undefined, unit: string, locale = dailyLocale()) {
  return value == null || !Number.isFinite(value) ? 'Unknown' : `${formatNumber(value, 2, locale)} ${unit}`;
}

export function formatDuration(seconds: number | null | undefined, locale = dailyLocale()) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: 0 }).format(value);
  if (hours > 0) return `${unit(hours, 'hour')}${minutes ? ` ${unit(minutes, 'minute')}` : ''}`;
  if (totalMinutes > 0) return unit(totalMinutes, 'minute');
  return unit(Math.floor(seconds), 'second');
}

export function formatDate(value: string | null | undefined) {
  return value ? formatSharedDate(value, { timeZone: timezone }) : 'Unknown';
}

export function formatTime(value: string | null | undefined) {
  return value ? formatDateTime(value, { timeZone: timezone }) : 'Unknown';
}

export function formatClockTime(value: string | null | undefined) {
  return value ? formatTimeOnly(value, { timeZone: timezone }) : 'Unknown';
}
