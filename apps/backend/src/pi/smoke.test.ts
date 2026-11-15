import { describe, expect, it } from 'vitest';
import type { PiEvent, PiGateway, PiUsage } from './gateway.js';
import { runPiSmoke, toolRanOk } from './smoke.js';
import type { PiTurnGrant } from './turns.js';

const usage: PiUsage = { inputTokens: 11_000, cachedTokens: 9_000, outputTokens: 20 };

/** A fake gateway: `toolOutcome` is what the MCP server would have recorded for the tool turn. */
function fakeGateway(toolOutcome: 'ok' | 'error' | 'none', options: { claimToolText?: boolean } = {}): PiGateway {
  const grants = new Map<string, PiTurnGrant>();
  let count = 0;
  return {
    smokeKit: {
      createConversation: async () => 'conv_1',
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
        if (isTools) {
          yield { kind: 'tool' };
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

describe('PI live smoke', () => {
  it('passes the MCP check only when the tool ran and its own result was ok', async () => {
    expect((await runPiSmoke(fakeGateway('ok'), new AbortController().signal, { warmTurns: 1 })).checks.tools_over_mcp).toBe(true);
  });

  it('fails the MCP check when the tool errored, even though the model wrote text and made a tool call', async () => {
    const report = await runPiSmoke(fakeGateway('error', { claimToolText: true }), new AbortController().signal, { warmTurns: 1 });
    expect(report.tools.toolCalls).toBe(1);
    expect(report.tools.characters).toBeGreaterThan(0);
    expect(report.checks.tools_over_mcp).toBe(false);
  });

  it('fails the MCP check when the server saw no tool run at all', async () => {
    expect((await runPiSmoke(fakeGateway('none', { claimToolText: true }), new AbortController().signal, { warmTurns: 1 })).checks.tools_over_mcp).toBe(false);
  });

  it('counts only list_jobs with an ok outcome', () => {
    expect(toolRanOk([{ tool: 'list_jobs', outcome: 'ok' }])).toBe(true);
    expect(toolRanOk([{ tool: 'list_jobs', outcome: 'refused' }])).toBe(false);
    expect(toolRanOk([{ tool: 'get_system_health', outcome: 'ok' }])).toBe(false);
    expect(toolRanOk([])).toBe(false);
  });
});
