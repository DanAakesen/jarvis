import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { suggest, type BudgetContext, type Suggestion } from '../nutrition/model.js';
import type { NutritionSuggestionSources } from '../nutrition/suggestion-adapter.js';
import type { NutritionTargets } from '../nutrition/targets.js';
import type { NutritionTargetsAccess } from '../nutrition/targets-store.js';
import { dailyNutritionSuggestTool } from './nutrition-suggest.js';

// Synthetic placeholders. They are not anyone's real figures.
const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const synthetic: NutritionTargets = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };
const now = '2026-10-17T10:30:00.000Z';
const signal = () => new AbortController().signal;

afterEach(() => { vi.restoreAllMocks(); });

const favourite = (id: string, energy: number, protein: number) => ({
  id, favorite_name: `Favourite ${id}`, energy_kcal: energy, protein_grams: protein, carbohydrates_grams: null, fat_grams: null, fiber_grams: null,
});

function fixture(over: { favourites?: Record<string, unknown>[]; health?: () => Promise<unknown> } = {}) {
  const read = vi.fn(async () => ({ targets: synthetic, updatedAt: '2026-10-10T08:00:00.000Z' }));
  const targets = vi.fn(() => ({ read, write: vi.fn() }));
  const history = vi.fn(async () => ({ rows: [], next: null }));
  const favorites = vi.fn(async () => ({ rows: over.favourites ?? [], nextId: null }));
  const suggestions = vi.fn(async (candidates: readonly Suggestion[], context: BudgetContext) => suggest(candidates, new Set(), context));
  const nutrition = vi.fn(() => ({ history, favorites, suggestions }));
  const healthHistory = vi.fn(over.health ?? (async () => ({
    items: [{ metric_name: 'active_energy', metric_date: '2026-10-17', unit: 'kcal', value: 300, sample_count: 8, start_at: null, end_at: null, updated_at: '2026-10-17T10:00:00.000Z' }],
    truncated: false, next: null,
  })));
  const health = vi.fn(() => ({ history: healthHistory }));
  const sources = { nutrition, health, now: () => now } as unknown as NutritionSuggestionSources;
  const request = { principal: { objectId: owner }, headers: {}, server: { ownerObjectId: owner } } as unknown as FastifyRequest;
  const tool = dailyNutritionSuggestTool(targets as unknown as NutritionTargetsAccess, sources);
  return { tool, request, targets, read, nutrition, health, history, favorites, suggestions, healthHistory };
}

const untouched = (f: ReturnType<typeof fixture>) => [f.targets, f.nutrition, f.health, f.history, f.favorites, f.healthHistory, f.suggestions];

describe('daily_nutrition_suggest descriptor', () => {
  it('is private, phone-denied, small-bodied and carries no figures in its model-facing text', () => {
    const { tool } = fixture();
    expect(tool.name).toBe('daily_nutrition_suggest');
    expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
    expect(tool.sensitive).toBe(true);
    expect(tool.denyOnPhone).toBe(true);
    expect(tool.bodyLimit).toBeLessThanOrEqual(4096);
    expect(tool.description.length).toBeLessThanOrEqual(4000);
    expect(tool.description).not.toMatch(/\d/u);
    expect(tool.description).toMatch(/read only/iu);
  });

  it('offers one optional, bounded limit and nothing that could name an owner, a date or a budget', () => {
    const { tool } = fixture();
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 10, description: expect.any(String) } },
      additionalProperties: false,
    });
    expect(tool.inputSchema).not.toHaveProperty('required');
  });
});

describe('daily_nutrition_suggest', () => {
  const favourites = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => favourite(id, 100 + index, 20 + index));

  it('returns the owner\'s remaining budget and fitting favourites, with a short default list', async () => {
    const f = fixture({ favourites });
    const report = await f.tool.execute({}, f.request, signal()) as { status: string; kcal: { remainingKcal: number }; suggestions: unknown[]; totalMatches: number };
    expect(report.status).toBe('ready');
    expect(report.kcal.remainingKcal).toBe(1750 + 300 - 350);
    expect(report.suggestions).toHaveLength(5);
    expect(report.totalMatches).toBe(7);
    for (const access of [f.targets, f.nutrition, f.health]) expect(access).toHaveBeenCalledWith(f.request);
    expect(f.history).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit limit', async () => {
    const f = fixture({ favourites });
    const report = await f.tool.execute({ limit: 2 }, f.request, signal()) as { suggestions: unknown[]; totalMatches: number };
    expect(report.suggestions).toHaveLength(2);
    expect(report.totalMatches).toBe(7);
  });

  it('answers the owner\'s own agent as well as the owner\'s session', async () => {
    const f = fixture({ favourites });
    const agent = { ...f.request, principal: undefined, agentPrincipal: { kind: 'jarvis-agent' } } as unknown as FastifyRequest;
    await expect(f.tool.execute({ limit: 1 }, agent, signal())).resolves.toMatchObject({ localDate: '2026-10-17' });
  });

  it.each([
    ['no arguments object', null],
    ['an array', []],
    ['a string', 'five'],
    ['an owner override', { owner: stranger }],
    ['a date override', { date: '2026-10-16' }],
    ['a budget override', { remainingKcal: 4200 }],
    ['a target override', { restingKcal: 1750 }],
    ['an extra field beside a valid limit', { limit: 3, owner }],
    ['a zero limit', { limit: 0 }],
    ['a limit above the maximum', { limit: 11 }],
    ['a fractional limit', { limit: 1.5 }],
    ['a numeric string limit', { limit: '3' }],
    ['a null limit', { limit: null }],
  ])('refuses %s before reading anything', async (_label, input) => {
    const f = fixture({ favourites });
    await expect(f.tool.execute(input, f.request, signal())).rejects.toBeInstanceOf(ToolRefusal);
    for (const mock of untouched(f)) expect(mock).not.toHaveBeenCalled();
  });

  it('denies anyone who is not the owner before any store is opened', async () => {
    const f = fixture({ favourites });
    const other = { ...f.request, principal: { objectId: stranger } } as unknown as FastifyRequest;
    await expect(f.tool.execute({}, other, signal())).rejects.toBeInstanceOf(AuthenticationDenied);
    for (const mock of untouched(f)) expect(mock).not.toHaveBeenCalled();
  });

  it('refuses the external connector and points it at its own boundary', async () => {
    const f = fixture({ favourites });
    const connector = {
      ...f.request, principal: undefined, dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner },
    } as unknown as FastifyRequest;
    await expect(f.tool.execute({}, connector, signal())).rejects.toThrow(/separate nutrition connector boundary/u);
    for (const mock of untouched(f)) expect(mock).not.toHaveBeenCalled();
  });

  it('turns its own deadline into a clear failure rather than a generic error', async () => {
    const f = fixture({ favourites });
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    const failure = await f.tool.execute({}, f.request, signal()).then(() => null, (error: unknown) => error);
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as ToolFailure).message).toBe('Nutrition suggestions took too long. Try again.');
    for (const mock of untouched(f)) expect(mock).not.toHaveBeenCalled();
  });

  it('lets an outer abort through unchanged', async () => {
    const reason = new Error('caller went away');
    const controller = new AbortController();
    const f = fixture({ favourites, health: async () => { controller.abort(reason); throw new Error('socket closed'); } });
    await expect(f.tool.execute({}, f.request, controller.signal)).rejects.toBe(reason);
    expect(f.suggestions).not.toHaveBeenCalled();
  });

  it('does not report success when the caller aborted while the last read was still answering', async () => {
    const reason = new Error('caller went away');
    const controller = new AbortController();
    const f = fixture({ favourites });
    f.suggestions.mockImplementationOnce(async (candidates, context) => {
      controller.abort(reason);
      return suggest(candidates, new Set(), context);
    });
    await expect(f.tool.execute({}, f.request, controller.signal)).rejects.toBe(reason);
    expect(f.suggestions).toHaveBeenCalledTimes(1);
  });

  it('does not report success when its own deadline passed while the last read was still answering', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const f = fixture({ favourites });
    f.suggestions.mockImplementationOnce(async (candidates, context) => {
      deadline.abort(new DOMException('timed out', 'TimeoutError'));
      return suggest(candidates, new Set(), context);
    });
    const failure = await f.tool.execute({}, f.request, signal()).then(() => null, (error: unknown) => error);
    expect(f.suggestions).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(ToolFailure);
    expect((failure as ToolFailure).message).toBe('Nutrition suggestions took too long. Try again.');
  });

  it('does not hide other failures', async () => {
    const f = fixture({ favourites });
    f.history.mockRejectedValueOnce(new Error('meal store unavailable'));
    await expect(f.tool.execute({}, f.request, signal())).rejects.toThrow('meal store unavailable');
  });
});
