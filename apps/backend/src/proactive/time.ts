const timeZone = 'Europe/Copenhagen';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type SlotTime = '07:00' | '18:00';
export interface ProactiveSlot {
  key: string;
  at: Date;
}

function parts(date: Date): Record<string, string> {
  const result = Object.fromEntries(formatter.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
  return result as Record<string, string>;
}

function localDate(date: Date): string {
  const value = parts(date);
  return `${value.year}-${value.month}-${value.day}`;
}

function dateParts(key: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(key)) throw new RangeError('Invalid Copenhagen date');
  const [year, month, day] = key.split('-').map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  if (candidate.toISOString().slice(0, 10) !== key) throw new RangeError('Invalid Copenhagen date');
  return [year!, month!, day!];
}

export function dayKey(date: Date): string {
  return localDate(date);
}

export function copenhagenDayStart(date: Date): Date {
  const target = Date.parse(`${localDate(date)}T00:00:00Z`);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration++) {
    const value = parts(new Date(candidate));
    const observed = Date.UTC(
      Number(value.year), Number(value.month) - 1, Number(value.day),
      Number(value.hour), Number(value.minute),
    );
    candidate += target - observed;
  }
  return new Date(candidate);
}

export function localTimeLabel(date: Date): string {
  const value = parts(date);
  return `${value.hour}:${value.minute}`;
}

export function isQuietHour(date: Date): boolean {
  const time = localTimeLabel(date);
  return time >= '22:00' || time < '07:00';
}

export function slotKey(date: Date, time: SlotTime): string {
  if (time !== '07:00' && time !== '18:00') throw new RangeError('Invalid proactive slot');
  return `${localDate(date)}T${time}`;
}

export function localSlotInstant(key: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})T(07:00|18:00)$/u.exec(key);
  if (!match) throw new RangeError('Invalid proactive slot key');
  const [year, month, day] = dateParts(match[1]!);
  const [hour, minute] = match[2]!.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration++) {
    const value = parts(new Date(candidate));
    const observed = Date.UTC(
      Number(value.year), Number(value.month) - 1, Number(value.day),
      Number(value.hour), Number(value.minute),
    );
    const difference = target - observed;
    if (difference === 0) break;
    candidate += difference;
  }
  const instant = new Date(candidate);
  if (`${localDate(instant)}T${localTimeLabel(instant)}` !== key) {
    throw new RangeError('Proactive slot does not exist in Copenhagen time');
  }
  return instant;
}

export function localDateTimeInstant(date: string, time: string): Date {
  if (!/^\d{2}:\d{2}$/u.test(time)) throw new RangeError('Invalid Copenhagen time');
  const [year, month, day] = dateParts(date);
  const [hour, minute] = time.split(':').map(Number);
  if (hour! > 23 || minute! > 59) throw new RangeError('Invalid Copenhagen time');
  const key = `${date}T${time}`;
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const value = parts(new Date(candidate));
    const observed = Date.UTC(
      Number(value.year), Number(value.month) - 1, Number(value.day),
      Number(value.hour), Number(value.minute),
    );
    const difference = target - observed;
    if (difference === 0) break;
    candidate += difference;
  }
  const instant = new Date(candidate);
  if (`${localDate(instant)}T${localTimeLabel(instant)}` !== key) {
    throw new RangeError('Copenhagen time does not exist');
  }
  return instant;
}

function shiftDate(key: string, days: number): string {
  const [year, month, day] = dateParts(key);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function slot(date: string, time: SlotTime): ProactiveSlot {
  const key = `${date}T${time}`;
  return { key, at: localSlotInstant(key) };
}

export function latestSlotAtOrBefore(now: Date): ProactiveSlot {
  const today = localDate(now);
  const todaySlots = (['07:00', '18:00'] as const).map((time) => slot(today, time));
  const available = todaySlots.filter(({ at }) => at.getTime() <= now.getTime());
  if (available.length) return available.at(-1)!;
  return slot(shiftDate(today, -1), '18:00');
}

export function nextSlotAfter(now: Date): ProactiveSlot {
  const today = localDate(now);
  for (const time of ['07:00', '18:00'] as const) {
    const candidate = slot(today, time);
    if (candidate.at.getTime() > now.getTime()) return candidate;
  }
  return slot(shiftDate(today, 1), '07:00');
}

export function monthKey(date: Date): string {
  const { year, month } = parts(date);
  return `${year}-${month}`;
}
