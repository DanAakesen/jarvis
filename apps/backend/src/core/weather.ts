import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { isHtmlArtifact, isWorkspaceCommand, type GeneratedView, type WorkspaceCommand } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import type { WorkspaceHtmlArtifactStore, WorkspaceHtmlSource } from '../database/workspace-html-artifact-store.js';
import type { WorkspaceItemsStore } from '../database/workspace-items-store.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { validateHtmlApp } from './html-artifact-validation.js';
import { readSettings } from './settings.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { workspaceResultDelivery } from './jobs.js';

const requestTimeoutMs = 8_000;
/** One try may use at most this much of the overall budget, so a stalled connection leaves room for a second try. */
const attemptTimeoutMs = 3_000;
/** A second try only starts when at least this much of the overall budget is left. */
const minRetryMs = 1_000;
/** Reading the saved home location is a local store read; it gets its own short bound. */
const homeLookupTimeoutMs = 2_000;
const maxAttempts = 2;
const progressTimeoutMs = 1_000;
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
    hourly: { type: 'boolean' },
    report: { type: 'boolean' },
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

export function weatherDescription(code: number): string {
  return weatherCodeDescriptions[code] ?? 'Unknown conditions';
}

type PhaseName = 'geocode' | 'forecast' | 'home_location' | 'report';
type FailureOutcome = 'timeout' | 'network' | 'http_status' | 'invalid' | 'too_large';
type FetchPhase = 'geocode' | 'forecast';

/** A failed provider fetch: only a fixed outcome and an HTTP status, never the provider's words. */
class WeatherFetchError extends Error {
  constructor(readonly outcome: FailureOutcome, readonly status?: number) {
    super(`Weather fetch failed: ${outcome}`);
    this.name = 'WeatherFetchError';
  }
}

/** The ToolFailure the agent sees; it names the safe cause and remembers the outcome for the report log. */
class WeatherProviderFailure extends ToolFailure {
  constructor(message: string, readonly outcome: FailureOutcome) {
    super(message);
  }
}

const phaseHosts: Readonly<Record<FetchPhase, 'open-meteo-geocoding' | 'open-meteo-forecast'>> = {
  geocode: 'open-meteo-geocoding',
  forecast: 'open-meteo-forecast',
};

function providerFailure(phase: FetchPhase, failure: WeatherFetchError, attempts: number): WeatherProviderFailure {
  const step = phase === 'geocode' ? 'place lookup' : 'forecast';
  const tries = attempts > 1 ? ` after ${attempts} tries` : '';
  const messages: Record<FailureOutcome, string> = {
    timeout: `The weather provider did not answer in time at the ${step} step${tries}.`,
    network: `The weather provider could not be reached at the ${step} step${tries}.`,
    http_status: `The weather provider returned HTTP ${failure.status ?? 'error'} at the ${step} step${tries}.`,
    too_large: `The weather provider's answer was too large at the ${step} step.`,
    invalid: `The weather provider's answer could not be read at the ${step} step.`,
  };
  return new WeatherProviderFailure(messages[failure.outcome], failure.outcome);
}

function retryable(failure: WeatherFetchError): boolean {
  return failure.outcome === 'timeout' || failure.outcome === 'network' ||
    (failure.outcome === 'http_status' && failure.status !== undefined && (failure.status === 429 || failure.status >= 500));
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      work.catch(() => undefined);
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new WeatherFetchError('too_large');
  }
  if (!response.body) throw new WeatherFetchError('invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new WeatherFetchError('too_large');
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
    throw new WeatherFetchError('invalid');
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

function validInput(value: unknown): value is { location?: string; days?: number; hourly?: boolean; report?: boolean } {
  if (!isObject(value) || Object.keys(value).some((key) => !['location', 'days', 'hourly', 'report'].includes(key))) return false;
  if ((value.hourly !== undefined && typeof value.hourly !== 'boolean') ||
      (value.report !== undefined && typeof value.report !== 'boolean')) return false;
  return (value.location === undefined ||
      (typeof value.location === 'string' && value.location.trim().length > 0 && value.location.length <= 100 &&
        ![...value.location].some((character) => character.charCodeAt(0) < 0x20))) &&
    (value.days === undefined ||
      (Number.isSafeInteger(value.days) && (value.days as number) >= 1 && (value.days as number) <= maxForecastDays));
}

function forecastUrl(place: WeatherPlace, days: number, hourly = false): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(place.latitude));
  url.searchParams.set('longitude', String(place.longitude));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  if (hourly) url.searchParams.set('hourly', 'temperature_2m,precipitation_probability');
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('timezone', 'auto');
  return url;
}

type WeatherReport = NonNullable<ReturnType<typeof forecastFrom>>;

function hourlyFrom(value: unknown, days: number) {
  if (!isObject(value) || !Array.isArray(value.time) || !Array.isArray(value.temperature_2m) ||
      !Array.isArray(value.precipitation_probability)) return null;
  const count = days * 24;
  const { time, temperature_2m: temperatures, precipitation_probability: chances } = value;
  if (time.length < count || temperatures.length < count || chances.length < count) return null;
  const times: string[] = [];
  const temperatureC: (number | null)[] = [];
  const precipitationProbabilityPercent: (number | null)[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = time[index];
    const temperature = temperatures[index];
    const chance = chances[index];
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(at) ||
        (temperature !== null && !finiteNumber(temperature)) ||
        (chance !== null && !(finiteNumber(chance) && chance >= 0 && chance <= 100))) return null;
    times.push(at);
    temperatureC.push(temperature);
    precipitationProbabilityPercent.push(chance);
  }
  // A null stays null: a missing hour is reported as missing, never filled in.
  return { times, temperatureC, precipitationProbabilityPercent };
}

function forecastFrom(value: unknown, place: WeatherPlace, days: number, hourly = false) {
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
  const hours = hourly ? hourlyFrom(value.hourly, days) : undefined;
  if (hours === null) return null;
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
    ...(hours ? { hourly: hours } : {}),
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weather in ${escapeHtml(report.location.name)}</title><style>body{font:16px system-ui,sans-serif;margin:2rem auto;max-width:56rem;padding:0 1rem;color:#20242a}h1{font-size:2rem}table{border-collapse:collapse;width:100%}th,td{padding:.65rem;text-align:left;border-bottom:1px solid #ccd0d5}caption{text-align:left;padding:.5rem 0}small{color:#59616b}</style></head><body><main><h1>Weather in ${escapeHtml(location)}</h1><p>${escapeHtml(report.current.conditions)} · ${report.current.temperatureC}°C, feels like ${report.current.feelsLikeC}°C</p><p>Humidity ${report.current.humidityPercent}% · Wind ${report.current.windSpeedKmh} km/h · Precipitation ${report.current.precipitationMm} mm</p><table><caption>Day-by-day forecast</caption><thead><tr><th>Date</th><th>Conditions</th><th>High</th><th>Low</th><th>Rain chance</th></tr></thead><tbody>${rows}</tbody></table><p><small>Local time: ${escapeHtml(report.current.time)}${report.timeZone ? ` (${escapeHtml(report.timeZone)})` : ''}. Weather data by Open-Meteo.</small></p></main></body></html>`;
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

interface WeatherTiming {
  requestTimeoutMs: number;
  attemptTimeoutMs: number;
  minRetryMs: number;
  homeLookupTimeoutMs: number;
}

/** The caller's signal, the overall deadline and when that deadline falls. */
interface WeatherBudget {
  caller: AbortSignal;
  deadline: AbortSignal;
  endsAt: number;
}

interface PhaseLog {
  phase: PhaseName;
  outcome: 'ok' | FailureOutcome;
  startedAt: number;
  attempt?: number;
  status?: number;
  host?: typeof phaseHosts[FetchPhase];
}

function logPhase(request: FastifyRequest, entry: PhaseLog): void {
  // Fixed vocabulary and numbers only: never a place, coordinate, query or provider text.
  request.log.info({
    phase: entry.phase,
    outcome: entry.outcome,
    ...(entry.status === undefined ? {} : { status: entry.status }),
    attempt: entry.attempt ?? 1,
    elapsedMs: Math.round(performance.now() - entry.startedAt),
    ...(entry.host === undefined ? {} : { host: entry.host }),
  }, 'weather.phase');
}

export function createWeatherModule(
  artifacts: Pick<WorkspaceHtmlArtifactStore, 'create'>,
  fetcher?: typeof fetch,
  workspaceItems?: WorkspaceItemsStore,
  timingOverrides: Partial<WeatherTiming> = {},
): BackendModule {
  const timing: WeatherTiming = {
    requestTimeoutMs, attemptTimeoutMs, minRetryMs, homeLookupTimeoutMs, ...timingOverrides,
  };
  const jobs = new Map<AbortController, Promise<void>>();

  function startBudget(caller: AbortSignal): WeatherBudget {
    return { caller, deadline: AbortSignal.timeout(timing.requestTimeoutMs), endsAt: performance.now() + timing.requestTimeoutMs };
  }

  // One transparent retry for a stalled or briefly failing provider; the overall budget never grows.
  async function requestJson(
    phase: FetchPhase, url: URL, budget: WeatherBudget, maxBytes: number, request: FastifyRequest,
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      budget.caller.throwIfAborted();
      const startedAt = performance.now();
      let attemptSignal: AbortSignal | undefined;
      let failure: WeatherFetchError;
      try {
        // AbortSignal.timeout only accepts whole milliseconds; what is left of the budget is fractional.
        const attemptMs = Math.max(1, Math.floor(Math.min(timing.attemptTimeoutMs, budget.endsAt - startedAt)));
        attemptSignal = AbortSignal.any([budget.caller, budget.deadline, AbortSignal.timeout(attemptMs)]);
        const response = await (fetcher ?? fetch)(url, {
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: attemptSignal,
        });
        if (!response.ok || response.redirected) {
          await response.body?.cancel().catch(() => undefined);
          throw response.ok
            ? new WeatherFetchError('invalid')
            : new WeatherFetchError('http_status', response.status);
        }
        const value = await readBoundedJson(response, maxBytes);
        logPhase(request, { phase, outcome: 'ok', attempt, startedAt, host: phaseHosts[phase] });
        return value;
      } catch (error) {
        budget.caller.throwIfAborted();
        failure = error instanceof WeatherFetchError
          ? error
          : new WeatherFetchError(attemptSignal?.aborted ? 'timeout' : 'network');
      }
      logPhase(request, {
        phase, outcome: failure.outcome, attempt, startedAt, host: phaseHosts[phase],
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      if (attempt >= maxAttempts || !retryable(failure) || budget.endsAt - performance.now() < timing.minRetryMs) {
        throw providerFailure(phase, failure, attempt);
      }
    }
  }

  async function homeLocation(request: FastifyRequest, budget: WeatherBudget) {
    const store = request.server.settingsStore;
    if (!store) return { state: 'unavailable' } as const;
    const startedAt = performance.now();
    const signal = AbortSignal.any([budget.caller, budget.deadline, AbortSignal.timeout(timing.homeLookupTimeoutMs)]);
    try {
      const home = (await abortable(readSettings(store), signal)).location;
      if (!home.city || home.latitude === null || home.longitude === null) {
        logPhase(request, { phase: 'home_location', outcome: 'invalid', startedAt });
        return { state: 'incomplete' } as const;
      }
      logPhase(request, { phase: 'home_location', outcome: 'ok', startedAt });
      return { state: 'ready', place: { name: home.city, latitude: home.latitude, longitude: home.longitude } } as const;
    } catch {
      budget.caller.throwIfAborted();
      const timedOut = signal.aborted;
      logPhase(request, { phase: 'home_location', outcome: timedOut ? 'timeout' : 'network', startedAt });
      return { state: 'unreadable', timedOut } as const;
    }
  }

  async function placeFor(inputLocation: string | undefined, request: FastifyRequest, budget: WeatherBudget) {
    if (inputLocation === undefined) {
      // The saved home city with coordinates is used as it is: no geocoding. A named place never waits on the settings store.
      const home = await homeLocation(request, budget);
      if (home.state === 'unavailable') throw new ToolRefusal('Home location settings are unavailable.');
      if (home.state === 'unreadable') {
        throw new ToolFailure(home.timedOut
          ? 'The saved home location did not answer in time.'
          : 'The saved home location could not be read right now.');
      }
      if (home.state === 'incomplete') {
        throw new ToolRefusal('Set a home city, latitude and longitude in Settings, or provide a location.');
      }
      return home.place;
    }
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', inputLocation);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const result = await requestJson('geocode', url, budget, geocodingResponseLimit, request);
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
    description: 'Get current weather and a short forecast from Open-Meteo. Uses the saved home location unless a named place is provided. By default it opens a report in the workspace. Set report to false to get the values only, with nothing opened (the right choice in typed chat, where show_in_chat presents them). Set hourly to true to also get temperature (°C) and rain probability (%) for every hour of the forecast days, with null for a missing hour. Times are local to the place; days count from today.',
    inputSchema,
    sensitive: true,
    async execute(input: unknown, request: FastifyRequest, signal: AbortSignal) {
      if (!validInput(input)) throw new ToolRefusal('Provide a place name, a forecast length from 1 to 7 days, and optional hourly and report flags.');
      signal.throwIfAborted();
      const days = input.days ?? 3;
      const location = input.location?.trim();
      if (input.report === false) {
        // Data only: nothing is saved or opened, so the caller can present the result itself.
        const budget = startBudget(signal);
        const place = await placeFor(location, request, budget);
        const value = await requestJson('forecast', forecastUrl(place, days, input.hourly === true), budget, forecastResponseLimit, request);
        const data = forecastFrom(value, place, days, input.hourly === true);
        if (!data) throw new ToolFailure('Open-Meteo returned an invalid weather forecast.');
        return { ...data, issuedAt: new Date().toISOString(), confirmation: 'Forecast returned. No workspace report was opened.' };
      }
      const ownerId = request.server.ownerObjectId;
      if (!workspaceItems) throw new ToolFailure('Weather result storage is unavailable.');
      const title = (location ? `Weather in ${location}` : 'Home weather forecast').slice(0, 80);
      const viewId = `weather-${randomUUID().replaceAll('-', '')}`;
      const controller = new AbortController();
      const abortOnCaller = () => controller.abort();
      signal.addEventListener('abort', abortOnCaller, { once: true });
      const reportStartedAt = performance.now();
      let tracker: Awaited<ReturnType<typeof request.server.backgroundJobs.start>>;
      try {
        tracker = await request.server.backgroundJobs.start(
          'html_app', title, 3, () => controller.abort(), 'Getting current weather',
        );
      } catch (error) {
        signal.removeEventListener('abort', abortOnCaller);
        throw error;
      }
      let finish!: () => void;
      jobs.set(controller, new Promise<void>((resolve) => { finish = resolve; }));
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
        // Presentation is optional once the persisted job owns the work.
        const progressSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(progressTimeoutMs)]);
        await request.server.workspaceCommands.execute(ownerId, initialCommand, progressSignal).catch(() => undefined);
        controller.signal.throwIfAborted();
        const budget = startBudget(controller.signal);
        const jobSignal = AbortSignal.any([controller.signal, budget.deadline]);
        await tracker.progress(1, 'Getting current weather');
        const place = await placeFor(location, request, budget);
        const value = await requestJson('forecast', forecastUrl(place, days, input.hourly === true), budget, forecastResponseLimit, request);
        const report = forecastFrom(value, place, days, input.hourly === true);
        if (!report) throw new ToolFailure('Open-Meteo returned an invalid weather forecast.');
        await tracker.progress(2, 'Saving weather report');
        const html = reportHtml(report);
        const sources = artifactSources(place, days);
        if (!validateHtmlApp(title, html, sources)) {
          throw new ToolFailure('The weather report failed workspace validation.');
        }
        const artifact = await artifacts.create(ownerId, title, html, sources, jobSignal);
        if (!isHtmlArtifact(artifact)) throw new ToolFailure('The weather report failed artifact validation.');
        const workspaceItem = await workspaceItems.record(ownerId, {
          id: `html_app:${artifact.id}`,
          kind: 'html_app',
          sourceId: artifact.id,
          title: artifact.title,
          promptSummary: title,
          createdAt: artifact.createdAt,
        }, jobSignal);
        const finalCommand = command('update', reportView(title, artifact.id));
        if (!isWorkspaceCommand(finalCommand, generatedViewValidationOptions(request.server))) {
          throw new ToolFailure('The weather report did not pass workspace validation.');
        }
        jobSignal.throwIfAborted();
        await tracker.done(viewId, 'Weather report saved', {
          resultId: workspaceItem.id, resultDelivery: 'pending',
        });
        let deliveryError: unknown;
        try {
          try {
            await request.server.workspaceCommands.execute(ownerId, finalCommand, jobSignal);
          } catch (error) {
            if (!(error instanceof ToolRefusal) || !request.server.workspaceCommands.isConnected(ownerId)) throw error;
            await request.server.workspaceCommands.execute(
              ownerId, command('create', reportView(title, artifact.id)), jobSignal,
            );
          }
        } catch (error) {
          deliveryError = error;
        }
        await tracker.setResultDelivery(
          deliveryError === undefined ? 'delivered' : workspaceResultDelivery(deliveryError),
        ).catch(() => undefined);
        logPhase(request, { phase: 'report', outcome: 'ok', startedAt: reportStartedAt });
        return {
          jobId: tracker.jobId,
          artifactId: artifact.id,
          ...report,
          confirmation: deliveryError === undefined
            ? 'Weather report opened in the workspace.'
            : 'Weather report saved, but workspace delivery was not confirmed. Open it from Background work.',
        };
      } catch (error) {
        if (signal.aborted) {
          // The caller is gone: close the job so it does not stay running; nobody is left to tell if that fails.
          await tracker.fail('Weather report was cancelled.').catch(() => undefined);
        } else if (!controller.signal.aborted) {
          // The whole job path: a provider failure keeps its own outcome, anything else is a report that could not be built or saved.
          logPhase(request, {
            phase: 'report',
            startedAt: reportStartedAt,
            outcome: error instanceof WeatherProviderFailure ? error.outcome : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'invalid',
          });
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
      } finally {
        signal.removeEventListener('abort', abortOnCaller);
        jobs.delete(controller);
        finish();
      }
    },
  };
  return {
    id: 'weather',
    tools: [weatherTool],
    registerRoutes: async (app) => {
      app.addHook('onClose', async () => {
        for (const controller of jobs.keys()) controller.abort();
        await Promise.all(jobs.values());
      });
    },
  };
}
