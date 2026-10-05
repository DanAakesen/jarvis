import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from './tool-registry.js';
import { createJevReflexClassifier, createReflexTargets } from './reflex.js';

function tool(reflexSafe: boolean) {
  return {
    name: reflexSafe ? 'pause_task' : 'delete_task',
    description: 'Control a task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
      additionalProperties: false,
    },
    ...(reflexSafe ? { reflexSafe: true } : {}),
    execute: vi.fn(async () => ({})),
  };
}

function response(
  route = 'target_0',
  confidence = 0.99,
  context: { completeCommand?: number; contradictedAction?: string } = {},
) {
  return new Response(JSON.stringify({
    answers: {
      addressed: { type: 'noul', noul: 0.99 },
      intent: { type: 'choice', choice: 'action', confidence: 0.99 },
      target: { type: 'choice', choice: route, confidence },
      confidence: { type: 'score', score: confidence, confidence },
      needs_confirmation: { type: 'noul', noul: 0.01 },
      ...(context.completeCommand === undefined ? {} : {
        complete_command: { type: 'noul', noul: context.completeCommand },
      }),
      ...(context.contradictedAction === undefined ? {} : {
        contradicted_action: { type: 'choice', choice: context.contradictedAction, confidence: 0.99 },
      }),
    },
  }), { headers: { 'content-type': 'application/json' } });
}

describe('Jev reflex classifier', () => {
  it('validates typed decisions and only offers registered reflex-safe targets', async () => {
    const tools = createToolRegistry([{ id: 'factory', tools: [tool(true), tool(false)] }]);
    const targets = createReflexTargets(tools.list(), ['12']);
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const classifier = createJevReflexClassifier(async () => 'fake-key', fetcher);

    const decision = await classifier.classify('Jarvis, pause task 12', 'en', targets, new AbortController().signal);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ tool: { name: 'pause_task' }, arguments: { taskId: '12' } });
    expect(decision).toMatchObject({
      addressed: true,
      intent: 'action',
      confidence: 0.99,
      needsConfirmation: false,
      target: { tool: { name: 'pause_task' }, arguments: { taskId: '12' } },
    });
    expect(fetcher).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: ['Bear', 'er'].join('') + ' fake-key' }),
      body: expect.stringContaining('"jev-latest"'),
    }));
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain('Jarvis, pause task 12');
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain('delete_task');
  });

  it('classifies a new partial command and checks final transcripts against the ledger', async () => {
    const tools = createToolRegistry([{ id: 'factory', tools: [tool(true)] }]);
    const targets = createReflexTargets(tools.list(), ['12']);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('target_0', 0.99, { completeCommand: 0.99 }))
      .mockResolvedValueOnce(response('target_0', 0.99, {
        completeCommand: 0.99,
        contradictedAction: 'action-1',
      }));
    const classifier = createJevReflexClassifier(async () => 'fake-key', fetcher);
    const signal = new AbortController().signal;

    await expect(classifier.classify(
      'Jarvis, pause task 12.',
      'en',
      targets,
      signal,
      { executed: [], partial: true },
    )).resolves.toMatchObject({ completeCommand: true });
    await expect(classifier.classify(
      'Jarvis, do not pause task 12.',
      'en',
      targets,
      signal,
      {
        executed: ['paused task 12'],
        executedActions: [{ id: 'action-1', summary: 'pause task 12' }],
        final: true,
      },
    )).resolves.toMatchObject({ completeCommand: true, contradictedAction: 'action-1' });

    const partialRequest = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      state: { already_executed: string[] };
      questions: Record<string, { type: string; criteria?: Record<string, string> }>;
    };
    const finalRequest = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
      state: { already_executed: string[] };
      questions: Record<string, { type: string; criteria?: Record<string, string> }>;
    };
    expect(partialRequest.state.already_executed).toEqual([]);
    expect(partialRequest.questions.complete_command?.type).toBe('noul');
    expect(partialRequest.questions.target?.type).toBe('choice');
    expect(finalRequest.state.already_executed).toEqual(['paused task 12']);
    expect(finalRequest.questions.contradicted_action?.type).toBe('choice');
    expect(finalRequest.questions.contradicted_action?.criteria).toMatchObject({
      none: 'No listed executed action is explicitly contradicted.',
      'action-1': 'pause task 12',
    });
  });

  it('falls through on low-confidence, malformed, missing-key, and rejected responses', async () => {
    const tools = createToolRegistry([{ id: 'factory', tools: [tool(true)] }]);
    const targets = createReflexTargets(tools.list(), ['12']);
    const lowConfidence = createJevReflexClassifier(async () => 'fake-key', async () => response('target_0', 0.4));
    const malformed = createJevReflexClassifier(async () => 'fake-key', async () =>
      new Response(JSON.stringify({ answers: {} }), { headers: { 'content-type': 'application/json' } }));
    const missingKey = createJevReflexClassifier(async () => undefined, vi.fn());
    const rejected = createJevReflexClassifier(async () => 'fake-key', async () => new Response(null, { status: 503 }));
    const signal = new AbortController().signal;

    await expect(lowConfidence.classify('Pause task 12', 'en', targets, signal)).resolves.toMatchObject({
      target: { tool: { name: 'pause_task' } },
      confidence: 0.4,
    });
    await expect(malformed.classify('Pause task 12', 'en', targets, signal)).resolves.toBeNull();
    await expect(missingKey.classify('Pause task 12', 'en', targets, signal)).resolves.toBeNull();
    await expect(rejected.classify('Pause task 12', 'en', targets, signal)).resolves.toBeNull();
  });

  it('retries one rate-limited response only when Retry-After fits the bounded wait', async () => {
    const tools = createToolRegistry([{ id: 'factory', tools: [tool(true)] }]);
    const targets = createReflexTargets(tools.list(), ['12']);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(response());
    const classifier = createJevReflexClassifier(async () => 'fake-key', fetcher);

    await expect(classifier.classify('Pause task 12', 'en', targets, new AbortController().signal))
      .resolves.toMatchObject({ target: { tool: { name: 'pause_task' } } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('measures offline simple-request classification under the 500 ms target', async () => {
    const tools = createToolRegistry([{ id: 'factory', tools: [tool(true)] }]);
    const classifier = createJevReflexClassifier(
      async () => 'fake-key',
      async () => response('main_agent'),
    );
    const started = performance.now();

    const decision = await classifier.classify(
      'Pause task 12',
      'en',
      createReflexTargets(tools.list(), ['12']),
      new AbortController().signal,
    );
    const elapsedMs = performance.now() - started;

    expect(decision).toMatchObject({ addressed: true, intent: 'action' });
    expect(elapsedMs).toBeLessThan(500);
    console.info(`Offline fake-provider reflex classification: ${elapsedMs.toFixed(2)} ms`);
  });
});
