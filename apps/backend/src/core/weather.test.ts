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

  it('does not geocode the saved home location and never reads settings for a named place', async () => {
    const home = { 'location.home_city': JSON.stringify('Aarhus'), 'location.latitude': '56.16', 'location.longitude': '10.2' };
    const saved = scripted({}, home);
    const result = await saved.call({ days: 2, report: false });
    expect(result).toMatchObject({ location: { name: 'Aarhus', latitude: 56.16, longitude: 10.2 } });
    expect(saved.calls.map((url) => url.hostname)).toEqual(['api.open-meteo.com']);
    expect(phases(saved.logs)).toEqual([{ phase: 'home_location', outcome: 'ok', attempt: 1 }, { phase: 'forecast', outcome: 'ok', attempt: 1 }]);

    // A named place never waits on the settings store, even when it is the home city.
    const named = scripted({}, home);
    await named.call({ location: 'aarhus', days: 2, report: false });
    expect(named.calls.map((url) => url.hostname)).toEqual(['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
    expect(named.logs.map((entry) => entry.phase)).not.toContain('home_location');

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

/** A stub clock: performance.now, AbortSignal.timeout and delayed answers all move only when the test ticks, with fractional milliseconds like the real clock. */
function stubClock() {
  let now = 1000.37;
  const due: { at: number; run: () => void }[] = [];
  const at = (ms: number, run: () => void) => { due.push({ at: now + ms, run }); };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const spies = [
    vi.spyOn(performance, 'now').mockImplementation(() => now),
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      if (!Number.isInteger(ms)) throw new RangeError(`The value of "delay" is out of range. It must be an integer. Received ${ms}`);
      const controller = new AbortController();
      at(ms, () => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')));
      return controller.signal;
    }),
  ];
  return {
    at,
    flush,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
    async tick(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = due.filter((item) => item.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        due.splice(due.indexOf(next), 1);
        now = Math.max(now, next.at);
        next.run();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

type Timed = 'stall' | { answerAfterMs: number } | 'ok';

describe('weather retry under the real default budget (8000 / 3000 / 1000 ms) on a stub clock', () => {
  const defaults = { requestTimeoutMs: 8_000, attemptTimeoutMs: 3_000, minRetryMs: 1_000, homeLookupTimeoutMs: 2_000 };

  function timed(script: { geocoding?: Timed[]; forecast?: Timed[] }, clock: ReturnType<typeof stubClock>, timing = defaults) {
    const logs: Logged[] = [];
    const fetcher = (async (url: URL, init: RequestInit) => {
      const geocoding = new URL(url).hostname.startsWith('geocoding');
      const step = (geocoding ? script.geocoding : script.forecast)?.shift() ?? 'ok';
      const response = () => new Response(JSON.stringify(geocoding ? placeAnswer : forecast));
      if (step === 'ok') return response();
      return new Promise<Response>((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        if (step !== 'stall') clock.at(step.answerAfterMs, () => resolve(response()));
      });
    }) as unknown as typeof fetch;
    const req = { server: {}, log: { info: (fields: Logged) => logs.push(fields) } } as unknown as FastifyRequest;
    const weather = createWeatherModule({ create: async () => { throw new Error('no artifact'); } }, fetcher, undefined, timing).tools[0]!;
    return { logs, start: (input: unknown) => weather.execute(input, req, new AbortController().signal) as Promise<WeatherResult> };
  }

  it('finishes when the retry leaves a fractional, shorter remainder for the forecast', async () => {
    const clock = stubClock();
    try {
      const { logs, start } = timed({ geocoding: ['stall', { answerAfterMs: 2_500.6 }] }, clock);
      const pending = start(chat);
      await clock.flush();
      await clock.tick(3_000);
      await clock.tick(2_500.6);
      await expect(pending).resolves.toMatchObject({ forecast: expect.any(Array) });
      expect(phases(logs)).toEqual([
        { phase: 'geocode', outcome: 'timeout', attempt: 1 },
        { phase: 'geocode', outcome: 'ok', attempt: 2 },
        { phase: 'forecast', outcome: 'ok', attempt: 1 },
      ]);
      expect(logs[1]!.elapsedMs).toBe(2_501);
    } finally { clock.restore(); }
  });

  it('turns a forecast stall after a slow lookup into the named-step failure, not a RangeError', async () => {
    const clock = stubClock();
    try {
      const { logs, start } = timed({ geocoding: ['stall', { answerAfterMs: 2_500.6 }], forecast: ['stall'] }, clock);
      const pending = start(chat).catch((error: unknown) => error);
      await clock.flush();
      await clock.tick(3_000);
      await clock.tick(2_500.6);
      await clock.tick(2_500);
      const failure = await pending;
      expect(failure).toBeInstanceOf(ToolFailure);
      expect((failure as Error).message).toBe('The weather provider did not answer in time at the forecast step.');
      expect(phases(logs).at(-1)).toEqual({ phase: 'forecast', outcome: 'timeout', attempt: 1 });
    } finally { clock.restore(); }
  });

  it('retries the forecast inside the fractional remainder and reports two tries', async () => {
    const clock = stubClock();
    try {
      const { logs, start } = timed({ geocoding: [{ answerAfterMs: 2_000.7 }], forecast: ['stall', 'stall'] }, clock);
      const pending = start(chat).catch((error: unknown) => error);
      await clock.flush();
      await clock.tick(2_000.7);
      await clock.tick(3_000);
      await clock.tick(2_999);
      const failure = await pending;
      expect((failure as Error).message).toBe('The weather provider did not answer in time at the forecast step after 2 tries.');
      expect(phases(logs).slice(-2)).toEqual([
        { phase: 'forecast', outcome: 'timeout', attempt: 1 },
        { phase: 'forecast', outcome: 'timeout', attempt: 2 },
      ]);
    } finally { clock.restore(); }
  });

  it('keeps a fractional remainder usable for the place lookup retry too', async () => {
    const clock = stubClock();
    try {
      const { logs, start } = timed({ geocoding: ['stall', 'stall'] }, clock, { ...defaults, attemptTimeoutMs: 5_000 });
      const pending = start(chat).catch((error: unknown) => error);
      await clock.flush();
      await clock.tick(5_000);
      await clock.tick(3_000);
      const failure = await pending;
      expect(failure).toBeInstanceOf(ToolFailure);
      expect((failure as Error).message).toBe('The weather provider did not answer in time at the place lookup step after 2 tries.');
      expect(phases(logs)).toEqual([
        { phase: 'geocode', outcome: 'timeout', attempt: 1 },
        { phase: 'geocode', outcome: 'timeout', attempt: 2 },
      ]);
    } finally { clock.restore(); }
  });
});

describe('weather report path', () => {
  function reporting(script: { forecast?: Step[] }, timing = quick) {
    const logs: Logged[] = [];
    const calls: URL[] = [];
    const tracker = {
      jobId: 'job-1', progress: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
      done: vi.fn(async () => undefined), setResultDelivery: vi.fn(async () => undefined),
    };
    const fetcher = (async (url: URL, init: RequestInit) => {
      const target = new URL(url);
      calls.push(target);
      if (target.hostname.startsWith('geocoding')) return new Response(JSON.stringify(placeAnswer));
      if ((script.forecast?.shift() ?? 'ok') === 'stall') {
        return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
      }
      return new Response(JSON.stringify(forecast));
    }) as unknown as typeof fetch;
    const req = {
      server: {
        ownerObjectId: 'owner',
        backgroundJobs: { start: async () => tracker },
        workspaceCommands: { execute: async () => undefined, isConnected: () => true },
        jarvisTools: { list: () => [] },
      },
      log: { info: (fields: Logged, event: string) => logs.push({ ...fields, event }) },
    } as unknown as FastifyRequest;
    const weather = createWeatherModule({ create: async () => { throw new Error('no artifact'); } }, fetcher, {} as never, timing).tools[0]!;
    return { logs, calls, tracker, run: (signal: AbortSignal) => weather.execute({ location: 'Copenhagen', days: 2 }, req, signal) };
  }

  it('fails with the provider cause and one report log when the forecast times out twice', async () => {
    const { logs, tracker, run } = reporting({ forecast: ['stall', 'stall'] });
    const failure = await run(new AbortController().signal).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as Error).message).toBe('The weather provider did not answer in time at the forecast step after 2 tries.');
    expect(logs.filter((entry) => entry.phase === 'report')).toEqual([expect.objectContaining({ phase: 'report', outcome: 'timeout', attempt: 1, event: 'weather.phase' })]);
    expect(tracker.fail).toHaveBeenCalledWith('Weather report could not be completed.');
  });

  it('stops when the caller aborts, closes the job and logs no report outcome', async () => {
    const { calls, logs, tracker, run } = reporting({ forecast: ['stall', 'ok'] }, { ...quick, attemptTimeoutMs: 300 });
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = run(controller.signal).catch((error: unknown) => error);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    const failure = await pending;
    expect((failure as Error).message).toBe('Weather report was cancelled.');
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(calls).toHaveLength(2);
    expect(tracker.fail).toHaveBeenCalledWith('Weather report was cancelled.');
    expect(logs.filter((entry) => entry.phase === 'report')).toEqual([]);
  });
});

