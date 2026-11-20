import type { FastifyRequest } from 'fastify';
import {
  isSituationActivationTool, ToolFailure, ToolRefusal, type JarvisTool,
} from '../core/tool-registry.js';
import { sourceIds, type SourceId } from '../proactive/types.js';
import { PiSituationError, type PiSituationService } from './situation.js';
import type { PiTurnRegistry } from './turns.js';

export const isSituationTool = isSituationActivationTool;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function grant(registry: PiTurnRegistry, request: FastifyRequest) {
  const value = request.headers['x-jarvis-activation'];
  const found = typeof value === 'string' ? registry.resolveActivation(value) : undefined;
  if (!request.jarvisPi || !found?.activation) {
    throw new ToolRefusal('This tool needs a live PI activation. Nothing was done.');
  }
  return found;
}

function failure(error: unknown): never {
  if (error instanceof ToolRefusal || error instanceof ToolFailure) throw error;
  if (error instanceof PiSituationError) {
    if (error.code === 'unavailable') throw new ToolFailure(error.message);
    throw new ToolRefusal(error.message);
  }
  throw error;
}

export function createSituationTools(options: {
  readonly registry: PiTurnRegistry;
  readonly service: PiSituationService;
  readonly now: () => Date;
}): JarvisTool[] {
  return [
    {
      name: 'situation_read',
      description: [
        'Read my compact, owner-scoped PI situational state and its revision, hash, source freshness and missing or stale sources.',
        'This is a model-maintained working summary, not the authoritative conversation or source archive.',
        'Disabled-source and stale facts are excluded. Use situation_lookup for the bounded raw reference when a decision needs detail.',
        'Only the current PI activation can use this tool.',
      ].join(' '),
      execution: { defaultEffect: 'read' },
      sensitive: true,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_input, request, signal) => {
        const active = grant(options.registry, request);
        try {
          const view = await options.service.read(signal);
          return {
            activationId: active.activation!.id,
            revision: view.revision,
            hash: view.hash,
            policyRevision: view.policyRevision,
            state: view.state,
            staleSources: view.staleSources,
            missingSources: view.missingSources,
            disabledSources: view.disabledSources,
            freshSources: view.freshSources,
            asOf: view.asOf,
            updatedAt: view.updatedAt,
            lastActivation: view.lastActivation ? {
              id: view.lastActivation.id,
              type: view.lastActivation.type,
              source: view.lastActivation.source,
              at: view.lastActivation.at.toISOString(),
            } : null,
          };
        } catch (error) { return failure(error); }
      },
    },
    {
      name: 'situation_lookup',
      description: [
        'Resolve one source reference from situation_read to a bounded current raw record.',
        'source is the exact source id and ref is the reference identity; the source switch still applies, so a disabled automatic source is refused.',
        'A direct owner chat request can use the underlying source tool normally even when that source is excluded here.',
        'Only the current PI activation can use this tool.',
      ].join(' '),
      execution: { defaultEffect: 'read' },
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: { source: { enum: [...sourceIds] }, ref: { type: 'string', minLength: 1, maxLength: 240 } },
        required: ['source', 'ref'],
        additionalProperties: false,
      },
      execute: async (input, request, signal) => {
        grant(options.registry, request);
        if (!isRecord(input) || typeof input.source !== 'string' || typeof input.ref !== 'string' ||
            !sourceIds.includes(input.source as SourceId)) {
          throw new ToolRefusal('The source reference is invalid. Nothing was read.');
        }
        try {
          return await options.service.lookup({ source: input.source as SourceId, ref: input.ref }, signal);
        } catch (error) { return failure(error); }
      },
    },
    {
      name: 'situation_patch',
      description: [
        'Apply one bounded, evidence-linked patch to the server-initialized PI situational state.',
        'Send the exact revision, hash and proactive-policy revision from situation_read.',
        'Patch only facts, references, source observations, summary and follow-ups that changed; use remove arrays to invalidate only affected evidence.',
        'The server owns the remaining sources and rejects disabled, stale, secret or unlinked evidence. A no-material-change patch returns without a new revision.',
        'Only the current PI activation can use this tool.',
      ].join(' '),
      execution: { defaultEffect: 'action' },
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 0, maximum: 9_007_199_254_740_991 },
          expectedHash: {
            anyOf: [{ type: 'string', pattern: '^[0-9a-f]{64}$' }, { type: 'null' }],
          },
          policyRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          patch: { type: 'object', additionalProperties: true },
        },
        required: ['expectedRevision', 'expectedHash', 'policyRevision', 'patch'],
        additionalProperties: false,
      },
      execute: async (input, request, signal) => {
        const active = grant(options.registry, request);
        if (!isRecord(input) || !Number.isSafeInteger(input.expectedRevision) ||
            (input.expectedHash !== null && typeof input.expectedHash !== 'string') ||
            typeof input.policyRevision !== 'string' || !isRecord(input.patch)) {
          throw new ToolRefusal('The situation patch is invalid. Nothing was changed.');
        }
        const activation = active.activation!;
        try {
          const result = await options.service.patch({
            expectedRevision: input.expectedRevision as number,
            expectedHash: input.expectedHash as string | null,
            policyRevision: input.policyRevision,
            patch: input.patch,
            activation: {
              id: activation.id,
              type: activation.type,
              source: activation.source,
              at: options.now(),
            },
          }, signal);
          return {
            committed: result.changed,
            changed: result.changed,
            revision: result.record.revision,
            hash: result.record.hash,
            asOf: result.record.asOf.toISOString(),
            excludedSources: result.excluded,
          };
        } catch (error) { return failure(error); }
      },
    },
    {
      name: 'situation_commit',
      description: [
        'Compatibility commit for one material whole-state change. Prefer situation_patch and preserve sources/facts not changed in this turn.',
        'Send the exact revision, hash and proactive-policy revision from situation_read, plus the complete bounded state schema.',
        'The server rejects stale revisions, source-policy changes and secrets. Facts from disabled sources are excluded; prior disabled-source facts are retained only as explicitly stale storage and are never used proactively.',
        'Only the current PI activation can use this tool.',
      ].join(' '),
      execution: { defaultEffect: 'action' },
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 0, maximum: 9_007_199_254_740_991 },
          expectedHash: {
            anyOf: [{ type: 'string', pattern: '^[0-9a-f]{64}$' }, { type: 'null' }],
          },
          policyRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          state: { type: 'object', additionalProperties: true },
        },
        required: ['expectedRevision', 'expectedHash', 'policyRevision', 'state'],
        additionalProperties: false,
      },
      execute: async (input, request, signal) => {
        const active = grant(options.registry, request);
        if (!isRecord(input) || !Number.isSafeInteger(input.expectedRevision) ||
            (input.expectedHash !== null && typeof input.expectedHash !== 'string') ||
            typeof input.policyRevision !== 'string' || !isRecord(input.state)) {
          throw new ToolRefusal('The situation commit is invalid. Nothing was changed.');
        }
        const activation = active.activation!;
        try {
          const result = await options.service.commit({
            expectedRevision: input.expectedRevision as number,
            expectedHash: input.expectedHash as string | null,
            policyRevision: input.policyRevision,
            state: input.state,
            activation: {
              id: activation.id,
              type: activation.type,
              source: activation.source,
              at: options.now(),
            },
          }, signal);
          return {
            committed: true,
            revision: result.record.revision,
            hash: result.record.hash,
            asOf: result.record.asOf.toISOString(),
            excludedSources: result.excluded,
          };
        } catch (error) { return failure(error); }
      },
    },
  ];
}
