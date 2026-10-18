import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import type { BrowserConfirmationDelivery, ConfirmationActionKind } from '../../core/owner-interactions.js';
import {
  emptyNutritionTargets, nutritionTargetBounds, nutritionTargetFields,
  type NutritionTargets, type NutritionTargetsPatch, type StoredNutritionTargets,
} from '../nutrition/targets.js';
import { dailyNutritionTargetsTool } from './nutrition-targets.js';

// Synthetic placeholders. They are not anyone's real figures.
const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const at = new Date('2026-10-17T10:00:00.000Z');
const signal = () => new AbortController().signal;
const synthetic: NutritionTargets = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };

afterEach(() => { vi.restoreAllMocks(); });

function fixture(initial: NutritionTargets = emptyNutritionTargets, options: { approval?: boolean } = {}) {
  let state: NutritionTargets = { ...initial };
  const snapshot = (): StoredNutritionTargets => ({
    targets: { ...state },
    updatedAt: Object.values(state).some((value) => value !== null) ? at.toISOString() : null,
  });
  const store = {
    read: vi.fn<(signal: AbortSignal) => Promise<StoredNutritionTargets>>(async () => snapshot()),
    write: vi.fn(async (patch: NutritionTargetsPatch, operationSignal: AbortSignal) => {
      operationSignal.throwIfAborted();
      state = { ...state, ...patch };
      return snapshot();
    }),
  };
  const access = vi.fn(() => store);
  const decisions: ReturnType<typeof Promise.withResolvers<'approve' | 'reject'>>[] = [];
  const runConfirmed = vi.fn(async <T>(_kind: ConfirmationActionKind, _summary: string, action: () => Promise<T>,
    _signal?: AbortSignal, delivery?: BrowserConfirmationDelivery): Promise<T> => {
    expect(delivery).toEqual({ channel: 'browser', lifetimeSeconds: 120 });
    const decision = Promise.withResolvers<'approve' | 'reject'>();
    decisions.push(decision);
    const answer = await decision.promise;
    if (answer !== 'approve') throw new ToolRefusal('Dan rejected the request.');
    return action();
  });
  const request = {
    principal: { objectId: owner }, headers: {},
    server: { ownerObjectId: owner, ...(options.approval === false ? {} : { ownerInteractions: { runConfirmed } }) },
  } as unknown as FastifyRequest;
  const tool = dailyNutritionTargetsTool(access);
  const begin = async (input: unknown, operationSignal = signal()) => {
    const active = tool.execute(input, request, operationSignal);
    const settled = active.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    await vi.waitFor(() => { expect(decisions.length).toBeGreaterThan(0); });
    const decision = decisions.shift()!;
    return {
      resolve: async (answer: 'approve' | 'reject' = 'approve') => {
        decision.resolve(answer);
        const result = await settled;
        if (result.error) throw result.error;
        return result.value;
      },
    };
  };
  return { tool, request, store, access, runConfirmed, begin };
}

describe('daily_nutrition_targets descriptor', () => {
  it('is private, phone-denied and carries no figures in its model-facing text', () => {
    const { tool } = fixture();
    expect(tool.name).toBe('daily_nutrition_targets');
    expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
    expect(tool.sensitive).toBe(true);
    expect(tool.denyOnPhone).toBe(true);
    expect(tool.bodyLimit).toBeLessThanOrEqual(4096);
    expect(tool.description.length).toBeLessThanOrEqual(4000);
    expect(tool.description).not.toMatch(/\d/u);
  });

  it('offers a plain object schema with read, set_targets and the three bounded, clearable targets', () => {
    const { tool } = fixture();
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['operation'] });
    const schema = tool.inputSchema as {
      properties: { operation: { enum: string[] }; targets: { additionalProperties: boolean; minProperties: number; properties: Record<string, unknown> } };
    };
    expect(schema.properties.operation.enum).toEqual(['read', 'set_targets']);
    expect(schema.properties.targets).toMatchObject({ additionalProperties: false, minProperties: 1 });
    expect(Object.keys(schema.properties.targets.properties)).toEqual([...nutritionTargetFields]);
    for (const field of nutritionTargetFields) {
      expect(schema.properties.targets.properties[field]).toMatchObject({
        type: ['integer', 'null'], minimum: nutritionTargetBounds[field].min, maximum: nutritionTargetBounds[field].max,
      });
    }
  });
});

describe('daily_nutrition_targets read', () => {
  it('reports needs-configuration with every target missing and asks for no approval', async () => {
    const f = fixture();
    expect(await f.tool.execute({ operation: 'read' }, f.request, signal())).toEqual({
      status: 'needs-configuration',
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null },
      missing: ['restingKcal', 'deficitKcal', 'proteinGrams'],
      updatedAt: null,
      bounds: nutritionTargetBounds,
      provenance: { store: 'daily-settings', enteredBy: 'owner' },
    });
    expect(f.runConfirmed).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('lists only the unset targets as missing while some are configured', async () => {
    const f = fixture({ restingKcal: 1750, deficitKcal: null, proteinGrams: 110 });
    expect(await f.tool.execute({ operation: 'read' }, f.request, signal())).toMatchObject({
      status: 'needs-configuration', missing: ['deficitKcal'], targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: 110 },
    });
  });

  it('reports configured once all three are set', async () => {
    const f = fixture(synthetic);
    expect(await f.tool.execute({ operation: 'read' }, f.request, signal())).toMatchObject({
      status: 'configured', missing: [], updatedAt: at.toISOString(), targets: synthetic,
    });
  });

  it('passes a store failure through with its safe message', async () => {
    const f = fixture();
    f.store.read.mockRejectedValueOnce(new ToolFailure('Nutrition targets are unavailable.'));
    await expect(f.tool.execute({ operation: 'read' }, f.request, signal())).rejects.toThrow('Nutrition targets are unavailable.');
  });
});

describe('daily_nutrition_targets input', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'read'],
    ['no operation', {}],
    ['an unknown operation', { operation: 'delete' }],
    ['a read with targets', { operation: 'read', targets: { restingKcal: 1750 } }],
    ['a read with an extra field', { operation: 'read', owner: stranger }],
    ['a set without targets', { operation: 'set_targets' }],
    ['a set with no named target', { operation: 'set_targets', targets: {} }],
    ['an estimated field', { operation: 'set_targets', targets: { bmr: 1700 } }],
    ['an out-of-range value', { operation: 'set_targets', targets: { restingKcal: 99999 } }],
    ['a numeric string', { operation: 'set_targets', targets: { restingKcal: '1750' } }],
    ['a fractional value', { operation: 'set_targets', targets: { restingKcal: 1750.5 } }],
    ['an owner override', { operation: 'set_targets', targets: { restingKcal: 1750 }, owner: stranger }],
  ])('refuses %s without asking for approval or writing', async (_label, input) => {
    const f = fixture();
    await expect(f.tool.execute(input, f.request, signal())).rejects.toBeInstanceOf(ToolRefusal);
    expect(f.runConfirmed).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('keeps a submitted value out of the refusal it shows', async () => {
    const f = fixture();
    const failure = await f.tool.execute({ operation: 'set_targets', targets: { restingKcal: 987654 } }, f.request, signal())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolRefusal);
    expect((failure as Error).message).not.toContain('987654');
  });
});

describe('daily_nutrition_targets authority', () => {
  it('denies anyone who is not the owner before the store is opened', async () => {
    const f = fixture();
    const other = { ...f.request, principal: { objectId: stranger } } as unknown as FastifyRequest;
    await expect(f.tool.execute({ operation: 'read' }, other, signal())).rejects.toBeInstanceOf(AuthenticationDenied);
    expect(f.access).not.toHaveBeenCalled();
  });

  it('refuses the external connector and points it at its own boundary', async () => {
    const f = fixture();
    const connector = {
      ...f.request, principal: undefined, dailyConnectorPrincipal: { kind: 'jarvis-daily-connector', objectId: owner },
    } as unknown as FastifyRequest;
    await expect(f.tool.execute({ operation: 'read' }, connector, signal())).rejects.toThrow(/separate nutrition connector boundary/u);
    expect(f.access).not.toHaveBeenCalled();
  });

  it('refuses before reading when the signal is already aborted', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort(new Error('Already gone'));
    await expect(f.tool.execute({ operation: 'read' }, f.request, controller.signal)).rejects.toThrow('Already gone');
    expect(f.store.read).not.toHaveBeenCalled();
  });

  it('bounds the whole operation to the same three minutes as the other approved Daily writes', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const f = fixture();
    await f.tool.execute({ operation: 'read' }, f.request, signal());
    expect(timeout).toHaveBeenCalledWith(180_000);
    timeout.mockRestore();
  });
});

describe('daily_nutrition_targets set_targets', () => {
  it('shows the exact change in the owner browser and writes only after approval', async () => {
    const f = fixture({ restingKcal: 1750, deficitKcal: null, proteinGrams: null });
    const review = await f.begin({ operation: 'set_targets', targets: { restingKcal: 1800, proteinGrams: 110 } });
    expect(f.store.write).not.toHaveBeenCalled();
    const [kind, summary] = f.runConfirmed.mock.calls[0]!;
    expect(kind).toBe('other');
    expect(summary).toContain('Resting energy burn: 1750 kcal → 1800 kcal');
    expect(summary).toContain('Protein target: not set → 110 g');
    expect(summary).not.toContain('Daily deficit');
    expect(summary).toContain('Nothing has changed yet.');
    expect(summary.length).toBeLessThanOrEqual(4000);
    expect(await review.resolve()).toMatchObject({
      status: 'committed', changed: ['restingKcal', 'proteinGrams'], missing: ['deficitKcal'],
      targets: { restingKcal: 1800, deficitKcal: null, proteinGrams: 110 },
    });
    expect(f.store.write).toHaveBeenCalledOnce();
    expect(f.store.write.mock.calls[0]![0]).toEqual({ restingKcal: 1800, proteinGrams: 110 });
  });

  it('shows a clear as a move to not set and deletes only that target on approval', async () => {
    const f = fixture(synthetic);
    const review = await f.begin({ operation: 'set_targets', targets: { deficitKcal: null } });
    expect(f.runConfirmed.mock.calls[0]![1]).toContain('Daily deficit: 350 kcal → not set');
    expect(await review.resolve()).toMatchObject({
      status: 'committed', changed: ['deficitKcal'], missing: ['deficitKcal'], targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: 110 },
    });
    expect(f.store.write.mock.calls[0]![0]).toEqual({ deficitKcal: null });
  });

  it('writes nothing when the owner rejects the review', async () => {
    const f = fixture(synthetic);
    const review = await f.begin({ operation: 'set_targets', targets: { restingKcal: 1800 } });
    await expect(review.resolve('reject')).rejects.toBeInstanceOf(ToolRefusal);
    expect(f.store.write).not.toHaveBeenCalled();
    expect(await f.tool.execute({ operation: 'read' }, f.request, signal())).toMatchObject({ targets: synthetic });
  });

  it('writes nothing when the call is cancelled while the review is open', async () => {
    const f = fixture(synthetic);
    const controller = new AbortController();
    const review = await f.begin({ operation: 'set_targets', targets: { restingKcal: 1800 } }, controller.signal);
    controller.abort(new Error('Conversation ended'));
    await expect(review.resolve('approve')).rejects.toThrow('Conversation ended');
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('answers unchanged without a review when the named values already match', async () => {
    const f = fixture(synthetic);
    expect(await f.tool.execute({ operation: 'set_targets', targets: { restingKcal: synthetic.restingKcal } }, f.request, signal()))
      .toMatchObject({ status: 'unchanged', targets: synthetic });
    expect(f.runConfirmed).not.toHaveBeenCalled();
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('answers unchanged when clearing a target that is already unset', async () => {
    const f = fixture();
    expect(await f.tool.execute({ operation: 'set_targets', targets: { proteinGrams: null } }, f.request, signal()))
      .toMatchObject({ status: 'unchanged' });
    expect(f.runConfirmed).not.toHaveBeenCalled();
  });

  it('refuses to change anything when Now approval is unavailable', async () => {
    const f = fixture(emptyNutritionTargets, { approval: false });
    await expect(f.tool.execute({ operation: 'set_targets', targets: { restingKcal: 1750 } }, f.request, signal()))
      .rejects.toThrow('Now approval is unavailable. No nutrition target was changed.');
    expect(f.store.write).not.toHaveBeenCalled();
  });

  it('refuses a second review while one is waiting and accepts a new one once it is resolved', async () => {
    const f = fixture(synthetic);
    const first = await f.begin({ operation: 'set_targets', targets: { restingKcal: 1800 } });
    await expect(f.tool.execute({ operation: 'set_targets', targets: { deficitKcal: 400 } }, f.request, signal()))
      .rejects.toThrow(/already waiting for approval/u);
    expect(f.runConfirmed).toHaveBeenCalledOnce();
    await first.resolve('reject').catch(() => undefined);
    const second = await f.begin({ operation: 'set_targets', targets: { deficitKcal: 400 } });
    expect(await second.resolve()).toMatchObject({ status: 'committed', changed: ['deficitKcal'] });
  });

  it('releases the review slot when the write fails after approval and reports the safe failure', async () => {
    const f = fixture(synthetic);
    f.store.write.mockRejectedValueOnce(new ToolFailure('Nutrition targets could not be saved. Read them to check the current values before retrying.'));
    const review = await f.begin({ operation: 'set_targets', targets: { restingKcal: 1800 } });
    await expect(review.resolve()).rejects.toThrow(/could not be saved/u);
    const retry = await f.begin({ operation: 'set_targets', targets: { restingKcal: 1800 } });
    expect(await retry.resolve()).toMatchObject({ status: 'committed' });
  });
});
