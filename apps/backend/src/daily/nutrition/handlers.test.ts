import { describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import type { FastifyRequest } from 'fastify';
import { createNutritionHandlers, type NutritionExecution } from './handlers.js';
import type { FridaLookupAdapter } from './frida.js';
import { NutritionStore } from './store.js';

const owner = '11111111-1111-4111-8111-111111111111';
const context = (intent: NutritionExecution['intent']): NutritionExecution => ({
  request: { server: { ownerObjectId: owner }, principal: { objectId: owner } } as unknown as FastifyRequest,
  signal: new AbortController().signal, requestTime: '2026-10-12T23:30:00Z', intent,
  explicit: true, proposalRequired: false, proposalAccepted: false,
});
describe('typed handlers awaiting P12-09 registration', () => {
  it('uses existing Jarvis owner/auth and does not accept model confirmation for photo proposals', async () => {
    const lookup = vi.fn(); const handlers = createNutritionHandlers({} as sql.ConnectionPool, { lookup } as unknown as FridaLookupAdapter);
    await expect(handlers.lookup([], { ...context('lookup'), request: { ...context('lookup').request, principal: { objectId: 'other' } } as unknown as FastifyRequest })).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    const input = { id: 'synthetic', idempotencyKey: 'synthetic', mealName: 'Synthetic', mealType: null, components: [], provenance: {},
      energyKcal: 100, confidence: 'accurate' as const, captureMethod: 'photo' as const, userConfirmed: true };
    await expect(handlers.log(input, { ...context('log-intake'), proposalRequired: true })).rejects.toThrow('acceptance');
  });
  it('passes explicit exact label intent without another confirmation and defaults nullable macros/time', async () => {
    const log = vi.fn(async () => ({ id: 'synthetic' }));
    const factory = vi.spyOn(NutritionStore, 'forRequest').mockReturnValue({ log } as unknown as NutritionStore);
    try {
      const handlers = createNutritionHandlers({} as sql.ConnectionPool, {} as FridaLookupAdapter);
      await handlers.log({ id: 'synthetic', idempotencyKey: 'synthetic', mealName: 'Synthetic', mealType: null, components: [], provenance: {},
        energyKcal: 123, confidence: 'accurate', captureMethod: 'voice' }, context('log-intake'));
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ energyKcal: 123, proteinGrams: null, mealDate: '2026-10-13', occurredAt: '2026-10-12T23:30:00Z' }),
        expect.objectContaining({ explicit: true, proposalRequired: false }), expect.any(AbortSignal));
    } finally { factory.mockRestore(); }
  });
  it('corrects by server-read operation key, preserves dates/legacy vocabulary and refuses changed identifiers', async () => {
    const intake = vi.fn(async () => ({ id: '01', idempotency_key: 'synthetic-key', meal_name: 'Synthetic', meal_type: null, components_json: '[]', nutrient_provenance_json: '{}',
      occurred_at: '2026-01-01T23:30:00+01:00', meal_date: new Date('2026-01-01T00:00:00Z'), expires_at: '9999-12-31T23:59:59Z',
      energy_kcal: 100, protein_grams: null, carbohydrates_grams: null, fat_grams: null, fiber_grams: null, confidence: 'accurate', capture_method: 'mixed' }));
    const correct = vi.fn(async () => ({})); const factory = vi.spyOn(NutritionStore, 'forRequest').mockReturnValue({ intake, correct } as unknown as NutritionStore);
    try {
      const handlers = createNutritionHandlers({} as sql.ConnectionPool, {} as FridaLookupAdapter);
      await handlers.correct({ idempotencyKey: 'synthetic-key', expectedRevision: 3n, changes: { energyKcal: 222 } }, context('correct-intake'));
      expect(correct).toHaveBeenCalledWith(expect.objectContaining({ id: '01', idempotencyKey: 'synthetic-key', energyKcal: 222, mealDate: '2026-01-01', occurredAt: '2026-01-01T23:30:00+01:00', confidence: 'accurate', captureMethod: 'mixed' }), 3n, expect.any(AbortSignal));
      await expect(handlers.correct({ idempotencyKey: 'synthetic-key', expectedRevision: 3n, changes: { id: 'different' } as never }, context('correct-intake'))).rejects.toThrow('correction');
    } finally { factory.mockRestore(); }
  });
});
