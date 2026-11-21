import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createWeatherModule } from './weather.js';
import { ToolFailure } from './tool-registry.js';

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

const request = { server: {}, log: { info: () => undefined } } as unknown as FastifyRequest;
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

type Step = 'ok' | 'stall' | 'network' | 'bad-json' | 'too-large' | number;
type Logged = Record<string, unknown>;

const quick = { requestTimeoutMs: 400, attemptTimeoutMs: 60, minRetryMs: 40, homeLookupTimeoutMs: 60 };
const placeAnswer = { results: [{ name: 'Copenhagen', latitude: 55.68, longitude: 12.57, country: 'Denmark' }] };

/** A stubbed provider: each host plays its steps in order; a stall waits until the request's signal aborts, as a stuck connection would. */
function scripted(script: { geocoding?: Step[]; forecast?: Step[] }, settings?: Record<string, unknown>, timing = quick) {
  const calls: URL[] = [];
  const logs: Logged[] = [];
  const fetcher = (async (url: URL, init: RequestInit) => {
    const target = new URL(url);
    calls.push(target);
    const steps = target.hostname.startsWith('geocoding') ? script.geocoding : script.forecast;
    const step = steps?.shift() ?? 'ok';
    const body = target.hostname.startsWith('geocoding') ? placeAnswer : forecast;
    if (step === 'stall') {
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
    }
    if (step === 'network') throw new TypeError('fetch failed');
    if (step === 'bad-json') return new Response('not json');
    if (step === 'too-large') return new Response('{}', { headers: { 'content-length': String(10 * 1024 * 1024) } });
    if (typeof step === 'number') return new Response('private provider text', { status: step });
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const server = settings ? { settingsStore: { read: async () => settings } } : {};
  const req = { server, log: { info: (fields: Logged, event: string) => logs.push({ ...fields, event }) } } as unknown as FastifyRequest;
  const weather = createWeatherModule({ create: async () => { throw new Error('no artifact expected'); } }, fetcher, undefined, timing).tools[0]!;
  const call = (input: unknown, signal: AbortSignal = new AbortController().signal) => weather.execute(input, req, signal) as Promise<WeatherResult>;
  return { calls, logs, call };
}

const chat = { location: 'Copenhagen', days: 2, report: false };
const phases = (logs: Logged[]) => logs.map(({ phase, outcome, attempt, status }) => ({ phase, outcome, attempt, ...(status === undefined ? {} : { status }) }));

describe('weather provider fetch: phase logs and one retry', () => {
  it('returns the same result on success and logs each phase once', async () => {
    const { calls, logs, call } = scripted({});
    const result = await call(chat);
    expect(result.forecast).toHaveLength(2);
    expect(calls.map((url) => url.hostname)).toEqual(['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
    expect(phases(logs)).toEqual([
      { phase: 'geocode', outcome: 'ok', attempt: 1 },
      { phase: 'forecast', outcome: 'ok', attempt: 1 },
    ]);
  });

  it('retries a stalled first attempt once and succeeds', async () => {
    const { calls, logs, call } = scripted({ forecast: ['stall', 'ok'] });
    await expect(call(chat)).resolves.toMatchObject({ forecast: expect.any(Array) });
    expect(calls.filter((url) => url.hostname === 'api.open-meteo.com')).toHaveLength(2);
    expect(phases(logs).slice(1)).toEqual([
      { phase: 'forecast', outcome: 'timeout', attempt: 1 },
      { phase: 'forecast', outcome: 'ok', attempt: 2 },
    ]);
  });

  it('fails with the cause after two timeouts and logs both attempts', async () => {
    const { calls, logs, call } = scripted({ forecast: ['stall', 'stall', 'ok'] });
    const failure = await call(chat).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as Error).message).toBe('The weather provider did not answer in time at the forecast step after 2 tries.');
    expect(calls.filter((url) => url.hostname === 'api.open-meteo.com')).toHaveLength(2);
    expect(phases(logs).slice(1)).toEqual([
      { phase: 'forecast', outcome: 'timeout', attempt: 1 },
      { phase: 'forecast', outcome: 'timeout', attempt: 2 },
    ]);
  });

  it('names the place lookup step when geocoding stalls', async () => {
    const { logs, call } = scripted({ geocoding: ['stall', 'stall'] });
    await expect(call(chat)).rejects.toThrow('did not answer in time at the place lookup step after 2 tries');
    expect(logs.map((entry) => entry.host)).toEqual(['open-meteo-geocoding', 'open-meteo-geocoding']);
  });

  it.each([[429], [503]])('retries HTTP %i once and then succeeds', async (status) => {
    const { logs, call } = scripted({ forecast: [status, 'ok'] });
    await call(chat);
    expect(phases(logs).slice(1)).toEqual([
      { phase: 'forecast', outcome: 'http_status', attempt: 1, status },
      { phase: 'forecast', outcome: 'ok', attempt: 2 },
    ]);
  });

  it('reports the status when the retry is also refused', async () => {
    const { call } = scripted({ forecast: [429, 429] });
    await expect(call(chat)).rejects.toThrow('The weather provider returned HTTP 429 at the forecast step after 2 tries.');
  });

  it('retries a network error once', async () => {
    const { logs, call } = scripted({ geocoding: ['network', 'ok'] });
    await call(chat);
    expect(phases(logs).slice(0, 2)).toEqual([
      { phase: 'geocode', outcome: 'network', attempt: 1 },
      { phase: 'geocode', outcome: 'ok', attempt: 2 },
    ]);
  });

  it.each([
    [404, 'returned HTTP 404 at the forecast step.', 'http_status'],
    ['bad-json', 'answer could not be read at the forecast step.', 'invalid'],
    ['too-large', 'answer was too large at the forecast step.', 'too_large'],
  ] as const)('does not retry %s', async (step, message, outcome) => {
    const { calls, logs, call } = scripted({ forecast: [step, 'ok'] });
    await expect(call(chat)).rejects.toThrow(message);
    expect(calls.filter((url) => url.hostname === 'api.open-meteo.com')).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ phase: 'forecast', outcome, attempt: 1 });
  });

  it('does not start a second attempt when too little of the overall budget is left', async () => {
    const { calls, call } = scripted({ geocoding: ['stall', 'ok'] }, undefined, { ...quick, requestTimeoutMs: 80, attemptTimeoutMs: 60, minRetryMs: 50 });
    await expect(call(chat)).rejects.toThrow(/did not answer in time at the place lookup step\.$/u);
    expect(calls).toHaveLength(1);
  });

  it('stops at once when the caller aborts and does not retry', async () => {
    const { calls, logs, call } = scripted({ forecast: ['stall', 'ok'] }, undefined, { ...quick, attemptTimeoutMs: 300 });
    const controller = new AbortController();
    const pending = call(chat, controller.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(ToolFailure);
    expect(calls).toHaveLength(2);
    expect(logs).toHaveLength(1);

    const early = scripted({});
    const aborted = new AbortController();
    aborted.abort();
    await expect(early.call(chat, aborted.signal)).rejects.toThrow();
    expect(early.calls).toHaveLength(0);
  });

  it('does not geocode the saved home location', async () => {
    const home = { 'location.home_city': JSON.stringify('Aarhus'), 'location.latitude': '56.16', 'location.longitude': '10.2' };
    const saved = scripted({}, home);
    const result = await saved.call({ days: 2, report: false });
    expect(result).toMatchObject({ location: { name: 'Aarhus', latitude: 56.16, longitude: 10.2 } });
    expect(saved.calls.map((url) => url.hostname)).toEqual(['api.open-meteo.com']);
    expect(phases(saved.logs)).toEqual([{ phase: 'home_location', outcome: 'ok', attempt: 1 }, { phase: 'forecast', outcome: 'ok', attempt: 1 }]);

    const named = scripted({}, home);
    await named.call({ location: 'aarhus', days: 2, report: false });
    expect(named.calls.map((url) => url.hostname)).toEqual(['api.open-meteo.com']);

    const other = scripted({}, home);
    await other.call(chat);
    expect(other.calls.map((url) => url.hostname)).toEqual(['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
  });

  it('refuses a missing home location and reports an unreadable settings store in plain words', async () => {
    const empty = scripted({}, {});
    await expect(empty.call({ days: 2, report: false })).rejects.toThrow('Set a home city, latitude and longitude in Settings');
    expect(empty.logs).toMatchObject([{ phase: 'home_location', outcome: 'invalid' }]);
    expect(empty.calls).toHaveLength(0);

    const { logs, calls } = scripted({});
    const broken = { server: { settingsStore: { read: async () => { throw new Error('private database detail'); } } }, log: { info: (fields: Logged) => logs.push(fields) } } as unknown as FastifyRequest;
    const weather = createWeatherModule({ create: async () => { throw new Error('no artifact'); } }, (async () => { throw new Error('no fetch'); }) as unknown as typeof fetch, undefined, quick).tools[0]!;
    const failure = await weather.execute({ days: 2, report: false }, broken, new AbortController().signal).catch((error: unknown) => error);
    expect((failure as Error).message).toBe('The saved home location could not be read right now.');
    expect(logs).toEqual([expect.objectContaining({ phase: 'home_location', outcome: 'network' })]);
    expect(calls).toHaveLength(0);
  });

  it('logs only the allowed fields and never the place, coordinates or provider text', async () => {
    const { logs, call } = scripted({ geocoding: [429, 'ok'], forecast: ['stall', 500, 'ok'] });
    await call({ ...chat, location: 'Private Town' }).catch(() => undefined);
    expect(logs.length).toBeGreaterThan(2);
    for (const entry of logs) {
      expect(Object.keys(entry).sort()).toEqual(expect.arrayContaining(['attempt', 'elapsedMs', 'event', 'outcome', 'phase']));
      expect(Object.keys(entry).filter((key) => !['attempt', 'elapsedMs', 'event', 'host', 'outcome', 'phase', 'status'].includes(key))).toEqual([]);
      expect(entry.event).toBe('weather.phase');
    }
    expect(JSON.stringify(logs)).not.toMatch(/Private|55\.68|12\.57|provider text/u);
  });

  it('skips every workspace, job and status step when report is false', async () => {
    const touched = vi.fn();
    const trap = new Proxy({}, { get: () => touched });
    const req = { server: { backgroundJobs: trap, workspaceCommands: trap, ownerObjectId: 'owner' }, log: { info: () => undefined } } as unknown as FastifyRequest;
    const weather = createWeatherModule({ create: touched } as never, (async (url: URL) => new Response(JSON.stringify(
      url.hostname.startsWith('geocoding') ? placeAnswer : forecast,
    ))) as unknown as typeof fetch, trap as never, quick).tools[0]!;
    await weather.execute(chat, req, new AbortController().signal);
    expect(touched).not.toHaveBeenCalled();
  });
});
