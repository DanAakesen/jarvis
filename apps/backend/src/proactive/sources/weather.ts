import { createHash } from 'node:crypto';
import { weatherDescription } from '../../core/weather.js';
import type { SourceContext, SourceFact, SourceResult } from '../types.js';
import { sanitizeFactText } from '../todo-file.js';

const requestTimeoutMs = 15_000;
const responseLimit = 128 * 1024;
const requiredHealthFields = [
  'time',
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
] as const;

function unavailable(now: Date, reason: string): SourceResult {
  return { source: 'weather', state: 'unavailable', reason, facts: [], observedAt: now.toISOString() };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > responseLimit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('response_too_large');
  }
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) {
        await reader.cancel().catch(() => undefined);
        throw new Error('response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function forecastUrl(latitude: number, longitude: number): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('daily', requiredHealthFields.slice(1).join(','));
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'auto');
  return url;
}

function forecastFacts(value: unknown, place: string, observedAt: string): SourceFact[] | null {
  if (!isObject(value) || !isObject(value.daily)) return null;
  const daily = value.daily;
  const arrays = requiredHealthFields.map((key) => daily[key]);
  if (arrays.some((items) => !Array.isArray(items) || items.length < 2)) return null;
  const [dates, codes, highs, lows, chances, amounts, winds] = arrays as [
    unknown[], unknown[], unknown[], unknown[], unknown[], unknown[], unknown[],
  ];
  const placeId = createHash('sha256').update(place).digest('hex').slice(0, 16);
  return dates.slice(0, 2).flatMap((date, index): SourceFact[] => {
    const code = codes[index];
    const high = highs[index];
    const low = lows[index];
    const chance = chances[index];
    const amount = amounts[index];
    const wind = winds[index];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
        !Number.isSafeInteger(code) || (code as number) < 0 || (code as number) > 99 ||
        !finiteNumber(high) || !finiteNumber(low) ||
        !finiteNumber(chance) || chance < 0 || chance > 100 ||
        !finiteNumber(amount) || amount < 0 || !finiteNumber(wind) || wind < 0) return [];
    const period = index === 0 ? 'Today' : 'Tomorrow';
    return [{
      ref: `trip-forecast:${placeId}:${date}`,
      identity: `trip-forecast:${placeId}:${date}`,
      taskScope: 'personal',
      kind: 'weather',
      label: 'Weather',
      highPriority: [56, 57, 65, 66, 67, 71, 73, 75, 77, 82, 85, 86, 95, 96, 99].includes(code as number) ||
        wind >= 50 || amount >= 15,
      text: sanitizeFactText(
        `${place} · ${period} (${date}): ${weatherDescription(code as number)}, ${low}–${high}°C; ` +
        `precipitation ${chance}% / ${amount} mm; wind up to ${wind} km/h`,
      ),
      observedAt,
    }];
  });
}

// Calendar locations may be coordinates, a town, or a Danish street address ending in postcode and town.
async function resolveDestination(location: string, signal: AbortSignal, fetcher: typeof fetch) {
  const coordinates = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/u.exec(location);
  if (coordinates && Math.abs(Number(coordinates[1])) <= 90 && Math.abs(Number(coordinates[2])) <= 180) {
    return { latitude: Number(coordinates[1]), longitude: Number(coordinates[2]), place: location };
  }
  const postal = /(?:^|[,\s])\d{4}\s+([\p{L} .'-]+?)(?:,\s*(?:Denmark|Danmark))?$/iu.exec(location);
  const city = (postal?.[1] ?? location).trim();
  if (!/^[\p{L} .'-]{2,80}$/u.test(city)) return;
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '5');
  if (postal) url.searchParams.set('countryCode', 'DK');
  const response = await fetcher(url, { redirect: 'error', signal });
  if (!response.ok) { await response.body?.cancel(); return; }
  const data = await readBoundedJson(response);
  if (!isObject(data) || !Array.isArray(data.results)) return;
  const matches = data.results.filter((item): item is Record<string, unknown> => isObject(item) &&
    typeof item.name === 'string' && item.name.localeCompare(city, undefined, { sensitivity: 'base' }) === 0 &&
    (!postal || item.country_code === 'DK') && finiteNumber(item.latitude) && finiteNumber(item.longitude));
  if (matches.length !== 1) return;
  const place = matches[0]!;
  return { latitude: Number(place.latitude), longitude: Number(place.longitude), place: city };
}

export async function readTripForecast(destination: string, startsAt: string, { now, signal }: SourceContext, fetcher: typeof fetch = fetch): Promise<SourceResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
  try {
    const place = await resolveDestination(destination, deadline, fetcher);
    if (!place) return unavailable(now, 'no_location');
    const response = await fetcher(forecastUrl(place.latitude, place.longitude), {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: deadline,
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => undefined);
      return unavailable(now, response.status === 429 ? 'rate_limited' : 'read_failed');
    }
    const observedAt = now.toISOString();
    const data = await readBoundedJson(response);
    const facts = forecastFacts(data, place.place, observedAt);
    if (facts?.length !== 2) return unavailable(now, 'read_failed');
    if (!isObject(data) || typeof data.timezone !== 'string') return unavailable(now, 'read_failed');
    const tripDay = new Intl.DateTimeFormat('sv-SE', { timeZone: data.timezone }).format(new Date(startsAt));
    const tripFacts = facts.filter(fact => fact.ref.endsWith(tripDay));
    if (!tripFacts.length) return unavailable(now, 'outside_forecast');
    return { source: 'weather', state: 'ok', reason: null, facts: tripFacts, observedAt };
  } catch {
    return unavailable(now, deadline.aborted ? 'timeout' : 'read_failed');
  }
}
