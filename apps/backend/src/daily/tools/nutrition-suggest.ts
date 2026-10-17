import { ToolFailure, ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import {
  defaultSuggestionLimit, maxSuggestionLimit, readNutritionSuggestions, type NutritionSuggestionSources,
} from '../nutrition/suggestion-adapter.js';
import type { NutritionTargetsAccess } from '../nutrition/targets-store.js';
import { resolveDailyOwner } from '../owner.js';

const inputSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: maxSuggestionLimit, description: 'How many suggestions to return. Defaults to a short list.' },
  },
  additionalProperties: false,
} as const;

function parseLimit(raw: unknown): number {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolRefusal('Send only an optional limit.');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'limit')) throw new ToolRefusal('Use only the limit field. The owner, date and budget come from stored settings and data.');
  if (input.limit === undefined) return defaultSuggestionLimit;
  const limit = input.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxSuggestionLimit) {
    throw new ToolRefusal(`The limit must be a whole number from 1 to ${maxSuggestionLimit}.`);
  }
  return limit;
}

/** Read-only: the personalised remaining food budget for today and the saved favourites that fit it. */
export function dailyNutritionSuggestTool(targets: NutritionTargetsAccess, sources: NutritionSuggestionSources): JarvisTool {
  return {
    name: 'daily_nutrition_suggest',
    description: 'Work out what is left of today\'s food budget and suggest saved favourites that fit it. Read only: it logs and changes nothing. It uses the owner\'s own nutrition targets (see daily_nutrition_targets), the active energy burned so far today from stored Apple Health data, and only meals logged in Jarvis, so food eaten but never logged is not counted. Trust the kcal figures only when kcal.state is ready; otherwise name the reason that is missing, never guess a number and never say a suggestion fits. Mention burn.ageMinutes when the Health reading is clearly old. Protein is partial when some logged meals have no protein value, so the remaining figure is an upper bound. Suggestions come only from saved favourites. The figures are private health data: no phone or Teams. This is the owner\'s own budget arithmetic, not advice or a coaching plan.',
    inputSchema,
    bodyLimit: 1024,
    sensitive: true,
    denyOnPhone: true,
    execute: async (raw, request, signal) => {
      resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      const limit = parseLimit(raw);
      const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      try {
        return await readNutritionSuggestions(sources, targets, request, limit, operationSignal);
      } catch (error) {
        // An outer abort or deadline passes through untouched; only this tool's own deadline becomes a clear failure.
        if (signal.aborted) throw signal.reason;
        if (operationSignal.aborted) throw new ToolFailure('Nutrition suggestions took too long. Try again.');
        throw error;
      }
    },
  };
}
