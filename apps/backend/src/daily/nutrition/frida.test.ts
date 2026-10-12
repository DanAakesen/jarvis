import { describe, expect, it, vi } from 'vitest';
import { FridaLookupAdapter, fridaReference } from './frida.js';

const foods = () => Array.from({ length: 1381 }, (_, index) => ({ releaseId: 10, id: index + 1,
  nameDanish: index === 0 ? 'Æble' : `Synthetic reference ${index}`, nameEnglish: index === 0 ? 'Apple' : null,
  descriptionDanish: null, descriptionEnglish: null, danishSynonyms: [] as string[], englishSynonyms: [] as string[] }));
const parameter = (id: number, value: number | null, unitName: string) => ({ id, value, unitName, nameDanish: 'Synthetic', nameEnglish: 'Synthetic', sourceIds: [101], sourceFoodIds: [1] });
const values = () => [{ foodParameters: [parameter(356, 100, 'kcal'), parameter(218, 2, 'g'), parameter(172, 10, 'g'), parameter(168, null, 'g'), parameter(141, 1, 'g')] }];
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function fixture(overrides: { catalogue?: unknown; parameters?: unknown; token?: boolean } = {}) {
  let clock = Date.parse('2026-10-12T15:42:01Z');
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/antiforgery')) return new Response('', { headers: { ...(overrides.token === false ? {} : { 'X-XSRF-TOKEN': 'synthetic-public-session' }), 'set-cookie': 'XSRF-TOKEN=synthetic; Secure; HttpOnly' } });
    expect(options?.headers).toEqual({ 'X-XSRF-TOKEN': 'synthetic-public-session', Cookie: 'XSRF-TOKEN=synthetic' });
    if (path.endsWith('/food/10')) return json(overrides.catalogue ?? foods());
    if (/\/foodParameter\/10\/\d+\/consumer$/u.test(path)) return json(overrides.parameters ?? values());
    throw new Error('Unexpected public endpoint');
  }) as unknown as typeof fetch;
  return { fetcher, adapter: new FridaLookupAdapter(fetcher, () => clock), advance: () => { clock += 11 * 60_000; } };
}
const input = [{ name: 'aeble', grams: 150, preparationMethod: null }];
const signal = () => new AbortController().signal;
describe('pinned verified Frida adapter using synthetic public DTOs only', () => {
  it('pins release 10/5.5, attributes DTU/DOI and scales only known per-100g values', async () => {
    const data = fixture(); const result = await data.adapter.lookup(input, signal());
    expect(result.reference).toEqual(fridaReference); expect(result.reference.version).toBe('5.5');
    expect(result.confirmationRequired).toBe(true); expect(result.status).toBe('partial');
    expect(result.totals).toEqual({ energyKcal: 150, proteinGrams: 3, carbohydratesGrams: 15, fatGrams: 1.5, fiberGrams: null });
    expect(result.components[0]?.match).toMatchObject({ foodId: 1, grams: 150, retrievedAt: '2026-10-12T15:42:01.000Z',
      provenance: { energyKcal: { parameterId: 356, unit: 'kcal', sourceIds: [101], sourceFoodIds: [1] } } });
    expect(result.unknowns).toContain('0:nutrient_missing:fiberGrams');
    await data.adapter.lookup(input, signal()); expect(data.fetcher).toHaveBeenCalledTimes(3);
    data.advance(); await data.adapter.lookup(input, signal()); expect(data.fetcher).toHaveBeenCalledTimes(6);
  });
  it('keeps missing amounts/unresolved components out of complete totals while showing matched subtotals', async () => {
    const data = fixture(); const result = await data.adapter.lookup([...input, { name: 'Apple', grams: null, preparationMethod: null }, { name: 'xyzunknown', grams: 25, preparationMethod: null }], signal());
    expect(result.status).toBe('partial'); expect(result.totals.energyKcal).toBeNull(); expect(result.matchedSubtotals.energyKcal).toBe(150);
    expect(result.unknowns).toContain('1:amount_missing'); expect(result.unknowns).toContain('2:no_match');
    expect(result.components[1]?.match).toBeNull();
  });
  it('requires a unique match, returns at most three candidates and discloses unverified preparation', async () => {
    const catalogue = foods(); catalogue[1]!.nameDanish = 'Æble'; catalogue[2]!.nameDanish = 'Æble'; catalogue[3]!.nameDanish = 'Æble';
    const result = await fixture({ catalogue }).adapter.lookup(input, signal());
    expect(result.components[0]?.candidates).toHaveLength(3); expect(result.components[0]?.match).toBeNull(); expect(result.unknowns).toContain('0:ambiguous_match');
    expect((await fixture().adapter.lookup([{ ...input[0]!, preparationMethod: 'fried' }], signal())).unknowns).toContain('0:preparation_unverified');
  });
  it('recognizes a strong separated match without inventing nutrient quantities', async () => {
    const catalogue = foods(); catalogue[0]!.nameDanish = 'Synthetic ripe apple edible fruit'; catalogue[0]!.nameEnglish = null;
    const params = values(); params[0]!.foodParameters[3]!.value = 1;
    const result = await fixture({ catalogue, parameters: params }).adapter.lookup([{ name: 'Synthetic ripe apple edible', grams: 100, preparationMethod: null }], signal());
    expect(result.status).toBe('complete'); expect(result.components[0]?.match?.foodId).toBe(1); expect(result.totals.fiberGrams).toBe(1);
  });
  it('preserves unavailable provenance and missing values without fabricating IDs or zeros', async () => {
    const row = { ...parameter(356, 100, 'kcal'), sourceIds: null, sourceFoodIds: undefined, value: undefined };
    const result = await fixture({ parameters: [{ foodParameters: [row] }] }).adapter.lookup(input, signal());
    expect(result.status).toBe('partial'); expect(result.totals.energyKcal).toBeNull(); expect(result.matchedSubtotals.energyKcal).toBeNull();
    expect(result.components[0]?.match?.provenance.energyKcal).toMatchObject({ sourceIds: null, sourceFoodIds: null });
    expect(result.unknowns).toContain('0:provenance_unavailable:energyKcal');
  });
  it('searches verified synonym arrays and rejects nonempty bootstrap bodies', async () => {
    const catalogue = foods(); catalogue[0]!.englishSynonyms = ['Synthetic synonym'];
    expect((await fixture({ catalogue }).adapter.lookup([{ ...input[0]!, name: 'Synthetic synonym' }], signal())).components[0]?.match?.foodId).toBe(1);
    const fetcher = vi.fn(async () => new Response('unexpected bootstrap body', { headers: { 'X-XSRF-TOKEN': 'synthetic', 'set-cookie': 'XSRF-TOKEN=synthetic; Secure' } })) as unknown as typeof fetch;
    await expect(new FridaLookupAdapter(fetcher).lookup(input, signal())).rejects.toThrow('invalid');
  });
  it.each([
    { catalogue: foods().slice(0, 100) }, { catalogue: foods().map((row) => ({ ...row, releaseId: 11 })) },
    { catalogue: foods().map((row) => ({ ...row, id: 1 })) }, { parameters: [{ foodParameters: [parameter(356, 1, 'kJ')] }] },
    { parameters: [{ foodParameters: [parameter(356, 1, 'kcal'), parameter(356, 2, 'kcal')] }] }, { token: false },
    { catalogue: foods().map((row) => ({ ...row, danishSynonyms: 'not-an-array' })) },
    { parameters: [{ foodParameters: [{ ...parameter(356, 1, 'kcal'), value: '1' }] }] },
    { parameters: [{ foodParameters: [{ ...parameter(356, 1, 'kcal'), sourceIds: { id: 1 } }] }] },
  ])('fails closed on invalid/truncated/provider session contracts %#', async (override) => {
    await expect(fixture(override).adapter.lookup(input, signal())).rejects.toThrow('No complete nutrient estimate');
  });
  it('bounds input and response bytes, sanitizes provider diagnostics and honors cancellation', async () => {
    await expect(fixture().adapter.lookup(Array(26).fill(input[0]), signal())).rejects.toThrow('components');
    await expect(fixture().adapter.lookup([{ ...input[0]!, grams: 5001 }], signal())).rejects.toThrow('amount');
    const fetcher = vi.fn(async () => { throw new Error('synthetic-cookie-token-and-provider-body'); }) as unknown as typeof fetch;
    const error = await new FridaLookupAdapter(fetcher).lookup(input, signal()).catch((error: Error) => error);
    expect(String(error)).not.toContain('synthetic-cookie'); expect(String(error)).toContain('unavailable');
    const cancelled = new AbortController(); cancelled.abort(); await expect(new FridaLookupAdapter(fetcher).lookup(input, cancelled.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); controller.close(); } });
    const huge = vi.fn(async (url: string) => url.endsWith('/antiforgery') ? new Response('', { headers: { 'X-XSRF-TOKEN': 'synthetic', 'set-cookie': 'XSRF-TOKEN=synthetic; Secure' } }) : new Response(body, { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    await expect(new FridaLookupAdapter(huge).lookup(input, signal())).rejects.toThrow('invalid');
  });
});
