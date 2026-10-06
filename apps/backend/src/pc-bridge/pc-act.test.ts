import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
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
  } as unknown as FastifyRequest;
}

function decision(operation: PcActDecision['operation'], targetIndex?: number, text?: string): PcActDecision {
  return {
    operation,
    confidence: 0.99,
    ...(targetIndex === undefined ? {} : { targetIndex }),
    ...(text === undefined ? {} : { text }),
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
