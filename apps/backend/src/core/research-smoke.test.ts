import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoundryClientError, type InvocationSnapshot } from '../foundry/client.js';
import { researchSmokeFailureReasons, createSystemSmokeReader, createSystemStatusReader, systemSmokeHttpResponse } from '../system-status.js';
import { createResearchSmokeProbe, researchSmokeFailureReason } from './research-smoke.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const accepted = { invocationId: 'fixture-invocation', sessionId: 'fixture-session', status: 'queued' as const, agent: 'codex' as const };
const roleProfile = JSON.parse(readFileSync(new URL(
  '../../../../agents/jarvis/tests/fixtures/runtime_role_settings.json', import.meta.url,
), 'utf8')) as { roles: { research: { model: string; reasoningEffort: string } } };

function fixture(overrides: Partial<InvocationSnapshot> = {}) {
  return {
    startCodexTool: vi.fn(async () => accepted),
    status: vi.fn(async () => ({
      ...accepted, status: 'completed' as const, startedAt: 0, finishedAt: 1,
      result: { answer: 'Synthetic dry run complete.', sources: [] }, error: null,
      events: [{ at: 0, kind: 'started', data: { private: 'PRIVATE_RUNNER_EVENT' } }],
      ...overrides,
    })),
    cancel: vi.fn(async () => ({ invocationId: accepted.invocationId, status: 'cancelled' as const })),
    deleteSession: vi.fn(async () => {}),
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('research smoke evidence', () => {
  it.each([
    ['fixture-model', 'high'],
    [roleProfile.roles.research.model, roleProfile.roles.research.reasoningEffort],
  ])('keeps the fixed dry run and selected %s/%s settings with terminal cleanup', async (model, reasoningEffort) => {
    const client = fixture();
    const report = await createResearchSmokeProbe({
      configured: true, clientFor: () => client,
      selectModel: async () => ({ model, reasoningEffort }),
    })();
    expect(report).toEqual({ status: 'ok', details: { configured: true } });
    expect(client.startCodexTool).toHaveBeenCalledExactlyOnceWith(
      'web_research',
      'Dry run only: answer with one short sentence and no sources; do not browse or save anything.',
      model, { reasoning: reasoningEffort, signal: expect.any(AbortSignal) },
    );
    expect(client.status).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledExactlyOnceWith(accepted.sessionId, { signal: expect.any(AbortSignal) });
    expect(client.cancel).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('PRIVATE_RUNNER_EVENT');
  });

  it('does no work when unconfigured or when role selection fails', async () => {
    const clientFor = vi.fn(() => fixture());
    const selectModel = vi.fn(async () => { throw new Error('PRIVATE_SETTINGS'); });
    expect(await createResearchSmokeProbe({ configured: false, clientFor, selectModel })())
      .toEqual({ status: 'down', details: { configured: false } });
    expect(selectModel).not.toHaveBeenCalled();
    expect(await createResearchSmokeProbe({ configured: true, clientFor, selectModel })())
      .toEqual({ status: 'down', details: { configured: true }, reason: 'research_settings_unavailable' });
    expect(clientFor).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'failed', error: 'PRIVATE_PROVIDER_FAILURE' }, 'research_runner_failed'],
    [{ status: 'failed', error: 'Codex usage limit reached' }, 'research_usage_limit'],
    [{ result: null }, 'research_result_missing'],
    [{ result: { private: 'PRIVATE_RESULT' } }, 'research_result_invalid'],
  ] as const)('separates terminal runner and result failures without a retry: %s', async (state, reason) => {
    const client = fixture(state);
    const report = await createResearchSmokeProbe({
      configured: true, clientFor: () => client,
      selectModel: async () => ({ model: 'fixture-model', reasoningEffort: 'none' }),
    })();
    expect(report).toEqual({ status: 'down', details: { configured: true }, reason });
    expect(client.startCodexTool).toHaveBeenCalledTimes(1);
    expect(client.cancel).not.toHaveBeenCalled();
    expect(client.deleteSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE/u);
  });

  it.each([
    ['codex_model_unsupported', 'research_codex_model_unsupported'],
    ['codex_auth', 'research_codex_auth'],
    ['codex_client_outdated', 'research_codex_client_outdated'],
    ['codex_network', 'research_codex_network'],
  ] as const)('reports only the fixed %s category from a failed runner event', async (category, reason) => {
    const client = fixture({
      status: 'failed',
      error: 'Codex web research failed',
      events: [{
        at: 1,
        kind: 'failed',
        data: { reason: category, output: 'PRIVATE_RAW_CODEX_OUTPUT' },
      }],
    });
    const report = await createResearchSmokeProbe({
      configured: true, clientFor: () => client,
      selectModel: async () => ({ model: 'fixture-model', reasoningEffort: 'none' }),
    })();

    expect(report).toEqual({ status: 'down', details: { configured: true }, reason });
    expect(JSON.stringify(report)).not.toContain('PRIVATE_RAW_CODEX_OUTPUT');
    expect(client.deleteSession).toHaveBeenCalledOnce();
  });

  it('keeps an unknown failed-event reason generic and out of the smoke report', async () => {
    const client = fixture({
      status: 'failed',
      error: 'PRIVATE_PROVIDER_FAILURE',
      events: [{
        at: 1,
        kind: 'failed',
        data: { reason: 'codex_private_provider_text', output: 'PRIVATE_RAW_CODEX_OUTPUT' },
      }],
    });
    const report = await createResearchSmokeProbe({
      configured: true, clientFor: () => client,
      selectModel: async () => ({ model: 'fixture-model', reasoningEffort: 'none' }),
    })();

    expect(report).toEqual({ status: 'down', details: { configured: true }, reason: 'research_runner_failed' });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE/u);
  });

  it.each([400, 401, 403, 404, 429, 500, 502, 503, 504])('retains only the fixed runner HTTP %s boundary', async (status) => {
    const client = fixture();
    client.startCodexTool.mockRejectedValue(new FoundryClientError('http', 'PRIVATE_OPERATION', status));
    expect(await createResearchSmokeProbe({
      configured: true, clientFor: () => client,
      selectModel: async () => ({ model: 'fixture-model', reasoningEffort: 'none' }),
    })()).toEqual({ status: 'down', details: { configured: true }, reason: `research_runner_http_${status}` });
    expect(client.status).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
  });

  it('keeps the bounded timeout and cancels/cleans the accepted runner once', async () => {
    vi.useFakeTimers();
    const client = fixture({ status: 'running', finishedAt: null, result: null });
    const pending = createResearchSmokeProbe({
      configured: true, clientFor: () => client, timeoutMs: 20, pollIntervalMs: 5,
      selectModel: async () => ({ model: 'fixture-model', reasoningEffort: 'none' }),
    })();
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ status: 'down', details: { configured: true }, reason: 'research_runner_timeout' });
    expect(client.startCodexTool).toHaveBeenCalledTimes(1);
    expect(client.cancel).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new FoundryClientError('auth', 'PRIVATE'), 'research_runner_auth'],
    [new FoundryClientError('protocol', 'PRIVATE'), 'research_runner_protocol'],
    [new FoundryClientError('timeout', 'PRIVATE'), 'research_runner_timeout'],
    [new FoundryClientError('transport', 'PRIVATE'), 'research_runner_transport'],
    [new FoundryClientError('aborted', 'PRIVATE'), 'research_runner_aborted'],
    [new FoundryClientError('http', 'PRIVATE', 418), 'research_unavailable'],
    [new ToolFailure('PRIVATE'), 'research_unavailable'],
    [new ToolRefusal('PRIVATE'), 'research_unavailable'],
    [new Error('PRIVATE'), 'research_unavailable'],
  ])('redacts arbitrary operation/error text: %s', (error, reason) => {
    expect(researchSmokeFailureReason(error)).toBe(reason);
  });

  it.each([...researchSmokeFailureReasons, 'PRIVATE_REASON'])('carries only allowlisted research evidence through retained/HTTP reports: %s', async (reason) => {
    const reader = createSystemSmokeReader(createSystemStatusReader({}), {
      research: async () => ({ status: 'down', reason }),
    });
    const retained = await reader.run();
    const report = systemSmokeHttpResponse(retained);
    for (const output of [retained, report]) {
      const entry = output.entries.find(row => row.id === 'research');
      expect(entry).toMatchObject({ status: 'down' });
      if (researchSmokeFailureReasons.has(reason)) expect(entry?.reason).toBe(reason);
      else expect(entry).not.toHaveProperty('reason');
      expect(JSON.stringify(output)).not.toMatch(/PRIVATE/u);
    }
  });
});
