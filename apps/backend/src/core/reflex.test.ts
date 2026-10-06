import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createToolRegistry } from './tool-registry.js';
import {
  createBrowserUrlTargets,
  createJevReflexClassifier,
  createReflexTargets,
  findChatReflexReplay,
  registerChatReflex,
  reflexActionSignature,
  workspaceReflexSafe,
  logReflexDecision,
  reflexTargets,
} from './reflex.js';
import { workspaceCommandTool } from './workspace-commands.js';
import { isWorkspaceCommand } from '@jarvis/contracts';

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

function browserTool() {
  return {
    name: 'browser_do',
    description: 'Work in Chrome.',
    inputSchema: {
      type: 'object',
      properties: { goal: { type: 'string' } },
      required: ['goal'],
      additionalProperties: false,
    },
    reflexSafe: true,
    execute: vi.fn(async () => ({})),
  };
}

function pcOpenTool() {
  return {
    name: 'pc_open',
    description: 'Open files and apps; websites open in Dan’s Chrome.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['url', 'app', 'folder', 'window'] },
        value: { type: 'string' },
      },
      required: ['target', 'value'],
      additionalProperties: false,
    },
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
  it('does not let slow task discovery consume the workspace classification budget', async () => {
    vi.useFakeTimers();
    try {
      const registry = createToolRegistry([{ id: 'test', tools: [tool(true), workspaceCommandTool] }]);
      const request = {
        principal: { objectId: 'owner' },
        server: {
          jarvisTools: registry,
          workspaceCommands: { snapshot: () => ({ windows: [], contextPanelOpen: false }) },
          taskStore: { list: () => new Promise(() => {}) },
        },
      } as unknown as FastifyRequest;
      const pending = reflexTargets(request, 'tile my windows');
      await vi.advanceTimersByTimeAsync(150);
      const targets = await pending;
      expect(targets).toContainEqual(expect.objectContaining({
        arguments: expect.objectContaining({ operation: 'layout', arrangement: 'tiled' }),
      }));
      expect(targets.some(({ tool }) => tool.name === 'pause_task')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [0.4, '<0.5'], [0.5, '0.5–0.8'], [0.8, '0.5–0.8'], [0.9, '>0.8'],
  ])('logs confidence %s as %s and explains skipped decisions', (confidence, bucket) => {
    const info = vi.fn();
    const request = {
      log: { info }, principal: {}, server: { toolCallStore: {} },
      compileValidationSchema: () => () => true,
    } as unknown as FastifyRequest;
    const target = createReflexTargets([workspaceCommandTool], [], undefined, {
      windows: [], contextPanelOpen: false,
    })[0]!;
    const classification = { addressed: true, intent: 'action' as const, confidence, needsConfirmation: false, target };
    const signal = new AbortController().signal;
    logReflexDecision(request, classification, 'chat', performance.now(), signal, null);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'chat', addressed: true, intent: 'action', confidence: bucket, completeCommand: true,
      tool: 'workspace_command', executed: false,
      reason: confidence < 0.9 ? 'low_confidence' : 'execution_failed', latencyMs: expect.any(Number),
    }), 'reflex.decision');
    logReflexDecision(request, { ...classification, addressed: false }, 'voice-final', performance.now(), signal, null);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'not_addressed' }), 'reflex.decision');
    logReflexDecision(request, { ...classification, completeCommand: false }, 'voice-partial', performance.now(), signal, null);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({
      completeCommand: false, reason: 'incomplete_command',
    }), 'reflex.decision');
    logReflexDecision(request, null, 'chat', performance.now(), signal, null);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'none', reason: 'unavailable' }), 'reflex.decision');
  });

  it('builds fixed window and global targets from the open workspace snapshot only', async () => {
    const snapshot = {
      windows: [{ viewId: 'tasks', title: 'Tasks' }, { viewId: 'board', title: 'Project board' }],
      contextPanelOpen: false,
    };
    const targets = createReflexTargets([workspaceCommandTool], [], undefined, snapshot);
    expect(createReflexTargets([workspaceCommandTool])).toEqual([]);
    expect(targets).toHaveLength(16);
    expect(targets.every((target) => isWorkspaceCommand(target.arguments) && workspaceReflexSafe(target))).toBe(true);
    expect(targets.filter(({ arguments: args }) => args.viewId === 'tasks').map(({ arguments: args }) => args.operation))
      .toEqual(['show', 'focus', 'minimise', 'restore', 'close', 'resize']);
    expect(targets.some(({ arguments: args }) => ['create', 'update'].includes(String(args.operation)))).toBe(false);
    expect(targets).toContainEqual(expect.objectContaining({ arguments: expect.objectContaining({
      operation: 'layout', arrangement: 'tiled',
    }) }));
    expect(targets.at(-2)?.arguments).toMatchObject({ operation: 'context-panel', action: 'open' });
    expect(createReflexTargets([workspaceCommandTool], [], undefined, { ...snapshot, contextPanelOpen: true })
      .at(-1)?.arguments).toMatchObject({ operation: 'context-panel', action: 'close' });
    const fetcher = vi.fn<typeof fetch>(async () => response(targets[0]!.choice));
    await createJevReflexClassifier(async () => 'fake-key', fetcher)
      .classify('open the tasks window', 'en', targets, new AbortController().signal);
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain('Tasks');
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain('Project board');
    const again = createReflexTargets([workspaceCommandTool], [], undefined, snapshot);
    expect(again[0]?.arguments.commandId).not.toBe(targets[0]?.arguments.commandId);
    expect(reflexActionSignature(again[0]!)).toBe(reflexActionSignature(targets[0]!));
    expect(workspaceReflexSafe({
      choice: 'unsafe', tool: workspaceCommandTool, arguments: { operation: 'create' },
    })).toBe(false);
  });

  it('replays a completed chat action only for the same registered tool arguments', async () => {
    const finish = registerChatReflex('7000001');
    const sameAction = findChatReflexReplay('7000001', 'pause_task', { taskId: '12' });
    const otherAction = findChatReflexReplay('7000001', 'pause_task', { taskId: '13' });

    finish({
      tool: 'pause_task',
      arguments: { taskId: '12' },
      result: { taskId: '12', state: 'Paused' },
      outcome: 'ok',
      note: 'Reflex already did pause_task (ok): Done.',
    });

    await expect(sameAction).resolves.toMatchObject({
      tool: 'pause_task',
      result: { taskId: '12', state: 'Paused' },
      outcome: 'ok',
    });
    await expect(otherAction).resolves.toBeNull();
  });

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
    expect(partialRequest.questions).not.toHaveProperty('confidence');
  });

  it('offers the recognized browser clause as a fixed reflex-safe target', () => {
    const tools = createToolRegistry([{ id: 'browser-agent', tools: [browserTool()] }]);

    expect(createReflexTargets(tools.list(), [], 'Open the page and search for Jarvis')).toMatchObject([
      {
        choice: 'target_0',
        tool: { name: 'browser_do' },
        arguments: { goal: 'Open the page and search for Jarvis' },
      },
    ]);
    expect(createReflexTargets(tools.list())).toEqual([]);
    expect(createReflexTargets(tools.list(), [], 'x'.repeat(4_001))).toEqual([]);
  });

  it('offers URL reflexes as pc_open URL targets instead of choosing Edge for browser requests', () => {
    const tools = createToolRegistry([{ id: 'pc-bridge', tools: [pcOpenTool()] }]);
    const openUrl = tools.get('pc_open');

    expect(createBrowserUrlTargets(openUrl, 'Open google.com')).toMatchObject([
      {
        choice: 'open_url',
        tool: { name: 'pc_open' },
        arguments: { target: 'url', value: 'https://google.com/' },
      },
    ]);
    expect(createBrowserUrlTargets(openUrl, 'Go to google')).toMatchObject([
      { arguments: { target: 'url', value: 'https://www.google.com/' } },
    ]);
    expect(createBrowserUrlTargets(openUrl, 'Open my browser')).toEqual([]);
    expect(createBrowserUrlTargets(undefined, 'Open google.com')).toEqual([]);
  });

  it('returns typed Jev failures while preserving low-confidence and missing-key fallthrough', async () => {
    const tools = createToolRegistry([{ id: 'factory', tools: [tool(true)] }]);
    const targets = createReflexTargets(tools.list(), ['12']);
    const lowConfidence = createJevReflexClassifier(async () => 'fake-key', async () => response('target_0', 0.4));
    const malformed = createJevReflexClassifier(async () => 'fake-key', async () =>
      new Response(JSON.stringify({ answers: {} }), { headers: { 'content-type': 'application/json' } }));
    const missingKey = createJevReflexClassifier(async () => undefined, vi.fn());
    const rejected = createJevReflexClassifier(async () => 'fake-key', async () => new Response(null, { status: 503 }));
    const networkError = createJevReflexClassifier(async () => 'fake-key', async () => {
      throw new Error('private fetch details');
    });
    const signal = new AbortController().signal;

    await expect(lowConfidence.classify('Pause task 12', 'en', targets, signal)).resolves.toMatchObject({
      target: { tool: { name: 'pause_task' } },
      confidence: 0.4,
    });
    await expect(malformed.classify('Pause task 12', 'en', targets, signal))
      .resolves.toEqual({ failure: 'invalid_answer' });
    await expect(missingKey.classify('Pause task 12', 'en', targets, signal)).resolves.toBeNull();
    await expect(rejected.classify('Pause task 12', 'en', targets, signal))
      .resolves.toEqual({ failure: 'http_503' });
    await expect(networkError.classify('Pause task 12', 'en', targets, signal))
      .resolves.toEqual({ failure: 'network_error' });
  });

  it.each([
    [402, 'billing'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [502, 'http_502'],
  ] as const)('classifies Jev HTTP %s as %s', async (status, failure) => {
    const classifier = createJevReflexClassifier(async () => 'fake-key', async () =>
      new Response(null, { status }));

    await expect(classifier.classify('Pause task 12', 'en', [], new AbortController().signal))
      .resolves.toEqual({ failure });
  });

  it('returns timeout when Jev exceeds its request deadline', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }));
    const classifier = createJevReflexClassifier(async () => 'fake-key', fetcher);

    await expect(classifier.classify('Pause task 12', 'en', [], new AbortController().signal))
      .resolves.toEqual({ failure: 'timeout' });
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
