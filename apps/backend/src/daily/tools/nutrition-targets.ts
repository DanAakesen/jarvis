import { ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import {
  changedNutritionTargets, nutritionTargetBounds, nutritionTargetFields, parseNutritionTargetsPatch, presentNutritionTargets,
  type NutritionTargetField, type NutritionTargets, type NutritionTargetsPatch, type StoredNutritionTargets,
} from '../nutrition/targets.js';
import type { NutritionTargetsAccess } from '../nutrition/targets-store.js';
import { resolveDailyOwner } from '../owner.js';

const targetProperties = Object.fromEntries(nutritionTargetFields.map((field) => {
  const range = nutritionTargetBounds[field];
  return [field, {
    type: ['integer', 'null'], minimum: range.min, maximum: range.max,
    description: `${range.label} in ${range.unit}, a whole number. null clears it.`,
  }];
}));
const inputSchema = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: ['read', 'set_targets'] },
    targets: { type: 'object', properties: targetProperties, additionalProperties: false, minProperties: 1 },
  },
  required: ['operation'],
  additionalProperties: false,
} as const;

type Input = { readonly operation: 'read' } | { readonly operation: 'set_targets'; readonly patch: NutritionTargetsPatch };

function parseInput(raw: unknown): Input {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolRefusal('Choose read or set_targets.');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'operation' && key !== 'targets')) {
    throw new ToolRefusal('Use only the operation and targets fields.');
  }
  if (input.operation === 'read') {
    if ('targets' in input) throw new ToolRefusal('Reading takes no targets.');
    return { operation: 'read' };
  }
  if (input.operation !== 'set_targets') throw new ToolRefusal('Choose read or set_targets.');
  const parsed = parseNutritionTargetsPatch(input.targets);
  if (!parsed.ok) throw new ToolRefusal(parsed.reason);
  return { operation: 'set_targets', patch: parsed.patch };
}

const show = (field: NutritionTargetField, value: number | null) => value === null ? 'not set' : `${value} ${nutritionTargetBounds[field].unit}`;

function summary(current: NutritionTargets, patch: NutritionTargetsPatch, changed: readonly NutritionTargetField[]): string {
  return [
    'Review this exact change to your nutrition targets in Now. Nothing has changed yet.',
    'Jarvis uses these figures to work out what is left to eat today. They stay in your private settings and are not sent to Teams.',
    ...changed.map((field) => `${nutritionTargetBounds[field].label}: ${show(field, current[field])} → ${show(field, patch[field] ?? null)}`),
  ].join('\n');
}

function present(stored: StoredNutritionTargets) {
  const view = presentNutritionTargets(stored);
  return { status: view.missing.length ? 'needs-configuration' : 'configured', ...view, provenance: { store: 'daily-settings', enteredBy: 'owner' } };
}

export function dailyNutritionTargetsTool(targets: NutritionTargetsAccess): JarvisTool {
  const pending = new Set<string>();
  return {
    name: 'daily_nutrition_targets',
    description: 'Read or change the owner\'s nutrition targets: resting energy burn (kcal), daily deficit (kcal) and protein target (g). read needs no approval and returns each stored value, or null where none is set, with the allowed ranges. set_targets changes only the targets you name (null clears one) and every change needs the exact browser Now approval within two minutes. Never guess, default or estimate a value: ask for the number. The values are private health data; do not repeat them outside this conversation. No phone or Teams. They are the owner\'s own figures for the daily food budget, not advice or a coaching plan.',
    inputSchema,
    bodyLimit: 2 * 1024,
    sensitive: true,
    denyOnPhone: true,
    execute: async (raw, request, signal) => {
      const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
      const owner = resolveDailyOwner(request);
      if (request.dailyConnectorPrincipal) throw new ToolRefusal('Use the separate nutrition connector boundary for external clients.');
      operationSignal.throwIfAborted();
      const input = parseInput(raw);
      const store = targets(request);
      const current = await store.read(operationSignal);
      if (input.operation === 'read') return present(current);
      const changed = changedNutritionTargets(current.targets, input.patch);
      if (changed.length === 0) return { ...present(current), status: 'unchanged' };
      const service = request.server.ownerInteractions;
      if (!service) throw new ToolRefusal('Now approval is unavailable. No nutrition target was changed.');
      const lock = owner.toLowerCase();
      if (pending.has(lock)) throw new ToolRefusal('A nutrition-target change is already waiting for approval. Resolve it first.');
      pending.add(lock);
      try {
        return await service.runConfirmed('other', summary(current.targets, input.patch, changed), async () => {
          operationSignal.throwIfAborted();
          return { ...present(await store.write(input.patch, operationSignal)), status: 'committed', changed };
        }, operationSignal, { channel: 'browser', lifetimeSeconds: 120 });
      } finally { pending.delete(lock); }
    },
  };
}
