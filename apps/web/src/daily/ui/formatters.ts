const timezone = 'Europe/Copenhagen';

function locale() {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en';
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(value)) return 'Unknown';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits }).format(value);
}

export function formatUnit(value: number | null | undefined, unit: string) {
  return value == null || !Number.isFinite(value) ? 'Unknown' : `${formatNumber(value)} ${unit}`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(locale(), { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: 0 }).format(value);
  if (hours > 0) return `${unit(hours, 'hour')}${minutes ? ` ${unit(minutes, 'minute')}` : ''}`;
  if (totalMinutes > 0) return unit(totalMinutes, 'minute');
  return unit(Math.floor(seconds), 'second');
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    return date.toISOString().slice(0, 10) === value ? date : null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDate(value: string | null | undefined) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale(), { timeZone: timezone, dateStyle: 'medium' }).format(date) : 'Unknown';
}

export function formatTime(value: string | null | undefined) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale(), { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Unknown';
}
