import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsStore } from '../../core/settings.js';
import { defaultProactiveSettings } from '../store.js';
import type { SourceContext } from '../types.js';
import { createWeatherSource } from './weather.js';

const now = new Date('2026-10-20T12:00:00.000Z');
const signal = () => new AbortController().signal;

function context(): SourceContext {
  return { now, signal: signal(), settings: defaultProactiveSettings() };
}

function settingsStore(location = true): SettingsStore {
  return {
    read: async () => location ? {
      'location.home_city': '"Synthetic City"',
      'location.latitude': '55.7',
      'location.longitude': '12.6',
    } : {},
    write: async () => {},
  };
}

function forecastResponse(): Response {
  return new Response(JSON.stringify({
    daily: {
      time: ['2026-10-20', '2026-10-21'],
      weather_code: [2, 61],
      temperature_2m_max: [14, 12],
      temperature_2m_min: [8, 6],
      precipitation_probability_max: [20, 80],
      precipitation_sum: [0.1, 4.2],
      wind_speed_10m_max: [8.4, 15],
    },
  }), { headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.useRealTimers());

describe('proactive weather source', () => {
  it('uses the saved home location and returns today and tomorrow without coordinates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(forecastResponse());
    const result = await createWeatherSource(settingsStore(), fetcher).read(context());

    expect(result).toMatchObject({ source: 'weather', state: 'ok', observedAt: now.toISOString() });
    expect(result.facts).toHaveLength(2);
    expect(result.facts.map(({ text }) => text)).toEqual([
      'Today (2026-10-20): Partly cloudy, 8–14°C; precipitation 20% / 0.1 mm; wind up to 8.4 km/h',
      'Tomorrow (2026-10-21): Slight rain, 6–12°C; precipitation 80% / 4.2 mm; wind up to 15 km/h',
    ]);
    expect(result.facts.map(({ identity, taskScope }) => [identity, taskScope])).toEqual([
      ['home-forecast:2026-10-20', 'personal'],
      ['home-forecast:2026-10-21', 'personal'],
    ]);
    expect(result.facts.every(({ text }) => !text.includes('55.7') && !text.includes('12.6'))).toBe(true);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('https://api.open-meteo.com/v1/forecast');
    expect(String(url)).toContain('latitude=55.7');
    expect(options).toMatchObject({ redirect: 'error' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not guess a location or make a request when home coordinates are missing', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createWeatherSource(settingsStore(false), fetcher).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'no_location', facts: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps provider errors, rate limits, oversized responses and timeouts to stable reasons', async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    await expect(createWeatherSource(settingsStore(), failed).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'read_failed', facts: [],
    });

    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    await expect(createWeatherSource(settingsStore(), limited).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'rate_limited', facts: [],
    });

    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(128 * 1024 + 1), {
      headers: { 'content-length': String(128 * 1024 + 1) },
    }));
    await expect(createWeatherSource(settingsStore(), oversized).read(context())).resolves.toMatchObject({
      state: 'unavailable', reason: 'read_failed', facts: [],
    });

    vi.useFakeTimers();
    const timeout = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = createWeatherSource(settingsStore(), timeout).read(context());
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toMatchObject({
      state: 'unavailable', reason: 'timeout', facts: [],
    });
  });
});
