/**
 * A scripted stand-in for the managed Foundry harness: it answers the PI gateway's `/conversations`, `/responses` (server-sent
 * events) and `/responses/:id/cancel` calls from a list of responses, and plays the model's Jarvis tool calls against the real
 * Jarvis MCP door with the live turn reference, as the harness would. Nothing here calls a provider.
 */

export interface UsageScript { readonly input: number; readonly cached: number; readonly output: number }

export interface McpOutcome {
  readonly status: number;
  readonly isError: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly body: Record<string, any> | undefined;
}

/** `live` is the turn reference of the message being answered; `stale` is the one of the turn before it. */
export interface ScriptedMcp {
  readonly tool: 'find_tools' | 'call_tool';
  /** Fixed, or written from the tool results so far (a task's exact path, line and version come from a search). */
  readonly args: Record<string, unknown> | ((tools: readonly McpRecord[]) => Record<string, unknown>);
  readonly turn?: 'live' | 'stale';
}

export type Step<World> =
  /** Streamed model text; a function writes it from the tool results so far, as a model reads what a tool returned. */
  | { readonly say: string | ((tools: readonly McpRecord[]) => string) }
  /** A Jarvis tool call over MCP, performed for real between the `added` and `done` events of the item. */
  | { readonly mcp: ScriptedMcp }
  /** A call the harness ran itself (a sub-agent `task`): the call item, then its own result item. */
  | { readonly native: { readonly name: string; readonly callId: string; readonly output: string } }
  /** A `function_call` the response ends on, unanswered: only the client can answer it. */
  | { readonly client: { readonly name: string; readonly callId: string } }
  /** Any side effect at an exact point of the response (a proactive message arriving, a second request). */
  | { readonly run: (world: World) => Promise<void> | void }
  /** Stays here until the test calls `release(name)` or the gateway aborts the request. */
  | { readonly hold: string };

export interface ScriptedResponse<World> {
  readonly steps: readonly Step<World>[];
  readonly usage?: UsageScript;
  /** Answer with a plain HTTP failure instead of a stream. */
  readonly httpStatus?: number;
  readonly retryAfter?: string;
  /** End the stream with `response.failed` and this code instead of `response.completed`. */
  readonly failWith?: string;
}

export interface FoundryRequest {
  readonly kind: 'warmup' | 'turn' | 'follow_up';
  readonly conversation: string;
  readonly input: readonly unknown[];
  /** The text of the first input message for a turn or warm-up; undefined for a follow-up that answers harness items. */
  readonly text: string | undefined;
}

export interface McpRecord {
  readonly tool: 'find_tools' | 'call_tool';
  readonly args: Record<string, unknown>;
  readonly turn: 'live' | 'stale';
  readonly outcome: McpOutcome;
}

export interface ScriptedFoundry<World> {
  readonly fetcher: typeof fetch;
  readonly requests: FoundryRequest[];
  readonly mcp: McpRecord[];
  readonly cancels: string[];
  /** The turn references the model was given, oldest first. */
  readonly turns: string[];
  enqueue(...responses: ScriptedResponse<World>[]): void;
  remaining(): number;
  conversations(): number;
  release(name: string): void;
  /** Resolves when a response reaches the `hold` with this name. */
  reached(name: string): Promise<void>;
}

const turnReference = /^\[Turn (jt-[A-Za-z0-9_-]{22}) \|/u;
const defaultUsage: UsageScript = { input: 11_000, cached: 9_000, output: 40 };
const encoder = new TextEncoder();
const frame = (event: Record<string, unknown>) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

interface Deferred { readonly promise: Promise<void>; resolve(): void }
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** The text in two or three pieces, as a model streams it. */
function pieces(text: string): string[] {
  const words = text.split(/(?<= )/u);
  const size = Math.max(1, Math.ceil(words.length / 3));
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += size) chunks.push(words.slice(index, index + size).join(''));
  return chunks;
}

export function createScriptedFoundry<World>(options: {
  readonly world: () => World;
  readonly callMcp: (tool: 'find_tools' | 'call_tool', args: Record<string, unknown>) => Promise<McpOutcome>;
}): ScriptedFoundry<World> {
  const script: ScriptedResponse<World>[] = [];
  const requests: FoundryRequest[] = [];
  const mcp: McpRecord[] = [];
  const cancels: string[] = [];
  const turns: string[] = [];
  const holds = new Map<string, { reached: Deferred; released: Deferred }>();
  const hold = (name: string) => {
    let entry = holds.get(name);
    if (!entry) { entry = { reached: deferred(), released: deferred() }; holds.set(name, entry); }
    return entry;
  };
  let conversations = 0;
  let responses = 0;
  let live: string | undefined;
  let previous: string | undefined;
  let items = 0;

  async function play(response: ScriptedResponse<World>, id: string, controller: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal | null | undefined, closed: () => boolean): Promise<void> {
    const send = (event: Record<string, unknown>) => { if (!closed()) controller.enqueue(encoder.encode(frame(event))); };
    send({ type: 'response.created', response: { id, status: 'in_progress' } });
    for (const step of response.steps) {
      if ('say' in step) {
        for (const delta of pieces(typeof step.say === 'function' ? step.say(mcp) : step.say)) send({ type: 'response.output_text.delta', delta });
      } else if ('mcp' in step) {
        const item = { type: 'mcp_call', server_label: 'jarvis', name: step.mcp.tool, id: `mcp_${items += 1}` };
        send({ type: 'response.output_item.added', item });
        const stale = step.mcp.turn === 'stale';
        const turn = stale ? previous : live;
        const wanted = typeof step.mcp.args === 'function' ? step.mcp.args(mcp) : step.mcp.args;
        const args = 'turn' in wanted ? wanted : { turn, ...wanted };
        const outcome = await options.callMcp(step.mcp.tool, args);
        mcp.push({ tool: step.mcp.tool, args: wanted, turn: stale ? 'stale' : 'live', outcome });
        send({ type: 'response.output_item.done', item: { ...item, output: JSON.stringify(outcome.body ?? null), error: null } });
      } else if ('native' in step) {
        const call = { type: 'function_call', name: step.native.name, call_id: step.native.callId, id: `fc_${items += 1}`, arguments: '{"prompt":"look it up"}' };
        send({ type: 'response.output_item.added', item: { ...call, status: 'in_progress', arguments: '' } });
        send({ type: 'response.output_item.done', item: { ...call, status: 'completed' } });
        send({ type: 'response.output_item.done', item: { type: 'function_call_output', call_id: step.native.callId, output: step.native.output } });
      } else if ('client' in step) {
        const call = { type: 'function_call', name: step.client.name, call_id: step.client.callId, id: `fc_${items += 1}`, arguments: '{}' };
        send({ type: 'response.output_item.added', item: { ...call, status: 'in_progress', arguments: '' } });
        send({ type: 'response.output_item.done', item: { ...call, status: 'completed' } });
      } else if ('run' in step) {
        await step.run(options.world());
      } else {
        const entry = hold(step.hold);
        entry.reached.resolve();
        await new Promise<void>(resolve => {
          void entry.released.promise.then(resolve);
          if (signal?.aborted) resolve();
          else signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal?.aborted) return;
      }
    }
    if (response.failWith) {
      send({ type: 'response.failed', response: { id, status: 'failed', error: { code: response.failWith } } });
      return;
    }
    const usage = response.usage ?? defaultUsage;
    send({
      type: 'response.completed',
      response: { id, status: 'completed', usage: { input_tokens: usage.input, input_tokens_details: { cached_tokens: usage.cached }, output_tokens: usage.output } },
    });
  }

  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE' && url.includes('/conversations/')) return new Response(null, { status: 204 });
    if (url.includes('/conversations')) { conversations += 1; return Response.json({ id: `conv_${conversations}` }); }
    if (url.includes('/cancel')) { cancels.push(url.split('/responses/')[1]!.split('/')[0]!); return Response.json({ status: 'cancelled' }); }
    const body = JSON.parse(String(init?.body)) as { conversation: string; input: unknown[] };
    const first = body.input[0] as { content?: unknown } | undefined;
    const text = typeof first?.content === 'string' ? first.content : undefined;
    if (text?.includes('Session warm-up only.')) {
      requests.push({ kind: 'warmup', conversation: body.conversation, input: body.input, text });
      const ready = frame({ type: 'response.created', response: { id: 'resp_warm' } }) + frame({ type: 'response.output_text.delta', delta: 'ready' }) +
        frame({ type: 'response.completed', response: { id: 'resp_warm', status: 'completed', usage: { input_tokens: 11_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2 } } });
      return new Response(ready, { headers: { 'content-type': 'text/event-stream' } });
    }
    const turn = text === undefined ? undefined : turnReference.exec(text)?.[1];
    if (turn !== undefined) { previous = live; live = turn; turns.push(turn); }
    requests.push({ kind: text === undefined ? 'follow_up' : 'turn', conversation: body.conversation, input: body.input, text });
    const response = script.shift();
    if (!response) throw new Error('The scripted Foundry has no response left for this request.');
    if (response.httpStatus !== undefined) {
      return new Response('{}', { status: response.httpStatus, headers: response.retryAfter ? { 'retry-after': response.retryAfter } : {} });
    }
    responses += 1;
    const id = `resp_${responses}`;
    let closed = false;
    return new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        try { await play(response, id, controller, init?.signal, () => closed); } catch (error) { if (!closed) controller.error(error); return; }
        if (!closed) controller.close();
      },
      cancel() { closed = true; },
    }), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;

  return {
    fetcher, requests, mcp, cancels, turns,
    enqueue(...responses) { script.push(...responses); },
    remaining: () => script.length,
    conversations: () => conversations,
    release: (name) => hold(name).released.resolve(),
    reached: (name) => hold(name).reached.promise,
  };
}
