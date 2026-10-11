export const DKK_PER_USD = 6.5785;

const ratesDkkPerMillionTokens = new Map([
  ['gpt-5.6-luna', { input: 1.3157, output: 7.8941 }],
  ['gpt-6-luna', { input: 0.6579, output: 3.2893 }],
]);

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}

export function foundryTokenCosts(model: string, inputTokens: number, outputTokens: number) {
  const rates = ratesDkkPerMillionTokens.get(model);
  if (!rates) return null;
  const inputDkk = roundCost(inputTokens * rates.input / 1_000_000);
  const outputDkk = roundCost(outputTokens * rates.output / 1_000_000);
  return {
    inputDkk,
    outputDkk,
    inputUsd: roundCost(inputDkk / DKK_PER_USD),
    outputUsd: roundCost(outputDkk / DKK_PER_USD),
  };
}

export function isRealtimeImageModel(model: string): boolean {
  return model === 'gpt-realtime-2.1' || model === 'gpt-realtime-2.1-mini';
}

export function realtimeImageCosts(model: string, imageTokens: number) {
  // Provider list-price estimate, not verified Azure billing:
  // https://developers.openai.com/api/docs/models/gpt-realtime-2.1
  // No exact mini image rate is established; its hold must remain pending.
  if (model !== 'gpt-realtime-2.1') return null;
  const inputUsd = roundCost(imageTokens * 5 / 1_000_000);
  return { inputDkk: roundCost(inputUsd * DKK_PER_USD), inputUsd, outputDkk: 0, outputUsd: 0 };
}
