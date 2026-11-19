import { describe, expect, it } from 'vitest';
import { foundryTokenCosts, highestFoundryTokenCosts } from '../core/usage-pricing.js';
import { budgetState, canRunWithinBudget, effectiveProactiveBudget, estimateCost } from './budget.js';

describe('proactive budget meter', () => {
  it('prices GPT-6.1 Terra at USD 1 input and USD 5 output per million tokens', () => {
    const cost = estimateCost('gpt-6.1-terra', 1_000_000, 1_000_000);
    expect(cost.estimated).toBe(false);
    expect(cost.estimatedDkk).toBeCloseTo(6.5785 + 32.8925, 4);
    const known = foundryTokenCosts('gpt-6.1-terra', 1_000_000, 1_000_000)!;
    expect(known.inputUsd).toBeCloseTo(1, 3);
    expect(known.outputUsd).toBeCloseTo(5, 3);
  });

  it('no longer prices Terra at the Luna rate', () => {
    const terra = estimateCost('gpt-6.1-terra', 100_000, 10_000).estimatedDkk;
    const luna = estimateCost('gpt-5.6-luna', 100_000, 10_000).estimatedDkk;
    expect(terra).toBeGreaterThan(luna * 4);
  });

  it('still prices an unlisted model at the highest known rate and marks it estimated', () => {
    const unknown = estimateCost('some-future-model', 1_000_000, 1_000_000);
    const highest = highestFoundryTokenCosts(1_000_000, 1_000_000);
    expect(unknown.estimated).toBe(true);
    expect(unknown.estimatedDkk).toBeCloseTo(highest.inputDkk + highest.outputDkk, 6);
    expect(unknown.estimatedDkk).toBeGreaterThanOrEqual(estimateCost('gpt-6.1-terra', 1_000_000, 1_000_000).estimatedDkk);
  });

  it('keeps the hard monthly stop', () => {
    expect(effectiveProactiveBudget(500)).toBe(100);
    expect(canRunWithinBudget(100, 99.5, 0.4)).toBe(true);
    expect(canRunWithinBudget(100, 99.5, 0.6)).toBe(false);
    expect(canRunWithinBudget(0, 0, 0.01)).toBe(false);
    expect(budgetState(100, 100)).toBe('exhausted');
    expect(budgetState(100, 80)).toBe('warn');
    expect(budgetState(100, 79.99)).toBe('ok');
  });
});
