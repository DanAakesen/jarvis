import type { FastifyInstance } from 'fastify';
import { createPiAuth, type PiAuth } from '../../auth/pi-credential.js';
import type { PiTurnGrant, PiTurnRegistry } from '../turns.js';

export const mcpSecret = 'C'.repeat(43);

type Json = Record<string, unknown>;

export interface FoundTool { readonly name: string; readonly description: string; readonly parameters: Json }
export interface OtherMatch { readonly name: string; readonly description: string }

export interface FindResult {
  readonly outcome: string;
  readonly tools: readonly FoundTool[];
  readonly otherMatches: readonly OtherMatch[];
  readonly note: string | undefined;
  readonly raw: string;
}

export interface CallResult {
  readonly status: number;
  /** The outcome the tool reported through call_tool: ok, refused or error. `unknown` when the answer was not an envelope. */
  readonly outcome: 'ok' | 'refused' | 'error' | 'unknown';
  readonly result: unknown;
  readonly isError: boolean;
  readonly truncated: boolean;
  readonly raw: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

/** A live PI turn whose reference is required by the MCP door. */
export interface ConformanceTurn { readonly grant: PiTurnGrant; close(): void }

export interface McpClient {
  /** A chat or voice turn, or (`wake`) a background brain wake that also sees the wake-only tools. */
  openTurn(options?: { readonly wake?: boolean; readonly activation?: PiTurnGrant['activation'] }): ConformanceTurn;
  find(turn: ConformanceTurn, query: string): Promise<FindResult>;
  call(turn: ConformanceTurn, name: string, args: Json, timeoutMs?: number, callId?: string): Promise<CallResult>;
  direct(turn: ConformanceTurn, name: string, args: Json, callId?: string): Promise<CallResult>;
  /** The tools/list answer, without the rest of the catalogue. */
  listDoorTools(): Promise<readonly string[]>;
  /** The full tools/list definitions, as the harness reads them. */
  listDoorDefinitions(): Promise<readonly { readonly name: string; readonly description?: string; readonly inputSchema?: Json }[]>;
}

const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;

/** The same client the managed agent is: JSON-RPC over the real `/pi/mcp` route with the static PI credential. */
export function createMcpClient(options: {
  readonly app: FastifyInstance;
  readonly registry: PiTurnRegistry;
  readonly auth: PiAuth;
  readonly owner: string;
  readonly sessionId: string;
  /** Read when a turn opens, so every call can be attributed to its own stored Dan message. */
  readonly messageId: () => string;
  readonly secret?: string;
}): McpClient {
  const { app, registry, owner } = options;
  const secret = options.secret ?? mcpSecret;
  let counter = 0;

  async function rpc(method: string, params: Json = {}, timeoutMs = 20_000): Promise<{ status: number; body: Json | undefined; raw: string; timedOut: boolean }> {
    counter += 1;
    const abort = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    // inject() does not stop waiting for a handler that never answers, so the wait itself is raced against the timer.
    const timedOut = new Promise<'timed-out'>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve('timed-out'); }, timeoutMs); });
    const request = app.inject({
      method: 'POST', url: '/pi/mcp', remoteAddress: '10.0.0.9', signal: abort.signal,
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        authorization: bearer(`jp.${secret}`),
      },
      payload: { jsonrpc: '2.0', id: counter, method, params },
    });
    request.catch(() => undefined);
    try {
      const response = await Promise.race([request, timedOut]);
      if (response === 'timed-out') return { status: 0, body: undefined, raw: '', timedOut: true };
      const data = response.body.includes('data:')
        ? response.body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : response.body;
      let body: Json | undefined;
      try { body = data ? JSON.parse(data) as Json : undefined; } catch { body = undefined; }
      return { status: response.statusCode, body, raw: response.body, timedOut: false };
    } catch {
      return { status: 0, body: undefined, raw: '', timedOut: abort.signal.aborted };
    } finally {
      clearTimeout(timer);
    }
  }

  const contentText = (body: Json | undefined): string | undefined => {
    const result = body?.result as { content?: { text?: string }[] } | undefined;
    return result?.content?.[0]?.text;
  };

  async function callTool(name: string, args: Json, timeoutMs = 20_000, callId?: string): Promise<CallResult> {
    const started = performance.now();
    const answer = await rpc('tools/call', { name, arguments: args, ...(callId ? { _meta: { tool_call_id: callId } } : {}) }, timeoutMs);
    const durationMs = performance.now() - started;
    const text = contentText(answer.body);
    let envelope: { outcome?: string; result?: unknown } | undefined;
    try { envelope = text ? JSON.parse(text) as typeof envelope : undefined; } catch { envelope = undefined; }
    const outcome = envelope?.outcome === 'ok' || envelope?.outcome === 'refused' || envelope?.outcome === 'error' ? envelope.outcome : 'unknown';
    const marker = envelope?.result as { truncated?: boolean; totalCharacters?: number; preview?: string } | undefined;
    return {
      status: answer.status, outcome, result: envelope?.result, isError: (answer.body?.result as { isError?: boolean } | undefined)?.isError === true,
      truncated: marker?.truncated === true && typeof marker.totalCharacters === 'number' && typeof marker.preview === 'string',
      raw: text ?? answer.raw, durationMs, timedOut: answer.timedOut,
    };
  }

  return {
    openTurn(turnOptions = {}) {
      const controller = new AbortController();
      const grant = registry.open({
        ownerObjectId: owner, sessionId: options.sessionId, messageId: options.messageId(), signal: controller.signal,
        ...(turnOptions.wake ? { brain: { runId: 'conformance-wake', sent: [], wrote: [], looked: [] } } : {}),
        ...(turnOptions.activation ? { activation: turnOptions.activation } : {}),
      });
      return { grant, close: () => { registry.close(grant.turn); controller.abort(); } };
    },
    async find(turn, query) {
      const answer = await rpc('tools/call', { name: 'find_tools', arguments: { turn: turn.grant.turn, query } });
      const text = contentText(answer.body);
      let parsed: { outcome?: string; result?: { tools?: FoundTool[]; otherMatches?: OtherMatch[]; note?: string } } = {};
      try { parsed = text ? JSON.parse(text) as typeof parsed : {}; } catch { parsed = {}; }
      return {
        outcome: parsed.outcome ?? 'unknown', tools: parsed.result?.tools ?? [], otherMatches: parsed.result?.otherMatches ?? [],
        note: parsed.result?.note, raw: text ?? answer.raw,
      };
    },
    call: (turn, name, args, timeoutMs, callId) => callTool('call_tool', { turn: turn.grant.turn, name, arguments: args }, timeoutMs, callId),
    direct: (turn, name, args, callId) => callTool(name, { ...args, turn: turn.grant.turn }, undefined, callId),
    async listDoorDefinitions() {
      const answer = await rpc('tools/list');
      return ((answer.body?.result as { tools?: { name: string; description?: string; inputSchema?: Json }[] } | undefined)?.tools ?? []);
    },
    async listDoorTools() {
      const answer = await rpc('tools/list');
      const tools = (answer.body?.result as { tools?: { name: string }[] } | undefined)?.tools ?? [];
      return tools.map((tool) => tool.name).sort();
    },
  };
}

export function createConformanceAuth(tenantId: string): PiAuth { return createPiAuth(tenantId, mcpSecret); }
