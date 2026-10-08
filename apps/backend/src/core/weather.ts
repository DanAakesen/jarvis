import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { isHtmlArtifact, isWorkspaceCommand, type GeneratedView, type WorkspaceCommand } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import type { WorkspaceHtmlArtifactStore, WorkspaceHtmlSource } from '../database/workspace-html-artifact-store.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { validateHtmlApp } from './html-artifact-validation.js';
import { readSettings } from './settings.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const requestTimeoutMs = 8_000;
const geocodingResponseLimit = 64 * 1024;
const forecastResponseLimit = 128 * 1024;
const maxForecastDays = 7;
const weatherCodeDescriptions: Readonly<Record<number, string>> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

const inputSchema = {
  type: 'object',
  properties: {
    location: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
    days: { type: 'integer', minimum: 1, maximum: maxForecastDays },
  },
  additionalProperties: false,
} as const;

interface WeatherPlace {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function coordinate(value: unknown, minimum: number, maximum: number): value is number {
  return finiteNumber(value) && value >= minimum && value <= maximum;
}

function weatherDescription(code: number): string {
  return weatherCodeDescriptions[code] ?? 'Unknown conditions';
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Weather response exceeded the size limit');
  }
  if (!response.body) throw new Error('Weather response was empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Weather response exceeded the size limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error('Weather response was invalid');
  }
}

function validatePlace(value: unknown): WeatherPlace | null {
  if (!isObject(value) || typeof value.name !== 'string' || !value.name.trim() ||
      value.name.length > 100 || !coordinate(value.latitude, -90, 90) ||
      !coordinate(value.longitude, -180, 180)) return null;
  return {
    name: value.name,
    latitude: value.latitude,
    longitude: value.longitude,
    ...(typeof value.country === 'string' && value.country.length <= 100 ? { country: value.country } : {}),
  };
}

function validInput(value: unknown): value is { location?: string; days?: number } {
  if (!isObject(value) || Object.keys(value).some((key) => !['location', 'days'].includes(key))) return false;
  return (value.location === undefined ||
      (typeof value.location === 'string' && value.location.trim().length > 0 && value.location.length <= 100 &&
        ![...value.location].some((character) => character.charCodeAt(0) < 0x20))) &&
    (value.days === undefined ||
      (Number.isSafeInteger(value.days) && (value.days as number) >= 1 && (value.days as number) <= maxForecastDays));
}

function forecastUrl(place: WeatherPlace, days: number): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(place.latitude));
  url.searchParams.set('longitude', String(place.longitude));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('timezone', 'auto');
  return url;
}

type WeatherReport = NonNullable<ReturnType<typeof forecastFrom>>;

function forecastFrom(value: unknown, place: WeatherPlace, days: number) {
  if (!isObject(value) || !isObject(value.current) || !isObject(value.daily)) return null;
  const current = value.current;
  if (typeof current.time !== 'string' || current.time.length > 64 || !finiteNumber(current.temperature_2m) ||
      !finiteNumber(current.apparent_temperature) || !coordinate(current.relative_humidity_2m, 0, 100) ||
      !finiteNumber(current.precipitation) || current.precipitation < 0 ||
      !Number.isSafeInteger(current.weather_code) || (current.weather_code as number) < 0 ||
      (current.weather_code as number) > 99 || !finiteNumber(current.wind_speed_10m) || current.wind_speed_10m < 0) {
    return null;
  }
  const daily = value.daily;
  const times = daily.time;
  const codes = daily.weather_code;
  const highs = daily.temperature_2m_max;
  const lows = daily.temperature_2m_min;
  const precipitation = daily.precipitation_probability_max;
  if (!Array.isArray(times) || !Array.isArray(codes) || !Array.isArray(highs) || !Array.isArray(lows) ||
      !Array.isArray(precipitation) || [times, codes, highs, lows, precipitation].some((items) => items.length < days)) {
    return null;
  }
  const forecast = [];
  for (let index = 0; index < days; index += 1) {
    const date = times[index];
    const code = codes[index];
    const high = highs[index];
    const low = lows[index];
    const chance = precipitation[index];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
        !Number.isSafeInteger(code) || (code as number) < 0 || (code as number) > 99 ||
        !finiteNumber(high) || !finiteNumber(low) ||
        !finiteNumber(chance) || chance < 0 || chance > 100) return null;
    forecast.push({
      date,
      weatherCode: code,
      conditions: weatherDescription(code),
      temperatureMaxC: high,
      temperatureMinC: low,
      precipitationProbabilityPercent: chance,
    });
  }
  return {
    provider: 'Open-Meteo',
    location: {
      name: place.name,
      ...(place.country ? { country: place.country } : {}),
      latitude: place.latitude,
      longitude: place.longitude,
    },
    timeZone: typeof value.timezone === 'string' ? value.timezone : undefined,
    current: {
      time: current.time,
      temperatureC: current.temperature_2m,
      feelsLikeC: current.apparent_temperature,
      humidityPercent: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
      weatherCode: current.weather_code,
      conditions: weatherDescription(current.weather_code as number),
      windSpeedKmh: current.wind_speed_10m,
    },
    forecast,
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function reportHtml(report: WeatherReport): string {
  const rows = report.forecast.map((day) =>
    `<tr><td>${escapeHtml(day.date)}</td><td>${escapeHtml(day.conditions)}</td>` +
    `<td>${day.temperatureMaxC}°C</td><td>${day.temperatureMinC}°C</td>` +
    `<td>${day.precipitationProbabilityPercent}%</td></tr>`,
  ).join('');
  const location = `${report.location.name}${report.location.country ? `, ${report.location.country}` : ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weather in ${escapeHtml(report.location.name)}</title><style>body{font:16px system-ui,sans-serif;margin:2rem auto;max-width:56rem;padding:0 1rem;color:#20242a}h1{font-size:2rem}table{border-collapse:collapse;width:100%}th,td{padding:.65rem;text-align:left;border-bottom:1px solid #ccd0d5}caption{text-align:left;padding:.5rem 0}small{color:#59616b}</style></head><body><main><h1>Weather in ${escapeHtml(location)}</h1><p>${escapeHtml(report.current.conditions)} · ${report.current.temperatureC}°C, feels like ${report.current.feelsLikeC}°C</p><p>Humidity ${report.current.humidityPercent}% · Wind ${report.current.windSpeedKmh} km/h · Precipitation ${report.current.precipitationMm} mm</p><table><caption>Daily forecast</caption><thead><tr><th>Date</th><th>Conditions</th><th>High</th><th>Low</th><th>Rain chance</th></tr></thead><tbody>${rows}</tbody></table><p><small>Local time: ${escapeHtml(report.current.time)}${report.timeZone ? ` (${escapeHtml(report.timeZone)})` : ''}. Weather data by Open-Meteo.</small></p></main></body></html>`;
}

function statusView(title: string, value: string): GeneratedView {
  return {
    version: 1,
    title,
    renderer: 'status',
    source: { id: 'html_generation', status: 'partial', updatedAt: new Date().toISOString() },
    data: { label: title, value, state: 'unknown' },
  };
}

function reportView(title: string, artifactId: string): GeneratedView {
  return {
    version: 1,
    title,
    renderer: 'html-app',
    source: { id: 'html_generation', status: 'complete', updatedAt: new Date().toISOString() },
    data: { artifactId },
  };
}

function artifactSources(place: WeatherPlace, days: number): WorkspaceHtmlSource[] {
  return [{
    title: 'Open-Meteo weather forecast',
    url: forecastUrl(place, days).toString(),
  }];
}

export function createWeatherModule(
  artifacts: Pick<WorkspaceHtmlArtifactStore, 'create'>,
  fetcher?: typeof fetch,
): BackendModule {
  async function requestJson(url: URL, signal: AbortSignal, maxBytes: number): Promise<unknown> {
    const response = await (fetcher ?? fetch)(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => undefined);
      throw new ToolFailure('Open-Meteo could not provide weather right now.');
    }
    return readBoundedJson(response, maxBytes);
  }

  async function placeFor(inputLocation: string | undefined, request: FastifyRequest, signal: AbortSignal) {
    if (inputLocation === undefined) {
      const store = request.server.settingsStore;
      if (!store) throw new ToolRefusal('Home location settings are unavailable.');
      const home = (await readSettings(store)).location;
      if (!home.city || home.latitude === null || home.longitude === null) {
        throw new ToolRefusal('Set a home city, latitude and longitude in Settings, or provide a location.');
      }
      return { name: home.city, latitude: home.latitude, longitude: home.longitude };
    }
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', inputLocation);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const result = await requestJson(url, signal, geocodingResponseLimit);
    if (!isObject(result) || (result.results !== undefined && !Array.isArray(result.results))) {
      throw new ToolFailure('Open-Meteo returned an invalid place result.');
    }
    const results = Array.isArray(result.results) ? result.results : [];
    const place = results.length > 0 ? validatePlace(results[0]) : null;
    if (!place) throw new ToolRefusal(`Could not find a place named "${inputLocation}".`);
    return place;
  }

  const weatherTool = {
    name: 'weather',
    description: 'Get current weather and a short forecast from Open-Meteo. Uses the saved home location unless a named place is provided, then opens a report in the workspace.',
    inputSchema,
    sensitive: true,
    async execute(input: unknown, request: FastifyRequest, signal: AbortSignal) {
      if (!validInput(input)) throw new ToolRefusal('Provide a place name and a forecast length from 1 to 7 days.');
      const ownerId = request.server.ownerObjectId;
      if (!request.server.workspaceCommands.isConnected(ownerId)) {
        throw new ToolRefusal('Open the signed-in conversation workspace before asking for weather.');
      }
      const days = input.days ?? 3;
      const location = input.location?.trim();
      const title = (location ? `Weather in ${location}` : 'Home weather forecast').slice(0, 80);
      const viewId = `weather-${randomUUID().replaceAll('-', '')}`;
      const controller = new AbortController();
      const requestSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(requestTimeoutMs)]);
      const tracker = await request.server.backgroundJobs.start(
        'html_app', title, 3, () => controller.abort(), 'Getting current weather',
      );
      const command = (operation: 'create' | 'update', view: GeneratedView): WorkspaceCommand => ({
        commandId: randomUUID(),
        operation,
        viewId,
        view,
      });
      try {
        const initialCommand = command('create', statusView(title, 'Getting current weather…'));
        if (!isWorkspaceCommand(initialCommand, generatedViewValidationOptions(request.server))) {
          throw new ToolFailure('Weather progress did not pass workspace validation.');
        }
        await request.server.workspaceCommands.execute(ownerId, initialCommand, signal);
        await tracker.progress(1, 'Getting current weather');
        const place = await placeFor(location, request, requestSignal);
        const value = await requestJson(forecastUrl(place, days), requestSignal, forecastResponseLimit);
        const report = forecastFrom(value, place, days);
        if (!report) throw new ToolFailure('Open-Meteo returned an invalid weather forecast.');
        await tracker.progress(2, 'Saving weather report');
        const html = reportHtml(report);
        const sources = artifactSources(place, days);
        if (!validateHtmlApp(title, html, sources)) {
          throw new ToolFailure('The weather report failed workspace validation.');
        }
        const artifact = await artifacts.create(ownerId, title, html, sources, requestSignal);
        if (!isHtmlArtifact(artifact)) throw new ToolFailure('The weather report failed artifact validation.');
        const finalCommand = command('update', reportView(title, artifact.id));
        if (!isWorkspaceCommand(finalCommand, generatedViewValidationOptions(request.server))) {
          throw new ToolFailure('The weather report did not pass workspace validation.');
        }
        try {
          try {
            await request.server.workspaceCommands.execute(ownerId, finalCommand, requestSignal);
          } catch (error) {
            if (!(error instanceof ToolRefusal)) throw error;
            await request.server.workspaceCommands.execute(
              ownerId, command('create', reportView(title, artifact.id)), requestSignal,
            );
          }
        } catch {
          throw new ToolFailure(`Weather report ${artifact.id} was saved, but the workspace could not display it.`);
        }
        await tracker.done(viewId, 'Weather report ready');
        return {
          jobId: tracker.jobId,
          artifactId: artifact.id,
          ...report,
          confirmation: 'Weather report opened in the workspace.',
        };
      } catch (error) {
        if (!controller.signal.aborted) {
          try {
            await tracker.fail(error instanceof ToolRefusal
              ? 'Weather report was refused.'
              : 'Weather report could not be completed.');
          } catch {
            throw new ToolFailure('Weather report failed and its job status could not be saved.');
          }
        }
        if (error instanceof ToolRefusal || error instanceof ToolFailure) throw error;
        throw new ToolFailure(controller.signal.aborted
          ? 'Weather report was cancelled.'
          : 'Weather report could not be completed.');
      }
    },
  };
  return {
    id: 'weather',
    tools: [weatherTool],
    registerRoutes: async () => {},
  };
}
