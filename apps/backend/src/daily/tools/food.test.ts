import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ConversationHistoryMessage, ConversationSession } from '../../core/conversation-store.js';
import { dailyFoodTool } from './food.js';
import type { IntakeAuthority, MealInput } from '../nutrition/model.js';
import { createToolRegistry, ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import {
  executeRealtimeCapabilityCall, VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL,
} from '../../voice/realtime.js';

const owner = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-10-16T23:30:00Z');
const source = { id: '42', sessionId: 'synthetic-session', role: 'dan' as const, text: 'Log my favourite Synthetic Dinner', at, model: null };
const signal = () => new AbortController().signal;
function fixture() {
  const favorite = {
    id: 'favorite', favorite_name: 'Synthetic Dinner', normalized_name: 'synthetic dinner', aliases_json: '[]',
    meal_name: 'Saved meal', meal_type: 'dinner', energy_kcal: 321, protein_grams: null, carbohydrates_grams: 20,
    fat_grams: null, fiber_grams: null, components_json: '[{"food":"synthetic"}]',
    nutrient_provenance_json: '{"kind":"retained"}', confidence: 'estimate', revision: '3',
    owner_object_id: owner, private_field: 'must-not-escape',
  };
  const rows = new Map<string, Record<string, unknown>>();
  const store = {
    intake: vi.fn(async (key: string) => rows.get(key) ?? null),
    lookupSaved: vi.fn(async (name: string): Promise<{ source: 'favorite' | 'history'; row: Record<string, unknown> } | null> =>
      name === 'Synthetic Dinner' ? { source: 'favorite', row: favorite } : null),
    log: vi.fn(async (input: MealInput, authority: IntakeAuthority) => {
      expect(authority.intent).toBe('log-intake');
      const row = { id: input.id, idempotency_key: input.idempotencyKey, revision: '1', deleted_at: null,
        energy_kcal: input.energyKcal, protein_grams: input.proteinGrams, capture_method: input.captureMethod,
        occurred_at: input.occurredAt, meal_date: input.mealDate, nutrient_provenance_json: JSON.stringify(input.provenance),
        owner_object_id: owner, private_field: 'must-not-escape' };
      rows.set(input.idempotencyKey, row);
      return row;
    }),
  };
  const session = { id: source.sessionId, channel: 'voice' as ConversationSession['channel'], language: 'en', startedAt: at, endedAt: null } satisfies ConversationSession;
  const getSession = vi.fn(async () => session);
  const getHistory = vi.fn(async () => ({ messages: [{ ...source, channel: 'chat', language: 'en', interrupted: false,
    voiceMinutes: null, toolCalls: [], attachments: [] } satisfies ConversationHistoryMessage], nextCursor: null }));
  const request = { server: { ownerObjectId: owner, conversationStore: { getSession, getHistory } },
    headers: {}, principal: { objectId: owner }, jarvisConversationMessage: { ...source },
    validateInput: vi.fn(() => true), getValidationFunction: vi.fn(() => undefined), log: { info: vi.fn() },
  } as unknown as FastifyRequest;
  const nutrition = vi.fn(() => store);
  const tool = dailyFoodTool(nutrition, () => at.getTime());
  return { tool, request, nutrition, store, favorite, session, getHistory, rows };
}
const favoriteInput = { operation: 'log_favorite' };

async function executeThroughVoiceCapability(tool: ReturnType<typeof dailyFoodTool>, request: FastifyRequest, input: unknown) {
  const registry = createToolRegistry([{ id: 'daily', tools: [tool] }]);
  const discovered = new Set<string>();
  const discovery = JSON.parse(await executeRealtimeCapabilityCall({
    type: 'response.function_call_arguments.done', name: VOICE_CAPABILITY_DISCOVERY_TOOL,
    call_id: 'food-discovery', arguments: '{}',
  }, registry, request, signal(), discovered, undefined, false));
  expect(discovery).toMatchObject({ outcome: 'ok', result: { capabilities: [expect.objectContaining({ name: 'health_food' })] } });
  return executeRealtimeCapabilityCall({
    type: 'response.function_call_arguments.done', name: VOICE_CAPABILITY_EXECUTION_TOOL,
    call_id: 'food-execution', arguments: JSON.stringify({ capability: 'health_food', arguments: input }),
  }, registry, request, signal(), discovered, undefined, false);
}

describe('inactive internal food tool', () => {
  it.each([
    ['explicit exact label', 'Log yoghurt: 123 kcal, protein 4 g', { operation: 'log_exact' }],
    ['saved favourite', 'Log my favourite Synthetic Dinner', favoriteInput],
  ])('preserves %s semantics through compact voice discovery and dispatch', async (_label, text, input) => {
    const f = fixture();
    f.request.jarvisConversationMessage = { ...source, text };
    const output = JSON.parse(await executeThroughVoiceCapability(f.tool, f.request, input));
    expect(output).toMatchObject({ tool: 'health_food', outcome: 'ok', result: { status: 'committed' } });
    expect(f.store.log).toHaveBeenCalledOnce();
    expect(f.store.log.mock.calls[0]![0].captureMethod).toBe('voice');
    expect(f.store.log.mock.calls[0]![1]).toMatchObject({ proposalRequired: false });
    expect(output.result.record).not.toHaveProperty('private_field');
  });
  it('logs the actual saved snapshot from verified voice with no second approval and a safe real receipt', async () => {
    const f = fixture();
    const result = await f.tool.execute(favoriteInput, f.request, signal());
    const [meal, authority] = f.store.log.mock.calls[0]!;
    expect(meal).toMatchObject({ energyKcal: 321, proteinGrams: null, confidence: 'estimate', captureMethod: 'voice',
      occurredAt: at.toISOString(), mealDate: '2026-10-17', components: [{ food: 'synthetic' }],
      provenance: { kind: 'retained', jarvisIntake: { sourceMessageId: '42', favoriteId: 'favorite' } } });
    expect(authority).toMatchObject({ explicit: true, estimateAccepted: true, proposalRequired: false,
      favorite: { id: 'favorite', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) } });
    expect(f.store.lookupSaved).toHaveBeenCalledWith('Synthetic Dinner', expect.any(AbortSignal));
    expect(result).toMatchObject({ status: 'committed', record: { revision: '1', energy_kcal: 321 } });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
    expect(JSON.stringify(result)).not.toContain(owner);
    expect(f.tool.sensitive).toBe(true); expect(f.tool.reflexSafe).not.toBe(true); expect(f.tool.publicAllowedOnPhone).not.toBe(true);
    expect(f.tool.denyOnPhone).toBe(true);
  });
  it('recovers a committed message after the favourite changes without logging or resolving it again', async () => {
    const f = fixture();
    const first = await f.tool.execute(favoriteInput, f.request, signal());
    f.favorite.energy_kcal = 999;
    expect(await f.tool.execute(favoriteInput, f.request, signal())).toEqual(first);
    expect(f.store.lookupSaved).toHaveBeenCalledTimes(1); expect(f.store.log).toHaveBeenCalledTimes(1);
    f.request.jarvisConversationMessage = { ...source, id: '43' };
    await f.tool.execute(favoriteInput, f.request, signal());
    expect(f.rows.size).toBe(2);
  });
  it('never recreates a deleted intake from a replayed message', async () => {
    const f = fixture(); await f.tool.execute(favoriteInput, f.request, signal());
    [...f.rows.values()][0]!.deleted_at = at.toISOString();
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow('not recreated');
    expect(f.store.log).toHaveBeenCalledTimes(1);
  });
  it('recovers the committed receipt when an overlapping retry resolves a newer favourite', async () => {
    const f = fixture(); const committed = await f.tool.execute(favoriteInput, f.request, signal());
    f.store.intake.mockResolvedValueOnce(null);
    f.favorite.energy_kcal = 999;
    f.store.log.mockRejectedValueOnce(new ToolRefusal('This operation key already belongs to different meal data.'));
    expect(await f.tool.execute(favoriteInput, f.request, signal())).toEqual(committed);
    expect(f.store.log.mock.calls[1]![0].energyKcal).toBe(999);
    expect(f.rows.size).toBe(1);
    expect(f.store.intake).toHaveBeenCalledTimes(3);
  });
  it('recovers a real committed row after an uncertain result without executing another write', async () => {
    const f = fixture(); const persist = f.store.log.getMockImplementation()!;
    f.store.log.mockImplementationOnce(async (input, authority) => {
      await persist(input, authority);
      throw new ToolFailure('Nutrition persistence failed. Retry with the same operation key.');
    });
    expect(await f.tool.execute(favoriteInput, f.request, signal())).toMatchObject({ status: 'committed', record: { energy_kcal: 321 } });
    expect(f.store.log).toHaveBeenCalledTimes(1); expect(f.rows.size).toBe(1);
  });
  it('does not turn an unverified persistence refusal into a successful receipt', async () => {
    const f = fixture();
    f.store.log.mockRejectedValueOnce(new ToolFailure('Synthetic unverified commit; retry the same message.'));
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow('Synthetic unverified commit');
    expect(f.store.intake).toHaveBeenCalledTimes(2); expect(f.rows.size).toBe(0);
  });
  it('refuses edited source text rather than passing an earlier intake off as the revised request', async () => {
    const f = fixture(); await f.tool.execute(favoriteInput, f.request, signal());
    f.request.jarvisConversationMessage = { ...source, text: 'Log a different favourite' };
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow('different committed intake');
    expect(f.store.log).toHaveBeenCalledTimes(1);
  });
  it('does not substitute a matching substring when the complete requested favourite is absent', async () => {
    const f = fixture(); f.request.jarvisConversationMessage = { ...source, text: 'Log two Synthetic Dinner' };
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow('missing or ambiguous');
    expect(f.store.lookupSaved).toHaveBeenCalledWith('two Synthetic Dinner', expect.any(AbortSignal));
    expect(f.store.log).not.toHaveBeenCalled();
  });
  it('derives exact label numbers and capture source from verified chat, never model arguments', async () => {
    const f = fixture(); f.session.channel = 'chat';
    f.request.jarvisConversationMessage = { ...source, text: 'Log yoghurt: 123 kcal, protein 4 g' };
    await f.tool.execute({ operation: 'log_exact' }, f.request, signal());
    expect(f.store.log.mock.calls[0]![0]).toMatchObject({ mealName: 'yoghurt', energyKcal: 123, proteinGrams: 4, fatGrams: null, captureMethod: 'text', confidence: 'accurate' });
    expect(f.store.lookupSaved).not.toHaveBeenCalled();
  });
  it('accepts a hosted agent only with the actual latest persisted Dan message', async () => {
    const f = fixture();
    f.request.principal = null; f.request.jarvisConversationMessage = undefined;
    f.request.agentPrincipal = { kind: 'jarvis-agent', objectId: owner, tenantId: owner };
    f.request.headers['x-jarvis-message-id'] = '42';
    await f.tool.execute(favoriteInput, f.request, signal());
    expect(f.getHistory).toHaveBeenCalledWith({ limit: 1 });
    f.request.headers['x-jarvis-message-id'] = '41';
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow('could not be verified');
    expect(f.store.log).toHaveBeenCalledTimes(1);
  });
  it.each([
    { userConfirmed: true }, { owner }, { name: 'Model-selected meal' }, { energyKcal: 1 }, { occurredAt: at.toISOString() },
    { idempotencyKey: 'model-key' }, { estimateAccepted: true },
  ])('rejects caller authority or quantities %j', async extra => {
    const f = fixture();
    await expect(f.tool.execute({ ...favoriteInput, ...extra }, f.request, signal())).rejects.toThrow();
    expect(f.nutrition).not.toHaveBeenCalled();
  });
  it.each(['Find Synthetic Dinner', 'Log Synthetic Dinner if approved'])('never upgrades message origin alone into intent: %s', async text => {
    const f = fixture(); f.request.jarvisConversationMessage = { ...source, text };
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow();
    expect(f.store.log).not.toHaveBeenCalled();
  });
  it('refuses history fallback, stale/closed/phone sessions, cancellation and persistence failure', async () => {
    const fallback = fixture(); fallback.store.lookupSaved.mockResolvedValue({ source: 'history', row: fallback.favorite });
    await expect(fallback.tool.execute(favoriteInput, fallback.request, signal())).rejects.toThrow('fallback');
    const stale = fixture(); stale.request.jarvisConversationMessage = { ...source, at: new Date(at.getTime() - 600_001) };
    await expect(stale.tool.execute(favoriteInput, stale.request, signal())).rejects.toThrow('no longer current');
    const phone = fixture(); phone.session.channel = 'phone';
    await expect(phone.tool.execute(favoriteInput, phone.request, signal())).rejects.toThrow('active verified');
    const closed = fixture(); closed.request.server.conversationStore!.getSession = vi.fn().mockResolvedValue({ ...closed.session, endedAt: at });
    await expect(closed.tool.execute(favoriteInput, closed.request, signal())).rejects.toThrow('active verified');
    const cancelled = fixture(); const controller = new AbortController(); controller.abort(new Error('synthetic cancel'));
    await expect(cancelled.tool.execute(favoriteInput, cancelled.request, controller.signal)).rejects.toThrow('synthetic cancel');
    const failed = fixture(); failed.store.log.mockRejectedValue(new Error('synthetic persistence failure'));
    await expect(failed.tool.execute(favoriteInput, failed.request, signal())).rejects.toThrow('synthetic persistence failure');
    for (const f of [fallback, stale, phone, closed, cancelled]) expect(f.store.log).not.toHaveBeenCalled();
  });
  it.each(['other', 'connector', 'runner', 'conflicting'])('refuses %s identity before accessing nutrition', async identity => {
    const f = fixture();
    if (identity === 'other') f.request.principal = { objectId: '22222222-2222-4222-8222-222222222222', tenantId: owner, displayName: 'Synthetic' };
    if (identity === 'connector') { f.request.principal = null; f.request.dailyConnectorPrincipal = { kind: 'jarvis-daily-connector', objectId: owner, tenantId: owner, clientId: owner, scopes: ['Daily.Nutrition.Write'] }; }
    if (identity === 'runner') f.request.runnerPrincipal = { kind: 'jarvis-runner', objectId: owner, tenantId: owner };
    if (identity === 'conflicting') f.request.agentPrincipal = { kind: 'jarvis-agent', objectId: owner, tenantId: owner };
    await expect(f.tool.execute(favoriteInput, f.request, signal())).rejects.toThrow();
    expect(f.nutrition).not.toHaveBeenCalled();
  });
});
