import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { SettingsStore } from './settings.js';
import { coreModule } from './index.js';
import { createWeatherTool } from './weather.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function forecast(days = 2) {
  return {
    latitude: 55.7,
    longitude: 12.6,
    timezone: 'Europe/Copenhagen',
    current: {
      time: '2026-10-08T12:00',
      temperature_2m: 12.5,
      apparent_temperature: 11.2,
      relative_humidity_2m: 72,
      precipitation: 0,
      weather_code: 2,
      wind_speed_10m: 8.4,
    },
    daily: {
      time: Array.from({ length: days }, (_, index) => `2026-10-${String(8 + index).padStart(2, '0')}`),
      weather_code: Array.from({ length: days }, () => 2),
      temperature_2m_max: Array.from({ length: days }, () => 14),
      temperature_2m_min: Array.from({ length: days }, () => 8),
      precipitation_probability_max: Array.from({ length: days }, () => 20),
    },
  };
}

function fixture(fetcher: typeof fetch, storedSettings: Record<string, unknown> = {}) {
  const record = vi.fn(async () => {});
  const settingsStore: SettingsStore = {
    read: async () => storedSettings,
    write: async () => {},
  };
  const modules = [{
    ...coreModule,
    tools: [...coreModule.tools.filter((tool) => tool.name !== 'weather'), createWeatherTool(fetcher)],
  }];
  const app = buildApp(config, undefined, {
    modules,
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    settingsStore,
    toolCallStore: { record } as never,
  });
  apps.push(app);
  return { app, record };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('weather tool', () => {
  it('uses the configured home coordinates and returns a normalized forecast', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(forecast()));
    const { app, record } = fixture(fetcher, {
      'location.home_city': '"Copenhagen"',
      'location.latitude': '55.7',
      'location.longitude': '12.6',
    });
    const result = await app.inject({ method: 'POST', url: '/tools/weather', headers, payload: { days: 2 } });

    const body = result.json();
    expect(body).toMatchObject({
      tool: 'weather',
      outcome: 'ok',
      result: {
        provider: 'Open-Meteo',
        location: { name: 'Copenhagen', latitude: 55.7, longitude: 12.6 },
        current: { temperatureC: 12.5, conditions: 'Partly cloudy' },
        forecast: expect.any(Array),
      },
    });
    expect(body.result.forecast).toHaveLength(2);
    expect(body.result.forecast[0]).toMatchObject({
      date: '2026-10-08',
      temperatureMaxC: 14,
      temperatureMinC: 8,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('forecast_days=2');
    expect(String(url)).toContain('latitude=55.7');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'weather',
      arguments: { redacted: true },
      result: { redacted: true },
    }));
  });

  it('geocodes a named location and honors the requested forecast length', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        results: [{ name: 'Aarhus', country: 'Denmark', latitude: 56.16, longitude: 10.2 }],
      }))
      .mockResolvedValueOnce(response(forecast(2)));
    const { app } = fixture(fetcher);
    const result = await app.inject({
      method: 'POST', url: '/tools/weather', headers,
      payload: { location: 'Aarhus', days: 2 },
    });

    expect(result.json()).toMatchObject({
      outcome: 'ok',
      result: { location: { name: 'Aarhus', country: 'Denmark' }, forecast: [{}, {}] },
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/v1/search?name=Aarhus&count=1');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('forecast_days=2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refuses an unset home location and invalid forecast lengths', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { app } = fixture(fetcher);
    const unset = await app.inject({ method: 'POST', url: '/tools/weather', headers, payload: {} });
    const invalid = await app.inject({
      method: 'POST', url: '/tools/weather', headers, payload: { days: 8 },
    });

    expect(unset.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Set a home city') },
    });
    expect(invalid.statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns sanitized provider failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('provider internals', { status: 503 }));
    const { app } = fixture(fetcher);
    const result = await app.inject({
      method: 'POST', url: '/tools/weather', headers, payload: { location: 'Aarhus' },
    });

    expect(result.json()).toMatchObject({
      outcome: 'error',
      result: { error: 'Open-Meteo could not provide weather right now.' },
    });
    expect(JSON.stringify(result.json())).not.toContain('provider internals');
  });
});
