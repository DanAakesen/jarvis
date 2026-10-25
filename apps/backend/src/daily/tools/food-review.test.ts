import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { createOwnerInteractionService, type BrowserConfirmationDelivery, type ConfirmationActionKind } from '../../core/owner-interactions.js';
import { approvalDeciderFor } from '../../core/approval-interpreter.js';
import type { ConfirmationStore } from '../../database/confirmation-store.js';
import type { MealInput } from '../nutrition/model.js';
import { createToolRegistry, ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { fridaReference, type FridaLookup, type LookupComponent } from '../nutrition/frida.js';
import type { DailyFoodLookup } from '../query.js';
import { dailyFoodReviewTool } from './food-review.js';
import { foodReviewSchema } from '../nutrition/review.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { coreModule } from '../../core/index.js';
import { conversationModule } from '../../core/conversation.js';
import type { ConversationHistoryMessage, ConversationStore } from '../../core/conversation-store.js';
import {
  executeRealtimeCapabilityCall, VOICE_CAPABILITY_DISCOVERY_TOOL, VOICE_CAPABILITY_EXECUTION_TOOL,
} from '../../voice/realtime.js';

const owner = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-10-17T03:00:00Z');
const signal = () => new AbortController().signal;
const estimate = () => ({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic portion', energyKcal: 200 } } });
const photo = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'synthetic-food.jpg', contentType: 'image/jpeg', size: 1024 };
function syntheticLookup(input: readonly LookupComponent[]): FridaLookup {
  const components: FridaLookup['components'] = input.map((component, index) => {
    const unknowns: string[] = [];
    if (component.grams === null) unknowns.push('amount_missing');
    if (component.name === 'Synthetic unmatched food') unknowns.push('no_match');
    const match = component.grams === null || component.name === 'Synthetic unmatched food' ? null : {
      foodId: index + 1, name: `Frida ${component.name}`, grams: component.grams,
      values: { energyKcal: component.grams * 2, proteinGrams: component.name === 'Synthetic unknown macro' ? null : component.grams / 10,
        carbohydratesGrams: component.grams * 3, fatGrams: component.grams / 5, fiberGrams: component.grams / 10 },
      provenance: {
        energyKcal: { parameterId: 356, unit: 'kcal', sourceIds: [1], sourceFoodIds: [index + 1] },
        proteinGrams: { parameterId: 218, unit: 'g', sourceIds: [2], sourceFoodIds: [index + 1] },
        carbohydratesGrams: { parameterId: 172, unit: 'g', sourceIds: [3], sourceFoodIds: [index + 1] },
        fatGrams: { parameterId: 141, unit: 'g', sourceIds: [4], sourceFoodIds: [index + 1] },
        fiberGrams: { parameterId: 168, unit: 'g', sourceIds: [5], sourceFoodIds: [index + 1] },
      },
      retrievedAt: at.toISOString(),
    };
    if (match && match.values.proteinGrams === null) unknowns.push('nutrient_missing:proteinGrams');
    return { input: component, match, candidates: [], unknowns };
  });
  const subtotal = (key: keyof FridaLookup['totals']) => {
    const values = components.map(component => component.match?.values[key]);
    const known = values.filter((value): value is number => typeof value === 'number');
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  };
  const totals = {
    energyKcal: null, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
  } as FridaLookup['totals'];
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    const values = components.map(component => component.match?.values[key]);
    if (values.every(value => typeof value === 'number')) totals[key] = subtotal(key);
  }
  const matchedSubtotals = {
    energyKcal: subtotal('energyKcal'), proteinGrams: subtotal('proteinGrams'), carbohydratesGrams: subtotal('carbohydratesGrams'),
    fatGrams: subtotal('fatGrams'), fiberGrams: subtotal('fiberGrams'),
  };
  const unknowns = components.flatMap((component, index) => component.unknowns.map(value => `${index}:${value}`));
  return {
    status: unknowns.length ? 'partial' : 'complete', confirmationRequired: true, reference: fridaReference,
    components, totals, matchedSubtotals, unknowns,
  };
}
function row(input: MealInput, revision = '1', deletedAt: string | null = null): Record<string, unknown> {
  return {
    id: input.id, idempotency_key: input.idempotencyKey, meal_name: input.mealName, meal_type: input.mealType,
    components_json: JSON.stringify(input.components), nutrient_provenance_json: JSON.stringify(input.provenance),
    occurred_at: input.occurredAt, meal_date: new Date(`${input.mealDate}T00:00:00Z`), expires_at: input.expiresAt,
    energy_kcal: input.energyKcal, protein_grams: input.proteinGrams, carbohydrates_grams: input.carbohydratesGrams,
    fat_grams: input.fatGrams, fiber_grams: input.fiberGrams, confidence: input.confidence,
    capture_method: input.captureMethod, revision, deleted_at: deletedAt, private_field: 'must-not-escape',
  };
}
function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  let attachments = [] as typeof photo[];
  const store = {
    intake: vi.fn(async (key: string) => rows.get(key) ?? null),
    lookupSaved: vi.fn(async (): Promise<{ source: 'favorite'; row: Record<string, unknown> } | null> => null),
    log: vi.fn(async (input: MealInput) => { const saved = row(input); rows.set(input.idempotencyKey, saved); return saved; }),
    correct: vi.fn(async (input: MealInput, revision: bigint) => {
      const saved = row(input, (revision + 1n).toString()); rows.set(input.idempotencyKey, saved); return saved;
    }),
    remove: vi.fn(async (key: string, revision: bigint) => {
      const saved = { ...rows.get(key)!, revision: (revision + 1n).toString(), deleted_at: at.toISOString() }; rows.set(key, saved); return saved;
    }),
  };
  const decision = Promise.withResolvers<'approve' | 'reject'>();
  const staged = Promise.withResolvers<void>();
  const runConfirmed = vi.fn(async <T>(_kind: ConfirmationActionKind, _summary: string, action: () => Promise<T>,
    operationSignal?: AbortSignal, delivery?: BrowserConfirmationDelivery): Promise<T> => {
    expect(delivery).toMatchObject({ channel: 'browser', lifetimeSeconds: 120 });
    staged.resolve();
    const answer = await decision.promise;
    operationSignal?.throwIfAborted();
    if (answer !== 'approve') throw new ToolRefusal('Dan rejected the request.');
    return action();
  });
  const mode = { mode: 'present' };
  const session = { id: 'session', channel: 'voice', language: 'en', startedAt: at, endedAt: null };
  const source = { id: '42', sessionId: session.id, role: 'dan' as const, text: 'I ate a portion; please review it.', at, model: null };
  const conversationStore = {
    getSession: vi.fn(async () => session),
    getHistory: vi.fn(async () => ({ messages: [{ ...source, attachments }], nextCursor: null })),
    getDanMessagesAfter: vi.fn(async () => [] as { id: string; text: string; language: 'en' }[]),
  };
  const request = {
    server: { ownerObjectId: owner, conversationStore,
      awayModeStore: { read: vi.fn(async () => mode) }, ownerInteractions: { runConfirmed } },
    principal: { objectId: owner }, headers: {}, jarvisConversationMessage: source,
    validateInput: vi.fn(() => true), getValidationFunction: vi.fn(() => undefined), log: { info: vi.fn() },
  } as unknown as FastifyRequest;
  const nutrition = vi.fn(() => store);
  const lookup = vi.fn<DailyFoodLookup>(async components => syntheticLookup(components));
  const tool = dailyFoodReviewTool(nutrition, () => at.getTime(), lookup);
  const seed = (overrides: Partial<MealInput> = {}) => {
    const saved = row({ id: 'old', idempotencyKey: 'retained-key', mealName: 'Old meal', mealType: null, components: [],
      energyKcal: 100, proteinGrams: null, carbohydratesGrams: null, fatGrams: null, fiberGrams: null,
      occurredAt: '2026-01-01T23:30:00Z', mealDate: '2026-01-02', expiresAt: '9999-12-31T23:59:59Z',
      confidence: 'accurate', captureMethod: 'mixed', provenance: { energyKcal: { source: 'user-exact' } }, ...overrides });
    rows.set('retained-key', saved); return saved;
  };
  return { tool, request, store, conversationStore, nutrition, rows, runConfirmed, staged: staged.promise,
    approve: () => decision.resolve('approve'), reject: () => decision.resolve('reject'), mode, session, seed, lookup,
    setAttachments: (value: typeof photo[]) => { attachments = value; } };
}

async function executeThroughVoiceCapability(
  tool: ReturnType<typeof dailyFoodReviewTool>, request: FastifyRequest, input: unknown,
) {
  const registry = createToolRegistry([{ id: 'daily', tools: [tool] }]);
  const discovered = new Set<string>();
  const discovery = JSON.parse(await executeRealtimeCapabilityCall({
    type: 'response.function_call_arguments.done', name: VOICE_CAPABILITY_DISCOVERY_TOOL,
    call_id: 'food-review-discovery', arguments: '{}',
  }, registry, request, signal(), discovered, undefined, false));
  expect(discovery).toMatchObject({
    outcome: 'ok', result: { capabilities: [expect.objectContaining({ name: 'daily_food_review' })] },
  });
  return executeRealtimeCapabilityCall({
    type: 'response.function_call_arguments.done', name: VOICE_CAPABILITY_EXECUTION_TOOL,
    call_id: 'food-review-execution',
    arguments: JSON.stringify({ capability: 'daily_food_review', arguments: input }),
  }, registry, request, signal(), discovered, undefined, false);
}

describe('inactive internal food proposal review', () => {
  it.each([false, true])('routes mobile browser estimate → Log it through discovered tools (earlier refusal: %s)', async earlierRefusal => {
    const f = fixture();
    f.session.channel = 'chat';
    f.session.id = '41';
    const config = { ...loadConfig({}), logLevel: 'silent' as const };
    config.auth.ownerObjectId = owner;
    const messages: ConversationHistoryMessage[] = earlierRefusal ? [{
      id: '40', sessionId: '41', role: 'jarvis', text: 'Unavailable in a phone session. Use browser approval.',
      model: null, at, channel: 'chat', language: 'en', interrupted: false, voiceMinutes: null,
      toolCalls: [], attachments: [],
    }] : [];
    let nextId = 42;
    const conversationStore: ConversationStore = {
      createSession: vi.fn(async () => ({ ...f.session, channel: 'chat', language: 'en' })),
      endSession: vi.fn(async () => true),
      getSession: vi.fn(async () => ({ ...f.session, channel: 'chat', language: 'en' })),
      getDanMessageIdBySourceItemId: vi.fn(async () => null),
      addMessage: vi.fn(async input => {
        const message: ConversationHistoryMessage = { ...input, id: String(nextId++), at: new Date(),
          channel: 'chat', language: 'en', interrupted: false, voiceMinutes: null, toolCalls: [], attachments: [] };
        messages.push(message);
        return message;
      }),
      getHistory: vi.fn(async ({ limit }) => ({ messages: [...messages].reverse().slice(0, limit), nextCursor: null })),
      readRecentUserMessages: vi.fn(async () => []),
      getDanMessagesAfter: vi.fn(async ({ after }) => messages.filter(message => message.role === 'dan' && BigInt(message.id) > BigInt(after))
        .map(({ id, text }) => ({ id, text, language: 'en' as const }))),
    };
    const service = createOwnerInteractionService({ ownerObjectId: owner, conversationStore, store: {
      createConfirmation: vi.fn(async () => {}),
      resolveConfirmation: vi.fn(async () => 'approved'),
      consumeApproval: vi.fn(async () => true),
      cancelConfirmation: vi.fn(async () => {}),
      expireConfirmation: vi.fn(async () => false),
      expirePendingConfirmations: vi.fn(async () => {}),
    } });
    const tool = dailyFoodReviewTool(f.nutrition, Date.now, f.lookup);
    const ownerHeaders = { authorization: ['Bearer', 'owner.payload.signature'].join(' '), 'user-agent': 'Synthetic Mobile Browser' };
    const agentHeaders = { authorization: ['Bearer', 'agent.payload.signature'].join(' '), 'x-jarvis-message-id': '42' };
    const app = buildApp(config, undefined, {
      auth: async token => token.startsWith('agent.') ? { kind: 'jarvis-agent', objectId: 'agent', tenantId: config.auth.tenantId }
        : { objectId: owner, tenantId: config.auth.tenantId, displayName: 'Synthetic owner' },
      modules: [coreModule, conversationModule, { id: 'synthetic-food', registerRoutes: async () => {}, tools: [tool] }],
      conversationStore, ownerInteractions: service, awayModeStore: f.request.server.awayModeStore!,
      toolCallStore: { record: vi.fn(async () => {}) },
      conversationAgent: { stream: async function* () {
        const catalogue = await app.inject({ method: 'GET', url: '/tools', headers: agentHeaders });
        expect(catalogue.json()).toContainEqual(expect.objectContaining({
          name: 'daily_food_review', description: expect.stringContaining('a mobile browser is NOT a telephone call'),
        }));
        expect(service.pendingBrowserConfirmations()).toHaveLength(0);
        const lookup = await app.inject({ method: 'POST', url: '/tools/daily_food_review', headers: agentHeaders,
          payload: { change: { operation: 'lookup_components', components: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } } });
        expect(lookup.json()).toMatchObject({ outcome: 'ok', result: { intakeLogged: false } });
        expect(service.pendingBrowserConfirmations()).toHaveLength(0);
        const pending = app.inject({ method: 'POST', url: '/tools/daily_food_review', headers: agentHeaders,
          payload: { change: { operation: 'log_estimate', food: { mealName: 'Synthetic portion',
            referenceComponents: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } } } }).then(response => response.json());
        await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
        expect(f.store.log).not.toHaveBeenCalled();
        const reply = await app.inject({ method: 'POST', url: '/conversation/sessions/41/steer',
          headers: ownerHeaders, payload: { text: 'Log it', language: 'en' } });
        expect(reply.statusCode).toBe(202);
        const receipt = await pending;
        expect(receipt).toMatchObject({ outcome: 'ok', result: { status: 'committed',
          record: { energy_kcal: 200, capture_method: 'text' } } });
        yield JSON.stringify(receipt.result);
        expect(await service.resolveFoodEstimateReply!({ ...messages.find(message => message.id === '43')!, id: '44' },
          approvalDeciderFor(f.request), signal())).toBe(false);
      } },
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/conversation/sessions/41/turns',
        headers: ownerHeaders, payload: { text: 'Estimate this synthetic food portion.' } });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('committed');
      expect(response.body).not.toContain('event: error');
      expect(f.store.log).toHaveBeenCalledOnce();
      expect(service.pendingBrowserConfirmations()).toEqual([]);
    } finally { await app.close(); }
  });

  it('does not stage an estimate superseded by cancellation during reference preparation', async () => {
    const f = fixture();
    f.lookup.mockImplementation(async components => {
      f.conversationStore.getDanMessagesAfter.mockResolvedValue([{ id: '43', text: 'Cancel that.', language: 'en' }]);
      return syntheticLookup(components);
    });
    await expect(f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic portion',
      referenceComponents: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } } }, f.request, signal()))
      .rejects.toThrow('superseded');
    expect(f.runConfirmed).not.toHaveBeenCalled();
    expect(f.store.log).not.toHaveBeenCalled();
  });

  it.each([110_000, 121_000])('keeps preparation plus review inside the existing operation budget (%d ms review)', async reviewMs => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      const f = fixture();
      f.lookup.mockImplementation(async components => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return syntheticLookup(components);
      });
      const input = { change: { operation: 'log_estimate', food: { mealName: 'Synthetic portion',
        referenceComponents: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } } };
      const result = f.tool.execute(input, f.request, signal());
      const checked = reviewMs > 120_000 ? expect(result).rejects.toThrow() :
        expect(result).resolves.toMatchObject({ status: 'committed', record: { energy_kcal: 200 } });
      await vi.advanceTimersByTimeAsync(60_000);
      await f.staged;
      expect(f.store.log).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(reviewMs);
      f.approve();
      await checked;
      expect(f.store.log).toHaveBeenCalledTimes(reviewMs > 120_000 ? 0 : 1);
      expect(timeout).toHaveBeenCalledWith(180_000);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each(['chat', 'voice'])('commits the pending %s estimate from a natural reply once and recovers the receipt on retry', async channel => {
    const f = fixture();
    f.session.channel = channel;
    const confirmations: ConfirmationStore = {
      createConfirmation: vi.fn(async () => {}),
      resolveConfirmation: vi.fn(async (_id, _owner, _conversation, decision) => decision === 'approve' ? 'approved' : 'rejected'),
      consumeApproval: vi.fn(async () => true),
      cancelConfirmation: vi.fn(async () => {}),
      expireConfirmation: vi.fn(async () => false),
      expirePendingConfirmations: vi.fn(async () => {}),
    };
    const service = createOwnerInteractionService({ ownerObjectId: owner, store: confirmations,
      conversationStore: { getDanMessagesAfter: vi.fn(async () => [{ id: '43', text: 'yes, log that', language: 'en' }]) } });
    f.runConfirmed.mockImplementation((...args) => service.runConfirmed(...args));
    const result = channel === 'voice' ? executeThroughVoiceCapability(f.tool, f.request, estimate())
      : f.tool.execute(estimate(), f.request, signal());
    await vi.waitFor(() => expect(service.pendingBrowserConfirmations()).toHaveLength(1));
    expect(f.store.log).not.toHaveBeenCalled();
    const reply = { id: '43', sessionId: f.session.id, role: 'dan' as const,
      text: 'yes, log that', model: null, at: new Date() };
    expect(await service.resolveFoodEstimateReply!(reply, approvalDeciderFor(f.request), signal())).toBe(true);
    const receipt = await result;
    expect(channel === 'voice' ? JSON.parse(receipt as string).result : receipt).toMatchObject({
      status: 'committed', record: { meal_name: 'Synthetic portion', energy_kcal: 200, capture_method: channel === 'chat' ? 'text' : 'voice' },
    });
    expect(await service.resolveFoodEstimateReply!({ ...reply, id: '44' }, approvalDeciderFor(f.request), signal())).toBe(false);
    expect(await f.tool.execute(estimate(), f.request, signal())).toMatchObject({ status: 'committed' });
    expect(f.store.log).toHaveBeenCalledOnce();
    expect(confirmations.consumeApproval).toHaveBeenCalledOnce();
  });

  it('keeps estimate and correction writes behind browser approval through compact voice dispatch', async () => {
    const estimateFixture = fixture();
    const estimateResult = executeThroughVoiceCapability(estimateFixture.tool, estimateFixture.request, estimate());
    await estimateFixture.staged;
    expect(estimateFixture.store.log).not.toHaveBeenCalled();
    expect(estimateFixture.runConfirmed.mock.calls[0]![4]).toMatchObject({ channel: 'browser', lifetimeSeconds: 120,
      foodEstimate: { sessionId: 'session', sourceMessageId: '42' } });
    estimateFixture.approve();
    expect(JSON.parse(await estimateResult)).toMatchObject({
      tool: 'daily_food_review', outcome: 'ok', result: { status: 'committed' },
    });
    expect(estimateFixture.store.log).toHaveBeenCalledOnce();

    const correctionFixture = fixture();
    correctionFixture.seed();
    const correctionResult = executeThroughVoiceCapability(correctionFixture.tool, correctionFixture.request, {
      change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } },
    });
    await correctionFixture.staged;
    expect(correctionFixture.store.correct).not.toHaveBeenCalled();
    correctionFixture.reject();
    expect(JSON.parse(await correctionResult)).toMatchObject({
      tool: 'daily_food_review', outcome: 'refused', result: { refused: 'Dan rejected the request.' },
    });
    expect(correctionFixture.store.correct).not.toHaveBeenCalled();
  });
  it('preserves each operation and unknown versus zero through real Fastify/Ajv before strict tool validation', async () => {
    const app = Fastify();
    app.post('/synthetic-food-schema', { schema: { body: fixture().tool.inputSchema } }, async request => foodReviewSchema.parse(request.body));
    try {
      for (const input of [
        estimate(),
        { change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal', energyKcal: 0, proteinGrams: null, carbohydratesGrams: 0, fatGrams: null, fiberGrams: 0 } } },
        { change: { operation: 'lookup_components', components: [{ name: 'Synthetic food', grams: null, preparationMethod: null }] } },
        { change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal',
          referenceComponents: [{ name: 'Synthetic food', grams: 100, preparationMethod: 'boiled' }] } } },
        { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } } },
        { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { proteinGrams: null, fatGrams: 0 } } },
        { change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '1' } },
      ]) {
        const result = await app.inject({ method: 'POST', url: '/synthetic-food-schema', payload: input });
        expect(result.statusCode).toBe(200);
        expect(result.json()).toEqual(foodReviewSchema.parse(input));
      }
    } finally { await app.close(); }
  });
  it('writes only after the exact browser proposal is approved, retaining actual voice/null/confidence evidence', async () => {
    const f = fixture(); const input = estimate();
    const result = f.tool.execute(input, f.request, signal());
    await f.staged;
    expect(f.store.log).not.toHaveBeenCalled();
    expect(f.runConfirmed.mock.calls[0]![4]).toMatchObject({ channel: 'browser', lifetimeSeconds: 120,
      foodEstimate: { sessionId: 'session', sourceMessageId: '42' } });
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('energy 200 kcal');
    input.change.food.energyKcal = 999;
    f.approve();
    expect(await result).toMatchObject({ status: 'committed', record: { energy_kcal: 200, protein_grams: null, confidence: 'estimate', capture_method: 'voice' } });
    expect(f.store.log).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'estimate' }),
      { intent: 'log-intake', explicit: true, proposalRequired: true, estimateAccepted: true }, expect.any(AbortSignal));
    expect(JSON.stringify(await f.tool.execute(estimate(), f.request, signal()))).not.toContain('must-not-escape');
    expect(f.store.log).toHaveBeenCalledOnce(); expect(f.runConfirmed).toHaveBeenCalledOnce();
    expect(f.tool.sensitive).toBe(true); expect(f.tool.publicAllowedOnPhone).not.toBe(true); expect(f.tool.reflexSafe).not.toBe(true);
    expect(f.tool.denyOnPhone).toBe(true);
  });
  it('looks up read-only, recalculates edited components, and logs only the approved photo estimate', async () => {
    const f = fixture(); f.session.channel = 'chat'; f.setAttachments([photo]);
    const firstComponents = [{ name: 'Synthetic rice', grams: 100, preparationMethod: null }];
    const lookedUp = await f.tool.execute({ change: { operation: 'lookup_components', components: firstComponents } }, f.request, signal());
    expect(lookedUp).toMatchObject({ intakeLogged: false, status: 'complete', totals: { energyKcal: 200 } });
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.runConfirmed).not.toHaveBeenCalled();

    const changed = [{ name: 'Synthetic lentils', grams: 75, preparationMethod: 'boiled' }];
    const input = { change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal', referenceComponents: changed } } };
    const retry = structuredClone(input);
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged;
    expect(f.lookup).toHaveBeenLastCalledWith(changed, f.request, expect.any(AbortSignal));
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('energy 150 kcal');
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('"referenceFood":"Frida Synthetic lentils"');
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('DTU National Food Institute');
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('Capture: "photo"');
    expect(f.store.log).not.toHaveBeenCalled();
    input.change.food.referenceComponents[0]!.grams = 999;
    f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: {
      energy_kcal: 150, protein_grams: 7.5, capture_method: 'photo', confidence: 'estimate',
    } });
    expect(f.store.log.mock.calls[0]![0]).toMatchObject({
      components: [{ name: 'Synthetic lentils', grams: 75, preparationMethod: 'boiled',
        reference: { values: { energyKcal: 150 }, provenance: { energyKcal: { parameterId: 356 } } } }],
      provenance: { source: 'frida-estimate', independentlyVerified: false,
        reference: { provider: 'DTU Frida', version: '5.5' } },
    });
    expect(await f.tool.execute(retry, f.request, signal())).toMatchObject({ status: 'committed', record: { energy_kcal: 150 } });
    await expect(f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal',
      referenceComponents: [{ name: 'Synthetic lentils', grams: 80, preparationMethod: 'boiled' }] } } }, f.request, signal()))
      .rejects.toThrow('different committed intake');
    expect(f.store.log).toHaveBeenCalledOnce();
    expect(f.lookup).toHaveBeenCalledTimes(2);
  });
  it('returns missing quantities and unmatched foods as explicit uncertainty without staging or writing', async () => {
    const f = fixture(); f.session.channel = 'chat'; f.setAttachments([photo]);
    const missing = await f.tool.execute({ change: { operation: 'lookup_components',
      components: [{ name: 'Synthetic food', grams: null, preparationMethod: null }] } }, f.request, signal());
    expect(missing).toMatchObject({ intakeLogged: false, status: 'partial', unknowns: ['0:amount_missing'] });
    const unresolved = await f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal',
      referenceComponents: [{ name: 'Synthetic unmatched food', grams: 100, preparationMethod: null }] } } }, f.request, signal());
    expect(unresolved).toMatchObject({ status: 'needs_details', intakeLogged: false,
      lookup: { totals: { energyKcal: null }, unknowns: ['0:no_match'] } });
    expect(f.runConfirmed).not.toHaveBeenCalled(); expect(f.store.log).not.toHaveBeenCalled();
  });
  it('keeps unknown nutrients null and recovers failed lookups without claiming an estimate', async () => {
    const f = fixture(); f.session.channel = 'chat'; f.setAttachments([photo]);
    f.lookup.mockRejectedValueOnce(new ToolFailure('Synthetic provider failure'));
    await expect(f.tool.execute({ change: { operation: 'lookup_components',
      components: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } }, f.request, signal()))
      .rejects.toThrow('Synthetic provider failure');
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.runConfirmed).not.toHaveBeenCalled();

    f.lookup.mockRejectedValueOnce(new ToolFailure('Synthetic final lookup failure'));
    await expect(f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal',
      referenceComponents: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } } }, f.request, signal()))
      .rejects.toThrow('Synthetic final lookup failure');
    expect(f.store.log).not.toHaveBeenCalled(); expect(f.runConfirmed).not.toHaveBeenCalled();

    const pending = f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal',
      referenceComponents: [{ name: 'Synthetic unknown macro', grams: 100, preparationMethod: null }] } } }, f.request, signal());
    await f.staged;
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('protein unknown (not zero) g');
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('nutrient_missing:proteinGrams');
    f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { energy_kcal: 200, protein_grams: null } });
    expect(f.store.log.mock.calls[0]![0].provenance).toMatchObject({ unknowns: ['0:nutrient_missing:proteinGrams'] });
  });
  it('does not accept caller-forged photo attachments or perform lookup for another owner', async () => {
    const f = fixture();
    f.request.jarvisConversationMessage = { ...f.request.jarvisConversationMessage!, attachments: [photo] } as never;
    const pending = f.tool.execute(estimate(), f.request, signal());
    await f.staged;
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('Capture: "voice"');
    f.approve(); await pending;

    const other = fixture(); other.request.principal = { objectId: '22222222-2222-4222-8222-222222222222' };
    await expect(other.tool.execute({ change: { operation: 'lookup_components',
      components: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } }, other.request, signal())).rejects.toThrow();
    expect(other.lookup).not.toHaveBeenCalled();
  });
  it('binds persisted attachment identity to retries without exposing attachment names', async () => {
    const f = fixture(); f.session.channel = 'chat'; f.setAttachments([photo]);
    const input = { change: { operation: 'log_estimate', food: { mealName: 'Synthetic meal',
      referenceComponents: [{ name: 'Synthetic food', grams: 100, preparationMethod: null }] } } };
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged; f.approve(); await pending;
    const changedSource = { ...photo, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'different-private-name.jpg' };
    f.setAttachments([changedSource]);
    await expect(f.tool.execute(input, f.request, signal())).rejects.toThrow('different committed intake');
    expect(JSON.stringify(f.store.log.mock.calls[0]![0].provenance)).not.toContain('synthetic-food.jpg');
    expect(JSON.stringify(f.store.log.mock.calls[0]![0].provenance)).not.toContain('different-private-name.jpg');
    expect(f.store.log).toHaveBeenCalledOnce();
  });
  it('does not write after rejection and releases the pending guard', async () => {
    const f = fixture(); const result = f.tool.execute(estimate(), f.request, signal());
    const refused = expect(result).rejects.toThrow('rejected');
    await f.staged; f.reject(); await refused;
    expect(f.store.log).not.toHaveBeenCalled();
    await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow('rejected');
    expect(f.runConfirmed).toHaveBeenCalledTimes(2);
  });
  it('refuses overlapping review instead of showing duplicate or changed approval cards', async () => {
    const f = fixture(); const first = f.tool.execute(estimate(), f.request, signal());
    await f.staged;
    await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow('already awaiting');
    f.approve(); await first;
    expect(f.runConfirmed).toHaveBeenCalledOnce(); expect(f.store.log).toHaveBeenCalledOnce();
  });
  it('refuses presence changes or cancellation after staging without committing', async () => {
    const f = fixture(); const result = f.tool.execute(estimate(), f.request, signal());
    const refused = expect(result).rejects.toThrow('present');
    await f.staged; f.mode.mode = 'away'; f.approve(); await refused;
    expect(f.store.log).not.toHaveBeenCalled();
    const cancelled = fixture(); const controller = new AbortController();
    const pending = cancelled.tool.execute(estimate(), cancelled.request, controller.signal);
    const aborted = expect(pending).rejects.toThrow();
    await cancelled.staged; controller.abort(); cancelled.approve(); await aborted;
    expect(cancelled.store.log).not.toHaveBeenCalled();
  });
  it('refuses non-present, unavailable, stale and phone context before requesting review', async () => {
    for (const modify of [
      (f: ReturnType<typeof fixture>) => { f.mode.mode = 'away'; },
      (f: ReturnType<typeof fixture>) => { f.request.server.ownerInteractions = undefined; },
      (f: ReturnType<typeof fixture>) => { f.session.channel = 'phone'; },
      (f: ReturnType<typeof fixture>) => { f.request.jarvisConversationMessage = { ...f.request.jarvisConversationMessage!, at: new Date(at.getTime() - 600001) }; },
    ]) {
      const f = fixture(); modify(f);
      await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow();
      expect(f.runConfirmed).not.toHaveBeenCalled(); expect(f.store.log).not.toHaveBeenCalled();
    }
  });
  it('routes direct exact labels and actual saved favourites back to the one-step tool without another confirmation', async () => {
    const exact = fixture(); exact.request.jarvisConversationMessage!.text = 'Log yoghurt: 200 kcal';
    await expect(exact.tool.execute(estimate(), exact.request, signal())).rejects.toThrow('log_exact');
    expect(exact.runConfirmed).not.toHaveBeenCalled();
    const favorite = fixture(); favorite.request.jarvisConversationMessage!.text = 'Log my favourite Dinner';
    favorite.store.lookupSaved.mockResolvedValue({ source: 'favorite', row: {} });
    await expect(favorite.tool.execute(estimate(), favorite.request, signal())).rejects.toThrow('log_favorite');
    expect(favorite.runConfirmed).not.toHaveBeenCalled();
  });
  it('rejects forged input authority and a different owner before touching nutrition', async () => {
    const f = fixture();
    await expect(f.tool.execute({ ...estimate(), userConfirmed: true }, f.request, signal())).rejects.toThrow();
    f.request.principal = { objectId: 'different' };
    await expect(f.tool.execute(estimate(), f.request, signal())).rejects.toThrow();
    expect(f.nutrition).not.toHaveBeenCalled();
  });
  it('recovers only an actual source/payload-bound commit after an uncertain log', async () => {
    const f = fixture(); const persist = f.store.log.getMockImplementation()!;
    f.store.log.mockImplementationOnce(async input => { await persist(input); throw new ToolFailure('Synthetic uncertain commit'); });
    const pending = f.tool.execute(estimate(), f.request, signal());
    await f.staged; f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { energy_kcal: 200 } });
    await expect(f.tool.execute({ change: { operation: 'log_estimate', food: { mealName: 'Other', energyKcal: 1 } } }, f.request, signal())).rejects.toThrow('different committed intake');
    expect(f.store.log).toHaveBeenCalledOnce();
  });
  it('preserves an unverified failure rather than manufacturing success', async () => {
    const f = fixture(); f.store.log.mockRejectedValueOnce(new ToolFailure('Synthetic missing receipt'));
    const pending = f.tool.execute(estimate(), f.request, signal());
    const failed = expect(pending).rejects.toThrow('missing receipt');
    await f.staged; f.approve(); await failed;
    expect(f.rows.size).toBe(0);
  });
  it('corrects old history with the exact revision and does not repeat a source-bound committed correction', async () => {
    const f = fixture(); f.seed();
    const input = { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1',
      changes: { energyKcal: 222, occurredAt: '2026-01-02T23:30:00Z' } } };
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged;
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('energy 100 → 222 kcal');
    expect(f.store.correct).not.toHaveBeenCalled();
    f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { energy_kcal: 222, meal_date: '2026-01-03', revision: '2', confidence: 'estimate', capture_method: 'mixed' } });
    expect(await f.tool.execute(input, f.request, signal())).toMatchObject({ status: 'committed', record: { revision: '2' } });
    expect(f.runConfirmed).toHaveBeenCalledOnce(); expect(f.store.correct).toHaveBeenCalledOnce();
  });
  it('keeps a four-component photo meal name correction reviewable through the actual tool path', async () => {
    const f = fixture();
    const lookup = syntheticLookup([
      { name: 'Synthetic lentils', grams: 75, preparationMethod: 'boiled' },
      { name: 'Synthetic rice', grams: 120, preparationMethod: 'steamed' },
      { name: 'Synthetic spinach', grams: 40, preparationMethod: 'raw' },
      { name: 'Synthetic sauce', grams: 25, preparationMethod: null },
    ]);
    f.seed({
      mealName: 'Four component synthetic photo meal', components: lookup.components.map(({ input, match, unknowns }) => ({
        name: input.name, grams: input.grams, preparationMethod: input.preparationMethod,
        reference: match ? { foodId: match.foodId, name: match.name, values: match.values,
          provenance: match.provenance, retrievedAt: match.retrievedAt } : null,
        unknowns,
      })),
      energyKcal: lookup.totals.energyKcal ?? lookup.matchedSubtotals.energyKcal ?? 0,
      proteinGrams: lookup.totals.proteinGrams, carbohydratesGrams: lookup.totals.carbohydratesGrams,
      fatGrams: lookup.totals.fatGrams, fiberGrams: lookup.totals.fiberGrams,
      confidence: 'estimate', captureMethod: 'photo',
      provenance: { source: 'frida-estimate', independentlyVerified: false, reference: lookup.reference,
        matchedSubtotals: lookup.matchedSubtotals, unknowns: lookup.unknowns },
    });
    const input = { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1',
      changes: { mealName: 'Renamed synthetic photo meal' } } };
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged;
    const summary = f.runConfirmed.mock.calls[0]![1];
    expect(summary.length).toBeLessThanOrEqual(4000);
    expect(summary).toContain('"Four component synthetic photo meal" → "Renamed synthetic photo meal"');
    expect(summary).toContain('Record revision: 1');
    expect(summary).toContain('4 components unchanged');
    expect(summary).toContain('confidence: "estimate"');
    expect(summary).not.toContain('"before":');
    expect(summary).not.toContain('"after":');
    expect(f.store.correct).not.toHaveBeenCalled();
    f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: {
      meal_name: 'Renamed synthetic photo meal', energy_kcal: lookup.totals.energyKcal,
      revision: '2', confidence: 'estimate', capture_method: 'photo',
    } });
    expect(f.store.correct).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.arrayContaining([expect.objectContaining({ name: 'Synthetic lentils', grams: 75 })]),
      provenance: expect.objectContaining({ source: 'frida-estimate', independentlyVerified: false }),
    }), 1n, expect.any(AbortSignal));
  });
  it('refuses changes made while a correction was awaiting approval', async () => {
    const f = fixture(); const saved = f.seed();
    const pending = f.tool.execute({ change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { mealName: 'New' } } }, f.request, signal());
    const refused = expect(pending).rejects.toThrow('while approval was pending');
    await f.staged; saved.revision = '2'; f.approve(); await refused;
    expect(f.store.correct).not.toHaveBeenCalled();
  });
  it('recovers the identical committed correction when another instance finishes while its approval is pending', async () => {
    const f = fixture(); const original = structuredClone(f.seed());
    const input = { change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } } };
    const first = f.tool.execute(input, f.request, signal());
    await f.staged; f.approve(); const committed = await first;
    f.store.intake.mockResolvedValueOnce(original);
    const second = dailyFoodReviewTool(() => f.store, () => at.getTime());
    expect(await second.execute(input, f.request, signal())).toEqual(committed);
    expect(f.store.correct).toHaveBeenCalledOnce();
    expect(f.runConfirmed).toHaveBeenCalledTimes(2);
  });
  it('recovers an actual source-bound corrected row after an uncertain correction result', async () => {
    const f = fixture(); f.seed(); const persist = f.store.correct.getMockImplementation()!;
    f.store.correct.mockImplementationOnce(async (input, revision) => { await persist(input, revision); throw new ToolFailure('Synthetic uncertain correction'); });
    const pending = f.tool.execute({ change: { operation: 'correct', idempotencyKey: 'retained-key', expectedRevision: '1', changes: { energyKcal: 222 } } }, f.request, signal());
    await f.staged; f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { revision: '2', energy_kcal: 222 } });
    expect(f.store.correct).toHaveBeenCalledOnce();
  });
  it('recovers a real tombstone after an uncertain deletion result without another write', async () => {
    const f = fixture(); f.seed(); const persist = f.store.remove.getMockImplementation()!;
    f.store.remove.mockImplementationOnce(async (key, revision) => { await persist(key, revision); throw new ToolFailure('Synthetic uncertain deletion'); });
    const pending = f.tool.execute({ change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '1' } }, f.request, signal());
    await f.staged; f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { revision: '2', deleted_at: at.toISOString() } });
    expect(f.store.remove).toHaveBeenCalledOnce();
  });
  it('soft-deletes only after review, preserves the row and reports a real tombstone without another write', async () => {
    const f = fixture(); f.seed();
    const input = { change: { operation: 'delete', idempotencyKey: 'retained-key', expectedRevision: '1' } };
    const pending = f.tool.execute(input, f.request, signal());
    await f.staged; expect(f.store.remove).not.toHaveBeenCalled(); f.approve();
    expect(await pending).toMatchObject({ status: 'committed', record: { revision: '2', deleted_at: at.toISOString(), energy_kcal: 100 } });
    expect(await f.tool.execute(input, f.request, signal())).toMatchObject({ status: 'already-deleted', record: { revision: '2' } });
    expect(f.rows.size).toBe(1); expect(f.store.remove).toHaveBeenCalledOnce(); expect(f.runConfirmed).toHaveBeenCalledOnce();
  });
});
