import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dailyQuerySources as sources, isWorkspaceCommand,
  type DailyJson, type DailyQueryResult, type DailySourceId, type WorkspaceCommand,
} from '@jarvis/contracts';
import type { FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import type { DailyQueryService } from '../query.js';
import { dailyShowSources, maxShownRows } from '../show/views.js';
import { dailyShowTool } from './show.js';

// Only the one test that proves the validation gate swaps the builder; every other test builds real views.
const builder = vi.hoisted(() => ({ replacement: undefined as (() => unknown) | undefined }));
vi.mock('../show/views.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../show/views.js')>();
  return {
    ...original,
    buildDailyView: (...args: Parameters<typeof original.buildDailyView>) =>
      builder.replacement ? builder.replacement() : original.buildDailyView(...args),
  };
});

// Synthetic placeholders only. They are not anyone's real figures.
type Row = Record<string, DailyJson>;
type Query = DailyQueryService['query'];
type Execute = (ownerId: string, command: WorkspaceCommand, signal: AbortSignal) => Promise<unknown>;
type Fixture = ReturnType<typeof fixture>;
interface Outcome {
  view: { viewId: string; operation: 'created' | 'refreshed'; renderer: string; rowsShown: number; rowsReturned: number; partial: boolean; notes: string[] };
  result: DailyQueryResult;
}
interface Sent { commandId: string; operation: string; viewId?: string; view?: { title: string; source: { status: string } } }

const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const observedAt = '2026-10-17T19:26:00.000Z';
const week = { startDate: '2026-10-11', endDate: '2026-10-17' } as const;
const ranged = { ...week, timeZone: 'Europe/Copenhagen' } as const;
const dated = new Set<DailySourceId>([sources.metrics, sources.sleep, sources.workouts, sources.meals, sources.days]);
const sleepWeek = { source: sources.sleep, ...week };

afterEach(() => {
  builder.replacement = undefined;
  vi.restoreAllMocks();
});

function answer(source: DailySourceId, items: Row[] = [], over: { hasMore?: boolean } = {}): DailyQueryResult {
  const hasMore = over.hasMore ?? false;
  return {
    source,
    period: dated.has(source) ? ranged : null,
    items,
    status: hasMore ? 'partial' : items.length ? 'available' : 'empty',
    units: {},
    provenance: { store: 'daily-sql', detail: 'retained-record', calculations: 'existing-read-model', consistency: 'independent-committed-reads' },
    freshness: { observedAt, sourceProcessedCommittedAt: null, latestReturnedRecordUpdatedAt: null, staleness: 'unknown' },
    coverage: { returned: items.length, hasMore, next: null, sourceCompleteness: 'unknown' },
    revision: '0'.repeat(64),
  };
}

const steps = (date: string, value: DailyJson): Row => ({ metric_date: date, metric_name: 'step_count', value, avg_value: null, unit: 'count' });
const mass = (date: string, value: DailyJson): Row => ({ metric_date: date, metric_name: 'body_mass', value, avg_value: null, unit: 'kg' });
const night = (date: string, asleep: DailyJson): Row => ({ sleep_date: date, asleep_hours: asleep, total_sleep_hours: asleep, in_bed_hours: null });
const beat = (minute: string, avg: DailyJson): Row => ({ sample_minute: minute, metric_name: 'heart_rate', min_value: 60, avg_value: avg, max_value: 99, unit: 'bpm' });
const beats = [beat('2026-10-17T07:00:00.000Z', 80), beat('2026-10-17T07:01:00.000Z', 82)];
const workout: Row = { id: 'workout-alpha', workout_date: '2026-10-17', workout_type: 'Running', duration_seconds: 1800, avg_heart_rate: null };

function fixture(reading: DailyQueryResult = answer(sources.metrics, [steps('2026-10-16', 1234), steps('2026-10-17', 61.5)])) {
  const query = vi.fn<Query>().mockResolvedValue(reading);
  const execute = vi.fn<Execute>().mockResolvedValue(undefined);
  const isConnected = vi.fn<(ownerId: string) => boolean>().mockReturnValue(true);
  const request = {
    principal: { objectId: owner }, headers: {},
    server: { ownerObjectId: owner, workspaceCommands: { isConnected, execute }, jarvisTools: { list: () => [] } },
  } as unknown as FastifyRequest;
  return { tool: dailyShowTool({ query }), request, query, execute, isConnected };
}

const signal = () => new AbortController().signal;
const run = (f: Fixture, input: unknown, request: FastifyRequest = f.request) => f.tool.execute(input, request, signal()) as Promise<Outcome>;
const rejection = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);
const sent = (f: Fixture): Sent[] => f.execute.mock.calls.map(([, command]) => command as unknown as Sent);
const operations = (f: Fixture) => sent(f).map(({ operation }) => operation);
const untouched = (f: Fixture) => [f.query, f.execute, f.isConnected];

function firstRead(f: Fixture) {
  const call = f.query.mock.calls[0];
  if (!call) throw new Error('The Daily read was never made.');
  return { query: call[0] as Record<string, unknown>, request: call[1], signal: call[2] };
}

describe('daily_show descriptor', () => {
  it('is private, phone-denied, small-bodied and plain about what it does', () => {
    const { tool } = fixture();
    expect(tool.name).toBe('daily_show');
    expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
    expect(tool.sensitive).toBe(true);
    expect(tool.denyOnPhone).toBe(true);
    expect(tool.bodyLimit).toBeLessThanOrEqual(4096);
    expect(tool.description.length).toBeLessThanOrEqual(4000);
    expect(tool.description).toContain('daily_query');
    expect(tool.description).toMatch(/one per-day nutrient/iu);
    expect(tool.description).toMatch(/Danish or English/iu);
    expect(tool.description).toMatch(/not exact trigger phrases/iu);
    expect(tool.description).toContain('filtering happens before the bounded page');
    expect(tool.description).not.toContain('from the page');
    expect(tool.description).toMatch(/adds no calculations/iu);
    expect(tool.description).toMatch(/never zero/iu);
  });

  it('offers a closed schema with exactly the showable sources and no cursor', () => {
    const { tool } = fixture();
    const schema = tool.inputSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { enum?: string[]; description?: string }>;
    };
    expect(schema.required).toEqual(['source']);
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.properties.source?.enum ?? [])].sort()).toEqual([
      sources.days, sources.favorites, sources.heartRate, sources.meals, sources.metricCatalog, sources.metrics,
      sources.plans, sources.sleep, sources.sync, sources.workouts,
    ].sort());
    expect(schema.properties.source?.enum).toEqual([...dailyShowSources]);
    expect(Object.keys(schema.properties).sort()).toEqual(['display', 'endDate', 'limit', 'metric', 'source', 'startDate', 'workoutId']);
    expect(schema.properties.display?.enum).toEqual(['table', 'chart']);
    expect(schema.properties.display?.description).toMatch(/honor an explicit table\/chart preference/iu);
    expect(schema.properties.metric?.description).toContain('protein_grams');
    expect(schema.properties.metric?.description).toContain('filtered before the page');
  });
});

describe('daily_show access', () => {
  it('denies a signed-in user who is not the owner before anything is read or drawn', async () => {
    const f = fixture();
    const other = { ...f.request, principal: { objectId: stranger } } as unknown as FastifyRequest;
    await expect(run(f, sleepWeek, other)).rejects.toBeInstanceOf(AuthenticationDenied);
    for (const touched of untouched(f)) expect(touched).not.toHaveBeenCalled();
  });

  it('refuses external connector clients even when they carry the owner id', async () => {
    const f = fixture();
    const connector = {
      ...f.request, principal: undefined, dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner },
    } as unknown as FastifyRequest;
    expect(await rejection(run(f, sleepWeek, connector))).toBeInstanceOf(ToolRefusal);
    for (const touched of untouched(f)) expect(touched).not.toHaveBeenCalled();
  });

  it('refuses before reading when no signed-in workspace is open', async () => {
    const f = fixture();
    f.isConnected.mockReturnValue(false);
    const error = await rejection(run(f, sleepWeek));
    expect(error).toBeInstanceOf(ToolRefusal);
    expect((error as ToolRefusal).message).toContain('daily_query');
    expect(f.isConnected).toHaveBeenCalledWith(owner);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
});

describe('daily_show input', () => {
  // Every free-text value carries "canary" so a refusal that echoed it back would be caught.
  const refusals: [string, unknown][] = [
    ['a body that is not an object', 'daily.sleep'],
    ['a null body', null],
    ['an array body', [sleepWeek]],
    ['no source', {}],
    ['a source that is not text', { source: 7 }],
    ['an unknown source', { source: 'canary-source' }],
    ['brief history', { source: sources.briefs }],
    ['one brief', { source: sources.brief }],
    ['one workout', { source: sources.workout }],
    ['a cursor', { source: sources.favorites, cursor: 'canary-cursor' }],
    ['a key the source does not take', { source: sources.favorites, 'canary-key': 1 }],
    ['an owner id', { ...sleepWeek, owner: 'canary-owner' }],
    ['dates on favourites', { source: sources.favorites, startDate: week.startDate }],
    ['dates on sync', { source: sources.sync, ...week }],
    ['a limit on sync', { source: sources.sync, limit: 5 }],
    ['dates on heart rate', { source: sources.heartRate, workoutId: 'workout-alpha', ...week }],
    ['a workout id on sleep', { ...sleepWeek, workoutId: 'canary-workout' }],
    ['a measurement on sleep', { ...sleepWeek, metric: 'canary-metric' }],
    ['a limit of zero', { ...sleepWeek, limit: 0 }],
    ['a limit above the page', { ...sleepWeek, limit: maxShownRows + 1 }],
    ['a fractional limit', { ...sleepWeek, limit: 1.5 }],
    ['a limit that is text', { ...sleepWeek, limit: 'canary-limit' }],
    ['more than the most meals allowed', { source: sources.meals, ...week, limit: 101 }],
    ['more than the most favourites allowed', { source: sources.favorites, limit: 101 }],
    ['a display that is not offered', { ...sleepWeek, display: 'canary-display' }],
    ['a nutrition selector for a table', { source: sources.days, ...week, metric: 'canary-protein' }],
    ['a blank measurement', { source: sources.metrics, ...week, metric: '   ' }],
    ['a measurement that is not text', { source: sources.metrics, ...week, metric: 5 }],
    ['a measurement that is too long', { source: sources.metrics, ...week, metric: `canary${'x'.repeat(256)}` }],
    ['a measurement with a control character', { source: sources.metrics, ...week, metric: 'canary\nmetric' }],
    ['no dates', { source: sources.sleep }],
    ['one date', { source: sources.sleep, startDate: week.startDate }],
    ['a date that is not a date', { source: sources.sleep, startDate: 'canary-date', endDate: week.endDate }],
    ['a day that does not exist', { source: sources.sleep, startDate: '2026-02-30', endDate: '2026-03-01' }],
    ['a year zero', { source: sources.sleep, startDate: '0000-01-01', endDate: '0000-01-02' }],
    ['dates in the wrong order', { source: sources.sleep, startDate: week.endDate, endDate: week.startDate }],
    ['a period of more than 366 days', { source: sources.sleep, startDate: '2025-10-16', endDate: '2026-10-18' }],
    ['heart rate without a workout id', { source: sources.heartRate }],
    ['a workout id that is not text', { source: sources.heartRate, workoutId: 7 }],
    ['a workout id with surrounding space', { source: sources.heartRate, workoutId: ' canary-workout' }],
    ['a workout id with a control character', { source: sources.heartRate, workoutId: 'canary\tworkout' }],
    ['a workout id that is too long', { source: sources.heartRate, workoutId: `canary${'w'.repeat(300)}` }],
  ];

  it.each(refusals)('refuses %s with static wording, before anything is read or drawn', async (_label, input) => {
    const f = fixture();
    const error = await rejection(run(f, input));
    expect(error).toBeInstanceOf(ToolRefusal);
    expect((error as ToolRefusal).message.length).toBeGreaterThan(0);
    expect((error as ToolRefusal).message).not.toContain('canary');
    for (const touched of untouched(f)) expect(touched).not.toHaveBeenCalled();
  });

  it('accepts a period of exactly 366 days', async () => {
    const f = fixture(answer(sources.sleep));
    await run(f, { source: sources.sleep, startDate: '2025-10-17', endDate: '2026-10-18' });
    expect(firstRead(f).query).toEqual({ source: sources.sleep, startDate: '2025-10-17', endDate: '2026-10-18' });
  });

  it('treats a key whose value is undefined as absent', async () => {
    const f = fixture(answer(sources.favorites));
    await run(f, { source: sources.favorites, limit: undefined, cursor: undefined, display: undefined });
    expect(firstRead(f).query).toEqual({ source: sources.favorites });
  });

  it('accepts a display on a source that cannot draw a chart, and a display on sync', async () => {
    const f = fixture(answer(sources.sync, [{ feeds: [], heartbeat: null, inbox: null }]));
    await run(f, { source: sources.sync, display: 'chart' });
    expect(firstRead(f).query).toEqual({ source: sources.sync });
  });

  const limits: [string, Record<string, unknown>, number | undefined][] = [
    ['a table of measurements', { source: sources.metrics, ...week }, undefined],
    ['a chart of measurements', { source: sources.metrics, ...week, display: 'chart' }, maxShownRows],
    ['one named measurement as a table', { source: sources.metrics, ...week, metric: 'step_count' }, maxShownRows],
    ['a table of sleep', sleepWeek, undefined],
    ['a chart of sleep', { ...sleepWeek, display: 'chart' }, maxShownRows],
    ['a chart of workouts', { source: sources.workouts, ...week, display: 'chart' }, maxShownRows],
    ['a chart request for meals, which cannot be drawn', { source: sources.meals, ...week, display: 'chart' }, undefined],
    ['a table of heart rate', { source: sources.heartRate, workoutId: 'workout-alpha' }, undefined],
    ['a chart of heart rate', { source: sources.heartRate, workoutId: 'workout-alpha', display: 'chart' }, maxShownRows],
    ['an explicit limit on a chart', { ...sleepWeek, display: 'chart', limit: 7 }, 7],
    ['an explicit limit on one measurement', { source: sources.metrics, ...week, metric: 'step_count', limit: 17 }, 17],
    ['the most sleep rows a page shows', { ...sleepWeek, limit: maxShownRows }, maxShownRows],
    ['the most meals allowed', { source: sources.meals, ...week, limit: 100 }, 100],
    ['the most favourites allowed', { source: sources.favorites, limit: 100 }, 100],
  ];

  it.each(limits)('reads %s with the page size it needs', async (_label, input, expected) => {
    const f = fixture(answer(input.source as DailySourceId));
    await run(f, input);
    const { query } = firstRead(f);
    if (expected === undefined) expect(query).not.toHaveProperty('limit');
    else expect(query).toHaveProperty('limit', expected);
    if (typeof input.metric === 'string') expect(query).toHaveProperty('metric', input.metric.trim());
    else expect(query).not.toHaveProperty('metric');
    expect(query).not.toHaveProperty('display');
  });
});

describe('daily_show publishing', () => {
  const identities: [string, Record<string, unknown>][] = [
    ['the signed-in owner', {}],
    ['the agent acting for the owner', { principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } }],
  ];

  it.each(identities)('reads one validated page and refreshes the open view for %s', async (_label, identity) => {
    const f = fixture(answer(sources.metrics, [steps('2026-10-16', 1234), steps('2026-10-17', 61.5)]));
    const request = { ...f.request, ...identity } as unknown as FastifyRequest;
    const outcome = await run(f, { source: sources.metrics, ...week }, request);

    expect(f.query).toHaveBeenCalledTimes(1);
    const read = firstRead(f);
    expect(read.query).toEqual({ source: sources.metrics, ...week });
    expect(read.request).toBe(request);
    expect(read.signal).toBeInstanceOf(AbortSignal);
    expect(f.isConnected).toHaveBeenCalledWith(owner);
    expect(operations(f)).toEqual(['update', 'show']);
    expect(f.execute.mock.calls.every(([who]) => who === owner)).toBe(true);
    const [update, show] = sent(f);
    expect(update?.viewId).toBe('daily-metrics-table');
    expect(show?.viewId).toBe('daily-metrics-table');
    expect(isWorkspaceCommand(update)).toBe(true);
    expect(isWorkspaceCommand(show)).toBe(true);
    expect(update?.commandId).not.toBe(show?.commandId);
    expect(outcome.view).toEqual({ viewId: 'daily-metrics-table', operation: 'refreshed', renderer: 'table', rowsShown: 2, rowsReturned: 2, partial: false, notes: [] });
    expect(outcome.result).toEqual(answer(sources.metrics, [steps('2026-10-16', 1234), steps('2026-10-17', 61.5)]));
  });

  it('keeps the whole call under the agent\'s default read time and the courtesy show tighter still', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await run(fixture(), { source: sources.metrics, ...week });
    expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([25_000, 3_000]);
  });

  it('opens the view when there is none to refresh, and does not also bring it forward', async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new ToolRefusal('That view is not open.'));
    const outcome = await run(f, { source: sources.metrics, ...week });
    expect(operations(f)).toEqual(['update', 'create']);
    const [update, create] = sent(f);
    expect(create?.viewId).toBe(update?.viewId);
    expect(create?.view).toEqual(update?.view);
    expect(isWorkspaceCommand(create)).toBe(true);
    expect(outcome.view.operation).toBe('created');
  });

  it('reports the workspace\'s own refusal when it will neither refresh nor open the view', async () => {
    const f = fixture();
    const second = new ToolRefusal('The workspace queue is full.');
    f.execute.mockRejectedValueOnce(new ToolRefusal('That view is not open.')).mockRejectedValueOnce(second);
    await expect(run(f, { source: sources.metrics, ...week })).rejects.toBe(second);
    expect(operations(f)).toEqual(['update', 'create']);
  });

  it('does not open a second view when the refresh fails for any other reason', async () => {
    const f = fixture();
    const failure = new ToolFailure('The workspace did not answer in time.');
    f.execute.mockRejectedValueOnce(failure);
    await expect(run(f, { source: sources.metrics, ...week })).rejects.toBe(failure);
    expect(operations(f)).toEqual(['update']);
  });

  it('still succeeds when the delivered view cannot be brought forward', async () => {
    const f = fixture();
    f.execute.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ToolFailure('The workspace did not answer in time.'));
    const outcome = await run(f, { source: sources.metrics, ...week });
    expect(operations(f)).toEqual(['update', 'show']);
    expect(outcome.view.operation).toBe('refreshed');
  });

  it('passes a failed read through and draws nothing', async () => {
    const f = fixture();
    const failure = new ToolFailure('The Daily store did not answer.');
    f.query.mockRejectedValue(failure);
    await expect(run(f, { source: sources.metrics, ...week })).rejects.toBe(failure);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('keeps one window per workout and per form for heart rate', async () => {
    const idFor = async (input: Record<string, unknown>) => (await run(fixture(answer(sources.heartRate, beats)), input)).view;
    const alpha = await idFor({ source: sources.heartRate, workoutId: 'workout-alpha', display: 'chart' });
    const again = await idFor({ source: sources.heartRate, workoutId: 'workout-alpha', display: 'chart' });
    const beta = await idFor({ source: sources.heartRate, workoutId: 'workout-beta', display: 'chart' });
    const table = await idFor({ source: sources.heartRate, workoutId: 'workout-alpha' });
    expect(alpha.renderer).toBe('chart');
    expect(alpha.viewId).toMatch(/^daily-heart-rate-chart-[0-9a-f]{8}$/u);
    expect(again.viewId).toBe(alpha.viewId);
    expect(beta.viewId).not.toBe(alpha.viewId);
    expect(beta.viewId).toMatch(/^daily-heart-rate-chart-[0-9a-f]{8}$/u);
    expect(table.renderer).toBe('table');
    expect(table.viewId).toMatch(/^daily-heart-rate-table-[0-9a-f]{8}$/u);
  });

  it('passes the workout and metric selectors to the bounded heart-rate read', async () => {
    const f = fixture(answer(sources.heartRate, beats));
    await run(f, { source: sources.heartRate, workoutId: 'workout-alpha', metric: 'heart_rate' });
    expect(firstRead(f).query).toEqual({ source: sources.heartRate, workoutId: 'workout-alpha', metric: 'heart_rate', limit: maxShownRows });
  });

  it('filters before the bounded read so a selected metric beyond unrelated rows is charted', async () => {
    const unrelated = Array.from({ length: maxShownRows + 10 }, (_, index) =>
      ({ ...mass('2026-10-16', index), metric_name: `a_unrelated_${String(index).padStart(3, '0')}` }));
    const matching = [steps('2026-10-16', 1234), steps('2026-10-17', 2345)];
    const f = fixture(answer(sources.metrics));
    f.query.mockImplementation(async (raw) => {
      const query = raw as Record<string, unknown>;
      const filtered = query.metric === 'Step count'
        ? [...unrelated, ...matching].filter((row) => row.metric_name === 'step_count')
        : [...unrelated, ...matching];
      const limit = Number(query.limit ?? 50);
      return answer(sources.metrics, filtered.slice(0, limit), { hasMore: filtered.length > limit });
    });
    const outcome = await run(f, { source: sources.metrics, ...week, metric: '  Step count  ', display: 'chart' });
    expect(firstRead(f).query).toEqual({ source: sources.metrics, ...week, metric: 'Step count', limit: maxShownRows });
    expect(outcome.view.renderer).toBe('chart');
    expect(outcome.view.rowsShown).toBe(2);
    expect(outcome.view.rowsReturned).toBe(2);
    expect(outcome.view.viewId).toMatch(/^daily-metrics-chart-step-count-[0-9a-f]{6}$/u);
    expect(outcome.view.partial).toBe(false);
    expect(outcome.result.items).toEqual(matching);
    expect(JSON.stringify(outcome.result)).not.toContain('a_unrelated_');
  });

  it('reports filtered coverage and a partial result for the selected metric page', async () => {
    const matching = Array.from({ length: maxShownRows + 5 }, (_, index) => steps('2026-10-16', index));
    const f = fixture(answer(sources.metrics));
    f.query.mockImplementation(async (raw) => {
      const query = raw as Record<string, unknown>;
      const limit = Number(query.limit ?? 50);
      return answer(sources.metrics, matching.slice(0, limit), { hasMore: matching.length > limit });
    });
    const outcome = await run(f, { source: sources.metrics, ...week, metric: 'step_count', limit: 7, display: 'chart' });
    expect(firstRead(f).query).toMatchObject({ metric: 'step_count', limit: 7 });
    expect(outcome.view).toMatchObject({ renderer: 'chart', rowsShown: 7, rowsReturned: 7, partial: true });
    expect(outcome.view.notes.join(' ')).toContain('More records are available beyond this page.');
    expect(outcome.result.coverage).toMatchObject({ returned: 7, hasMore: true });
    expect(outcome.view.viewId).toMatch(/^daily-metrics-chart-step-count-/u);
  });

  it('keeps an empty filtered result specific to the selected measurement', async () => {
    const f = fixture(answer(sources.metrics));
    const outcome = await run(f, {
      source: sources.metrics, ...week, metric: 'step_count',
    });
    expect(outcome.view.renderer).toBe('text');
    expect(outcome.view.rowsReturned).toBe(0);
    expect(outcome.view.viewId).toMatch(/^daily-metrics-table-step-count-/u);
    expect(outcome.view.notes).toEqual([]);
    expect(sent(f)[0]?.view?.title).toContain('Step count');
  });

  it('says when the page is partial and passes that to the view footnote', async () => {
    const f = fixture(answer(sources.sleep, [night('2026-10-16', 7.25)], { hasMore: true }));
    const outcome = await run(f, sleepWeek);
    expect(outcome.view.partial).toBe(true);
    expect(outcome.view.notes.join(' ')).toMatch(/more records are available/iu);
    expect(sent(f)[0]?.view?.source.status).toBe('partial');
    expect(outcome.result.coverage.hasMore).toBe(true);
  });

  it('shows workout duration as a chart when requested', async () => {
    const f = fixture(answer(sources.workouts, [workout]));
    const outcome = await run(f, { source: sources.workouts, ...week, display: 'chart' });
    expect(firstRead(f).query).toEqual({ source: sources.workouts, ...week, limit: maxShownRows });
    expect(outcome.view).toMatchObject({ renderer: 'chart', viewId: 'daily-workouts-chart', rowsShown: 1, notes: [] });
  });

  it('charts a requested per-day nutrition trend without sending the display selector or nutrient as query data', async () => {
    const rows: Row[] = [
      { meal_date: '2026-10-16', meal_count: 2, protein_grams: 58, partial_nutrients: [], unknown_nutrients: [] },
      { meal_date: '2026-10-17', meal_count: 1, protein_grams: 44, partial_nutrients: [], unknown_nutrients: [] },
    ];
    const f = fixture(answer(sources.days, rows));
    const outcome = await run(f, { source: sources.days, ...week, metric: 'protein', display: 'chart' });

    expect(firstRead(f).query).toEqual({ source: sources.days, ...week, limit: maxShownRows });
    expect(outcome.view).toMatchObject({
      renderer: 'chart', rowsShown: 2, rowsReturned: 2, partial: false,
    });
    expect(outcome.result.items).toEqual(rows);
    expect(operations(f)).toEqual(['update', 'show']);
  });

  it('honors an explicit table preference for a selected nutrition period', async () => {
    const f = fixture(answer(sources.days, [{
      meal_date: '2026-10-17', meal_count: 1, protein_grams: 44, partial_nutrients: [], unknown_nutrients: [],
    }]));
    const outcome = await run(f, { source: sources.days, ...week, display: 'table' });

    expect(firstRead(f).query).toEqual({ source: sources.days, ...week });
    expect(outcome.view.renderer).toBe('table');
  });

  it('shows sync evidence as one detail view without dates', async () => {
    const f = fixture(answer(sources.sync, [{ feeds: [], heartbeat: null, inbox: null }]));
    const outcome = await run(f, { source: sources.sync });
    expect(firstRead(f).query).toEqual({ source: sources.sync });
    expect(outcome.view).toMatchObject({ viewId: 'daily-sync', renderer: 'detail' });
  });

  it('fails closed when the built view would not pass workspace validation', async () => {
    builder.replacement = () => ({ viewId: 'not a valid view id!', view: { title: 'Broken' }, receipt: {} });
    const f = fixture();
    const error = await rejection(run(f, { source: sources.metrics, ...week }));
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as ToolFailure).message).toBe('The Health view did not pass workspace validation.');
    expect(f.execute).not.toHaveBeenCalled();
  });
});

describe('daily_show cancellation', () => {
  const cancelled = () => new DOMException('The turn was cancelled.', 'AbortError');

  it('passes a caller abort through untouched and draws nothing', async () => {
    const f = fixture();
    const stop = new AbortController();
    const reason = cancelled();
    f.query.mockImplementation(async (_input, _request, used) => {
      stop.abort(reason);
      used.throwIfAborted();
      return answer(sources.metrics);
    });
    await expect(f.tool.execute({ source: sources.metrics, ...week }, f.request, stop.signal)).rejects.toBe(reason);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('reports a clear failure when its own deadline passes during the read, and draws nothing', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('Timed out.', 'TimeoutError')));
    const f = fixture();
    f.query.mockImplementation(async (_input, _request, used) => {
      used.throwIfAborted();
      return answer(sources.metrics);
    });
    const error = await rejection(run(f, { source: sources.metrics, ...week }));
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as ToolFailure).message).toMatch(/took too long/u);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('shows the abort rather than a delivery failure when the caller cancels while the view is published', async () => {
    const f = fixture();
    const stop = new AbortController();
    const reason = cancelled();
    f.execute.mockImplementation(async () => {
      stop.abort(reason);
      throw new ToolFailure('Workspace command was cancelled before delivery.');
    });
    await expect(f.tool.execute({ source: sources.metrics, ...week }, f.request, stop.signal)).rejects.toBe(reason);
    expect(operations(f)).toEqual(['update']);
  });

  it('does not report success when the caller aborts after the view was delivered', async () => {
    const f = fixture();
    const stop = new AbortController();
    const reason = cancelled();
    f.execute.mockImplementation(async () => { stop.abort(reason); });
    await expect(f.tool.execute({ source: sources.metrics, ...week }, f.request, stop.signal)).rejects.toBe(reason);
  });

  it('does not report success when its own deadline passes after the view was delivered', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const f = fixture();
    f.execute.mockImplementation(async () => { deadline.abort(new DOMException('Timed out.', 'TimeoutError')); });
    const error = await rejection(run(f, { source: sources.metrics, ...week }));
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as ToolFailure).message).toMatch(/took too long/u);
  });
});
