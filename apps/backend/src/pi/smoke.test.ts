import { describe, expect, it } from 'vitest';
import type { RemoteMcpBridge } from './remote-mcp.js';
import type { PiEvent, PiGateway } from './gateway.js';
import type { PiUsage } from './pricing.js';
import { isSpokenShape, runPiSmoke, toolRanOk } from './smoke.js';
import type { PiTurnGrant } from './turns.js';

const usage: PiUsage = { inputTokens: 11_000, cachedTokens: 9_000, outputTokens: 20 };

/** A fake gateway: `toolOutcome` is what the MCP server would have recorded for the tool turn. */
function fakeGateway(toolOutcome: 'ok' | 'error' | 'none', options: { claimToolText?: boolean; listed?: readonly string[]; failReach?: boolean } = {}): PiGateway {
  const grants = new Map<string, PiTurnGrant>();
  let count = 0;
  return {
    smokeKit: {
      withConversation: async (_signal, run) => run('conv_1'),
      openGrant: (signal) => {
        count += 1;
        const grant = { turn: `jt-${String(count).padStart(22, 'A')}`, ownerObjectId: 'o', sessionId: '', messageId: '', smoke: true, discovered: new Set<string>(), results: [], signal } as PiTurnGrant;
        grants.set(grant.turn, grant);
        return grant;
      },
      closeGrant: () => {},
      recordSmoke: async () => {},
      format: (turn, text) => `${turn}\n${text}`,
      cost: () => 0.07,
      now: () => new Date(),
      async *respond(_conversation, input, signal): AsyncGenerator<PiEvent> {
        const turn = /(jt-[A-Za-z0-9_-]{22})/u.exec(input)![1]!;
        const isTools = input.includes('jobs');
        const isLong = input.includes('story');
        for (const server of options.listed ?? []) yield { kind: 'tools_listed', server, tools: 12, failed: false };
        // GitHub runs through the Jarvis door: the door, not the harness, records its call.
        if (input.includes('gh_issue_read')) (grants.get(turn)!.results as { tool: string; outcome: 'ok' | 'error' }[]).push({ tool: 'gh_issue_read', outcome: options.failReach === true ? 'error' : 'ok' });
        if (input.includes('azure resource group resources list')) (grants.get(turn)!.results as { tool: string; outcome: 'ok' | 'error' }[]).push({ tool: 'az_group_resource_list', outcome: options.failReach === true ? 'error' : 'ok' });
        if (isTools) {
          yield { kind: 'tool', server: 'jarvis' };
          if (toolOutcome !== 'none') (grants.get(turn)!.results as { tool: string; outcome: 'ok' | 'error' }[]).push({ tool: 'list_jobs', outcome: toolOutcome });
        }
        const pieces = isTools && !options.claimToolText ? ['No jobs.'] : ['one ', 'two ', 'three ', 'four ', 'five '];
        for (const piece of pieces) {
          if (signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, isLong ? 60 : 30));
          if (signal.aborted) throw signal.reason;
          yield { kind: 'delta', text: piece };
        }
        yield { kind: 'done', usage, responseId: null };
      },
    },
  } as unknown as PiGateway;
}

const bridge = (count: number, prefix = 'gh_'): RemoteMcpBridge => ({
  prefix,
  label: prefix === 'az_' ? 'Azure' : 'GitHub',
  status: () => (count === 0 ? { state: 'unreachable', reason: 'no answer within 200 seconds' } : { state: 'ready' }),
  warm: () => {},
  tools: async () => Array.from({ length: count }, (_, index) => ({ name: `gh_t${index}`, description: 'x', inputSchema: {}, moduleId: 'github', execute: async () => ({}) })),
  call: async () => ({ outcome: 'ok', result: {} }),
});

describe('PI live smoke', () => {
  it('passes the MCP check only when the tool ran and its own result was ok', async () => {
    expect((await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, part: 'core' })).checks.tools_over_mcp).toBe(true);
  });

  it('fails the MCP check when the tool errored, even though the model wrote text and made a tool call', async () => {
    const report = await runPiSmoke(fakeGateway('error', { claimToolText: true }), new AbortController().signal, { warmTurns: 1, part: 'core' });
    expect(report.tools.toolCalls).toBe(1);
    expect(report.tools.characters).toBeGreaterThan(0);
    expect(report.checks.tools_over_mcp).toBe(false);
  });

  it('fails the MCP check when the server saw no tool run at all', async () => {
    expect((await runPiSmoke(fakeGateway('none', { claimToolText: true }), new AbortController().signal, { warmTurns: 1, part: 'core' })).checks.tools_over_mcp).toBe(false);
  });

  it('reports which tools PI reached for on natural prompts, without making them a check', async () => {
    const report = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, part: 'reach' });
    expect(report.choices.map(({ label }) => label)).toEqual(['Azure question', 'GitHub question', 'Notes question', 'PC request']);
    expect(report.choices.every(({ called }) => Array.isArray(called))).toBe(true);
    expect(Object.keys(report.checks).some(key => key.startsWith('choice'))).toBe(false);
  });

  it('gives a reach server a turn and a check only when the harness listed its tools', async () => {
    const none = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, part: 'reach' });
    expect(none.reach).toEqual([]);
    expect(Object.keys(none.checks).filter(key => key.startsWith('reach_'))).toEqual([]);
    const both = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, bridges: [bridge(12), bridge(5, 'az_')], part: 'reach' });
    expect(both.reach.map(({ server }) => server)).toEqual(['github', 'azure']);
    expect(both.checks).toMatchObject({ reach_github: true, reach_azure: true, mcp_listing: true });
    expect(both.listed).toEqual([{ server: 'github', tools: 12, failed: false }, { server: 'azure', tools: 5, failed: false }]);
  });

  it('fails a reach check when the door recorded the call as failed', async () => {
    const report = await runPiSmoke(fakeGateway('ok', { failReach: true }), new AbortController().signal, { warmTurns: 1, bridges: [bridge(5, 'az_')], part: 'reach' });
    expect(report.checks.reach_azure).toBe(false);
  });

  it('reports GitHub through the Jarvis door: listed by the bridge, checked by the door\'s own record of the call', async () => {
    const good = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, bridges: [bridge(30)], part: 'reach' });
    expect(good.listed).toEqual([{ server: 'github', tools: 30, failed: false }]);
    expect(good.checks.reach_github).toBe(true);
    const failed = await runPiSmoke(fakeGateway('ok', { failReach: true }), new AbortController().signal, { warmTurns: 1, bridges: [bridge(30)], part: 'reach' });
    expect(failed.checks.reach_github).toBe(false);
    const empty = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, bridges: [bridge(0)], part: 'reach' });
    expect(empty.listed).toEqual([{ server: 'github', tools: 0, failed: true, reason: 'no answer within 200 seconds' }]);
    expect(empty.reach).toEqual([]);
    expect(empty.checks.reach_github).toBe(false);
  });

  it('fails the check of a server whose tool listing failed, instead of skipping it', async () => {
    const gateway = fakeGateway('ok');
    const original = gateway.smokeKit.respond;
    gateway.smokeKit.respond = async function* (conversation, input, signal) {
      yield { kind: 'tools_listed', server: 'github', tools: 0, failed: true } as PiEvent;
      yield { kind: 'tools_listed', server: '', tools: 0, failed: true } as PiEvent;
      yield* original(conversation, input, signal);
    };
    const report = await runPiSmoke(gateway, new AbortController().signal, { warmTurns: 1, part: 'reach' });
    expect(report.reach).toEqual([]);
    expect(report.checks).toMatchObject({ reach_github: false, mcp_listing: false });
    expect(report.checks.reach_azure).toBeUndefined();
  });

  it('does not count a Jarvis call as reach', async () => {
    const report = await runPiSmoke(fakeGateway('ok', { listed: ['github'] }), new AbortController().signal, { warmTurns: 1, part: 'core' });
    expect(report.tools.reachCalls).toEqual([]);
  });

  it('measures the voice leg of PI in the same conversation and checks the replies read as speech', async () => {
    const report = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, part: 'voice' });
    expect(report.voice.plain.firstTextMs).not.toBeNull();
    expect(report.voice.tools.toolCalls).toBe(1);
    expect(report.checks).toMatchObject({ voice_spoken_shape: true, voice_tools_over_mcp: true });
    const failed = await runPiSmoke(fakeGateway('error'), new AbortController().signal, { warmTurns: 1, part: 'voice' });
    expect(failed.checks.voice_tools_over_mcp).toBe(false);
  });

  it('measures the fixed prompt on its own, in a new conversation', async () => {
    const report = await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1, part: 'core' });
    expect(report.baseline.usage.inputTokens).toBe(11_000);
    expect(report.baseline.toolCalls).toBe(0);
  });

  it('tells speech from chat formatting', () => {
    expect(isSpokenShape('You have two meetings today, the first at nine.')).toBe(true);
    for (const text of ['', '- one\n- two', 'Here is **bold** text', 'See [this](http://x)', 'First line\nSecond line', 'word '.repeat(80)]) {
      expect(isSpokenShape(text)).toBe(false);
    }
  });

  it('counts only list_jobs with an ok outcome', () => {
    expect(toolRanOk([{ tool: 'list_jobs', outcome: 'ok' }])).toBe(true);
    expect(toolRanOk([{ tool: 'list_jobs', outcome: 'refused' }])).toBe(false);
    expect(toolRanOk([{ tool: 'get_system_health', outcome: 'ok' }])).toBe(false);
    expect(toolRanOk([])).toBe(false);
  });
});
