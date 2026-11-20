import { randomUUID } from 'node:crypto';
import type { PiBrainRun, PiTurnGrant, PiTurnRegistry } from './turns.js';
import type { PiActivationType, PiSituationCommit, PiSituationService, PiSituationView } from './situation.js';

export interface PiActivationStart {
  readonly type: PiActivationType;
  readonly source: string | null;
  readonly slotKey?: string | null;
  readonly id?: string;
  readonly ownerObjectId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly ownerText?: string;
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
const metadata = (grant: PiTurnGrant): PiSituationCommit['activation'] => {
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
  readonly recall?: (query: string, signal: AbortSignal) => Promise<string>;
}): PiActivationService {
  return {
    situation: options.situation,
    async begin(input) {
      const [{ text, view }, memory] = await Promise.all([
        options.situation.context(input.signal),
        !input.brain && input.ownerText && options.recall ? options.recall(input.ownerText, input.signal) : '',
      ]);
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
        return { grant, situation: view, context: [text, memory].filter(Boolean).join('\n\n') };
      } catch (error) {
        options.registry.close(grant.turn);
        throw error;
      }
    },
    async failed(grant, at, signal) {
      const activation = metadata(grant);
      const baseline = grant.activation;
      if (!baseline) return;
      await options.situation.markFailed({
        activation: { ...activation, at },
        expectedRevision: baseline.stateRevision,
        expectedHash: baseline.stateHash,
      }, signal);
    },
  };
}
