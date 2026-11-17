import { PI_MCP_SERVER_LABEL } from './definition.js';
import { azureToolPrefix, githubToolPrefix, type RemoteMcpBridge } from './remote-mcp.js';
import type { PiEvent, PiGateway, PiUsage } from './gateway.js';

interface Measured {
  readonly firstTextMs: number | null;
  readonly lastTextMs: number | null;
  readonly totalMs: number;
  readonly deltas: number;
  readonly toolCalls: number;
  /** What the tools run in this turn returned, from the MCP server's own record. */
  readonly toolResults: readonly { readonly tool: string; readonly outcome: 'ok' | 'refused' | 'error' }[];
  /** Calls to the reach servers (GitHub, Azure) with the harness's own verdict; Jarvis calls are in `toolResults`. */
  readonly reachCalls: readonly { readonly server: string; readonly name: string; readonly failed: boolean }[];
  readonly characters: number;
  readonly text: string;
  /** True when the reply read as speech: no markdown or list marks and a short word count. Judged on the whole reply. */
  readonly spokenShape: boolean;
  /** True when PI wrote a sentence before its first tool call (what Voice Live speaks while the tool runs). */
  readonly textBeforeTool: boolean;
  readonly usage: PiUsage;
  readonly costDkk: number;
  readonly aborted: boolean;
}

/**
 * The smoke is three requests, each well inside the 240 s the ingress allows a request, because the whole of it takes about four
 * minutes. Each part reports its own checks; the workflow calls them one after another and merges the answers.
 */
export const piSmokeParts = ['core', 'voice', 'reach'] as const;
export type PiSmokePart = typeof piSmokeParts[number];

interface PiSmokePartReport {
  readonly part: PiSmokePart;
  readonly totalCostDkk: number;
  readonly checks: Record<string, boolean>;
}

export interface PiSmokeCoreReport extends PiSmokePartReport {
  readonly part: 'core';
  /** The fixed prompt: first call of a new conversation with a trivial reply. Not a check; it explains the growth of longer turns. */
  readonly baseline: Measured;
  readonly cold: Measured;
  readonly warm: readonly Measured[];
  readonly tools: Measured;
  readonly cancel: { readonly abortToCloseMs: number; readonly partialCharacters: number; readonly followUpOk: boolean };
}

/** The PI leg of a voice turn: the same agent and conversation with the voice channel note. Voice Live's own audio time is not in it. */
export interface PiSmokeVoiceReport extends PiSmokePartReport {
  readonly part: 'voice';
  readonly voice: { readonly plain: Measured; readonly tools: Measured };
}

export interface PiSmokeReachReport extends PiSmokePartReport {
  readonly part: 'reach';
  /** Servers the harness listed tools for in this run, with the tool count: proof that each is attached and reachable. */
  readonly listed: readonly { readonly server: string; readonly tools: number; readonly failed: boolean; readonly reason?: string }[];
  /** One turn per attached reach server; absent servers get no turn and no check. */
  readonly reach: readonly { readonly server: 'github' | 'azure'; readonly turn: Measured }[];
  /** Natural prompts with no tool named: which tools PI reached for. Report only; the smoke role refuses everything but its reads, so nothing acts. */
  readonly choices: readonly { readonly label: string; readonly called: readonly string[]; readonly turn: Measured }[];
}

/** True only when list_jobs ran through call_tool and its own result was `ok`. */
export function toolRanOk(results: Measured['toolResults']): boolean {
  return results.some(result => result.tool === 'list_jobs' && result.outcome === 'ok');
}

const noUsage: PiUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

/** A reply that can be read aloud as it stands: plain words, no markup or list marks, a few sentences at most. */
export function isSpokenShape(text: string): boolean {
  const body = text.trim();
  return body.length > 0 && !/[*#|`[\]<>]|^\s*(?:[-•]|\d+[.)])\s/mu.test(body) && !body.includes('\n') && body.split(/\s+/u).length <= 70;
}

/**
 * Live proof for the Deploy workflow, one part at a time: scratch conversations (never the owner's). `core`: a cold turn, warm turns, a tool turn
 * through the Jarvis MCP server under the read-only smoke role, and a cancelled turn followed by a normal one. `voice`: the PI leg of
 * voice turns. `reach`: the GitHub and Azure servers and tool choice. It reports
 * what it observed; the workflow, not this code, decides how to present it.
 */
interface PiSmokeOptions { readonly warmTurns?: number; readonly bridges?: readonly RemoteMcpBridge[] | undefined }
export function runPiSmoke(gateway: PiGateway, signal: AbortSignal, options: PiSmokeOptions & { readonly part: 'core' }): Promise<PiSmokeCoreReport>;
export function runPiSmoke(gateway: PiGateway, signal: AbortSignal, options: PiSmokeOptions & { readonly part: 'voice' }): Promise<PiSmokeVoiceReport>;
export function runPiSmoke(gateway: PiGateway, signal: AbortSignal, options: PiSmokeOptions & { readonly part: 'reach' }): Promise<PiSmokeReachReport>;
export function runPiSmoke(gateway: PiGateway, signal: AbortSignal, options: PiSmokeOptions & { readonly part: PiSmokePart }): Promise<PiSmokeCoreReport | PiSmokeVoiceReport | PiSmokeReachReport>;
export async function runPiSmoke(gateway: PiGateway, signal: AbortSignal, options: PiSmokeOptions & { readonly part: PiSmokePart }): Promise<PiSmokeCoreReport | PiSmokeVoiceReport | PiSmokeReachReport> {
  const kit = gateway.smokeKit;
  const conversationId = await kit.createConversation(signal);
  const listed = new Map<string, { tools: number; failed: boolean; reason?: string }>();

  async function measure(text: string, config: { abortAfterFirstText?: boolean; voice?: boolean; environment?: boolean; conversation?: string } = {}): Promise<Measured & { abortToCloseMs: number }> {
    const controller = new AbortController();
    const turnSignal = AbortSignal.any([signal, controller.signal]);
    const grant = kit.openGrant(turnSignal);
    const started = performance.now();
    let firstTextMs: number | null = null;
    let lastTextMs: number | null = null;
    let deltas = 0;
    let toolCalls = 0;
    let textBeforeTool = false;
    const toolResults: Measured['toolResults'][number][] = [];
    let output = '';
    const reachCalls: Measured['reachCalls'][number][] = [];
    let usage = noUsage;
    let abortedAt: number | null = null;
    try {
      for await (const event of kit.respond(config.conversation ?? conversationId, kit.format(grant.turn, text, config.voice ? 'voice' : config.environment ? 'environment' : undefined), turnSignal) as AsyncIterable<PiEvent>) {
        const at = performance.now() - started;
        if (event.kind === 'delta') {
          firstTextMs ??= Math.round(at);
          lastTextMs = Math.round(at);
          deltas += 1;
          output += event.text;
          if (config.abortAfterFirstText && abortedAt === null) { abortedAt = performance.now(); controller.abort(); }
        } else if (event.kind === 'tool') { toolCalls += 1; if (toolCalls === 1) textBeforeTool = output.trim().length > 0; }
        else if (event.kind === 'tool_done') {
          if (event.server !== PI_MCP_SERVER_LABEL) reachCalls.push({ server: event.server, name: event.name, failed: event.failed });
        } else if (event.kind === 'tools_listed') listed.set(event.server, { tools: event.tools, failed: event.failed });
        else usage = event.usage;
      }
    } catch (error) {
      if (!(config.abortAfterFirstText && controller.signal.aborted)) throw error;
    } finally {
      toolResults.push(...grant.results);
      // GitHub and Azure run through the Jarvis door, so their calls are the door's own record, reported as each server's.
      for (const [prefix, server] of [[githubToolPrefix, 'github'], [azureToolPrefix, 'azure']] as const) {
        reachCalls.push(...grant.results.filter(result => result.tool.startsWith(prefix)).map(result => ({ server, name: result.tool.slice(prefix.length), failed: result.outcome !== 'ok' })));
      }
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
      spokenShape: isSpokenShape(output), textBeforeTool, aborted: abortedAt !== null, abortToCloseMs: closedMs };
  }

  const strip = (turn: Measured & { abortToCloseMs?: number }): Measured => {
    const { abortToCloseMs, ...rest } = turn;
    void abortToCloseMs;
    return rest;
  };
  const cost = (turns: readonly Measured[]) => Number(turns.reduce((sum, turn) => sum + turn.costDkk, 0).toFixed(4));

  if (options.part === 'core') {
    // The fixed prompt on its own: a new conversation and a reply that needs no skill or tool. Its input tokens are what every
    // conversation starts with; anything a longer turn adds beyond it (skills loaded, tool results) is the conversation's own growth.
    const baseline = await measure('Reply with exactly: ready', { conversation: await kit.createConversation(signal) });
    // A reply of a few dozen words, so streaming can be told from one buffered chunk; one short sentence cannot.
    const cold = await measure('In about 60 words, introduce yourself as PI, Jarvis on the Copilot harness, and say what you can do for Dan.');
    const warm: Measured[] = [];
    for (let index = 0; index < (options.warmTurns ?? 3); index += 1) {
      warm.push(await measure(`Reply with one short sentence about the number ${index + 2}.`));
    }
    const tools = await measure(
      'Use find_tools to look up "jobs", then run list_jobs with call_tool and empty arguments, then say in one sentence how many jobs are running.',
    );
    const cancelled = await measure('Write a very long, detailed story of at least 400 words about a butler.', { abortAfterFirstText: true });
    const followUp = await measure('Reply with exactly: still here').then(turn => turn.characters > 0, () => false);
    const warmMedian = [...warm].map(turn => turn.firstTextMs ?? Infinity).sort((a, b) => a - b)[Math.floor(warm.length / 2)] ?? Infinity;
    return {
      part: 'core',
      cold: strip(cold), warm, tools: strip(tools), baseline: strip(baseline),
      cancel: { abortToCloseMs: cancelled.abortToCloseMs, partialCharacters: cancelled.characters, followUpOk: followUp },
      totalCostDkk: cost([baseline, cold, ...warm, tools, cancelled]),
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

  if (options.part === 'voice') {
    // The PI leg of voice turns: what Dan says is short, and what PI says must be speakable.
    const voicePlain = await measure('Dan asks by voice: what is a good name for a goldfish?', { voice: true });
    const voiceTools = await measure(
      'Dan asks by voice: use find_tools to look up "jobs", then run list_jobs with call_tool and empty arguments, and tell me how many jobs are running.',
      { voice: true },
    );
    return {
      part: 'voice',
      voice: { plain: strip(voicePlain), tools: strip(voiceTools) },
      totalCostDkk: cost([voicePlain, voiceTools]),
      checks: {
        // Voice: the reply reads as speech, and a voice turn can use a tool as the server recorded it.
        voice_spoken_shape: voicePlain.spokenShape && voiceTools.spokenShape,
        voice_tools_over_mcp: toolRanOk(voiceTools.toolResults),
      },
    };
  }

  // A reach server gets a turn only when the harness listed its tools; a server that is not attached is reported as such.
  const reach: { server: 'github' | 'azure'; turn: Measured }[] = [];
  // The servers are waited for at once (a server starting from zero can take a minute; a search never waits for it).
  await Promise.all((options.bridges ?? []).map(async (bridge) => {
    const found = await bridge.tools(signal, 100_000).catch(() => []);
    const status = bridge.status();
    listed.set(bridge.prefix === azureToolPrefix ? 'azure' : 'github', {
      tools: found.length, failed: found.length === 0, ...(status.state === 'unreachable' ? { reason: status.reason } : status.state === 'starting' && found.length === 0 ? { reason: 'still starting after the wait' } : {}),
    });
  }));
  const reachPrompts = {
    github: 'Use find_tools to look up "github issue read", then call the GitHub tool gh_issue_read with owner "DanAakesen", repo "jarvis", issue_number 700 and method "get", then say the issue title in one sentence.',
    // The environment note carries the default subscription and the Jarvis resource group, as a real first turn would.
    azure: 'Use find_tools to look up "azure resource group resources list", then call the Azure tool that lists the resources in the Jarvis resource group, using the default subscription and resource group from the environment note without asking, and say how many resources there are in one sentence.',
  } as const;
  for (const server of ['github', 'azure'] as const) {
    if (listed.get(server) && !listed.get(server)!.failed) reach.push({ server, turn: strip(await measure(reachPrompts[server], { environment: server === 'azure' })) });
  }
  // Tool choice: realistic questions that name no tool. What PI searches for and calls shows whether it picks the right door.
  const choicePrompts = [
    { label: 'Azure question', text: 'What is in my Jarvis resource group?' },
    { label: 'GitHub question', text: 'Which pull requests are open in my Jarvis repository?' },
    { label: 'Notes question', text: 'What do my notes say about the garden?' },
    { label: 'PC request', text: 'Open Spotify on my PC and play something relaxing.' },
  ] as const;
  const choices: { label: string; called: string[]; turn: Measured }[] = [];
  for (const prompt of choicePrompts) {
    const turn = strip(await measure(prompt.text, { environment: true }));
    choices.push({ label: prompt.label, called: turn.toolResults.map(result => result.tool), turn });
  }
  return {
    part: 'reach',
    listed: [...listed].map(([server, entry]) => ({ server, ...entry })), reach, choices,
    totalCostDkk: cost([...reach.map(({ turn }) => turn), ...choices.map(({ turn }) => turn)]),
    checks: {
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
