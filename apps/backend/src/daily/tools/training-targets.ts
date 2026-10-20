import { ToolRefusal, type JarvisTool } from '../../core/tool-registry.js';
import {
  changedTrainingTargets, parseTrainingTargetsPatch, presentTrainingTargets, trainingTargetBounds,
  trainingTargetFields, type TrainingTargetField, type TrainingTargets, type TrainingTargetsPatch,
  type StoredTrainingTargets,
} from '../training/targets.js';
import type { TrainingTargetsAccess } from '../training/targets-store.js';
import { resolveDailyOwner } from '../owner.js';

const targetProperties = Object.fromEntries(trainingTargetFields.map((field) => {
  const range = trainingTargetBounds[field];
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

type Input = { readonly operation: 'read' } | { readonly operation: 'set_targets'; readonly patch: TrainingTargetsPatch };

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
  const parsed = parseTrainingTargetsPatch(input.targets);
  if (!parsed.ok) throw new ToolRefusal(parsed.reason);
  return { operation: 'set_targets', patch: parsed.patch };
}

function show(field: TrainingTargetField, value: number | null): string {
  return value === null ? 'not set' : `${value} ${trainingTargetBounds[field].unit}`;
}

function summary(current: TrainingTargets, patch: TrainingTargetsPatch, changed: readonly TrainingTargetField[]): string {
  return [
    'Review this exact change to your training targets in Now. Nothing has changed yet.',
    'These owner-set targets stay in private Daily settings and are not sent to Teams.',
    ...changed.map((field) => `${trainingTargetBounds[field].label}: ${show(field, current[field])} → ${show(field, patch[field] ?? null)}`),
  ].join('\n');
}

function present(stored: StoredTrainingTargets) {
  const view = presentTrainingTargets(stored);
  return {
    status: view.missing.length ? 'needs-configuration' : 'configured',
    ...view,
    provenance: { store: 'daily-training-targets', enteredBy: 'owner' },
  };
}

export function dailyTrainingTargetsTool(targets: TrainingTargetsAccess): JarvisTool {
  const pending = new Set<string>();
  return {
    name: 'daily_training_targets',
    description: 'Read or change the owner-set targets for gym sessions per week, run sessions per week and daily steps. read needs no approval and returns each stored value, or null where none is set, with the allowed ranges. set_targets changes only the targets you name (null clears one) and every change needs the exact browser Now approval within two minutes. Never guess, default or estimate a value: ask for it. These values are private owner data; do not repeat them outside this conversation. No phone or Teams.',
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
      const changed = changedTrainingTargets(current.targets, input.patch);
      if (changed.length === 0) return { ...present(current), status: 'unchanged' };
      const service = request.server.ownerInteractions;
      if (!service) throw new ToolRefusal('Now approval is unavailable. No training target was changed.');
      const lock = owner.toLowerCase();
      if (pending.has(lock)) throw new ToolRefusal('A training-target change is already waiting for approval. Resolve it first.');
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
