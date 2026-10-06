import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { KeySequence } from '../core/keyboard-actions.js';
import { recipeId, type RecipeDraft, type RecipeRuntime } from '../core/task-recipes.js';
import {
  createJevPcActPlanner,
  runPcAct,
  type PcActBridge,
  type PcActDecision,
  type PcActSnapshot,
} from './pc-act.js';

const snapshot: PcActSnapshot = {
  snapshotId: '1730aa51-f380-4df9-a345-1feb862cb1c4',
  application: 'vscode',
  elements: [{ index: 0, role: 'button', name: 'Open project' }],
};

function request(principal: 'agent' | 'other' = 'agent'): FastifyRequest {
  return {
    agentPrincipal: principal === 'agent' ? { objectId: 'jarvis' } : null,
    principal: principal === 'other' ? { objectId: 'someone-else' } : null,
    server: { ownerObjectId: 'dan' },
    log: { info: vi.fn() },
    routeOptions: { url: '/conversation/:sessionId/messages' },
  } as unknown as FastifyRequest;
}

function decision(
  operation: PcActDecision['operation'],
  targetIndex?: number,
  text?: string,
  keys?: KeySequence,
): PcActDecision {
  return {
    operation,
    confidence: 0.99,
    ...(targetIndex === undefined ? {} : { targetIndex }),
    ...(text === undefined ? {} : { text }),
    ...(keys === undefined ? {} : { keys }),
  };
}

function bridge(overrides: Partial<PcActBridge> = {}): PcActBridge {
  return {
    observe: vi.fn(async () => snapshot),
    act: vi.fn(async ({ action }) => ({ acted: true, action })),
    ...overrides,
  };
}

function jevResponse(answers: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ answers }), {
    headers: { 'content-type': 'application/json' },
  });
}

function recipes(draft?: RecipeDraft): RecipeRuntime {
  return {
    store: {
      list: vi.fn(async () => draft ? [{ ...draft, id: recipeId(draft) }] : []),
      save: vi.fn(async () => {}),
      delete: vi.fn(async () => false),
    },
    planner: {
      select: vi.fn(async () => ({ choice: draft ? recipeId(draft) : 'none', confidence: 0.99 })),
      verify: vi.fn(async () => ({ choice: 'replay', confidence: 0.99 })),
    },
  };
}

describe('PC task recipes', () => {
  it('measures full planning versus replay runs including recipe selection overhead', async () => {
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      let saved: RecipeDraft | undefined;
      const runtime = recipes();
      runtime.store.list = vi.fn(async () => {
        clock += 5;
        return saved ? [{ ...saved, id: recipeId(saved) }] : [];
      });
      runtime.store.save = vi.fn(async (draft) => { clock += 2; saved = draft; });
      runtime.planner.select = vi.fn(async () => {
        clock += 25;
        return { choice: recipeId(saved!), confidence: 0.99 };
      });
      runtime.planner.verify = vi.fn(async () => {
        clock += 10;
        return { choice: 'replay', confidence: 0.99 };
      });
      const decisions = [decision('click', 0), decision('done')];
      const planner = { decide: vi.fn(async () => { clock += 100; return decisions.shift()!; }) };
      const pc = bridge({
        observe: vi.fn(async () => { clock += 3; return snapshot; }),
        act: vi.fn(async ({ action }) => { clock += 7; return { acted: true, action }; }),
      });
      const planningRequest = request();
      const planningLog = vi.fn();
      planningRequest.log.info = planningLog;
      const replayRequest = request();
      const replayLog = vi.fn();
      replayRequest.log.info = replayLog;
      await runPcAct({ goal: 'Open project' }, planningRequest, new AbortController().signal, pc, { planner, recipes: runtime });
      await runPcAct({ goal: 'Open project' }, replayRequest, new AbortController().signal, pc, { planner, recipes: runtime });
      const planningMs = planningLog.mock.calls.find(([entry]) => entry.phase === 'recipe_run')![0].durationMs as number;
      const replayMs = replayLog.mock.calls.find(([entry]) => entry.phase === 'recipe_run')![0].durationMs as number;
      expect(planningMs).toBe(220);
      expect(replayMs).toBe(65);
      expect(replayMs).toBeLessThan(planningMs);
      expect(replayLog).toHaveBeenCalledWith({ phase: 'recipe_select', durationMs: 30 }, 'chat.latency');
      expect(planningLog.mock.calls.filter(([entry]) => entry.phase === 'recipe_plan'))
        .toEqual([[{ phase: 'recipe_plan', durationMs: 100 }, 'chat.latency'], [{ phase: 'recipe_plan', durationMs: 100 }, 'chat.latency']]);
      expect(replayLog).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'recipe_plan' }), 'chat.latency');
      expect(planner.decide).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('captures only successful completed runs without retaining entered values or snapshot indexes', async () => {
    const runtime = recipes();
    const pc = bridge({
      observe: vi.fn(async () => ({
        ...snapshot, elements: [{ index: 0, role: 'edit', name: 'Search' }],
      })),
    });
    const planner = {
      decide: vi.fn()
        .mockResolvedValueOnce(decision('type', 0, 'Alpha note'))
        .mockResolvedValueOnce(decision('done')),
    };
    const req = request();
    await runPcAct({ goal: 'Enter "Alpha note"' }, req, new AbortController().signal, pc, {
      planner, recipes: runtime,
    });
    expect(runtime.store.save).toHaveBeenCalledOnce();
    const persisted = vi.mocked(runtime.store.save).mock.calls[0]![0];
    expect(persisted).toMatchObject({
      kind: 'pc', key: 'vscode', goal: 'enter [value]',
      steps: [{ operation: 'type', target: { role: 'edit', name: 'Search' }, valueSlot: 0 }, { operation: 'done' }],
    });
    expect(JSON.stringify(persisted)).not.toContain('Alpha note');
    expect(JSON.stringify(persisted)).not.toContain('index');
    expect(req.log.info).toHaveBeenCalledWith({
      phase: 'recipe_plan', durationMs: expect.any(Number),
    }, 'chat.latency');
    expect(req.log.info).toHaveBeenCalledWith({
      phase: 'recipe_run', durationMs: expect.any(Number),
    }, 'chat.latency');
  });

  it('never saves unsuccessful actions', async () => {
    const runtime = recipes();
    await expect(runPcAct({ goal: 'Open project' }, request(), new AbortController().signal, bridge({
      act: vi.fn(async () => ({ acted: false, action: 'click' })),
    }), {
      planner: { decide: vi.fn(async () => decision('click', 0)) }, recipes: runtime,
    })).rejects.toThrow(/did not complete/u);
    expect(runtime.store.save).not.toHaveBeenCalled();
  });

  it('relocalizes every replay step against reordered fresh controls', async () => {
    const runtime = recipes({
      kind: 'pc', key: 'vscode', goal: 'open project',
      steps: [
        { operation: 'click', target: { role: 'button', name: 'Open project' } },
        { operation: 'click', target: { role: 'button', name: 'Open project' } },
        { operation: 'done' },
      ],
    });
    const pc = bridge({
      observe: vi.fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValue({
          ...snapshot,
          snapshotId: '2730aa51-f380-4df9-a345-1feb862cb1c4',
          elements: [
            { index: 0, role: 'button', name: 'Other' },
            { index: 1, role: 'button', name: 'Open project' },
          ],
        }),
    });
    const planner = { decide: vi.fn(async () => decision('blocked')) };
    const req = request();
    await runPcAct({ goal: 'Open project' }, req, new AbortController().signal, pc, { planner, recipes: runtime });
    expect(planner.decide).not.toHaveBeenCalled();
    expect(runtime.planner.select).toHaveBeenCalledOnce();
    expect(pc.act).toHaveBeenNthCalledWith(1, expect.objectContaining({ elementIndex: 0 }), expect.any(AbortSignal));
    expect(pc.act).toHaveBeenNthCalledWith(2, expect.objectContaining({
      elementIndex: 1, snapshotId: '2730aa51-f380-4df9-a345-1feb862cb1c4',
    }), expect.any(AbortSignal));
    expect(runtime.planner.verify).toHaveBeenCalledWith(expect.objectContaining({
      context: { previousActions: expect.any(Array) },
    }), expect.any(AbortSignal));
    expect(req.log.info).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'recipe_plan' }), 'chat.latency');
    expect(req.log.info).toHaveBeenCalledWith({
      phase: 'recipe_run', durationMs: expect.any(Number),
    }, 'chat.latency');
  });

  it('abandons replay after application drift and does not capture a cross-app run', async () => {
    const runtime = recipes({
      kind: 'pc', key: 'vscode', goal: 'open project',
      steps: [{ operation: 'click', target: { role: 'button', name: 'Open project' } }, { operation: 'done' }],
    });
    const pc = bridge({
      observe: vi.fn()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, application: 'explorer' })
        .mockResolvedValue(snapshot),
    });
    const planner = { decide: vi.fn().mockResolvedValueOnce(decision('click', 0)).mockResolvedValueOnce(decision('done')) };
    await runPcAct({ goal: 'Open project' }, request(), new AbortController().signal, pc, { planner, recipes: runtime });
    expect(planner.decide).toHaveBeenCalledTimes(2);
    expect(runtime.planner.verify).toHaveBeenCalledOnce();
    expect(runtime.store.save).not.toHaveBeenCalled();
  });

  it('refuses low-confidence replay instead of falling through to the normal planner', async () => {
    const runtime = recipes({
      kind: 'pc', key: 'vscode', goal: 'open project',
      steps: [{ operation: 'click', target: { role: 'button', name: 'Open project' } }, { operation: 'done' }],
    });
    runtime.planner.verify = vi.fn(async () => ({ choice: 'replay', confidence: 0.89 }));
    const pc = bridge();
    const planner = { decide: vi.fn(async () => decision('done')) };
    await expect(runPcAct({ goal: 'Open project' }, request(), new AbortController().signal, pc, {
      planner, recipes: runtime,
    })).rejects.toThrow(/not confident/u);
    expect(pc.act).not.toHaveBeenCalled();
    expect(planner.decide).not.toHaveBeenCalled();
    expect(runtime.store.save).not.toHaveBeenCalled();
  });

  it('keeps replayed irreversible clicks behind runConfirmed', async () => {
    const runtime = recipes({
      kind: 'pc', key: 'vscode', goal: 'delete item',
      steps: [{ operation: 'click', target: { role: 'button', name: 'Delete' } }, { operation: 'done' }],
    });
    const pc = bridge({
      observe: vi.fn(async () => ({ ...snapshot, elements: [{ index: 0, role: 'button', name: 'Delete' }] })),
    });
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
    await runPcAct({ goal: 'Delete item' }, request(), new AbortController().signal, pc, {
      planner: { decide: vi.fn(async () => decision('blocked')) }, recipes: runtime, runConfirmed,
    });
    expect(runConfirmed).toHaveBeenCalledOnce();
    expect(pc.act).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }), expect.any(AbortSignal));
  });
});

describe('pc_act Jev planner', () => {
  it('sends one bounded Jev decision the observed Windows controls and exact user-quoted values', async () => {
    const fetcher = vi.fn(async () => jevResponse({
      operation: { type: 'choice', choice: 'type', confidence: 0.99 },
      target: { type: 'choice', choice: 'element_0', confidence: 0.99 },
      text_value: { type: 'choice', choice: 'value_0', confidence: 0.99 },
    }));
    const planner = createJevPcActPlanner(async () => 'fake-key', fetcher);

    const result = await planner.decide({
      goal: 'Enter "Jarvis issue 205"',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal);

    expect(result).toEqual({
      operation: 'type', confidence: 0.99, targetIndex: 0, text: 'Jarvis issue 205',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('jev-latest');
    expect(JSON.stringify(body)).toContain('Jarvis issue 205');
    expect(JSON.stringify(body)).not.toContain('value:');
    expect(body.questions).not.toHaveProperty('confidence');
    expect(init?.redirect).toBe('error');
  });

  it.each([
    [402, 'billing'],
    [401, 'auth'],
    [429, 'rate_limited'],
    [503, 'http_503'],
  ] as const)('returns typed Jev HTTP failure %s as %s', async (status, failure) => {
    const planner = createJevPcActPlanner(async () => 'fake-key', async () => new Response(null, { status }));

    await expect(planner.decide({
      goal: 'Click the open button',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toEqual({ failure });
  });

  it('uses operation and target Choice confidence for the PC confidence gate', async () => {
    const planner = createJevPcActPlanner(async () => 'fake-key', async () => jevResponse({
      operation: { type: 'choice', choice: 'click', confidence: 0.99 },
      target: { type: 'choice', choice: 'element_0', confidence: 0.89 },
    }));

    await expect(planner.decide({
      goal: 'Click the open button',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toEqual({
      operation: 'click', confidence: 0.89,
    });
  });

  it('returns invalid_answer for an unlisted text Choice', async () => {
    const planner = createJevPcActPlanner(async () => 'fake-key', async () => jevResponse({
      operation: { type: 'choice', choice: 'type', confidence: 0.99 },
      target: { type: 'choice', choice: 'element_0', confidence: 0.99 },
      text_value: { type: 'choice', choice: 'value_9', confidence: 0.99 },
    }));

    await expect(planner.decide({
      goal: 'Enter "Jarvis issue 205"',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toEqual({ failure: 'invalid_answer' });
  });

  it('maps a closed-set keyboard Choice and includes app-specific shortcut hints', async () => {
    const fetcher = vi.fn(async () => jevResponse({
      operation: { type: 'choice', choice: 'keys', confidence: 0.99 },
      key_sequence: { type: 'choice', choice: 'keys_0', confidence: 0.97 },
    }));
    const planner = createJevPcActPlanner(async () => 'fake-key', fetcher);

    await expect(planner.decide({
      goal: 'Use Ctrl+P to open a file',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toEqual({
      operation: 'keys', confidence: 0.97, keys: ['Ctrl+P'],
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      state: { commonShortcuts: string[] };
      questions: { key_sequence: { criteria: Record<string, string> } };
    };
    expect(body.state.commonShortcuts).toContain('Ctrl+P opens Quick Open');
    expect(body.questions.key_sequence.criteria.keys_0).toBe('Ctrl+P');

    const laterChoicePlanner = createJevPcActPlanner(async () => 'fake-key', async () => jevResponse({
      operation: { type: 'choice', choice: 'keys', confidence: 0.99 },
      key_sequence: { type: 'choice', choice: 'keys_10', confidence: 0.99 },
    }));
    await expect(laterChoicePlanner.decide({
      goal: 'Press Escape',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toMatchObject({ operation: 'keys', keys: ['Escape'] });
  });

  it('maps type_focused only to an exact quoted non-sensitive Choice value', async () => {
    const planner = createJevPcActPlanner(async () => 'fake-key', async () => jevResponse({
      operation: { type: 'choice', choice: 'type_focused', confidence: 0.99 },
      text_value: { type: 'choice', choice: 'value_0', confidence: 0.98 },
    }));

    await expect(planner.decide({
      goal: 'Type "Daft Punk" in the focused search box',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toEqual({
      operation: 'type_focused', confidence: 0.98, text: 'Daft Punk',
    });
  });

  it('logs typed PC planner failures without the goal or Jev key', async () => {
    const log = { info: vi.fn() };
    const req = {
      ...request(),
      log,
      routeOptions: { url: '/conversation/:sessionId/messages' },
    } as unknown as FastifyRequest;

    await expect(runPcAct(
      { goal: 'Open this private project' },
      req,
      new AbortController().signal,
      bridge(),
      { planner: { decide: vi.fn(async () => ({ failure: 'auth' as const })) } },
    )).rejects.toThrow(/valid PC decision/u);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({
      source: 'chat',
      reason: 'auth',
    }), 'reflex.decision');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('private project');
  });

  it('refuses sensitive goals and missing Jev keys without making a request', async () => {
    const fetcher = vi.fn();
    const planner = createJevPcActPlanner(async () => 'fake-key', fetcher);

    await expect(planner.decide({
      goal: 'Type my password into the field',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toBeNull();
    await expect(planner.decide({
      goal: 'Review this record: 123-45-6789',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toBeNull();
    await expect(planner.decide({
      goal: 'Enter my SSN',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toBeNull();
    await expect(planner.decide({
      goal: 'Use this reference number: 123456',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();

    const withoutKey = createJevPcActPlanner(async () => undefined, fetcher);
    await expect(withoutKey.decide({
      goal: 'Click the open button',
      step: 1,
      previousActions: [],
      snapshot,
    }, new AbortController().signal)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('pc_act bounded Windows control loop', () => {
  it('controls any bounded foreground app and does not confirm reversible settings actions', async () => {
    const appSnapshot: PcActSnapshot = { ...snapshot, application: 'SystemSettings' };
    const pcBridge = bridge({ observe: vi.fn(async () => appSnapshot) });
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('click', 0))
      .mockResolvedValueOnce(decision('done')) };
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());

    const result = await runPcAct(
      { goal: 'Open Settings' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, runConfirmed },
    );

    expect(result.status).toBe('completed');
    expect(runConfirmed).not.toHaveBeenCalled();
    expect(pcBridge.act).toHaveBeenCalledWith(expect.objectContaining({
      action: 'click',
      confirmed: false,
    }), expect.any(AbortSignal));
  });

  it('uses one Jev decision for each fresh snapshot and logs only redacted step metadata', async () => {
    const pcBridge = bridge();
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('click', 0))
      .mockResolvedValueOnce(decision('done')) };
    const onStep = vi.fn();

    const result = await runPcAct(
      { goal: 'Open the project' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, onStep },
    );

    expect(result).toMatchObject({ status: 'completed', steps: 2 });
    expect(pcBridge.observe).toHaveBeenCalledTimes(2);
    expect(planner.decide).toHaveBeenCalledTimes(2);
    expect(pcBridge.act).toHaveBeenCalledWith({
      snapshotId: snapshot.snapshotId,
      elementIndex: 0,
      action: 'click',
      confirmed: false,
    }, expect.any(AbortSignal));
    expect(onStep.mock.calls.map(([event]) => event)).toEqual([
      { step: 1, action: 'click', outcome: 'completed' },
      { step: 2, action: 'done', outcome: 'completed' },
    ]);
    expect(JSON.stringify(onStep.mock.calls)).not.toMatch(/Open project|Jarvis|goal|text/iu);
  });

  it('searches and plays in a non-allow-listed foreground app without asking for confirmation', async () => {
    const spotifySnapshots: PcActSnapshot[] = [
      { ...snapshot, application: 'spotify', elements: [{ index: 0, role: 'edit', name: 'Search Spotify' }] },
      { ...snapshot, application: 'spotify', elements: [{ index: 0, role: 'button', name: 'Search' }] },
      { ...snapshot, application: 'spotify', elements: [{ index: 0, role: 'button', name: 'Play Daft Punk' }] },
      { ...snapshot, application: 'spotify', elements: [] },
    ];
    const pcBridge = bridge({
      observe: vi.fn()
        .mockResolvedValueOnce(spotifySnapshots[0])
        .mockResolvedValueOnce(spotifySnapshots[1])
        .mockResolvedValueOnce(spotifySnapshots[2])
        .mockResolvedValueOnce(spotifySnapshots[3]),
    });
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('type', 0, 'Daft Punk'))
      .mockResolvedValueOnce(decision('click', 0))
      .mockResolvedValueOnce(decision('click', 0))
      .mockResolvedValueOnce(decision('done')) };
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());

    const result = await runPcAct(
      { goal: 'Search Spotify for "Daft Punk" and play the result' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, runConfirmed },
    );

    expect(result.status).toBe('completed');
    expect(pcBridge.act).toHaveBeenNthCalledWith(1, {
      snapshotId: snapshot.snapshotId,
      elementIndex: 0,
      action: 'type',
      confirmed: false,
      text: 'Daft Punk',
    }, expect.any(AbortSignal));
    expect(pcBridge.act).toHaveBeenNthCalledWith(3, expect.objectContaining({
      action: 'click',
      confirmed: false,
    }), expect.any(AbortSignal));
    expect(runConfirmed).not.toHaveBeenCalled();
  });

  it('confirms irreversible keyboard chords and keeps chord/text content out of step logs', async () => {
    const pcBridge = bridge();
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('keys', undefined, undefined, ['Ctrl+Enter']))
      .mockResolvedValueOnce(decision('done')) };
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
    const onStep = vi.fn();

    const result = await runPcAct(
      { goal: 'Send the message with Ctrl+Enter' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, runConfirmed, onStep },
    );

    expect(result.status).toBe('completed');
    expect(runConfirmed).toHaveBeenCalledWith(
      'Send an irreversible keyboard action in vscode.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(pcBridge.act).toHaveBeenCalledWith({
      snapshotId: snapshot.snapshotId,
      action: 'keys',
      keys: ['Ctrl+Enter'],
      confirmed: true,
      closeIntent: false,
    }, expect.any(AbortSignal));
    expect(JSON.stringify(onStep.mock.calls)).not.toMatch(/Ctrl\+Enter|message/iu);
  });

  it('types explicitly quoted text into the focused Windows control without logging its value', async () => {
    const pcBridge = bridge();
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('type_focused', undefined, 'Daft Punk'))
      .mockResolvedValueOnce(decision('done')) };
    const onStep = vi.fn();

    await runPcAct(
      { goal: 'Type "Daft Punk" in the focused search field' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, onStep },
    );

    expect(pcBridge.act).toHaveBeenCalledWith({
      snapshotId: snapshot.snapshotId,
      action: 'type_focused',
      text: 'Daft Punk',
    }, expect.any(AbortSignal));
    expect(JSON.stringify(onStep.mock.calls)).not.toContain('Daft Punk');
  });

  it('does not confirm reversible submit, remove, or replace controls', async () => {
    for (const name of ['Submit', 'Remove', 'Replace']) {
      const pcBridge = bridge({
        observe: vi.fn(async () => ({
          ...snapshot,
          elements: [{ index: 0, role: 'button', name }],
        })),
      });
      const planner = { decide: vi.fn()
        .mockResolvedValueOnce(decision('click', 0))
        .mockResolvedValueOnce(decision('done')) };
      const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());

      await runPcAct(
        { goal: `Click ${name}` },
        request(),
        new AbortController().signal,
        pcBridge,
        { planner, runConfirmed },
      );

      expect(runConfirmed).not.toHaveBeenCalled();
      expect(pcBridge.act).toHaveBeenCalledWith(expect.objectContaining({ confirmed: false }), expect.any(AbortSignal));
    }
  });

  it('requires the existing approval flow for irreversible actions and retries the same observed target', async () => {
    const pcBridge = bridge({
      act: vi.fn()
        .mockResolvedValueOnce({
          confirmationRequired: true,
          actionKind: 'computer_use',
          summary: 'Activate a potentially destructive Windows control.',
        })
        .mockResolvedValueOnce({ acted: true, action: 'click' }),
    });
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('click', 0))
      .mockResolvedValueOnce(decision('done')) };

    const result = await runPcAct(
      { goal: 'Open this project' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, runConfirmed },
    );

    expect(result.status).toBe('completed');
    expect(runConfirmed).toHaveBeenCalledWith(
      'Click the button "Open project" in VS Code.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(pcBridge.act).toHaveBeenNthCalledWith(1, expect.objectContaining({ confirmed: false }), expect.any(AbortSignal));
    expect(pcBridge.act).toHaveBeenNthCalledWith(2, expect.objectContaining({ confirmed: true }), expect.any(AbortSignal));
  });

  it('pre-approves overwrite controls and identifies the exact action target', async () => {
    const overwriteSnapshot: PcActSnapshot = {
      ...snapshot,
      elements: [{ index: 0, role: 'button', name: 'Overwrite file' }],
    };
    const pcBridge = bridge({ observe: vi.fn(async () => overwriteSnapshot) });
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('click', 0))
      .mockResolvedValueOnce(decision('done')) };
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());

    const result = await runPcAct(
      { goal: 'Save the file' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, runConfirmed },
    );

    expect(result.status).toBe('completed');
    expect(runConfirmed).toHaveBeenCalledWith(
      'Click the button "Overwrite file" in VS Code.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(pcBridge.act).toHaveBeenNthCalledWith(1, expect.objectContaining({ confirmed: true }), expect.any(AbortSignal));
  });

  it('requires approval before replacing text when the goal is destructive', async () => {
    const fieldSnapshot: PcActSnapshot = {
      ...snapshot,
      elements: [{ index: 0, role: 'edit', name: 'Search' }],
    };
    const pcBridge = bridge({ observe: vi.fn(async () => fieldSnapshot) });
    const planner = { decide: vi.fn()
      .mockResolvedValueOnce(decision('type', 0, 'new title'))
      .mockResolvedValueOnce(decision('done')) };
    const runConfirmed = vi.fn(async (_summary: string, action: () => Promise<unknown>) => action());

    const result = await runPcAct(
      { goal: 'Overwrite the current title with "new title"' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner, runConfirmed },
    );

    expect(result.status).toBe('completed');
    expect(runConfirmed).toHaveBeenCalledWith(
      'Replace text in the edit "Search" in VS Code.',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(pcBridge.act).toHaveBeenNthCalledWith(1, {
      snapshotId: snapshot.snapshotId,
      elementIndex: 0,
      action: 'type',
      confirmed: true,
      text: 'new title',
    }, expect.any(AbortSignal));
  });

  it('never executes an irreversible action if the approval service is unavailable', async () => {
    const pcBridge = bridge({
      observe: vi.fn(async () => ({
        ...snapshot,
        elements: [{ index: 0, role: 'button', name: 'Delete project' }],
      })),
    });
    const planner = { decide: vi.fn().mockResolvedValue(decision('click', 0)) };

    await expect(runPcAct(
      { goal: 'Delete this project' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/approval service is unavailable/u);
    expect(pcBridge.act).not.toHaveBeenCalled();

    const typeBridge = bridge();
    await expect(runPcAct(
      { goal: 'Overwrite the current title with "new title"' },
      request(),
      new AbortController().signal,
      typeBridge,
      { planner: { decide: vi.fn().mockResolvedValue(decision('type', 0, 'new title')) } },
    )).rejects.toThrow(/approval service is unavailable/u);
    expect(typeBridge.act).not.toHaveBeenCalled();

    const keysBridge = bridge();
    await expect(runPcAct(
      { goal: 'Send the message with Ctrl+Enter' },
      request(),
      new AbortController().signal,
      keysBridge,
      { planner: { decide: vi.fn().mockResolvedValue(decision('keys', undefined, undefined, ['Ctrl+Enter'])) } },
    )).rejects.toThrow(/approval service is unavailable/u);
    expect(keysBridge.act).not.toHaveBeenCalled();
  });

  it('refuses injected text that was not explicitly quoted and refuses unverified callers', async () => {
    const pcBridge = bridge();
    const planner = { decide: vi.fn().mockResolvedValue(decision('type', 0, 'unquoted model text')) };

    await expect(runPcAct(
      { goal: 'Enter a value' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/quoted in the request/u);
    expect(pcBridge.act).not.toHaveBeenCalled();

    await expect(runPcAct(
      { goal: 'Click the button' },
      request('other'),
      new AbortController().signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/verified Dan session/u);
    expect(pcBridge.observe).toHaveBeenCalledOnce();
  });

  it('refuses sensitive identifier goals and sensitive labels returned by the bridge', async () => {
    const pcBridge = bridge();
    const planner = { decide: vi.fn().mockResolvedValue(decision('click', 0)) };

    await expect(runPcAct(
      { goal: 'Review this record: 123-45-6789' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/will not handle passwords, payment-card numbers, one-time codes, or sensitive identity numbers/u);
    expect(pcBridge.observe).not.toHaveBeenCalled();

    await expect(runPcAct(
      { goal: 'Use this reference number: 123456' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/sensitive identity numbers/u);
    expect(pcBridge.observe).not.toHaveBeenCalled();

    const sensitiveSnapshot: PcActSnapshot = {
      ...snapshot,
      elements: [{ index: 0, role: 'edit', name: 'Social Security Number' }],
    };
    const bridgeWithSensitiveSnapshot = bridge({ observe: vi.fn(async () => sensitiveSnapshot) });
    await expect(runPcAct(
      { goal: 'Open the project' },
      request(),
      new AbortController().signal,
      bridgeWithSensitiveSnapshot,
      { planner },
    )).rejects.toThrow(/safely observed/u);
    expect(planner.decide).not.toHaveBeenCalled();

    const numericSnapshot: PcActSnapshot = {
      ...snapshot,
      elements: [{ index: 0, role: 'edit', name: '123456' }],
    };
    const bridgeWithNumericSnapshot = bridge({ observe: vi.fn(async () => numericSnapshot) });
    await expect(runPcAct(
      { goal: 'Open the project' },
      request(),
      new AbortController().signal,
      bridgeWithNumericSnapshot,
      { planner },
    )).rejects.toThrow(/safely observed/u);
    expect(planner.decide).not.toHaveBeenCalled();
  });

  it('stops before observing when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const pcBridge = bridge();

    await expect(runPcAct(
      { goal: 'Open the project' },
      request(),
      controller.signal,
      pcBridge,
      { planner: { decide: vi.fn() } },
    )).rejects.toThrow(/stopped before completion/u);
    expect(pcBridge.observe).not.toHaveBeenCalled();
  });

  it('does not execute a decision returned after cancellation', async () => {
    const controller = new AbortController();
    const pcBridge = bridge();
    const planner = {
      decide: vi.fn(async () => {
        controller.abort();
        return decision('click', 0);
      }),
    };

    await expect(runPcAct(
      { goal: 'Open the project' },
      request(),
      controller.signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/stopped before completion/u);
    expect(pcBridge.act).not.toHaveBeenCalled();
  });

  it('stops after twenty actions without a completion decision', async () => {
    const pcBridge = bridge();
    const planner = { decide: vi.fn().mockResolvedValue(decision('click', 0)) };

    await expect(runPcAct(
      { goal: 'Open the project' },
      request(),
      new AbortController().signal,
      pcBridge,
      { planner },
    )).rejects.toThrow(/stopped after 20 steps/u);
    expect(pcBridge.observe).toHaveBeenCalledTimes(20);
    expect(planner.decide).toHaveBeenCalledTimes(20);
    expect(pcBridge.act).toHaveBeenCalledTimes(20);
  });
});
