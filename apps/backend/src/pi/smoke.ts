import type { PiEvent, PiGateway, PiUsage } from './gateway.js';

interface Measured {
  readonly firstTextMs: number | null;
  readonly lastTextMs: number | null;
  readonly totalMs: number;
  readonly deltas: number;
  readonly toolCalls: number;
  /** What the tools run in this turn returned, from the MCP server's own record. */
  readonly toolResults: readonly { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  readonly characters: number;
  readonly text: string;
  readonly usage: PiUsage;
  readonly costDkk: number;
  readonly aborted: boolean;
}

export interface PiSmokeReport {
  readonly cold: Measured;
  readonly warm: readonly Measured[];
  readonly tools: Measured;
  readonly cancel: { readonly abortToCloseMs: number; readonly partialCharacters: number; readonly followUpOk: boolean };
  readonly totalCostDkk: number;
  readonly checks: Record<'streaming' | 'tools_over_mcp' | 'cancellation' | 'warm_faster_than_cold', boolean>;
}

/** True only when list_jobs ran through call_tool and its own result was `ok`. */
export function toolRanOk(results: Measured['toolResults']): boolean {
  return results.some(result => result.tool === 'list_jobs' && result.outcome === 'ok');
}

const noUsage: PiUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

/**
 * Live proof for the Deploy workflow: one scratch conversation (never the owner's), a cold turn, warm turns, a tool turn
 * through the Jarvis MCP server under the read-only smoke role, and a cancelled turn followed by a normal one. It reports
 * what it observed; the workflow, not this code, decides how to present it.
 */
export async function runPiSmoke(gateway: PiGateway, signal: AbortSignal, options: { warmTurns?: number } = {}): Promise<PiSmokeReport> {
  const kit = gateway.smokeKit;
  const conversationId = await kit.createConversation(signal);

  async function measure(text: string, config: { abortAfterFirstText?: boolean } = {}): Promise<Measured & { abortToCloseMs: number }> {
    const controller = new AbortController();
    const turnSignal = AbortSignal.any([signal, controller.signal]);
    const grant = kit.openGrant(turnSignal);
    const started = performance.now();
    let firstTextMs: number | null = null;
    let lastTextMs: number | null = null;
    let deltas = 0;
    let toolCalls = 0;
    const toolResults: Measured['toolResults'][number][] = [];
    let output = '';
    let usage = noUsage;
    let abortedAt: number | null = null;
    try {
      for await (const event of kit.respond(conversationId, kit.format(grant.turn, text), turnSignal) as AsyncIterable<PiEvent>) {
        const at = performance.now() - started;
        if (event.kind === 'delta') {
          firstTextMs ??= Math.round(at);
          lastTextMs = Math.round(at);
          deltas += 1;
          output += event.text;
          if (config.abortAfterFirstText && abortedAt === null) { abortedAt = performance.now(); controller.abort(); }
        } else if (event.kind === 'tool') toolCalls += 1;
        else usage = event.usage;
      }
    } catch (error) {
      if (!(config.abortAfterFirstText && controller.signal.aborted)) throw error;
    } finally {
      toolResults.push(...grant.results);
      kit.closeGrant(grant.turn);
    }
    const closedMs = abortedAt === null ? 0 : Math.round(performance.now() - abortedAt);
    const totalMs = Math.round(performance.now() - started);
    const costDkk = kit.cost(usage);
    await kit.recordSmoke({
      kind: 'smoke', messageId: null, model: 'gpt-6.1-terra', inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens, costDkk, firstTextMs, totalMs, outcome: abortedAt === null ? 'ok' : 'cancelled',
    }, AbortSignal.timeout(10_000)).catch(() => undefined);
    return { firstTextMs, lastTextMs, totalMs, deltas, toolCalls, toolResults, characters: output.length, text: output.slice(0, 200), usage, costDkk,
      aborted: abortedAt !== null, abortToCloseMs: closedMs };
  }

  const cold = await measure('Reply with one short sentence saying you are PI, Jarvis on the Copilot harness.');
  const warm: Measured[] = [];
  for (let index = 0; index < (options.warmTurns ?? 3); index += 1) {
    warm.push(await measure(`Reply with one short sentence about the number ${index + 2}.`));
  }
  const tools = await measure(
    'Use find_tools to look up "jobs", then run list_jobs with call_tool and empty arguments, then say in one sentence how many jobs are running.',
  );
  const cancelled = await measure('Write a very long, detailed story of at least 400 words about a butler.', { abortAfterFirstText: true });
  const followUp = await measure('Reply with exactly: still here').then(turn => turn.characters > 0, () => false);

  const all = [cold, ...warm, tools, cancelled];
  const warmMedian = [...warm].map(turn => turn.firstTextMs ?? Infinity).sort((a, b) => a - b)[Math.floor(warm.length / 2)] ?? Infinity;
  const strip = (turn: Measured & { abortToCloseMs: number }): Measured => {
    const { abortToCloseMs, ...rest } = turn;
    void abortToCloseMs;
    return rest;
  };
  return {
    cold: strip(cold), warm: warm, tools: strip(tools),
    cancel: { abortToCloseMs: cancelled.abortToCloseMs, partialCharacters: cancelled.characters, followUpOk: followUp },
    totalCostDkk: Number(all.reduce((sum, turn) => sum + turn.costDkk, 0).toFixed(4)),
    checks: {
      // Real streaming: several deltas, with the last arriving well after the first.
      streaming: cold.deltas > 3 && (cold.lastTextMs ?? 0) - (cold.firstTextMs ?? 0) > 100,
      // The tool must have run and succeeded as the server saw it: model text or an mcp_call item alone prove nothing.
      tools_over_mcp: toolRanOk(tools.toolResults),
      cancellation: cancelled.aborted && cancelled.abortToCloseMs < 5_000 && followUp,
      warm_faster_than_cold: warmMedian < (cold.firstTextMs ?? 0),
    },
  };
}
