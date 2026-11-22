export interface PiUsage {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

// Azure GPT-6.1 Terra meters, in DKK per million tokens (November 2026).
const piAzureRates = { cacheRead: 0.34, cacheWrite: 8.39, input: 6.7, output: 33.5 };

/** One harness call measured about 18,008 input tokens. Use this estimate when a started call reports no usage. */
export const ESTIMATED_PROMPT_TOKENS = 18_000;

export function piCostDkk({ inputTokens, cachedTokens, outputTokens }: PiUsage): number {
  const cacheReads = Math.min(inputTokens, cachedTokens);
  // Foundry reports cache reads but not writes. Estimate all remaining input at the uncached rate;
  // do not assume it all incurred the cache-write meter.
  const uncached = inputTokens - cacheReads;
  return Number(((cacheReads * piAzureRates.cacheRead + uncached * piAzureRates.input +
    outputTokens * piAzureRates.output) / 1_000_000).toFixed(6));
}

/** The existing proactive reservation: a long prompt (no cache hits) and a long answer. */
export const PI_WAKE_PREFLIGHT_DKK = piCostDkk({ inputTokens: 90_000, cachedTokens: 0, outputTokens: 6_000 });
