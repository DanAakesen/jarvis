import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createWeatherModule } from './weather.js';

const hours = Array.from({ length: 48 }, (_, index) => `2026-11-${index < 24 ? '16' : '17'}T${String(index % 24).padStart(2, '0')}:00`);
const forecast = {
  timezone: 'Europe/Copenhagen',
  current: {
    time: '2026-11-16T17:00', temperature_2m: 7, apparent_temperature: 5, relative_humidity_2m: 80,
    precipitation: 0, weather_code: 3, wind_speed_10m: 12,
  },
  daily: {
    time: ['2026-11-16', '2026-11-17'], weather_code: [3, 61], temperature_2m_max: [9, 8], temperature_2m_min: [5, 4],
    precipitation_probability_max: [20, 60],
  },
  hourly: {
    time: hours,
    temperature_2m: hours.map((_, index) => (index === 3 ? null : 6 + (index % 5))),
    precipitation_probability: hours.map((_, index) => index % 50),
  },
};

function tool(requested: URL[]) {
  const fetcher = (async (url: URL) => {
    requested.push(new URL(url));
    const body = url.hostname.startsWith('geocoding')
      ? { results: [{ name: 'Copenhagen', latitude: 55.68, longitude: 12.57, country: 'Denmark' }] }
      : forecast;
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return createWeatherModule({ create: async () => { throw new Error('no artifact expected'); } }, fetcher).tools[0]!;
}

interface WeatherResult {
  hourly: { times: string[]; temperatureC: (number | null)[]; precipitationProbabilityPercent: (number | null)[] };
  forecast: Record<string, unknown>[];
  issuedAt: string;
}

const request = { server: {} } as unknown as FastifyRequest;
const run = (weather: ReturnType<typeof tool>, input: unknown) => weather.execute(input, request, new AbortController().signal) as Promise<WeatherResult>;

describe('weather values for a chat block', () => {
  it('returns hourly temperature and rain probability without opening a report', async () => {
    const requested: URL[] = [];
    const result = await run(tool(requested), { location: 'Copenhagen', days: 2, hourly: true, report: false });
    expect(requested.at(-1)!.searchParams.get('hourly')).toBe('temperature_2m,precipitation_probability');
    expect(result.hourly.times).toHaveLength(48);
    expect(result.hourly.temperatureC[3]).toBeNull();
    expect(result.hourly.precipitationProbabilityPercent[47]).toBe(47);
    expect(result.forecast[1]).toMatchObject({ date: '2026-11-17', temperatureMaxC: 8, precipitationProbabilityPercent: 60 });
    expect(result.issuedAt).toMatch(/Z$/u);
    expect(result).not.toHaveProperty('artifactId');
  });

  it('leaves hourly values out unless asked and rejects an incomplete hourly answer', async () => {
    const requested: URL[] = [];
    const weather = tool(requested);
    const plain = await run(weather, { location: 'Copenhagen', days: 2, report: false });
    expect(plain).not.toHaveProperty('hourly');
    expect(requested.at(-1)!.searchParams.has('hourly')).toBe(false);
    forecast.hourly.time.length = 10;
    await expect(run(weather, { location: 'Copenhagen', days: 2, hourly: true, report: false })).rejects.toThrow(/invalid weather forecast/u);
  });
});
