import { randomUUID } from 'node:crypto';
import type { PiBrainRun, PiTurnGrant, PiTurnRegistry } from './turns.js';
import type {
  PiActivationType, PiSituationActivation, PiSituationService, PiSituationView,
} from './situation.js';
import { sourceIds, type SourceId } from '../proactive/types.js';

export interface PiActivationStart {
  readonly type: PiActivationType;
  readonly source: string | null;
  readonly slotKey?: string | null;
  readonly id?: string;
  readonly ownerObjectId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly brain?: PiBrainRun;
  readonly signal: AbortSignal;
}

export interface PiStartedActivation {
  readonly grant: PiTurnGrant;
  readonly situation: PiSituationView;
  readonly context: string;
}

/** Owns the exact activation envelope shared by user and background turns. */
export interface PiActivationService {
  readonly situation: PiSituationService;
  begin(input: PiActivationStart): Promise<PiStartedActivation>;
  failed(grant: PiTurnGrant, at: Date, signal: AbortSignal): Promise<void>;
}

const activationId = (value: string | undefined): string => value ?? randomUUID();
const metadata = (grant: PiTurnGrant): PiSituationActivation => {
  const value = grant.activation;
  if (!value) throw new Error('PI activation metadata is missing');
  return {
    id: value.id,
    type: value.type,
    source: value.source,
    at: new Date(),
  };
};

export function createPiActivationService(options: {
  readonly registry: PiTurnRegistry;
  readonly situation: PiSituationService;
}): PiActivationService {
  return {
    situation: options.situation,
    async begin(input) {
      const { text, view } = await options.situation.context(input.signal);
      const id = activationId(input.id);
      const at = new Date();
      const grant = options.registry.open({
        ownerObjectId: input.ownerObjectId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        ...(input.brain ? { brain: input.brain } : {}),
        signal: input.signal,
        activation: {
          id,
          type: input.type,
          source: input.source,
          slotKey: input.slotKey ?? null,
          stateRevision: view.revision,
          stateHash: view.hash,
          policyRevision: view.policyRevision,
          staleSources: view.staleSources.length,
          disabledSources: view.disabledSources,
        },
      });
      try {
        await options.situation.markActivation({
          id,
          type: input.type,
          source: input.source,
          at,
        }, input.signal);
        if (input.brain && view.state) {
          input.brain.evidence ??= [];
          for (const ref of view.state.refs) {
            input.brain.evidence.push({
              source: ref.source,
              ref: ref.id,
              identity: ref.identity,
              label: ref.label,
              observedAt: ref.observedAt,
              verifiedAt: ref.verifiedAt!,
            });
          }
        }
        return { grant, situation: view, context: text };
      } catch (error) {
        options.registry.close(grant.turn);
        throw error;
      }
    },
    async failed(grant, at, signal) {
      const activation = metadata(grant);
      const baseline = grant.activation;
      if (!baseline) return;
      const source = baseline.type === 'event'
        ? (sourceIds as readonly string[]).includes(activation.source ?? '')
          ? activation.source as SourceId
          : activation.source === 'github' || activation.source === 'worker' ? 'factory' as const : undefined
        : undefined;
      await options.situation.markFailed({
        activation: { ...activation, at },
        expectedRevision: baseline.stateRevision,
        expectedHash: baseline.stateHash,
        ...(source ? { sources: [source] } : {}),
      }, signal);
    },
  };
}
