import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import sql from 'mssql';
import { ToolFailure } from '../../core/tool-registry.js';
import { fridaReference, type FridaLookup } from '../nutrition/frida.js';
import { createDailyData, dailyResultByteLimit, type DailyFoodLookup } from '../query.js';
import { dailyFoodLookupTool } from './food-lookup.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const request = (id = owner) => ({
  server: { ownerObjectId: id, nowEventHub: { publish: vi.fn() },
    conversationStore: { getSession: vi.fn(async () => ({ id: '41', channel: 'chat', endedAt: null })) } },
  principal: { objectId: id }, headers: {},
  jarvisConversationMessage: { id: '42', sessionId: '41', role: 'dan', text: 'Estimate synthetic food.', at: new Date(), model: null },
}) as unknown as FastifyRequest;
const input = () => ({ components: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] });
function result(): FridaLookup {
  const values = { energyKcal: 0, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null };
  return {
    status: 'partial', confirmationRequired: true, reference: fridaReference, totals: values, matchedSubtotals: values,
    unknowns: ['nutrient_missing:proteinGrams'],
    components: [{ input: input().components[0]!, candidates: [], unknowns: ['nutrient_missing:proteinGrams'],
      match: { foodId: 1, name: 'Synthetic reference fixture', grams: 100, values,
        provenance: { energyKcal: { parameterId: 356, unit: 'kcal', sourceIds: null, sourceFoodIds: null } },
        retrievedAt: '2026-10-17T06:00:00Z' } }],
  };
}
describe('inactive internal Frida reference lookup', () => {
  it('returns the unchanged partial reference, zero, unknowns and actual retrieval time without write authority', async () => {
    const reference = result(); const lookup = vi.fn<DailyFoodLookup>().mockResolvedValue(reference);
    const tool = dailyFoodLookupTool(lookup); const req = request();
    const response = await tool.execute(input(), req, new AbortController().signal);
    expect(response).toEqual({ ...reference, intakeLogged: false,
      presentation: 'Estimated nutrition (Frida; not measured):\n- Protein: unknown (not zero) g\n- Calories: 0 kcal\n- Fat: unknown (not zero) g\n- Carbohydrates: unknown (not zero) g\n- Fiber: unknown (not zero) g' });
    expect(lookup).toHaveBeenCalledWith(input().components, req, expect.any(AbortSignal));
    expect(req.server.nowEventHub.publish).toHaveBeenCalledWith({ type: 'food_estimate_result', sessionId: '41', sourceMessageId: '42',
      summary: expect.stringContaining('- Calories: 0 kcal') });
    expect(tool.sensitive).toBe(true); expect(tool.denyOnPhone).toBe(true);
    expect(tool.reflexSafe).not.toBe(true); expect(tool.publicAllowedOnPhone).not.toBe(true);
    expect(tool.description.length).toBeLessThanOrEqual(4000);
  });
  it('freezes inputs, uses the exact 20-second service deadline and rejects a late result after cancellation', async () => {
    const pending = Promise.withResolvers<FridaLookup>();
    const lookup = vi.fn<DailyFoodLookup>(() => pending.promise);
    const tool = dailyFoodLookupTool(lookup); const controller = new AbortController(); const payload = input();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const active = tool.execute(payload, request(), controller.signal);
      const outcome = expect(active).rejects.toThrow();
      expect(timeout).toHaveBeenCalledWith(20000);
      payload.components[0]!.grams = 999;
      await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
      expect(lookup.mock.calls[0]![0][0]!.grams).toBe(100);
      controller.abort();
      expect(lookup.mock.calls[0]![2].aborted).toBe(true);
      pending.resolve(result());
      await outcome;
    } finally { timeout.mockRestore(); pending.resolve(result()); }
  });
  it('refuses missing or inactive source bindings before lookup or presentation', async () => {
    const lookup = vi.fn<DailyFoodLookup>().mockResolvedValue(result());
    const tool = dailyFoodLookupTool(lookup);
    const missing = request(); delete missing.jarvisConversationMessage;
    await expect(tool.execute(input(), missing, new AbortController().signal)).rejects.toThrow('verified current');
    const ended = request();
    vi.mocked(ended.server.conversationStore!.getSession).mockResolvedValue(null);
    await expect(tool.execute(input(), ended, new AbortController().signal)).rejects.toThrow('active verified');
    expect(lookup).not.toHaveBeenCalled();
    expect(missing.server.nowEventHub.publish).not.toHaveBeenCalled();
    expect(ended.server.nowEventHub.publish).not.toHaveBeenCalled();
  });
  it('rejects authority/provider selectors before invoking the injected service', async () => {
    const lookup = vi.fn<DailyFoodLookup>().mockResolvedValue(result()); const tool = dailyFoodLookupTool(lookup);
    for (const payload of [{ ...input(), owner: other }, { ...input(), url: 'https://example.invalid' }, { components: [] }]) {
      await expect(tool.execute(payload, request(), new AbortController().signal)).rejects.toThrow();
    }
    await expect(tool.execute(input(), { ...request(), principal: { objectId: other } } as FastifyRequest, new AbortController().signal)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
  it('surfaces provider failures and refuses oversized results without a success-shaped fallback', async () => {
    const lookup = vi.fn<DailyFoodLookup>().mockRejectedValueOnce(new ToolFailure('Public food reference unavailable.'));
    const tool = dailyFoodLookupTool(lookup);
    await expect(tool.execute(input(), request(), new AbortController().signal)).rejects.toThrow('reference unavailable');
    lookup.mockResolvedValueOnce({ ...result(), unknowns: ['x'.repeat(dailyResultByteLimit)] });
    await expect(tool.execute(input(), request(), new AbortController().signal)).rejects.toThrow('response limit');
  });
  it('adds provider access only when explicitly injected and checks the data owner before any provider or SQL call', async () => {
    const pool = new sql.ConnectionPool({ server: '127.0.0.1' });
    const sqlRequest = vi.spyOn(pool, 'request');
    const provider = { lookup: vi.fn(async () => result()) };
    try {
      expect(createDailyData(pool, owner).foodLookup).toBeUndefined();
      const data = createDailyData(pool, owner, Date.now, provider);
      expect(provider.lookup).not.toHaveBeenCalled();
      await expect(data.foodLookup!(input().components, request(other), new AbortController().signal)).rejects.toThrow();
      expect(provider.lookup).not.toHaveBeenCalled();
      expect(await data.foodLookup!(input().components, request(), new AbortController().signal)).toEqual(result());
      expect(provider.lookup).toHaveBeenCalledOnce(); expect(sqlRequest).not.toHaveBeenCalled();
    } finally { sqlRequest.mockRestore(); if (pool.connected) await pool.close(); }
  });
});
