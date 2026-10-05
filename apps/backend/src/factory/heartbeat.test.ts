import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoundryClient, FoundryClientError } from '../foundry/client.js';
import type { SandboxHeartbeatStore } from './heartbeat.js';
import { isSandboxCrashResponse, SandboxHeartbeat } from './heartbeat.js';

const recording = JSON.parse(readFileSync(new URL('../foundry/fixtures/runner-responses.json', import.meta.url), 'utf8')) as {
  records: Record<string, { status_code: number; body: unknown }>;
};
const runtimeEndpoint = 'https://example.cognitiveservices.azure.com/api/projects/jarvis';
const adminEndpoint = 'https://example.services.ai.azure.com/api/projects/jarvis';
const sandbox = {
  sandboxSessionId: '7',
  foundrySessionId: 'capture-session',
  agentName: 'jarvis-runner-base-1x2',
  invocationId: 'capture-task',
};

function setup(records: { status_code: number; body: unknown }[]) {
  const responses = [...records];
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const record = responses.shift();
    if (!record) throw new Error('No recorded response remains');
    return new Response(JSON.stringify(record.body), { status: record.status_code });
  });
  const client = new FoundryClient({
    runtimeEndpoint,
    adminEndpoint,
    agentName: sandbox.agentName,
    getToken: async () => 'test-token',
    fetch,
  });
  const store: SandboxHeartbeatStore = {
    listRunning: vi.fn(async () => [sandbox]),
    recordHeartbeat: vi.fn(async () => {}),
    markNeedsAttention: vi.fn(async () => 'crashed' as const),
    resolvePause: vi.fn(async () => true),
  };
  const onDecision = vi.fn();
  const heartbeat = new SandboxHeartbeat(store, () => client, { onDecision });
  return { heartbeat, store, fetch, onDecision };
}

afterEach(() => { vi.useRealTimers(); });

describe('sandbox heartbeat', () => {
  it('records healthy polls even when the recorded response has no events', async () => {
    vi.useFakeTimers();
    const running = recording.records['status_running']!;
    const body = { ...(running.body as Record<string, unknown>), events: [] };
    const { heartbeat, store, fetch } = setup([
      { status_code: running.status_code, body },
      running,
    ]);

    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.recordHeartbeat).toHaveBeenCalledTimes(1);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.recordHeartbeat).toHaveBeenCalledTimes(2);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();
    await heartbeat.stop();
  });

  it('moves a task to NeedsAttention after two recorded not-found polls', async () => {
    vi.useFakeTimers();
    const missing = recording.records['status_not_found']!;
    const { heartbeat, store, fetch, onDecision } = setup([missing, missing]);

    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.markNeedsAttention).toHaveBeenCalledOnce();
    expect(store.markNeedsAttention).toHaveBeenCalledWith('7', undefined, sandbox.invocationId, false);
    expect(onDecision.mock.calls.map(([decision]) => decision)).toEqual([
      { sandboxSessionId: '7', invocationId: sandbox.invocationId, httpStatus: 404, decision: 'confirm_failure' },
      { sandboxSessionId: '7', invocationId: sandbox.invocationId, httpStatus: 404, decision: 'crashed' },
    ]);
    await heartbeat.stop();
  });

  it('uses committed completion evidence when the first poll after completion fails', async () => {
    vi.useFakeTimers();
    const missing = recording.records['status_not_found']!;
    const { heartbeat, store, onDecision } = setup([missing, missing]);
    // The runner completes between polls; Foundry never returns a completed snapshot.
    vi.mocked(store.markNeedsAttention).mockResolvedValue('idle_expired');
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.markNeedsAttention).toHaveBeenCalledWith('7', undefined, sandbox.invocationId, false);
    expect(onDecision).toHaveBeenLastCalledWith({
      sandboxSessionId: '7', invocationId: sandbox.invocationId, httpStatus: 404, decision: 'idle_expired',
    });
    await heartbeat.stop();
  });

  it('resets the failure window after a healthy poll and logs every decision', async () => {
    vi.useFakeTimers();
    const missing = recording.records['status_not_found']!;
    const running = recording.records['status_running']!;
    const { heartbeat, store, onDecision } = setup([missing, running, missing, missing]);
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();
    expect(onDecision.mock.calls.map(([decision]) => [decision.httpStatus, decision.decision])).toEqual([
      [404, 'confirm_failure'], [200, 'running'], [404, 'confirm_failure'],
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.markNeedsAttention).toHaveBeenCalledOnce();
    await heartbeat.stop();
  });

  it('logs soft failures without provider bodies or credentials', async () => {
    vi.useFakeTimers();
    const { heartbeat, store, onDecision } = setup([
      { status_code: 429, body: { error: 'private provider body' } },
    ]);
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();
    expect(onDecision.mock.calls).toEqual([[{
      sandboxSessionId: '7', invocationId: sandbox.invocationId, httpStatus: 429, decision: 'poll_failed',
    }]]);
    await heartbeat.stop();
  });

  it.each([200, 202])('logs the actual HTTP %i response status', async (statusCode) => {
    vi.useFakeTimers();
    const { heartbeat, onDecision } = setup([{
      status_code: statusCode, body: recording.records['status_running']!.body,
    }]);
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onDecision).toHaveBeenLastCalledWith({
      sandboxSessionId: '7', invocationId: sandbox.invocationId, httpStatus: statusCode, decision: 'running',
    });
    await heartbeat.stop();
  });

  it('ends an expired session without a crash after its invocation completed', async () => {
    vi.useFakeTimers();
    const completed = recording.records['status_completed']!;
    const missing = recording.records['status_not_found']!;
    const { heartbeat, store } = setup([completed, missing, missing]);
    const onCompleted = vi.fn(async () => false);
    heartbeat.setCompletionHandler(onCompleted);

    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(store.recordHeartbeat).toHaveBeenCalledWith('7', sandbox.invocationId, true);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.markNeedsAttention).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(store.markNeedsAttention).toHaveBeenCalledWith('7', undefined, sandbox.invocationId, true);
    expect(onCompleted).toHaveBeenCalledOnce();
    await heartbeat.stop();
  });

  it('moves a task to Paused after Foundry confirms the invocation has stopped', async () => {
    vi.useFakeTimers();
    const running = recording.records['status_running']!;
    const body = { ...(running.body as Record<string, unknown>), status: 'paused' };
    const { heartbeat, store } = setup([{ status_code: running.status_code, body }]);

    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.resolvePause).toHaveBeenCalledWith('7', 'Paused');
    await heartbeat.stop();
  });

  it('moves a task to NeedsAttention with the agent question', async () => {
    vi.useFakeTimers();
    const running = recording.records['status_running']!;
    const question = 'Which license should this project use?';
    const body = { ...(running.body as Record<string, unknown>), status: 'needs_attention', error: question };
    const { heartbeat, store } = setup([{ status_code: running.status_code, body }]);

    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.markNeedsAttention).toHaveBeenCalledWith('7', question, sandbox.invocationId, false);
    await heartbeat.stop();
  });

  it.each([404, 424, 500, 503])('recognizes HTTP %i as a crash poll response', (statusCode) => {
    expect(isSandboxCrashResponse(new FoundryClientError('http', 'status', statusCode))).toBe(true);
  });

  it.each([400, 429, undefined])('does not treat HTTP %s or non-HTTP failures as a crash', (statusCode) => {
    const error = statusCode === undefined
      ? new FoundryClientError('transport', 'status')
      : new FoundryClientError('http', 'status', statusCode);
    expect(isSandboxCrashResponse(error)).toBe(false);
  });
});
