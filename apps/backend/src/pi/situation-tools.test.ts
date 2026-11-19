import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { isCurrentAssistantTool, isSituationActivationTool } from '../core/tool-registry.js';
import { createMemoryProactiveStore } from '../proactive/store.js';
import { sourceIds } from '../proactive/types.js';
import {
  createMemoryPiSituationStore,
  createPiSituationService,
  parsePiSituationState,
} from './situation.js';
import { createSituationTools } from './situation-tools.js';
import { createPiTurnRegistry } from './turns.js';

const owner = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-11-19T05:00:00.000Z');
const live = () => new AbortController().signal;

function toolRequest(activationId?: string): FastifyRequest {
  return {
    headers: activationId ? { 'x-jarvis-activation': activationId } : {},
    jarvisPi: activationId ? 'turn' : undefined,
    agentPrincipal: activationId ? { objectId: 'pi-dispatch', tenantId: 'fixture' } : undefined,
  } as unknown as FastifyRequest;
}

describe('PI situation MCP tools', () => {
  it('is PI-activation-only, never a normal assistant catalogue tool', () => {
    expect(isSituationActivationTool('situation_read')).toBe(true);
    expect(isCurrentAssistantTool('situation_read')).toBe(false);
  });

  it('reads, commits and rejects a closed activation through the live grant', async () => {
    const registry = createPiTurnRegistry();
    const proactive = createMemoryProactiveStore(owner);
    const service = createPiSituationService({
      owner, store: createMemoryPiSituationStore(), proactive, sources: [], now: () => at,
    });
    const tools = createSituationTools({ registry, service, now: () => at });
    const read = tools.find(({ name }) => name === 'situation_read')!;
    const commit = tools.find(({ name }) => name === 'situation_commit')!;
    const grant = registry.open({
      ownerObjectId: owner, sessionId: '7', messageId: '42', signal: live(),
      activation: {
        id: '00000000-0000-4000-8000-000000000001',
        type: 'chat', source: 'chat', slotKey: null, stateRevision: 0, stateHash: null,
        policyRevision: (await service.read(live())).policyRevision,
        staleSources: 0, disabledSources: [],
      },
    });
    const request = toolRequest(grant.activation!.id);
    const first = await read.execute({}, request, live()) as Record<string, unknown>;
    expect(first).toMatchObject({ revision: 0, state: null });
    const state = parsePiSituationState({
      version: 1,
      asOf: at.toISOString(),
      summary: '',
      summaryRefIds: [],
      sources: sourceIds.map((id) => ({
        id, state: id === 'location' ? 'fresh' : 'missing',
        observedAt: id === 'location' ? at.toISOString() : null,
        expiresAt: null, reason: id === 'location' ? null : 'not_observed', refIds: [],
      })),
      refs: [], facts: [], followUps: [],
    });
    const result = await commit.execute({
      expectedRevision: first.revision,
      expectedHash: first.hash,
      policyRevision: first.policyRevision,
      state,
    }, request, live()) as Record<string, unknown>;
    expect(result).toMatchObject({ committed: true, revision: 1 });
    registry.close(grant.turn);
    await expect(read.execute({}, request, live())).rejects.toThrow('live PI activation');
  });
});
