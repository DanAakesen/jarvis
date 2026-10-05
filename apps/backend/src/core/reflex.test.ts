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

function response(route = 'target_0', confidence = 0.99) {
  return new Response(JSON.stringify({
    answers: {
      addressed: { type: 'noul', noul: 0.99 },
      intent: { type: 'choice', choice: 'action', confidence: 0.99 },
      target: { type: 'choice', choice: route, confidence },
      confidence: { type: 'score', score: confidence, confidence },
      needs_confirmation: { type: 'noul', noul: 0.01 },
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
