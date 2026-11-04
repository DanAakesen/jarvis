import { activeHealthSession, currentHealthMessage } from './context.js';
import { nutritionSummary } from '../nutrition/review.js';
import { ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import { resolveHealthOwner } from '../owner.js';
import { foodLookupInputSchema, foodLookupSchema } from '../nutrition/lookup-schema.js';
import { healthResultByteLimit, type HealthFoodLookup } from '../query.js';

export function healthFoodLookupTool(lookup: HealthFoodLookup): JarvisTool {
  return {
    name: 'health_food_lookup',
    description: 'Look up public DTU Frida reference nutrients for 1-25 food components. Supply only a generic food name, grams (or null if unknown) and preparationMethod (or null). Quantities are requested reference amounts, not verified eaten food. Always show actual returned protein (g), calories (kcal) and fat (g) as a bulleted list; unknown stays unknown. Preserve returned DTU/version/DOI attribution, retrieval times, unknowns and incomplete subtotals; never turn a partial match into complete nutrition. This read never logs intake, saves food or exports Health. Reference results do not approve a later food change; use the separate source/native-authority workflow. No owner, credentials, provider URL, confidence or confirmation flags. Not available by phone.',
    inputSchema: foodLookupInputSchema,
    bodyLimit: 96 * 1024,
    sensitive: true,
    denyOnPhone: true,
    execute: async (input, request, signal) => {
      resolveHealthOwner(request);
      if (request.healthConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      const parsed = foodLookupSchema.safeParse(input);
      if (!parsed.success) throw new ToolRefusal('Use 1-25 bounded food components with positive grams or an explicit unknown; no authority or provider selectors.');
      signal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      signal.throwIfAborted();
      const source = await currentHealthMessage(request, signal);
      await activeHealthSession(request, source, signal, Date.now());
      const result = await lookup(structuredClone(parsed.data.components), request, signal);
      signal.throwIfAborted();
      const response = { ...result, intakeLogged: false,
        presentation: `Estimated nutrition (Frida; not measured):\n${nutritionSummary(result.totals)}` };
      if (Buffer.byteLength(JSON.stringify(response)) > healthResultByteLimit) {
        throw new ToolRefusal('Food reference result exceeds the shared Health response limit. Request fewer components; no complete result is claimed.');
      }
      request.server.nowEventHub?.publish({ type: 'food_estimate_result', sessionId: source.sessionId,
        sourceMessageId: source.id, summary: response.presentation });
      return response;
    },
  };
}
