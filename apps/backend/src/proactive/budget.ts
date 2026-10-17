import { foundryTokenCosts } from '../core/usage-pricing.js';

const knownModels = ['gpt-5.6-luna', 'gpt-6-luna'];
export type BudgetState = 'ok' | 'warn' | 'exhausted';

export function estimateCost(model: string, inputTokens: number, outputTokens: number): {
  estimatedDkk: number;
  estimated: boolean;
} {
  if (![inputTokens, outputTokens].every((count) => Number.isSafeInteger(count) && count >= 0)) {
    throw new RangeError('Token counts must be nonnegative safe integers');
  }
  const known = foundryTokenCosts(model, inputTokens, outputTokens);
  if (known) return { estimatedDkk: known.inputDkk + known.outputDkk, estimated: false };
  const conservative = knownModels.map((candidate) =>
    foundryTokenCosts(candidate, inputTokens, outputTokens)!);
  return {
    estimatedDkk: Math.max(...conservative.map(({ inputDkk }) => inputDkk)) +
      Math.max(...conservative.map(({ outputDkk }) => outputDkk)),
    estimated: true,
  };
}

export function budgetState(monthlyLimitDkk: number, estimatedSpendDkk: number): BudgetState {
  if (!Number.isFinite(monthlyLimitDkk) || monthlyLimitDkk < 0 ||
      !Number.isFinite(estimatedSpendDkk) || estimatedSpendDkk < 0) {
    throw new RangeError('Budget amounts must be nonnegative finite numbers');
  }
  if (monthlyLimitDkk === 0 || estimatedSpendDkk >= monthlyLimitDkk) return 'exhausted';
  return estimatedSpendDkk >= monthlyLimitDkk * 0.8 ? 'warn' : 'ok';
}

export function canRunWithinBudget(monthlyLimitDkk: number, estimatedSpendDkk: number, worstCaseDkk: number): boolean {
  if (![monthlyLimitDkk, estimatedSpendDkk, worstCaseDkk].every((amount) => Number.isFinite(amount) && amount >= 0)) {
    throw new RangeError('Budget amounts must be nonnegative finite numbers');
  }
  return worstCaseDkk <= Math.max(0, monthlyLimitDkk - estimatedSpendDkk);
}
