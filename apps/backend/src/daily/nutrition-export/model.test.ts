import { describe,expect,it } from 'vitest';
import { authorizePeriod,claimInput,completion,exportItem,period } from './model.js';
import { resolveDailyOwner } from '../owner.js';
import type { FastifyRequest } from 'fastify';
const range = { from: '2026-10-12T00:00:00Z',to: '2026-10-13T00:00:00Z' };
describe('bounded explicit nutrition export contracts',() => {
  it('denies export/mixed principals at ordinary Daily owner boundaries',() => {
    const owner = '11111111-1111-4111-8111-111111111111';
    for (const principal of [undefined,{ objectId: owner }]) expect(() => resolveDailyOwner({ server: { ownerObjectId: owner },principal,
      nutritionExportPrincipal: { kind: 'nutrition-export-device' } } as unknown as FastifyRequest)).toThrow();
  });
  it('requires trusted confirmation of precisely the supplied period',() => {
    expect(authorizePeriod(range,{ intent: 'queue-nutrition-export',explicit: true,confirmedPeriod: range })).toEqual({ from: '2026-10-12T00:00:00.000Z',to: '2026-10-13T00:00:00.000Z' });
    for (const authority of [{ intent: 'queue-nutrition-export' as const,explicit: false,confirmedPeriod: range },
      { intent: 'queue-nutrition-export' as const,explicit: true,confirmedPeriod: { ...range,to: '2026-10-14T00:00:00Z' } }]) expect(() => authorizePeriod(range,authority)).toThrow('conflicts');
    expect(() => period({ ...range,to: range.from })).toThrow();
    expect(() => period({ ...range,to: '2027-01-01T00:00:00Z' })).toThrow();
  });
  it.each([0,21,1.5,NaN])('rejects unbounded claim limit %s',limit => expect(() => claimInput({ operationKey: 'synthetic',limit })).toThrow());
  it('defaults claim batch to ten and rejects client identity selectors',() => {
    expect(claimInput({ operationKey: 'synthetic' })).toEqual({ operationKey: 'synthetic',limit: 10 });
    expect(() => claimInput({ operationKey: 'synthetic',owner: 'other' } as never)).toThrow();
  });
  it('normalizes harmless receipt replay without accepting conflicting/over-limit ACKs',() => {
    const input = { id: '01',claimToken: '11111111-1111-4111-8111-111111111111',status: 'written' as const };
    expect(completion(input).receipt).toBe(completion({ ...input,writer: 'Apple Shortcuts' }).receipt);
    expect(completion({ ...input,status: 'failed',error: 'Synthetic partial native write' }).receipt).not.toBe(completion(input).receipt);
    expect(() => completion({ ...input,error: 'not a written receipt' })).toThrow();
    expect(() => completion({ ...input,writer: 'x'.repeat(101) })).toThrow();
    expect(() => completion({ ...input,status: 'failed',error: 'x'.repeat(501) })).toThrow();
  });
  it('preserves unknowns and occurrence time without manufacturing macro zeros',() => {
    const row = { id: '01',idempotency_key: 'stable',meal_name: 'Synthetic',meal_type: null,components_json: '[]',occurred_at: '2026-10-12T10:00:00+02:00',
      energy_kcal: 123.5,protein_grams: null,carbohydrates_grams: 0,fat_grams: null,fiber_grams: null,confidence: 'accurate',capture_method: 'text',status: 'claimed',created_at: '2026-10-12T12:00:00Z' };
    expect(exportItem(row)).toMatchObject({ occurredAt: row.occurred_at,nutrients: { caloriesKcal: 123.5,proteinGrams: null,carbohydratesGrams: 0 } });
    expect(() => exportItem({ ...row,energy_kcal: Infinity })).toThrow();
  });
});
