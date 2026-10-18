import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { dailySourceTools } from './source-tools.js';
import type { DailyCoachStore } from '../coach-store.js';
import type { DailyData } from '../query.js';
import type { NutritionStore } from '../nutrition/store.js';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-10-18T12:00:00Z');
const signal = () => new AbortController().signal;

function fixture() {
  const confirmation: string[] = [];
  const request = (id = owner) => ({
    server: { ownerObjectId: owner, ownerInteractions: {
      runConfirmed: async (_kind: string, text: string, apply: () => Promise<unknown>) => {
        confirmation.push(text);
        return apply();
      },
    } },
    principal: { objectId: id },
  }) as unknown as FastifyRequest;
  const health = {
    history: vi.fn(async (kind: string) => ({
      items: [{ metric_name: kind === 'metrics' ? 'active_energy' : undefined, metric_date: '2026-10-18',
        value: 500, unit: 'kcal', updated_at: '2026-10-18T11:00:00Z' }],
      truncated: false, next: null,
    })),
    sync: vi.fn(async () => ({ feeds: [], heartbeat: null, inbox: null })),
  };
  const nutritionStore = {
    history: vi.fn(async () => ({ rows: [{ id: 'synthetic-meal', energy_kcal: 400, protein_grams: null }], next: null })),
    days: vi.fn(async () => ({ rows: [
      { meal_date: '2026-10-17', meal_count: 1, energy_kcal: 400, protein_grams: null, unknown_nutrients: ['protein_grams'], partial_nutrients: [] },
      { meal_date: '2026-10-18', meal_count: 1, energy_kcal: 500, protein_grams: 20, unknown_nutrients: [], partial_nutrients: [] },
    ], next: null })),
    preferences: vi.fn(async () => []),
    feedback: vi.fn(async (key: string, preference: string | null) => ({ meal_key: key, preference, revision: '1' })),
  } as unknown as Pick<NutritionStore, 'history' | 'days' | 'preferences' | 'feedback'>;
  const profile = { status: 'available' as const, profile: { revision: '3', primaryGoal: 'synthetic' } };
  const coach = {
    profile: vi.fn(async () => profile),
    updateProfile: vi.fn(async (_patch, revision: bigint) => ({ revision: String(revision + 1n) })),
    recovery: vi.fn(async () => [{ recovery_date: new Date('2026-10-17T00:00:00Z'), context_text: null }]),
    setRecovery: vi.fn(async (_start: string, _end: string, state: 'sick' | 'clear') => ({ affectedDays: 1, state })),
  } as unknown as DailyCoachStore;
  const data: DailyData = {
    query: { query: vi.fn() }, changes: {} as never,
    health: () => health as never,
    nutrition: () => nutritionStore,
    coach: () => coach,
  };
  return { request, health, nutritionStore, coach, confirmation, tools: dailySourceTools(data, data.nutrition!, data.coach!, () => now) };
}

describe('source-selected Daily tool capabilities', () => {
  it('registers three bounded native tools for all nine remaining source capabilities', () => {
    const { tools } = fixture();
    expect(tools.map(tool => tool.name)).toEqual(['daily_health_summary', 'daily_nutrition_history', 'daily_coach_status']);
    const descriptions = tools.map(tool => tool.description).join('\n');
    for (const capability of ['get_health_summary', 'get_health_history', 'get_nutrition_history', 'analyze_nutrition',
      'get_calorie_balance', 'get_coach_status', 'get_coach_profile', 'update_coach_profile', 'set_meal_preference', 'set_recovery_period']) {
      expect(descriptions).toContain(capability);
    }
    expect(tools.every(tool => tool.sensitive && tool.denyOnPhone)).toBe(true);
  });

  it('reads summary/history and enforces the original history range bound', async () => {
    const f = fixture();
    const healthTool = f.tools[0]!;
    const summary = await healthTool.execute({ operation: 'get_health_summary' }, f.request(), signal()) as Record<string, unknown>;
    expect(summary).toMatchObject({ timeZone: 'Europe/Copenhagen', today: { date: '2026-10-18' }, targets: null });
    expect(f.health.sync).toHaveBeenCalledOnce();
    const history = await healthTool.execute({ operation: 'get_health_history', startDate: '2026-10-01', endDate: '2026-10-18', limit: 10 }, f.request(), signal()) as Record<string, unknown>;
    expect(history).toMatchObject({ period: { startDate: '2026-10-01', endDate: '2026-10-18' }, sourceCompleteness: 'unknown' });
    await expect(healthTool.execute({ operation: 'get_health_history', startDate: '2026-07-01', endDate: '2026-10-18' }, f.request(), signal())).rejects.toThrow('93 days');
    await expect(healthTool.execute({ operation: 'get_health_summary', startDate: '2026-10-18' }, f.request(), signal())).rejects.toThrow();
  });

  it('keeps named meal history distinct and excludes recorded recovery dates from analysis', async () => {
    const f = fixture();
    const tool = f.tools[1]!;
    const history = await tool.execute({ operation: 'get_nutrition_history', startDate: '2026-10-01', endDate: '2026-10-18' }, f.request(), signal()) as Record<string, unknown>;
    expect(history).toMatchObject({ source: 'daily.nutrition_meals', timeZone: 'Europe/Copenhagen' });
    expect(f.nutritionStore.history).toHaveBeenCalledOnce();
    const analysis = await tool.execute({ operation: 'analyze_nutrition', startDate: '2026-10-17', endDate: '2026-10-18', granularity: 'day' }, f.request(), signal()) as Record<string, unknown>;
    expect(analysis).toMatchObject({ granularity: 'day', excludedRecoveryDays: 1 });
    expect(analysis.series).toHaveLength(1);
    expect(f.coach.recovery).toHaveBeenCalled();
    await expect(tool.execute({ operation: 'get_calorie_balance', owner: other }, f.request(), signal())).rejects.toThrow();
    await expect(tool.execute({ operation: 'get_nutrition_history', startDate: '2026-10-19', endDate: '2026-10-20' }, f.request(), signal())).rejects.toThrow('ending no later than today');
  });

  it('uses the existing Now confirmation boundary for profile, preference and recovery writes', async () => {
    const f = fixture();
    const tool = f.tools[2]!;
    const profile = await tool.execute({ operation: 'update_coach_profile', patch: { deficitRate: 0.2 } }, f.request(), signal()) as Record<string, unknown>;
    expect(profile.status).toBe('committed');
    expect(f.coach.updateProfile).toHaveBeenCalledWith({ deficitRate: 0.2 }, 3n, expect.any(AbortSignal));
    const preference = await f.tools[1]!.execute({ operation: 'set_meal_preference', mealKey: 'favorite:synthetic', preference: 'like' }, f.request(), signal()) as Record<string, unknown>;
    expect(preference).toMatchObject({ status: 'committed', source: 'daily.nutrition_recommendation_feedback' });
    expect(f.nutritionStore.feedback).toHaveBeenCalledWith('favorite:synthetic', 'like', expect.any(AbortSignal), 0n);
    const recovery = await tool.execute({ operation: 'set_recovery_period', startDate: '2026-10-18', endDate: '2026-10-18', context: 'synthetic' }, f.request(), signal()) as Record<string, unknown>;
    expect(recovery).toMatchObject({ status: 'committed', measurementsPreserved: true, source: 'daily.recovery_days' });
    expect(f.coach.setRecovery).toHaveBeenCalledWith('2026-10-18', '2026-10-18', 'sick', 'synthetic', expect.any(AbortSignal));
    expect(f.confirmation).toHaveLength(3);
  });

  it('rejects non-owner access and does not claim unavailable historical data as empty', async () => {
    const f = fixture();
    await expect(f.tools[0]!.execute({ operation: 'get_health_summary' }, f.request(other), signal())).rejects.toThrow();
    const tool = f.tools[1]!;
    const result = await tool.execute({ operation: 'get_calorie_balance', startDate: '2026-10-18', endDate: '2026-10-18' }, f.request(), signal()) as Record<string, unknown>;
    expect(result.units).toEqual({ energy: 'kcal' });
    expect(result.coverage).toMatchObject({ sourceCompleteness: 'unknown' });
  });
});
