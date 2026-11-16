import { PI_MCP_SERVER_LABEL } from './definition.js';
import type { PiEvent, PiGateway, PiUsage } from './gateway.js';

interface Measured {
  readonly firstTextMs: number | null;
  readonly lastTextMs: number | null;
  readonly totalMs: number;
  readonly deltas: number;
  readonly toolCalls: number;
  /** What the tools run in this turn returned, from the MCP server's own record. */
  readonly toolResults: readonly { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  /** Calls to the read-only reach servers (GitHub, Azure) with the harness's own verdict; Jarvis calls are in `toolResults`. */
  readonly reachCalls: readonly { readonly server: string; readonly name: string; readonly failed: boolean }[];
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
  /** Servers the harness listed tools for in this run, with the tool count: proof that each is attached and reachable. */
  readonly listed: readonly { readonly server: string; readonly tools: number; readonly failed: boolean }[];
  /** One turn per attached reach server; absent servers get no turn and no check. */
  readonly reach: readonly { readonly server: 'github' | 'azure'; readonly turn: Measured }[];
  readonly cancel: { readonly abortToCloseMs: number; readonly partialCharacters: number; readonly followUpOk: boolean };
  readonly totalCostDkk: number;
  readonly checks: Record<string, boolean>;
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
  const listed = new Map<string, { tools: number; failed: boolean }>();

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
    const reachCalls: Measured['reachCalls'][number][] = [];
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
        else if (event.kind === 'tool_done') {
          if (event.server !== PI_MCP_SERVER_LABEL) reachCalls.push({ server: event.server, name: event.name, failed: event.failed });
        } else if (event.kind === 'tools_listed') listed.set(event.server, { tools: event.tools, failed: event.failed });
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
    return { firstTextMs, lastTextMs, totalMs, deltas, toolCalls, toolResults, reachCalls, characters: output.length, text: output.slice(0, 200), usage, costDkk,
      aborted: abortedAt !== null, abortToCloseMs: closedMs };
  }

  // A reply of a few dozen words, so streaming can be told from one buffered chunk; one short sentence cannot.
  const cold = await measure('In about 60 words, introduce yourself as PI, Jarvis on the Copilot harness, and say what you can do for Dan.');
  const warm: Measured[] = [];
  for (let index = 0; index < (options.warmTurns ?? 3); index += 1) {
    warm.push(await measure(`Reply with one short sentence about the number ${index + 2}.`));
  }
  const tools = await measure(
    'Use find_tools to look up "jobs", then run list_jobs with call_tool and empty arguments, then say in one sentence how many jobs are running.',
  );
  const strip = (turn: Measured & { abortToCloseMs?: number }): Measured => {
    const { abortToCloseMs, ...rest } = turn;
    void abortToCloseMs;
    return rest;
  };
  // A reach server gets a turn only when the harness listed its tools; a server that is not attached is reported as such.
  const reach: { server: 'github' | 'azure'; turn: Measured }[] = [];
  const reachPrompts = {
    github: 'Use the github tools (read only) to read the title of issue 700 in the repository DanAakesen/jarvis, then say it in one sentence.',
    azure: 'Use the azure tools (read only) to list the resource groups of the subscription, then say how many there are in one sentence.',
  } as const;
  for (const server of ['github', 'azure'] as const) {
    if (listed.get(server) && !listed.get(server)!.failed) reach.push({ server, turn: strip(await measure(reachPrompts[server])) });
  }
  const cancelled = await measure('Write a very long, detailed story of at least 400 words about a butler.', { abortAfterFirstText: true });
  const followUp = await measure('Reply with exactly: still here').then(turn => turn.characters > 0, () => false);

  const all = [cold, ...warm, tools, ...reach.map(({ turn }) => turn), cancelled];
  const warmMedian = [...warm].map(turn => turn.firstTextMs ?? Infinity).sort((a, b) => a - b)[Math.floor(warm.length / 2)] ?? Infinity;
  return {
    cold: strip(cold), warm: warm, tools: strip(tools),
    listed: [...listed].map(([server, entry]) => ({ server, ...entry })), reach,
    cancel: { abortToCloseMs: cancelled.abortToCloseMs, partialCharacters: cancelled.characters, followUpOk: followUp },
    totalCostDkk: Number(all.reduce((sum, turn) => sum + turn.costDkk, 0).toFixed(4)),
    checks: {
      // Real streaming: several deltas, with the last arriving well after the first.
      streaming: cold.deltas > 3 && (cold.lastTextMs ?? 0) - (cold.firstTextMs ?? 0) > 100,
      // The tool must have run and succeeded as the server saw it: model text or an mcp_call item alone prove nothing.
      tools_over_mcp: toolRanOk(tools.toolResults),
      cancellation: cancelled.aborted && cancelled.abortToCloseMs < 5_000 && followUp,
      warm_faster_than_cold: warmMedian < (cold.firstTextMs ?? 0),
      // A reach check exists only for a server the harness reported on: a server that listed its tools must also answer a read
      // without an error, and one whose listing failed fails its check. A server that is not attached has no check at all.
      ...Object.fromEntries(['github', 'azure'].flatMap((server) => {
        const entry = listed.get(server);
        if (!entry) return [];
        const turn = reach.find((candidate) => candidate.server === server)?.turn;
        return [[`reach_${server}`, !entry.failed && turn !== undefined && turn.reachCalls.some(call => call.server === server && !call.failed)]];
      })),
      ...(listed.size > 0 ? { mcp_listing: [...listed.values()].every(entry => !entry.failed) } : {}),
    },
  };
}
