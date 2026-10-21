import type { SettingsStore } from '../../core/settings.js';
import { readSettings } from '../../core/settings.js';
import { weatherDescription } from '../../core/weather.js';
import type { ProactiveSource, SourceContext, SourceFact, SourceResult } from '../types.js';
import { sanitizeFactText } from '../todo-file.js';

const requestTimeoutMs = 15_000;
const responseLimit = 128 * 1024;
const requiredDailyFields = [
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
  url.searchParams.set('daily', requiredDailyFields.slice(1).join(','));
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'auto');
  return url;
}

function forecastFacts(value: unknown, observedAt: string): SourceFact[] | null {
  if (!isObject(value) || !isObject(value.daily)) return null;
  const daily = value.daily;
  const arrays = requiredDailyFields.map((key) => daily[key]);
  if (arrays.some((items) => !Array.isArray(items) || items.length < 2)) return null;
  const [dates, codes, highs, lows, chances, amounts, winds] = arrays as [
    unknown[], unknown[], unknown[], unknown[], unknown[], unknown[], unknown[],
  ];
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
      ref: `weather:${index + 1}`,
      identity: `home-forecast:${date}`,
      taskScope: 'personal',
      kind: 'weather',
      label: 'Weather',
      text: sanitizeFactText(
        `${period} (${date}): ${weatherDescription(code as number)}, ${low}–${high}°C; ` +
        `precipitation ${chance}% / ${amount} mm; wind up to ${wind} km/h`,
      ),
      observedAt,
    }];
  });
}

export function createWeatherSource(
  settingsStore?: SettingsStore,
  fetcher: typeof fetch = fetch,
): ProactiveSource {
  return {
    id: 'weather',
    label: 'Weather',
    async read({ now, signal }: SourceContext): Promise<SourceResult> {
      if (!settingsStore) return unavailable(now, 'not_connected');
      const timeout = new AbortController();
      const timeoutId = setTimeout(() => timeout.abort(), requestTimeoutMs);
      try {
        const home = (await readSettings(settingsStore)).location;
        if (!home.city || home.latitude === null || home.longitude === null) {
          return unavailable(now, 'no_location');
        }
        if (!Number.isFinite(home.latitude) || home.latitude < -90 || home.latitude > 90 ||
            !Number.isFinite(home.longitude) || home.longitude < -180 || home.longitude > 180) {
          return unavailable(now, 'no_location');
        }
        const url = forecastUrl(home.latitude, home.longitude);
        if (url.protocol !== 'https:') return unavailable(now, 'read_failed');
        const response = await fetcher(url, {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.any([signal, timeout.signal]),
        });
        if (response.status === 429) {
          await response.body?.cancel().catch(() => undefined);
          return unavailable(now, 'rate_limited');
        }
        if (!response.ok || response.redirected) {
          await response.body?.cancel().catch(() => undefined);
          return unavailable(now, 'read_failed');
        }
        const observedAt = new Date().toISOString();
        const facts = forecastFacts(await readBoundedJson(response), observedAt);
        if (!facts || facts.length !== 2) return unavailable(now, 'read_failed');
        return { source: 'weather', state: 'ok', reason: null, facts, observedAt };
      } catch {
        return unavailable(now, timeout.signal.aborted || signal.aborted ? 'timeout' : 'read_failed');
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
