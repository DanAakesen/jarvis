import type { RegisteredTool } from '../core/tool-registry.js';

/**
 * Remote MCP servers (GitHub, Azure) reach PI through the Jarvis MCP door instead of being tools of the harness: the harness
 * lists every tool of every server in every turn (GitHub's alone cost seconds and 13k tokens), and a server that is slow to
 * answer or to authenticate would fail the whole turn. Here their tools are searched like Jarvis's own and called on demand.
 */
export const githubToolPrefix = 'gh_';
export const azureToolPrefix = 'az_';

const protocolVersion = '2025-06-18';
const listTtlMs = 30 * 60_000;
const maxPages = 10;
/** A search of the local tools never waits long for a remote catalogue... */
const searchWaitMs = 8_000;
/**
 * ...but the refresh itself may take this long, so a container that scales from zero can finish starting in the background.
 * The Container Apps ingress holds a request for a stopped app for up to 240 s; giving up before that cancels a start that is
 * about to finish.
 */
const refreshTimeoutMs = 200_000;
const callTimeoutMs = 120_000;

interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}
interface RpcResponse { readonly result?: Record<string, unknown>; readonly error?: { readonly message?: string } }

export interface GithubCallResult {
  readonly outcome: 'ok' | 'error';
  readonly result: unknown;
  /** Only an explicitly annotated read may have its result shortened. */
  readonly readOnly?: true;
}

export type RemoteMcpStatus =
  /** Configured but not loaded: a bridge only loads when a request names the provider or the agent asks for it. */
  | { readonly state: 'idle' }
  | { readonly state: 'ready' }
  /** A last catalogue is usable, but refreshing it failed, so it is not freshly verified. */
  | { readonly state: 'stale'; readonly reason: string }
  /** The first list is still loading, for example because the server scales from zero. */
  | { readonly state: 'starting' }
  /** The last attempt failed and there is no list to use. `reason` names the failure and never repeats server text. */
  | { readonly state: 'unreachable'; readonly reason: string };

export interface RemoteMcpBridge {
  /** `gh_` or `az_`: the start of every tool name this bridge offers. */
  readonly prefix: string;
  /** Names the server for the model and the owner, for example `Azure`. */
  readonly label: string;
  /** Whether the catalogue is loaded, still loading, or could not be loaded; a search tells the model so. */
  status(): RemoteMcpStatus;
  /** Starts a catalogue refresh without waiting. Nothing calls it at startup: a bridge loads only when asked for. */
  warm(): void;
  /** The remote server's tools as catalogue entries named `<prefix><tool>`; empty when it cannot be reached. */
  tools(signal: AbortSignal, waitMs?: number): Promise<readonly RegisteredTool[]>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<GithubCallResult>;
}

/** The body of a JSON-RPC answer, whether the server sent plain JSON or a one-event stream. */
async function readRpc(response: Response, id: number): Promise<RpcResponse> {
  const body = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const message = JSON.parse(line.slice(5)) as RpcResponse & { id?: number };
      if (message.id === id) return message;
    }
    throw new Error('github_mcp_no_answer');
  }
  return JSON.parse(body) as RpcResponse;
}

function text(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
    ? [String((part as { text?: unknown }).text ?? '')] : []).join('\n');
}

/**
 * A small client for a remote MCP server (Streamable HTTP). The credential comes from `token()` on every request, so a managed
 * identity token is renewed by its own library and a static one stays on the backend. The tool list is read once and kept for
 * half an hour; a failed refresh keeps the last list.
 */
export function createRemoteMcpBridge(options: {
  readonly url: string;
  readonly prefix: string;
  /** Names the server in descriptions, for example `GitHub`. */
  readonly label: string;
  readonly token: (signal: AbortSignal) => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** How long one search waits for the catalogue (default 8 s). Tests shorten it; production leaves it. */
  readonly searchWaitMs?: number;
}): RemoteMcpBridge {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let session: string | undefined | null = null;
  let counter = 0;
  let listed: { readonly at: number; readonly tools: readonly RegisteredTool[] } | undefined;
  let refreshing: Promise<void> | undefined;
  let failure: string | undefined;

  const describeFailure = (error: unknown): string => {
    if (error instanceof Error && error.name === 'TimeoutError') return `no answer within ${refreshTimeoutMs / 1000} seconds`;
    const status = /^github_mcp_http_(\d{3})$/u.exec(error instanceof Error ? error.message : '');
    return status ? `the server answered HTTP ${status[1]}` : 'the connection failed';
  };

  /** One refresh at a time, shared by every search that arrives meanwhile. */
  function refresh(): Promise<void> {
    refreshing ??= fetchTools(AbortSignal.timeout(refreshTimeoutMs))
      .then((tools) => { listed = { at: now(), tools }; failure = undefined; }, (error: unknown) => {
        failure = describeFailure(error);
        // With a list in hand, ask again in a minute. With none, the next search asks at once.
        if (listed) listed = { at: now() - listTtlMs + 60_000, tools: listed.tools };
      })
      .finally(() => { refreshing = undefined; });
    return refreshing;
  }

  const headers = async (signal: AbortSignal): Promise<Record<string, string>> => ({
    authorization: `Bearer ${await options.token(signal)}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': protocolVersion } : {}),
  });

  async function rpc(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    counter += 1;
    const id = counter;
    const response = await send(options.url, { method: 'POST', headers: await headers(signal), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal });
    if (response.status === 404 && session) { session = null; throw new Error('github_mcp_session_expired'); }
    if (!response.ok) throw new Error(`github_mcp_http_${response.status}`);
    const answer = await readRpc(response, id);
    if (answer.error || !answer.result) throw new Error('github_mcp_error');
    return answer.result;
  }

  async function open(signal: AbortSignal): Promise<void> {
    if (session !== null) return;
    counter += 1;
    const id = counter;
    const response = await send(options.url, {
      method: 'POST', headers: await headers(signal), signal,
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'jarvis-pi', version: '1.0.0' } } }),
    });
    if (!response.ok) throw new Error(`github_mcp_http_${response.status}`);
    await readRpc(response, id);
    session = response.headers.get('mcp-session-id') ?? undefined;
    await send(options.url, { method: 'POST', headers: await headers(signal), signal, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  }

  async function withSession<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try { await open(signal); return await work(); } catch (error) {
        if (attempt === 0 && error instanceof Error && error.message === 'github_mcp_session_expired') continue;
        throw error;
      }
    }
  }

  async function fetchTools(signal: AbortSignal): Promise<RegisteredTool[]> {
    const found: RemoteTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await withSession(() => rpc('tools/list', cursor ? { cursor } : {}, signal), signal);
      found.push(...(result.tools as RemoteTool[] | undefined ?? []));
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return found.filter((tool) => /^[A-Za-z0-9_-]{1,60}$/u.test(tool.name)).map((tool) => ({
      name: `${options.prefix}${tool.name}`,
      description: `${options.label}: ${tool.description ?? tool.name}`,
      inputSchema: tool.inputSchema ?? { type: 'object' },
      ...(tool.annotations?.readOnlyHint === true ? { execution: { defaultEffect: 'read' as const } } : {}),
      moduleId: 'github',
      execute: async () => { throw new Error('Remote tools run through the bridge'); },
    }));
  }

  return {
    prefix: options.prefix,
    label: options.label,
    status() {
      if (listed) return failure !== undefined ? { state: 'stale', reason: failure } : { state: 'ready' };
      if (refreshing) return { state: 'starting' };
      return failure !== undefined ? { state: 'unreachable', reason: failure } : { state: 'idle' };
    },
    warm() { if (!listed || now() - listed.at >= listTtlMs) void refresh(); },
    async tools(signal, waitMs = options.searchWaitMs ?? searchWaitMs) {
      if (listed && now() - listed.at < listTtlMs) return listed.tools;
      // Bounded: a slow server costs a search a few seconds, then the last list (or none) is used.
      const loading = refresh();
      const wait = AbortSignal.any([signal, AbortSignal.timeout(waitMs)]);
      await Promise.race([loading, new Promise<void>((resolve, reject) => {
        const stop = () => (signal.aborted ? reject(signal.reason) : resolve());
        if (wait.aborted) stop(); else wait.addEventListener('abort', stop, { once: true });
      })]);
      return listed?.tools ?? [];
    },

    async call(name, args, signal) {
      if (!name.startsWith(options.prefix)) throw new Error('not_a_remote_tool');
      const readOnly = listed?.tools.some((tool) => tool.name === name && tool.execution?.defaultEffect === 'read');
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(callTimeoutMs)]);
      try {
        const result = await withSession(() => rpc('tools/call', { name: name.slice(options.prefix.length), arguments: args }, bounded), bounded);
        const body = text(result.content);
        let parsed: unknown = body;
        try { parsed = JSON.parse(body); } catch { /* plain text stays text */ }
        if (result.isError === true) return { outcome: 'error', result: { error: body || `${options.label} returned an error.` } };
        return { outcome: 'ok', result: result.structuredContent ?? parsed, ...(readOnly ? { readOnly: true } : {}) };
      } catch (error) {
        if (signal.aborted) throw error;
        return { outcome: 'error', result: { error: `${options.label} could not be reached. Nothing is confirmed as done.` } };
      }
    },
  };
}
