import { describe, expect, it } from 'vitest';
import { budgetState, canRunWithinBudget, estimateCost } from './budget.js';

describe('proactive budget', () => {
  it('uses known Foundry rates and estimates unknown models at the highest known rates', () => {
    expect(estimateCost('gpt-5.6-luna', 1_000_000, 1_000_000)).toMatchObject({
      estimatedDkk: 9.2098,
      estimated: false,
    });
    expect(estimateCost('unknown-model', 1_000_000, 1_000_000)).toMatchObject({
      estimatedDkk: 9.2098,
      estimated: true,
    });
  });

  it('marks budget thresholds and refuses worst-case spend beyond what remains', () => {
    expect(budgetState(100, 79.99)).toBe('ok');
    expect(budgetState(100, 80)).toBe('warn');
    expect(budgetState(100, 99.99)).toBe('warn');
    expect(budgetState(100, 100)).toBe('exhausted');
    expect(budgetState(0, 0)).toBe('exhausted');
    expect(canRunWithinBudget(100, 80, 20)).toBe(true);
    expect(canRunWithinBudget(100, 80, 20.01)).toBe(false);
  });
});
