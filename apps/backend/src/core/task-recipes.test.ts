import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createJevRecipePlanner, createRecipeSession, normalizeRecipeGoal, recipeId, recipeSiteKey,
  validRecipe, type RecipeDraft, type RecipeRuntime, type TaskRecipe,
} from './task-recipes.js';

const signal = new AbortController().signal;
const target = { role: 'button', name: 'Search' };
const draft: RecipeDraft = {
  kind: 'pc', key: 'sampleapp', goal: 'open search',
  steps: [{ operation: 'click', target }, { operation: 'done' }],
};
const recipe: TaskRecipe = { ...draft, id: recipeId(draft) };

function fixture(candidates: readonly TaskRecipe[] = [recipe]) {
  const log = vi.fn();
  const request = { log: { info: log }, routeOptions: { url: '/tools/pc_act' } } as unknown as FastifyRequest;
  const runtime: RecipeRuntime = {
    store: {
      list: vi.fn(async () => candidates),
      save: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
    },
    planner: {
      select: vi.fn(async () => ({ choice: recipe.id, confidence: 0.95 })),
      verify: vi.fn(async () => ({ choice: 'replay', confidence: 0.96 })),
    },
  };
  return { runtime, request, log };
}

describe('task recipes', () => {
  it('normalizes quoted values, generated text, URLs, emails and numbers; stores only the site origin', () => {
    expect(normalizeRecipeGoal(' Search for “hello” at https://site.test/private?q=hidden as user@site.test 123 '))
      .toBe('search for [value] at [site] as [value] [number]');
    expect(normalizeRecipeGoal('write hello there', ['hello there'])).toBe('write [value]');
    expect(recipeSiteKey('https://site.test/private?q=hidden#secret')).toBe('https://site.test');
    expect(recipeSiteKey('******site.test')).toBeUndefined();
    expect(recipeSiteKey('file:///private')).toBeUndefined();
  });

  it('re-locates a unique stable description with the new index and verifies every step', async () => {
    const { runtime, request, log } = fixture();
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal);
    expect(await session.propose('sampleapp', [{ index: 8, ...target }], signal))
      .toEqual({ operation: 'click', targetIndex: 8, confidence: 0.96 });
    expect(await session.propose('sampleapp', [], signal, { previousActions: ['click'] }))
      .toEqual({ operation: 'done', confidence: 0.96 });
    expect(runtime.planner.verify).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(call => call[0].phase)).toEqual(['recipe_select', 'recipe_verify', 'recipe_verify']);
    expect(JSON.stringify(log.mock.calls)).not.toContain('Search');
  });

  it.each(['missing', 'ambiguous', 'app changed', 'verifier drift'])('falls back on %s without executing a saved target', async drift => {
    const { runtime, request } = fixture();
    if (drift === 'verifier drift') {
      vi.mocked(runtime.planner.verify).mockResolvedValue({ choice: 'plan', confidence: 0.95 });
    }
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal);
    const elements = drift === 'missing' ? [] : drift === 'ambiguous'
      ? [{ index: 0, ...target }, { index: 1, ...target }] : [{ index: 0, ...target }];
    expect(await session.propose(drift === 'app changed' ? 'otherapp' : 'sampleapp', elements, signal))
      .toBeUndefined();
    expect(await session.propose('sampleapp', [{ index: 0, ...target }], signal)).toBeUndefined();
  });

  it('selects none without replaying, but asks Dan on low confidence or unknown choices', async () => {
    const { runtime, request } = fixture();
    vi.mocked(runtime.planner.select).mockResolvedValue({ choice: 'none', confidence: 0.95 });
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal);
    expect(await session.propose('sampleapp', [{ index: 0, ...target }], signal)).toBeUndefined();
    vi.mocked(runtime.planner.select).mockResolvedValue({ choice: 'none', confidence: 0.5 });
    await expect(createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal))
      .rejects.toThrow('Please clarify');
    vi.mocked(runtime.planner.select).mockResolvedValue({ choice: 'unknown', confidence: 0.95 });
    await expect(createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal))
      .rejects.toThrow('known task recipe');
  });

  it('asks Dan on low confidence verification instead of bypassing it through planning', async () => {
    const { runtime, request } = fixture();
    vi.mocked(runtime.planner.verify).mockResolvedValue({ choice: 'replay', confidence: 0.89 });
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal);
    await expect(session.propose('sampleapp', [{ index: 0, ...target }], signal)).rejects.toThrow('Please clarify');
  });

  it('logs only the typed provider failure without recipe content', async () => {
    const { runtime, request, log } = fixture();
    vi.mocked(runtime.planner.select).mockResolvedValue({ failure: 'billing' });
    await expect(createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal))
      .rejects.toThrow('valid recipe decision');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ reason: 'billing' }), 'reflex.decision');
    expect(JSON.stringify(log.mock.calls)).not.toContain('open search');
  });

  it('captures no text or selection values and uses new quoted values on replay', async () => {
    const { runtime, request } = fixture([]);
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'search for "first phrase"', request, signal);
    session.record('type', { role: 'edit', name: 'Query' }, { text: 'first phrase' });
    session.record('keys', undefined, { keys: ['Enter'] });
    session.record('done');
    await session.complete(signal);
    const saved = vi.mocked(runtime.store.save).mock.calls[0]![0];
    expect(JSON.stringify(saved)).not.toContain('first phrase');
    expect(saved.steps[0]).toEqual({ operation: 'type', target: { role: 'edit', name: 'Query' }, valueSlot: 0 });
    const savedRecipe = { ...saved, id: recipeId(saved) };
    vi.mocked(runtime.store.list).mockResolvedValue([savedRecipe]);
    vi.mocked(runtime.planner.select).mockResolvedValue({ choice: savedRecipe.id, confidence: 0.95 });
    const replay = await createRecipeSession(runtime, 'pc', 'sampleapp', 'search for "second phrase"', request, signal);
    expect(await replay.propose('sampleapp', [{ index: 4, role: 'edit', name: 'Query' }], signal))
      .toMatchObject({ text: 'second phrase', targetIndex: 4 });
  });

  it('allows browser text regeneration without persisting generated text', async () => {
    const { runtime, request } = fixture([]);
    const session = await createRecipeSession(runtime, 'browser', 'https://site.test', 'write a brief greeting', request, signal);
    session.record('type', { role: 'textbox', name: 'Message' }, { text: 'Good morning' });
    session.record('done');
    await session.complete(signal);
    const saved = vi.mocked(runtime.store.save).mock.calls[0]![0];
    expect(saved.steps[0]).toEqual({ operation: 'type', target: { role: 'textbox', name: 'Message' } });
    expect(JSON.stringify(saved)).not.toContain('Good morning');
  });

  it.each([
    { name: 'user@example.test', text: undefined },
    { name: 'Password', text: undefined },
    { name: 'Open first phrase', text: 'first phrase' },
    { name: '1234', text: undefined },
  ])('does not retain unsafe or value-echoing labels: $name', async ({ name, text }) => {
    const { runtime, request } = fixture([]);
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'search "first phrase"', request, signal);
    if (text) session.record('type', { role: 'edit', name: 'Query' }, { text });
    session.record('click', { role: 'button', name });
    session.record('done');
    await session.complete(signal);
    expect(runtime.store.save).not.toHaveBeenCalled();
  });

  it('does not save incomplete runs, unquoted PC values, or literal printable key sequences', async () => {
    for (const testCase of ['incomplete', 'unquoted', 'printable']) {
      const { runtime, request } = fixture([]);
      const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'search', request, signal);
      if (testCase === 'unquoted') session.record('type', { role: 'edit', name: 'Query' }, { text: 'private' });
      else if (testCase === 'printable') session.record('keys', undefined, { keys: ['a', 'b'] });
      else session.record('click', target);
      if (testCase !== 'incomplete') session.record('done');
      await session.complete(signal);
      expect(runtime.store.save).not.toHaveBeenCalled();
    }
  });

  it('rejects oversized, corrupted, sensitive and unknown persisted fields', () => {
    expect(validRecipe(recipe)).toBe(true);
    expect(validRecipe({ ...recipe, name: 'Find search' })).toBe(true);
    expect(validRecipe({ ...recipe, name: 'private token' })).toBe(false);
    expect(validRecipe({ ...recipe, name: '🔎'.repeat(80) })).toBe(true);
    expect(validRecipe({ ...recipe, name: '🔎'.repeat(81) })).toBe(false);
    expect(recipeId({ ...draft, name: 'Find search' })).toBe(recipe.id);
    expect(validRecipe({ ...recipe, text: 'private' })).toBe(false);
    expect(validRecipe({ ...recipe, steps: [{ operation: 'click', target, text: 'private' }, { operation: 'done' }] })).toBe(false);
    expect(validRecipe({ ...recipe, steps: Array(21).fill({ operation: 'wait' }) })).toBe(false);
    expect(validRecipe({ ...recipe, goal: 'password hidden' })).toBe(false);
    expect(validRecipe({ ...recipe, id: 'a'.repeat(64) })).toBe(false);
    for (const keys of [['+'], ['/'], ['Shift+A'], ['Shift++']]) {
      expect(validRecipe({ ...recipe, steps: [{ operation: 'keys', keys }, { operation: 'done' }] })).toBe(false);
    }
  });

  it('bounds cancellation and makes storage failures visible without false success', async () => {
    const { runtime, request } = fixture([]);
    const session = await createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, signal);
    session.record('click', target);
    session.record('done');
    vi.mocked(runtime.store.save).mockRejectedValue(new Error('private database details'));
    await expect(session.complete(signal)).rejects.toThrow('task completed, but');
    vi.mocked(runtime.store.list).mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = createRecipeSession(runtime, 'pc', 'sampleapp', 'open search', request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('could not be loaded');
  });
});

describe('Jev recipe choices', () => {
  function response(choice: string, confidence = 0.95) {
    return Response.json({ answers: { recipe: { type: 'choice', choice, confidence } } });
  }
  it('asks one typed selection among app candidates plus none and one typed verification per step', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(recipe.id)).mockResolvedValueOnce(response('replay'));
    const planner = createJevRecipePlanner(async () => 'offline-test', fetcher);
    expect(await planner.select({ kind: 'pc', key: 'sampleapp', goal: 'open search', candidates: [recipe] }, signal))
      .toEqual({ choice: recipe.id, confidence: 0.95 });
    const selection = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(Object.keys(selection.questions)).toEqual(['recipe']);
    expect(Object.keys(selection.questions.recipe.criteria)).toEqual(['none', recipe.id]);
    expect(await planner.verify({ goal: 'open search', key: 'sampleapp', step: draft.steps[0]!, elements: [] }, signal))
      .toEqual({ choice: 'replay', confidence: 0.95 });
    const verification = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    expect(Object.keys(verification.questions.recipe.criteria)).toEqual(['replay', 'plan']);
    expect(fetcher.mock.calls[0]![1]!.redirect).toBe('error');
  });
  it.each([
    () => response('invented'),
    () => response('none', 1.1),
    () => Response.json({ answers: { recipe: { type: 'text', choice: 'none', confidence: 0.95 } } }),
    () => new Response('x'.repeat(16_385), { headers: { 'content-type': 'application/json' } }),
  ])('rejects malformed, unknown and oversized choices', async makeResponse => {
    const planner = createJevRecipePlanner(async () => 'offline-test', vi.fn<typeof fetch>().mockResolvedValue(makeResponse()));
    expect(await planner.select({ kind: 'pc', key: 'sampleapp', goal: 'open search', candidates: [recipe] }, signal))
      .toEqual({ failure: 'invalid_answer' });
  });
  it('preserves explicit Jev failure statuses and bounds key lookup', async () => {
    const planner = createJevRecipePlanner(async () => 'offline-test', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 402 })));
    expect(await planner.select({ kind: 'pc', key: 'sampleapp', goal: 'open search', candidates: [recipe] }, signal))
      .toEqual({ failure: 'billing' });
    const controller = new AbortController();
    const pending = createJevRecipePlanner(() => new Promise(() => {}))
      .select({ kind: 'pc', key: 'sampleapp', goal: 'open search', candidates: [recipe] }, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ failure: 'timeout' });
    const network = createJevRecipePlanner(async () => 'offline-test', vi.fn<typeof fetch>().mockRejectedValue(new Error('private')));
    expect(await network.select({ kind: 'pc', key: 'sampleapp', goal: 'open search', candidates: [recipe] }, signal))
      .toEqual({ failure: 'network_error' });
  });
});
