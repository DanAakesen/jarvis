export type DateTimeValue = Date | string | null | undefined;

export interface DateTimeOptions {
  locale?: string;
  timeZone?: string;
}

const fallback = '—';
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function utcDateAt(year: number, month: number, day: number, hour: number, minute = 0, second = 0): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date;
}

function parsedDate(value: DateTimeValue, timeZone?: string): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

  const dateOnly = dateOnlyPattern.exec(value);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const utcDate = utcDateAt(year, month, day, 12);
    if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() + 1 !== month || utcDate.getUTCDate() !== day) return null;
    if (!timeZone) {
      const localDate = new Date(0);
      localDate.setFullYear(year, month - 1, day);
      localDate.setHours(12, 0, 0, 0);
      return localDate;
    }

    const target = utcDate.getTime();
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(candidate);
      const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
      const observed = utcDateAt(part('year'), part('month'), part('day'), part('hour'), part('minute'), part('second')).getTime();
      const adjustment = target - observed;
      if (adjustment === 0) break;
      candidate += adjustment;
    }
    return new Date(candidate);
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDate(value: DateTimeValue, options: DateTimeOptions, dateOptions: Intl.DateTimeFormatOptions): string {
  try {
    const date = parsedDate(value, options.timeZone);
    if (!date) return fallback;
    return new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
      ...dateOptions,
      ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
    }).format(date);
  } catch {
    return fallback;
  }
}

export function formatDateTime(value: DateTimeValue, options: DateTimeOptions = {}): string {
  return formatDate(value, options, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
}

export function formatDateOnly(value: DateTimeValue, options: DateTimeOptions = {}): string {
  return formatDate(value, options, { dateStyle: 'medium' });
}

export function formatTimeOnly(value: DateTimeValue, options: DateTimeOptions = {}): string {
  return formatDate(value, options, { timeStyle: 'short', hourCycle: 'h23' });
}
