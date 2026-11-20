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
/** A provider-specific search waits only this long for a remote catalogue... */
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
export type RemoteMcpTool = RegisteredTool & { readonly readOnly?: boolean };
interface RpcResponse { readonly result?: Record<string, unknown>; readonly error?: { readonly message?: string } }

export interface GithubCallResult {
  readonly outcome: 'ok' | 'error';
  readonly result: unknown;
}

export type RemoteMcpStatus =
  | { readonly state: 'ready'; readonly toolCount?: number }
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
  /** Starts loading the catalogue without waiting for it, so a server that scales from zero wakes before anyone asks. */
  warm(): void;
  /** The remote server's tools as catalogue entries named `<prefix><tool>`; empty when it cannot be reached. */
  tools(signal: AbortSignal, waitMs?: number): Promise<readonly RemoteMcpTool[]>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<GithubCallResult>;
}

type ProviderStatus = Exclude<RemoteMcpStatus, { state: 'ready' }> |
  { readonly state: 'not_configured' | 'ready' | 'empty' };

/** Snapshot known catalogue state for activation context. Does not connect or start a refresh. */
export function remoteMcpProviderStatus(bridges: readonly RemoteMcpBridge[] = []): Readonly<{
  github: ProviderStatus; azure: ProviderStatus;
}> {
  const status = (prefix: string): ProviderStatus => {
    const observed = bridges.find((bridge) => bridge.prefix === prefix)?.status();
    if (!observed) return { state: 'not_configured' };
    if (observed.state === 'ready') return { state: observed.toolCount === 0 ? 'empty' : 'ready' };
    return observed;
  };
  return { github: status(githubToolPrefix), azure: status(azureToolPrefix) };
}

/** Remote catalogue reads are opt-in: generic local searches must not wait on a provider. */
export function requestedRemoteMcpPrefixes(query: string): readonly string[] {
  const prefixes: string[] = [];
  if (/(?:^|[^\p{L}\p{N}])(?:github|gh)(?=$|[^\p{L}\p{N}])/iu.test(query)) prefixes.push(githubToolPrefix);
  if (/(?:^|[^\p{L}\p{N}])(?:azure|az)(?=$|[^\p{L}\p{N}])/iu.test(query)) prefixes.push(azureToolPrefix);
  return prefixes;
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
}): RemoteMcpBridge {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let session: string | undefined | null = null;
  let counter = 0;
  let listed: { readonly at: number; readonly tools: readonly RemoteMcpTool[] } | undefined;
  let refreshing: Promise<void> | undefined;
  let failure: string | undefined;
  const cachedTools = () => listed?.tools ?? [];

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

  async function fetchTools(signal: AbortSignal): Promise<RemoteMcpTool[]> {
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
      moduleId: 'github',
      execute: async () => { throw new Error('Remote tools run through the bridge'); },
      ...(typeof tool.annotations?.readOnlyHint === 'boolean' ? { readOnly: tool.annotations.readOnlyHint } : {}),
    }));
  }

  return {
    prefix: options.prefix,
    label: options.label,
    status() {
      if (listed) return { state: 'ready', toolCount: listed.tools.length };
      return failure !== undefined && !refreshing ? { state: 'unreachable', reason: failure } : { state: 'starting' };
    },
    warm() { if (!listed || now() - listed.at >= listTtlMs) void refresh(); },
    async tools(signal, waitMs = searchWaitMs) {
      signal.throwIfAborted();
      if (listed) {
        if (now() - listed.at >= listTtlMs) void refresh();
        return listed.tools;
      }
      // Only a cold search waits; future searches can use the last catalogue while refreshing in the background.
      const loading = refresh();
      if (waitMs === 0) return cachedTools();
      const wait = AbortSignal.any([signal, AbortSignal.timeout(waitMs)]);
      let stop: () => void = () => {};
      try {
        await Promise.race([loading, new Promise<void>((resolve) => {
          stop = resolve;
          if (wait.aborted) stop(); else wait.addEventListener('abort', stop, { once: true });
        })]);
        signal.throwIfAborted();
        return cachedTools();
      } finally {
        wait.removeEventListener('abort', stop);
      }
    },

    async call(name, args, signal) {
      if (!name.startsWith(options.prefix)) throw new Error('not_a_remote_tool');
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(callTimeoutMs)]);
      try {
        const result = await withSession(() => rpc('tools/call', { name: name.slice(options.prefix.length), arguments: args }, bounded), bounded);
        const body = text(result.content);
        let parsed: unknown = body;
        try { parsed = JSON.parse(body); } catch { /* plain text stays text */ }
        return result.isError === true ? { outcome: 'error', result: { error: body || `${options.label} returned an error.` } } : { outcome: 'ok', result: parsed };
      } catch (error) {
        if (signal.aborted) throw error;
        return { outcome: 'error', result: { error: `${options.label} could not be reached. Nothing is confirmed as done.` } };
      }
    },
  };
}
