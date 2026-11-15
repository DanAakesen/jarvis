import { describe, expect, it, vi } from 'vitest';
import type { ModelCatalogue } from '../../core/model-catalog.js';
import { createFoundryEventReasoner, EVENT_REASONER_MODEL, validateReasonerOutput } from './reasoner.js';
import { applyRules } from './rules.js';
import type { QueuedEvent } from './types.js';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const IDS = ['e1', 'e2', 'e3'];
const decision = { events: ['e1'], tier: 'medium', title: 'Deploy failed', body: 'Main is red.', why: 'blocks work', category: 'status' };

describe('validateReasonerOutput', () => {
  it('accepts decisions and quiet entries over known events', () => {
    const result = validateReasonerOutput({ decisions: [decision], quiet: [{ event: 'e2', why: 'routine' }] }, IDS);
    expect(result.decisions[0]).toMatchObject({ eventIds: ['e1'], tier: 'medium', category: 'status' });
    expect(result.quiet).toEqual([{ eventId: 'e2', why: 'routine' }]);
  });

  it.each([
    ['an unknown event id', { decisions: [{ ...decision, events: ['nope'] }] }],
    ['an event in two places', { decisions: [decision], quiet: [{ event: 'e1', why: 'x' }] }],
    ['a tier outside low, medium and high', { decisions: [{ ...decision, tier: 'urgent' }] }],
    ['a link in the text', { decisions: [{ ...decision, body: 'See https://evil.example/pay' }] }],
    ['markup in the text', { decisions: [{ ...decision, title: '<b>Hi</b>' }] }],
    ['an extra field', { decisions: [{ ...decision, call: true }] }],
    ['a title longer than 80 characters', { decisions: [{ ...decision, title: 'x'.repeat(81) }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => validateReasonerOutput(value, IDS)).toThrow();
  });

  it('allows file names such as index.ts', () => {
    expect(() => validateReasonerOutput({ decisions: [{ ...decision, body: 'Build failed in index.ts' }] }, IDS)).not.toThrow();
  });
});

describe('Foundry event reasoner', () => {
  const catalogue = (withTerra: boolean): ModelCatalogue => ({
    source: 'arm', reason: null,
    deployments: withTerra ? [{
      name: 'gpt-6.1-terra', model: 'gpt-6.1-terra', version: '2026-10-26', sku: 'GlobalStandard', capacity: 150,
      capabilities: ['chat', 'responses'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    }] : [],
  } as unknown as ModelCatalogue);
  const endpoint = 'https://acct.services.ai.azure.com/api/projects/jarvis';
  const input = {
    now: NOW, guidance: '', facts: [], feedback: [],
    events: [{ id: 'e1', source: 'github', kind: 'workflow_run.failure', dedupeKey: 'k', summary: 'Deploy failed', detail: {}, occurredAt: NOW, receivedAt: NOW, attempts: 1 }],
  } satisfies Parameters<ReturnType<typeof createFoundryEventReasoner>['reason']>[0];
  const answer = (content: unknown) => new Response(JSON.stringify({
    usage: { prompt_tokens: 4_000, completion_tokens: 300 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  it('calls GPT-6.1 Terra at low reasoning effort and returns validated decisions with usage', async () => {
    const fetcher = vi.fn(async () => answer({ decisions: [decision], quiet: [] }));
    const reasoner = createFoundryEventReasoner({
      modelCatalogue: { read: async () => catalogue(true) }, getCredentialToken: async () => 'token',
      foundryProjectEndpoint: endpoint, fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await reasoner.reason(input, new AbortController().signal);
    expect(result.decisions).toHaveLength(1);
    expect(result.usage).toEqual({ model: 'gpt-6.1-terra', inputTokens: 4_000, outputTokens: 300 });
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [URL, { body: string }])[1].body) as Record<string, unknown>;
    expect(body).toMatchObject({ model: EVENT_REASONER_MODEL, reasoning_effort: 'low', response_format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('tools');
  });

  it('reports unavailable when Terra is not deployed, without calling the network', async () => {
    const fetcher = vi.fn();
    const reasoner = createFoundryEventReasoner({
      modelCatalogue: { read: async () => catalogue(false) }, getCredentialToken: async () => 'token',
      foundryProjectEndpoint: endpoint, fetcher: fetcher as unknown as typeof fetch,
    });
    expect((await reasoner.reason(input, new AbortController().signal)).reason).toBe('model_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps usage but rejects an invalid answer', async () => {
    const reasoner = createFoundryEventReasoner({
      modelCatalogue: { read: async () => catalogue(true) }, getCredentialToken: async () => 'token',
      foundryProjectEndpoint: endpoint,
      fetcher: (async () => answer({ decisions: [{ ...decision, events: ['unknown'] }] })) as unknown as typeof fetch,
    });
    const result = await reasoner.reason(input, new AbortController().signal);
    expect(result).toMatchObject({ reason: 'invalid_model_output', usage: { inputTokens: 4_000 } });
  });

  it('has a worst-case price that fits the monthly budget many times over', () => {
    const reasoner = createFoundryEventReasoner({
      modelCatalogue: { read: async () => catalogue(true) }, getCredentialToken: async () => 'token',
    });
    expect(reasoner.worstCaseDkk()).toBeGreaterThan(0.3);
    expect(reasoner.worstCaseDkk()).toBeLessThan(0.5);
  });
});

describe('cheap rules', () => {
  const event = (partial: Partial<QueuedEvent>): QueuedEvent => ({
    id: 'e', source: 'github', kind: 'workflow_run.failure', dedupeKey: 'k', summary: 's', detail: {},
    occurredAt: new Date(NOW.getTime() - 60_000), receivedAt: NOW, attempts: 1, ...partial,
  });
  const base = { now: NOW, sourceEnabled: true, escalatedLastHour: 0 };

  it('keeps failures and alerts, drops routine successes', () => {
    expect(applyRules(event({}), base).keep).toBe(true);
    expect(applyRules(event({ source: 'alert', kind: 'budget_threshold' }), base).keep).toBe(true);
    expect(applyRules(event({ kind: 'workflow_run.success' }), base)).toEqual({ keep: false, reason: 'routine_build_result' });
    expect(applyRules(event({ kind: 'deployment_status.success' }), base).reason).toBe('routine_deploy_result');
  });

  it('drops stale events, disabled sources, over-rate sources and exhausted retries', () => {
    expect(applyRules(event({ occurredAt: new Date(NOW.getTime() - 25 * 3_600_000) }), base).reason).toBe('stale');
    expect(applyRules(event({ source: 'timer', kind: 'review', occurredAt: new Date(NOW.getTime() - 2 * 3_600_000) }), base).reason).toBe('stale');
    expect(applyRules(event({}), { ...base, sourceEnabled: false }).reason).toBe('source_disabled');
    expect(applyRules(event({}), { ...base, escalatedLastHour: 20 }).reason).toBe('source_rate_limited');
    expect(applyRules(event({ attempts: 5 }), base).reason).toBe('gave_up_after_retries');
  });

  it('drops calendar events that are over or far away', () => {
    const calendar = (detail: Record<string, unknown>) => event({ source: 'calendar', kind: 'event.new', detail });
    expect(applyRules(calendar({ endsAt: new Date(NOW.getTime() - 1_000).toISOString() }), base).reason).toBe('calendar_event_over');
    expect(applyRules(calendar({ startsAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString() }), base).reason).toBe('calendar_too_far_ahead');
    expect(applyRules(calendar({ startsAt: new Date(NOW.getTime() + 86_400_000).toISOString() }), base).keep).toBe(true);
  });
});
