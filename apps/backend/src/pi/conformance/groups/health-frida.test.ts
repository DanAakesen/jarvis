import { describe, expect, it } from 'vitest';
import { ToolFailure } from '../../../core/tool-registry.js';
import { FridaLookupAdapter } from '../../../health/nutrition/frida.js';
import type { ConformanceContext } from '../types.testkit.js';
import { fridaStubFetch } from './health-nutrition.testkit.js';

/** The one outside service the Health group depends on: the real adapter over the stubbed public food data. */
describe('the Frida reference stub', () => {
  const lookups = (down: Set<string>) => new FridaLookupAdapter(fridaStubFetch({ down } as unknown as ConformanceContext));
  const components = [{ name: 'egg', grams: 120, preparationMethod: null }, { name: 'toast', grams: 60, preparationMethod: null }];

  it('resolves the foods Dan logs through the real adapter, with the reference attribution', async () => {
    const result = await lookups(new Set()).lookup(components, new AbortController().signal);
    expect(result.status).toBe('complete');
    expect(result.totals.energyKcal).toBeCloseTo(143 * 1.2 + 265 * 0.6, 5);
    expect(result.reference.attribution).toMatch(/DTU National Food Institute/u);
  });

  it('fails with a plain typed message while the network is down', async () => {
    const error = await lookups(new Set(['frida'])).lookup(components, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as ToolFailure).message).toMatch(/Frida reference lookup is unavailable/u);
  });
});
