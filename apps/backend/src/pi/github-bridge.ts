import type { RegisteredTool } from '../core/tool-registry.js';

/** GitHub's tools reach PI through the Jarvis MCP door, so the harness lists two tools instead of about a hundred. */
export const githubToolPrefix = 'gh_';

const protocolVersion = '2025-06-18';
const listTtlMs = 30 * 60_000;
const maxPages = 10;

interface RemoteTool { readonly name: string; readonly description?: string; readonly inputSchema?: Record<string, unknown> }
interface RpcResponse { readonly result?: Record<string, unknown>; readonly error?: { readonly message?: string } }

export interface GithubCallResult {
  readonly outcome: 'ok' | 'error';
  readonly result: unknown;
}

export interface GithubBridge {
  /** The remote server's tools as catalogue entries named `gh_<tool>`; empty when GitHub cannot be reached. */
  tools(signal: AbortSignal): Promise<readonly RegisteredTool[]>;
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
 * A small client for the GitHub MCP server (Streamable HTTP). The token is the owner's fine-grained one and stays on the backend.
 * The tool list is read once and kept for half an hour; a failed refresh keeps the last list.
 */
export function createGithubBridge(options: { readonly url: string; readonly token: string; readonly fetch?: typeof fetch; readonly now?: () => number }): GithubBridge {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let session: string | undefined | null = null;
  let counter = 0;
  let listed: { readonly at: number; readonly tools: readonly RegisteredTool[] } | undefined;

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    authorization: `Bearer ${options.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': protocolVersion } : {}), ...extra,
  });

  async function rpc(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    counter += 1;
    const id = counter;
    const response = await send(options.url, { method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal });
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
      method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'jarvis-pi', version: '1.0.0' } } }),
    });
    if (!response.ok) throw new Error(`github_mcp_http_${response.status}`);
    await readRpc(response, id);
    session = response.headers.get('mcp-session-id') ?? undefined;
    await send(options.url, { method: 'POST', headers: headers(), signal, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
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
      name: `${githubToolPrefix}${tool.name}`,
      description: `GitHub: ${tool.description ?? tool.name}`,
      inputSchema: tool.inputSchema ?? { type: 'object' },
      moduleId: 'github',
      execute: async () => { throw new Error('GitHub tools run through the bridge'); },
    }));
  }

  return {
    async tools(signal) {
      if (listed && now() - listed.at < listTtlMs) return listed.tools;
      try {
        listed = { at: now(), tools: await fetchTools(signal) };
      } catch (error) {
        if (signal.aborted) throw error;
        // Keep the last list, and try again after a minute instead of on every search.
        listed = { at: now() - listTtlMs + 60_000, tools: listed?.tools ?? [] };
      }
      return listed.tools;
    },

    async call(name, args, signal) {
      if (!name.startsWith(githubToolPrefix)) throw new Error('not_a_github_tool');
      try {
        const result = await withSession(() => rpc('tools/call', { name: name.slice(githubToolPrefix.length), arguments: args }, signal), signal);
        const body = text(result.content);
        let parsed: unknown = body;
        try { parsed = JSON.parse(body); } catch { /* plain text stays text */ }
        return result.isError === true ? { outcome: 'error', result: { error: body || 'GitHub returned an error.' } } : { outcome: 'ok', result: parsed };
      } catch (error) {
        if (signal.aborted) throw error;
        return { outcome: 'error', result: { error: 'GitHub could not be reached. Nothing is confirmed as done.' } };
      }
    },
  };
}
