import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { BackgroundJob, WorkspaceCommand, WorkspaceItem } from '@jarvis/contracts';
import type { BackgroundJobStore } from '../database/background-job-store.js';
import type { SettingsStore } from './settings.js';
import { coreModule } from './index.js';
import type { WorkspaceHtmlArtifactStore } from '../database/workspace-html-artifact-store.js';
import { createWeatherModule } from './weather.js';
import { createWorkspacesModule } from './workspaces.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';
import { WorkspaceItemNotFound, type WorkspaceItemRecord, type WorkspaceItemsStore } from '../database/workspace-items-store.js';

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
  const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
  const createArtifact = vi.fn(async (
    _ownerId: string,
    title: string,
    html: string,
    sources: { title: string; url: string }[],
  ) => ({
    id: artifactId,
    kind: 'html' as const,
    title,
    html,
    sources,
    createdAt: '2026-10-08T12:00:00.000Z',
    pinned: false,
  }));
  const artifacts = {
    create: createArtifact,
    read: vi.fn(async () => ({})),
  } as unknown as WorkspaceHtmlArtifactStore;
  const items = new Map<string, WorkspaceItem>();
  const recordItem = vi.fn(async (_owner: string, input: WorkspaceItemRecord, signal: AbortSignal) => {
    signal.throwIfAborted();
    const item: WorkspaceItem = {
      id: input.id, kind: input.kind, title: input.title, promptSummary: input.promptSummary,
      createdAt: input.createdAt, pinned: false,
    };
    items.set(item.id, item);
    return item;
  });
  const workspaceItems = {
    record: recordItem,
    get: vi.fn(async (_owner: string, id: string) => {
      const item = items.get(id);
      if (!item) throw new WorkspaceItemNotFound();
      return { item, sourceId: id.slice('html_app:'.length) };
    }),
  } as unknown as WorkspaceItemsStore;
  const workspaceCommands = {
    isConnected: vi.fn(() => true),
    execute: vi.fn(async (_owner: string, _command: WorkspaceCommand, signal: AbortSignal) => { signal.throwIfAborted(); }),
    snapshot: vi.fn(() => undefined),
    dispose: vi.fn(),
  };
  const persistedJobs: BackgroundJob[] = [];
  const backgroundJobStore = {
    create: vi.fn(async (job: BackgroundJob) => { persistedJobs.push(job); return true; }),
    update: vi.fn(async (job: BackgroundJob) => {
      const index = persistedJobs.findIndex(({ jobId }) => jobId === job.jobId);
      if (index < 0) return null;
      persistedJobs[index] = job;
      return job;
    }),
    list: vi.fn(async () => [...persistedJobs]),
    updateResultDelivery: vi.fn(async (id: string, resultDelivery: BackgroundJob['resultDelivery']) => {
      const index = persistedJobs.findIndex(({ jobId }) => jobId === id);
      if (index < 0) return null;
      persistedJobs[index] = { ...persistedJobs[index]!, resultDelivery };
      return persistedJobs[index]!;
    }),
    get: vi.fn(async () => null),
    reconcileInterrupted: vi.fn(async () => []),
    prune: vi.fn(async () => {}),
  } as unknown as BackgroundJobStore;
  const settingsStore: SettingsStore = {
    read: async () => storedSettings,
    write: async () => {},
  };
  const app = buildApp(config, undefined, {
    modules: [coreModule, createWeatherModule(artifacts, fetcher, workspaceItems), createWorkspacesModule(workspaceItems, artifacts)],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    settingsStore,
    toolCallStore: { record } as never,
    backgroundJobStore,
    workspaceCommands: workspaceCommands as never,
  });
  apps.push(app);
  return { app, record, artifacts, createArtifact, workspaceCommands, persistedJobs, items, recordItem };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('weather tool', () => {
  it('uses the configured home coordinates and returns a normalized forecast', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(forecast()));
    const { app, record, createArtifact, workspaceCommands, persistedJobs } = fixture(fetcher, {
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
        artifactId: '56a2b0bd-af47-46b5-8e15-c6e9a718ae93',
        confirmation: 'Weather report opened in the workspace.',
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
    expect(createArtifact).toHaveBeenCalledOnce();
    expect(workspaceCommands.execute).toHaveBeenCalledTimes(2);
    expect((await app.backgroundJobs.list()).map((job) => job.status)).toEqual(['done']);
    expect(persistedJobs.map((job) => job.status)).toEqual(['done']);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'weather',
      arguments: { redacted: true },
      result: { redacted: true },
    }));
  });

  it('geocodes a named location and honors the requested forecast length', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        results: [{ name: 'Aarhus <script>', country: 'Denmark', latitude: 56.16, longitude: 10.2 }],
      }))
      .mockResolvedValueOnce(response(forecast(2)));
    const { app, createArtifact } = fixture(fetcher);
    const result = await app.inject({
      method: 'POST', url: '/tools/weather', headers,
      payload: { location: ' Aarhus ', days: 2 },
    });

    expect(result.json()).toMatchObject({
      outcome: 'ok',
      result: { location: { name: 'Aarhus <script>', country: 'Denmark' }, forecast: [{}, {}] },
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/v1/search?name=Aarhus&count=1');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('forecast_days=2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const html = createArtifact.mock.calls[0]?.[2];
    expect(html).toContain('Aarhus &lt;script&gt;');
    expect(html).not.toContain('Aarhus <script>');
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
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') } });
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

  it.each(['missing workspace', 'workspace disconnect', 'request abort', 'ambiguous delivery'] as const)(
    'saves a recoverable result despite %s and reports only acknowledged delivery',
    async (failure) => {
      const fetcher = vi.fn<typeof fetch>();
      const { app, workspaceCommands, createArtifact, persistedJobs, items } = fixture(fetcher, {
        'location.home_city': '"Copenhagen"', 'location.latitude': '55.7', 'location.longitude': '12.6',
      });
      let abortRequest!: () => void;
      app.addHook('preHandler', (request, _reply, done) => {
        abortRequest = () => { request.raw.emit('aborted'); };
        done();
      });
      const disconnect = () => {
        workspaceCommands.isConnected.mockReturnValue(false);
        workspaceCommands.execute.mockRejectedValue(new ToolRefusal('No active signed-in workspace is connected.'));
      };
      if (failure === 'missing workspace') disconnect();
      fetcher.mockImplementation(async (_url, options) => {
        if (failure === 'request abort') abortRequest();
        if (failure === 'workspace disconnect' || failure === 'request abort') disconnect();
        expect(options?.signal?.aborted).toBe(false);
        if (failure === 'ambiguous delivery') {
          workspaceCommands.execute.mockImplementation(async () => {
            expect(persistedJobs[0]).toMatchObject({ status: 'done', resultDelivery: 'pending' });
            throw new ToolFailure(
              'The active workspace disconnected before acknowledging the command; it may already have been applied.',
            );
          });
        }
        return response(forecast());
      });

      const result = await app.inject({ method: 'POST', url: '/tools/weather', headers, payload: { days: 2 } });

      expect(result.json()).toMatchObject({
        outcome: 'ok',
        result: { artifactId: expect.any(String), confirmation: expect.stringContaining('delivery was not confirmed') },
      });
      const { jobId, artifactId } = result.json().result;
      expect(persistedJobs).toEqual([expect.objectContaining({
        jobId, status: 'done', resultId: `html_app:${artifactId}`,
        resultDelivery: failure === 'ambiguous delivery' ? 'unknown' : 'pending',
      })]);
      expect(items.size).toBe(1);
      expect(createArtifact).toHaveBeenCalledOnce();
      const fetchCalls = fetcher.mock.calls.length;
      workspaceCommands.isConnected.mockReturnValue(true);
      workspaceCommands.execute.mockResolvedValue(undefined);

      const reopened = await app.inject({ method: 'POST', url: `/jobs/${jobId}/open-result`, headers });

      expect(reopened.statusCode).toBe(200);
      expect(workspaceCommands.execute).toHaveBeenNthCalledWith(
        workspaceCommands.execute.mock.calls.length - 1, config.auth.ownerObjectId,
        expect.objectContaining({
          operation: 'create', viewId: persistedJobs[0]!.viewId,
          view: expect.objectContaining({ data: { artifactId } }),
        }), expect.any(AbortSignal),
      );
      expect(persistedJobs[0]?.resultDelivery).toBe('delivered');
      expect(fetcher.mock.calls).toHaveLength(fetchCalls);
      expect(createArtifact).toHaveBeenCalledOnce();
    },
  );

  it('explicitly cancels provider work after request disconnect without falsely failing the job', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
      entered();
    }));
    const { app, workspaceCommands, createArtifact, persistedJobs } = fixture(fetcher);
    let abortRequest!: () => void;
    app.addHook('preHandler', (request, _reply, done) => {
      if (request.url === '/tools/weather') abortRequest = () => { request.raw.emit('aborted'); };
      done();
    });
    const pending = app.inject({ method: 'POST', url: '/tools/weather', headers, payload: { location: 'Aarhus' } });
    await started;
    abortRequest();
    workspaceCommands.isConnected.mockReturnValue(false);
    const providerSignal = fetcher.mock.calls[0]![1]!.signal!;
    expect(providerSignal.aborted).toBe(false);

    const cancelled = await app.inject({ method: 'POST', url: `/jobs/${persistedJobs[0]!.jobId}/cancel`, headers });

    expect(cancelled.statusCode).toBe(202);
    expect(providerSignal.aborted).toBe(true);
    expect((await pending).json()).toMatchObject({ outcome: 'error' });
    expect(persistedJobs[0]?.status).toBe('cancelled');
    expect(createArtifact).not.toHaveBeenCalled();
  });

  it.each(['presentation expiry', 'explicit cancellation'] as const)(
    'keeps unacknowledged connected-workspace presentation separate from execution: %s',
    async (outcome) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(forecast()));
      const { app, workspaceCommands, createArtifact, persistedJobs } = fixture(fetcher, {
        'location.home_city': '"Copenhagen"', 'location.latitude': '55.7', 'location.longitude': '12.6',
      });
      await app.ready();
      const progressDeadline = new AbortController();
      const executionDeadline = new AbortController();
      const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) =>
        milliseconds === 1_000 ? progressDeadline.signal
          : milliseconds === 8_000 ? executionDeadline.signal
            : originalTimeout(milliseconds));
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => { entered = resolve; });
      workspaceCommands.execute.mockImplementationOnce((_owner, _command, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          entered();
        }));
      const pending = app.inject({ method: 'POST', url: '/tools/weather', headers, payload: { days: 2 } });
      try {
        await waiting;
        expect(workspaceCommands.isConnected()).toBe(true);
        expect(timeout).toHaveBeenCalledWith(1_000);
        expect(timeout).not.toHaveBeenCalledWith(8_000);
        expect(fetcher).not.toHaveBeenCalled();
        expect(persistedJobs[0]?.status).toBe('running');
        if (outcome === 'presentation expiry') {
          progressDeadline.abort(new DOMException('Synthetic progress expiry', 'TimeoutError'));
          const result = await pending;
          expect(result.json()).toMatchObject({ outcome: 'ok' });
          expect(timeout).toHaveBeenCalledWith(8_000);
          expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
          expect(persistedJobs[0]).toMatchObject({ status: 'done', resultDelivery: 'delivered' });
          expect(createArtifact).toHaveBeenCalledOnce();
        } else {
          const cancelled = await app.inject({
            method: 'POST', url: `/jobs/${persistedJobs[0]!.jobId}/cancel`, headers,
          });
          expect(cancelled.statusCode).toBe(202);
          expect((await pending).json()).toMatchObject({ outcome: 'error' });
          expect(timeout).not.toHaveBeenCalledWith(8_000);
          expect(persistedJobs[0]?.status).toBe('cancelled');
          expect(fetcher).not.toHaveBeenCalled();
          expect(createArtifact).not.toHaveBeenCalled();
        }
      } finally {
        progressDeadline.abort();
        executionDeadline.abort();
        await pending;
        timeout.mockRestore();
      }
    },
  );

  it.each(['artifact', 'workspace item'] as const)('keeps real %s persistence failures failed', async (failure) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(forecast()));
    const { app, createArtifact, recordItem, persistedJobs } = fixture(fetcher, {
      'location.home_city': '"Copenhagen"', 'location.latitude': '55.7', 'location.longitude': '12.6',
    });
    if (failure === 'artifact') createArtifact.mockRejectedValueOnce(new Error('Synthetic persistence failure'));
    else recordItem.mockRejectedValueOnce(new Error('Synthetic persistence failure'));

    const result = await app.inject({ method: 'POST', url: '/tools/weather', headers, payload: { days: 2 } });

    expect(result.json()).toMatchObject({ outcome: 'error' });
    expect(persistedJobs[0]?.status).toBe('failed');
    expect(persistedJobs[0]?.resultId).toBeUndefined();
  });
});
