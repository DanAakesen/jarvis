import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { JarvisTool } from '../../core/tool-registry.js';
import type { DailyCoachStore } from '../coach-store.js';
import type { DailyHealthReadModel } from '../health/read-model.js';
import type { NutritionStore } from '../nutrition/store.js';
import { dailyResultByteLimit, type DailyData } from '../query.js';
import { dailySourceTools } from './source-tools.js';

const owner = '11111111-1111-4111-8111-111111111111';
const request = () => ({ server: { ownerObjectId: owner }, principal: { objectId: owner } }) as FastifyRequest;
const signal = () => new AbortController().signal;
const dateAt = (day: number) => new Date(Date.parse('2025-01-01') + day * 86_400_000).toISOString().slice(0, 10);
const kinds = ['metrics', 'sleep', 'workouts'] as const;
type Kind = typeof kinds[number];
type Row = { date: string; key: string; id: string; meal_date: string; created_at: string; unit: string; deleted_at?: string };
type Result = {
  status: string; sourceCompleteness: string;
  period: { startDate: string; endDate: string; timeZone: string };
  requestedPeriod: { startDate: string; endDate: string };
  coverage: { hasMore: boolean; continuation: Record<string, unknown> | null; retainedWindowExhausted: boolean; nextStep: string };
  meals: Row[];
} & Record<Kind, { items: Row[]; next: unknown; hasMore: boolean }>;

function fixture() {
  const records = (perDay: number) => Array.from({ length: 365 }, (_, day) =>
    Array.from({ length: perDay }, (_, index): Row => ({
      date: dateAt(day), key: `synthetic-${index}`, id: `${dateAt(day)}-${index}`, meal_date: dateAt(day),
      created_at: '2026-01-01T00:00:00Z', unit: 'source-unit',
    }))).flat();
  const retained = { metrics: records(3), sleep: records(1), workouts: records(2), meals: records(2) };
  // Backdated meals deliberately have date order opposite to their creation/ID keyset order.
  for (const [index, row] of retained.meals.entries()) row.meal_date = dateAt(364 - Math.floor(index / 2));
  const history = vi.fn<DailyHealthReadModel['history']>(async (kind, input, bounded) => {
    bounded.throwIfAborted();
    const eligible = retained[kind].filter(row => row.date >= input.startDate && row.date <= input.endDate &&
      (!input.after || row.date > input.after.date || row.date === input.after.date && row.key > input.after.key));
    const items = eligible.slice(0, input.limit);
    const last = items.at(-1);
    const truncated = eligible.length > items.length;
    return { items, truncated, next: truncated && last ? { date: last.date, key: last.key } : null };
  });
  const meals = vi.fn<NutritionStore['history']>(async (input, bounded) => {
    bounded.throwIfAborted();
    const eligible = retained.meals.filter(row => row.meal_date >= input.from! && row.meal_date <= input.to! &&
      (!input.after || row.created_at > input.after.createdAt || row.created_at === input.after.createdAt && row.id > input.after.id));
    const rows = eligible.slice(0, input.limit);
    const last = rows.at(-1);
    return { rows, next: eligible.length > rows.length && last ? { createdAt: last.created_at, id: last.id } : null };
  });
  const sync = vi.fn(async () => ({ feeds: [], heartbeat: null, inbox: null }));
  const nutrition = { history: meals } as unknown as NutritionStore;
  const data = {
    health: () => ({ history, sync }), nutrition: () => nutrition,
    coach: () => ({} as DailyCoachStore),
  } as unknown as DailyData;
  const tools = dailySourceTools(data, data.nutrition!, data.coach!, () => Date.parse('2026-10-22T22:30:00Z'));
  return { retained, history, meals, sync, tools };
}

async function schemaApp(tools: JarvisTool[]) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.decorate('ownerObjectId', owner);
  app.addHook('onRequest', async req => {
    req.principal = { objectId: owner, tenantId: owner, displayName: 'Synthetic' };
  });
  for (const tool of tools.slice(0, 2)) {
    app.post(`/${tool.name}`, { schema: { body: tool.inputSchema } },
      async req => tool.execute(req.body, req, signal()));
  }
  await app.ready();
  return app;
}

describe('bounded grouped history continuation', () => {
  it('instructs the assistant to continue when needed or disclose bounded/interrupted coverage', () => {
    const { tools } = fixture();
    for (const tool of tools.slice(0, 2)) {
      expect(tool.description).toContain('coverage.continuation');
      expect(tool.description).toContain('explicit startDate/endDate');
      expect(tool.description).toContain('full year/history');
      expect(tool.description).toContain('loaded windows/records');
      expect(tool.description).toContain('tool/time budget');
      expect(tool.description).toContain('interrupted or budget-limited traversal');
      expect(tool.description).toContain('completeness');
      expect(tool.description).toContain('unknown');
    }
  });

  it.each(['health', 'nutrition'] as const)('traverses a retained year of %s through public grouped schemas without duplicates or omissions', async source => {
    const f = fixture();
    const tool = f.tools[source === 'health' ? 0 : 1]!;
    const app = await schemaApp(f.tools);
    const input = { operation: source === 'health' ? 'get_health_history' : 'get_nutrition_history',
      startDate: '2025-01-01', endDate: '2025-12-31', limit: 17 };
    const loaded: Record<string, string[]> = { metrics: [], sleep: [], workouts: [], meals: [] };
    let continuation: Record<string, unknown> | null = null;
    let calls = 0;
    let previous: Result | undefined;
    try {
      do {
        const response = await app.inject({ method: 'POST', url: `/${tool.name}`,
          payload: { ...input, ...(continuation ? { continuation } : {}) } });
        expect(response.statusCode).toBe(200);
        const result = response.json<Result>();
        expect(result.sourceCompleteness).toBe('unknown');
        expect(result.requestedPeriod).toMatchObject({ startDate: input.startDate, endDate: input.endDate });
        expect(result.period.timeZone).toBe('Europe/Copenhagen');
        if (source === 'health') {
          expect(Date.parse(result.period.endDate) - Date.parse(result.period.startDate)).toBeLessThanOrEqual(92 * 86_400_000);
        } else expect(result.period).toMatchObject({ startDate: input.startDate, endDate: input.endDate });
        if (previous && previous.period.startDate !== result.period.startDate) {
          expect(Date.parse(result.period.startDate) - Date.parse(previous.period.endDate)).toBe(86_400_000);
          expect(previous.coverage.retainedWindowExhausted).toBe(true);
        }
        if (source === 'health') {
          for (const kind of kinds) {
            loaded[kind]!.push(...result[kind].items.map(row => row.id));
            if (previous?.period.startDate === result.period.startDate && previous[kind].next === null) {
              expect(result[kind].items).toEqual([]);
            }
          }
        } else loaded.meals!.push(...result.meals.map(row => row.id));
        continuation = result.coverage.continuation;
        expect(result.status).toBe(continuation ? 'partial' : 'available');
        if (calls === 0) {
          expect(result.coverage.nextStep).toContain('Never call one page the full history/year');
          expect(result.period).toMatchObject({ startDate: '2025-01-01', endDate: source === 'health' ? '2025-04-03' : '2025-12-31' });
          expect(result.status).toBe('partial');
        }
        previous = result;
        expect(++calls).toBeLessThan(100);
      } while (continuation);
      for (const kind of source === 'health' ? kinds : ['meals'] as const) {
        expect(loaded[kind]).toEqual(f.retained[kind].map(row => row.id));
        expect(new Set(loaded[kind]).size).toBe(loaded[kind]!.length);
      }
      expect(previous!.period.endDate).toBe('2025-12-31');
      expect(previous!.coverage.nextStep).toContain('not proof of complete device/source ingestion');
      if (source === 'health') {
        // One page per live category and one sync read, never a server-side fetch-all loop.
        expect(f.history.mock.calls.length).toBeLessThan(calls * 3);
        expect(f.sync).toHaveBeenCalledTimes(calls);
        for (const [, input] of f.history.mock.calls) expect(input.limit).toBe(17);
      } else {
        expect(f.meals).toHaveBeenCalledTimes(calls);
        for (const [input] of f.meals.mock.calls) expect(input.limit).toBe(17);
      }
    } finally { await app.close(); }
  });

  it('keeps empty/final windows distinct from requested-range and source completeness', async () => {
    const f = fixture();
    for (const kind of kinds) f.retained[kind].length = 0;
    const tool = f.tools[0]!;
    const input = { operation: 'get_health_history', startDate: '2025-01-01', endDate: '2025-04-04' };
    const first = await tool.execute(input, request(), signal()) as Result;
    expect(first).toMatchObject({ status: 'partial', coverage: { hasMore: true, retainedWindowExhausted: true,
      continuation: { windowStartDate: '2025-04-04', cursors: null } } });
    const last = await tool.execute({ ...input, continuation: first.coverage.continuation }, request(), signal()) as Result;
    expect(last).toMatchObject({ status: 'empty', sourceCompleteness: 'unknown',
      period: { startDate: '2025-04-04', endDate: '2025-04-04' },
      coverage: { hasMore: false, continuation: null } });
  });

  it('keeps meal-date filtering separate from creation-time ordering, including backdated and deleted records', async () => {
    const f = fixture();
    const tool = f.tools[1]!;
    f.retained.meals.at(-1)!.deleted_at = '2026-01-02T00:00:00Z';
    const input = { operation: 'get_nutrition_history', startDate: '2025-01-01', endDate: '2025-01-02', limit: 3 };
    const first = await tool.execute(input, request(), signal()) as Result;
    const next = first.coverage.continuation;
    expect(first.meals.map(row => row.id)).toEqual(f.retained.meals.slice(-4, -1).map(row => row.id));
    expect(first.meals.map(row => row.meal_date)).toEqual(['2025-01-02', '2025-01-02', '2025-01-01']);
    const last = await tool.execute({ ...input, continuation: next }, request(), signal()) as Result;
    expect(last.meals.map(row => row.id)).toEqual([f.retained.meals.at(-1)!.id]);
    expect(last.meals[0]!.deleted_at).toBe('2026-01-02T00:00:00Z');
    expect(last.coverage).toMatchObject({ hasMore: false, continuation: null });
    for (const [read] of f.meals.mock.calls) {
      expect(read).toMatchObject({ from: input.startDate, to: input.endDate, limit: 3 });
    }
    f.meals.mockResolvedValueOnce({ rows: [], next: null });
    expect(await tool.execute(input, request(), signal())).toMatchObject({
      status: 'empty', sourceCompleteness: 'unknown', coverage: { hasMore: false },
    });
  });

  it.each(['health', 'nutrition'] as const)('rejects malformed and mismatched %s continuations before reading', async source => {
    const f = fixture();
    const tool = f.tools[source === 'health' ? 0 : 1]!;
    const input = { operation: source === 'health' ? 'get_health_history' : 'get_nutrition_history',
      startDate: '2025-01-01', endDate: '2025-12-31', limit: 1 };
    const first = await tool.execute(input, request(), signal()) as Result;
    const valid = first.coverage.continuation!;
    f.history.mockClear(); f.meals.mockClear(); f.sync.mockClear();
    const malformed = [
      null, [], {}, { ...valid, owner }, { ...valid, source: source === 'health' ? 'nutrition' : 'health' },
      { ...valid, startDate: '2024-01-01' }, { ...valid, endDate: '2025-12-30' },
      { ...valid, windowStartDate: '2025-01-02' }, { ...valid, windowStartDate: '2025-02-30' },
      { ...valid, windowStartDate: '2026-01-01' }, { ...valid, cursors: {} },
      { ...valid, cursors: source === 'health' ? { metrics: null, sleep: null, workouts: null } : { meals: null } },
      { ...valid, cursors: source === 'health' ? {
        metrics: { date: '2024-12-31', key: 'synthetic' }, sleep: null, workouts: null,
      } : { meals: { date: '2025-01-01', key: 'wrong-source-shape' } } },
      { ...valid, cursors: source === 'health' ? {
        metrics: { date: '2025-01-01', key: 'synthetic', owner }, sleep: null, workouts: null,
      } : { meals: { createdAt: 'not-an-instant', id: 'synthetic' } } },
    ];
    for (const continuation of malformed) {
      await expect(tool.execute({ ...input, continuation }, request(), signal())).rejects.toThrow();
    }
    await expect(tool.execute({ operation: input.operation, continuation: valid }, request(), signal())).rejects.toThrow();
    for (const limit of ['10', true, null, 0, 101, 1.5]) {
      await expect(tool.execute({ ...input, limit }, request(), signal())).rejects.toThrow();
    }
    expect(f.history).not.toHaveBeenCalled();
    expect(f.meals).not.toHaveBeenCalled();
    expect(f.sync).not.toHaveBeenCalled();
  });

  it('exposes continuation only on history operations and refuses unexpected schema fields', async () => {
    const f = fixture();
    const app = await schemaApp(f.tools);
    try {
      for (const payload of [
        { operation: 'get_health_summary', continuation: {} },
        { operation: 'get_health_history', owner },
        { operation: 'get_health_history', limit: 101 },
        { operation: 'get_health_history', continuation: { source: 'health' } },
      ]) expect((await app.inject({ method: 'POST', url: '/health_summary', payload })).statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it('replays exact legacy meal IDs using the nutrition store contract, without trimming or renaming', async () => {
    const f = fixture();
    const tool = f.tools[1]!;
    const input = { operation: 'get_nutrition_history', startDate: '2025-01-01', endDate: '2025-12-31', limit: 1 };
    for (const id of [' padded synthetic ', 'synthetic\nid', 'synthetic-æ']) {
      const cursor = { createdAt: '2026-01-01T00:00:00.000Z', id };
      f.meals.mockResolvedValueOnce({ rows: [{ id }], next: cursor });
      const first = await tool.execute(input, request(), signal()) as Result;
      await tool.execute({ ...input, continuation: first.coverage.continuation }, request(), signal());
      expect(f.meals).toHaveBeenLastCalledWith({
        from: input.startDate, to: input.endDate, limit: 1, after: cursor,
      }, expect.any(AbortSignal));
    }
  });

  it.each(['health', 'nutrition'] as const)('does not turn later %s errors, cancellation or timeout into empty/complete results', async source => {
    const f = fixture();
    const tool = f.tools[source === 'health' ? 0 : 1]!;
    const input = { operation: source === 'health' ? 'get_health_history' : 'get_nutrition_history',
      startDate: '2025-01-01', endDate: '2025-01-02', limit: 1 };
    const first = await tool.execute(input, request(), signal()) as Result;
    expect(first.status).toBe('partial');
    const nextInput = { ...input, continuation: first.coverage.continuation };
    const reader = source === 'health' ? f.history : f.meals;
    reader.mockRejectedValueOnce(new Error('Synthetic later-page failure'));
    await expect(tool.execute(nextInput, request(), signal())).rejects.toThrow('Synthetic later-page failure');
    const cancelled = new AbortController();
    cancelled.abort(new Error('Synthetic cancellation'));
    reader.mockClear();
    await expect(tool.execute(nextInput, request(), cancelled.signal)).rejects.toThrow('Synthetic cancellation');
    expect(reader).not.toHaveBeenCalled();
    const timeout = AbortSignal.abort(new Error('Synthetic timeout'));
    const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout);
    try {
      await expect(tool.execute(nextInput, request(), signal())).rejects.toThrow('Synthetic timeout');
      expect(timer).toHaveBeenCalledWith(30_000);
      expect(reader).not.toHaveBeenCalled();
    } finally { timer.mockRestore(); }
    expect(first.coverage.hasMore).toBe(true);
    expect(first.coverage.nextStep).toContain('budget-limited traversal partial');
  });

  it('propagates in-flight cancellation and rejects oversized pages without silently dropping records', async () => {
    const f = fixture();
    const tool = f.tools[0]!;
    const input = { operation: 'get_health_history', startDate: '2025-01-01', endDate: '2025-01-01' };
    const cancelled = new AbortController();
    f.history.mockImplementationOnce(async (_kind, _input, bounded) => {
      cancelled.abort(new Error('Synthetic in-flight cancellation'));
      bounded.throwIfAborted();
      return { items: [], next: null, truncated: false };
    });
    await expect(tool.execute(input, request(), cancelled.signal)).rejects.toThrow('Synthetic in-flight cancellation');
    f.history.mockResolvedValueOnce({
      items: [{ id: 'synthetic', unit: 'x'.repeat(dailyResultByteLimit) }], next: null, truncated: false,
    });
    await expect(tool.execute(input, request(), signal())).rejects.toThrow('shared response limit');
    const timer = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
    f.history.mockImplementationOnce(async () => {
      timer.abort(new Error('Synthetic elapsed deadline'));
      return { items: [], next: null, truncated: false };
    });
    try {
      await expect(tool.execute(input, request(), signal())).rejects.toThrow('Synthetic elapsed deadline');
    } finally { timeout.mockRestore(); }
    f.meals.mockResolvedValueOnce({ rows: [{ id: 'synthetic', meal_name: 'x'.repeat(dailyResultByteLimit) }], next: null });
    await expect(f.tools[1]!.execute({ ...input, operation: 'get_nutrition_history' }, request(), signal())).rejects.toThrow('shared response limit');
  });

  it('preserves owner/connector restrictions and Copenhagen dates on the public execution path', async () => {
    const f = fixture();
    for (const tool of f.tools.slice(0, 2)) {
      const operation = tool === f.tools[0] ? 'get_health_history' : 'get_nutrition_history';
      await expect(tool.execute({ operation }, { ...request(), principal: { objectId: 'other' } } as FastifyRequest, signal())).rejects.toThrow();
      await expect(tool.execute({ operation }, { ...request(), principal: undefined,
        dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner } } as unknown as FastifyRequest, signal())).rejects.toThrow('separate nutrition connector');
      const result = await tool.execute({ operation }, request(), signal()) as Result;
      // The injected clock is still October 22 in UTC, but October 23 in Copenhagen.
      expect(result.period.endDate).toBe('2026-10-23');
    }
  });
});
