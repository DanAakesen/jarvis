import { describe, expect, it } from 'vitest';
import { createRemoteMcpBridge } from './remote-mcp.js';

const signal = () => new AbortController().signal;

function server(options: { sse?: boolean; expireOnce?: boolean; callResult?: Record<string, unknown> } = {}) {
  const seen: { method: string; auth: string | null; session: string | null }[] = [];
  let expired = false;
  const fetchStub = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { name?: string } };
    const headers = init.headers as Record<string, string>;
    seen.push({ method: body.method, auth: headers.authorization ?? null, session: headers['mcp-session-id'] ?? null });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (options.expireOnce && !expired && body.method === 'tools/list') { expired = true; return new Response('gone', { status: 404 }); }
    const results: Record<string, unknown> = {
      initialize: { protocolVersion: '2025-06-18', capabilities: {} },
      'tools/list': { tools: [{ name: 'issue_write', description: 'Create or update an issue', inputSchema: { type: 'object' } }, { name: 'bad name!', description: 'x' }] },
      'tools/call': options.callResult ?? (body.params?.name === 'broken'
        ? { isError: true, content: [{ type: 'text', text: 'Not Found' }] }
        : body.params?.name === 'structured'
          ? { content: [{ type: 'text', text: 'summary text' }], structuredContent: { items: [1, 2] } }
          : { content: [{ type: 'text', text: JSON.stringify({ number: 700, title: 'Hello' }) }] }),
    };
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: results[body.method] });
    return options.sse
      ? new Response(`event: message\ndata: ${message}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 's1' } })
      : new Response(message, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { seen, fetchStub };
}

describe('the GitHub bridge', () => {
  it('lists the remote tools as gh_ catalogue entries with the token, once, and drops unusable names', async () => {
    const { seen, fetchStub } = server();
    const bridge = createRemoteMcpBridge({ url: 'https://gh.example/mcp/x/all', prefix: 'gh_', label: 'GitHub', token: async () => 'github_pat_x', fetch: fetchStub });
    const tools = await bridge.tools(signal());
    expect(tools.map(({ name }) => name)).toEqual(['gh_issue_write']);
    expect(tools[0]!.description).toBe('GitHub: Create or update an issue');
    expect(seen.every(({ auth }) => auth === 'Bearer github_pat_x')).toBe(true);
    const calls = seen.length;
    await bridge.tools(signal());
    expect(seen).toHaveLength(calls);
  });

  it('calls a tool, reads a streamed answer, keeps the session and reports a remote error as an error', async () => {
    const { seen, fetchStub } = server({ sse: true });
    const bridge = createRemoteMcpBridge({ url: 'https://gh.example/mcp/x/all', prefix: 'gh_', label: 'GitHub', token: async () => 'github_pat_x', fetch: fetchStub });
    expect(await bridge.call('gh_issue_read', { issue_number: 700 }, signal())).toEqual({ outcome: 'ok', result: { number: 700, title: 'Hello' } });
    expect(seen.at(-1)).toMatchObject({ method: 'tools/call', session: 's1' });
    expect(await bridge.call('gh_broken', {}, signal())).toEqual({ outcome: 'error', result: { error: 'Not Found' } });
    await expect(bridge.call('issue_read', {}, signal())).rejects.toThrow('not_a_remote_tool');
  });

  it('prefers structuredContent over the text rendering of a result', async () => {
    const { fetchStub } = server();
    const bridge = createRemoteMcpBridge({ url: 'https://gh.example', prefix: 'gh_', label: 'GitHub', token: async () => 't', fetch: fetchStub });
    expect(await bridge.call('gh_structured', {}, signal())).toEqual({ outcome: 'ok', result: { items: [1, 2] } });
  });

  it.each(['const value = 7;', ''])('returns embedded GitHub file text, including an empty file', async (content) => {
    const receipt = 'successfully downloaded text file (SHA: abc123)';
    const uri = 'repo://owner/project/refs/heads/main/value.ts';
    const { fetchStub } = server({ callResult: { content: [
      { type: 'text', text: receipt }, { type: 'resource', resource: { uri, mimeType: 'text/plain', text: content } },
    ] } });
    const bridge = createRemoteMcpBridge({ url: 'https://gh.example', prefix: 'gh_', label: 'GitHub', token: async () => 't', fetch: fetchStub });
    expect((await bridge.call('gh_get_file_contents', { path: 'value.ts' }, signal())).result).toEqual({ receipt, uri, content });
  });

  it('finds source in the structured file blocks even when the other blocks carry a receipt and a blob', async () => {
    const receipt = 'successfully downloaded text file (SHA: abc123)';
    const uri = 'repo://owner/project/sha/abc123/value.ts';
    const { fetchStub } = server({ callResult: {
      content: [{ type: 'text', text: receipt }, { type: 'resource', resource: { uri, blob: 'AAAA' } }],
      structuredContent: { content: [{ type: 'resource', resource: { uri, text: 'export default 42;' } }] },
    } });
    const bridge = createRemoteMcpBridge({ url: 'https://gh.example', prefix: 'gh_', label: 'GitHub', token: async () => 't', fetch: fetchStub });
    expect((await bridge.call('gh_get_file_contents', { path: 'value.ts', sha: 'abc123' }, signal())).result)
      .toEqual({ receipt, uri, content: 'export default 42;' });
  });

  it('does not make a search wait for a stalled GitHub, and stops waiting when the turn is cancelled', async () => {
    const stalled = createRemoteMcpBridge({ url: 'https://gh.example', prefix: 'gh_', label: 'GitHub', token: async () => 't', fetch: (async (_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as unknown as typeof fetch });
    const turn = new AbortController();
    const waiting = stalled.tools(turn.signal);
    turn.abort(new Error('turn cancelled'));
    await expect(waiting).rejects.toThrow('turn cancelled');
  });

  it('lets a server that scales from zero finish starting after a search stopped waiting, and uses the list at the next search', async () => {
    let started = false;
    const slow = server();
    const bridge = createRemoteMcpBridge({
      url: 'https://az.example', prefix: 'az_', label: 'Azure', token: async () => 'token',
      fetch: (async (url: string, init: RequestInit) => {
        if (!started) await new Promise((resolve) => setTimeout(resolve, 150));
        started = true;
        return slow.fetchStub(url, init);
      }) as unknown as typeof fetch,
    });
    // A search that gives up after 20 ms gets nothing; the refresh goes on and the next search has the list.
    expect(await bridge.tools(signal(), 20)).toEqual([]);
    expect((await bridge.tools(signal(), 2_000)).map(({ name }) => name)).toEqual(['az_issue_write']);
  });

  it('opens a new session when the old one expired, and answers with an empty list instead of failing when GitHub is down', async () => {
    const expiring = server({ sse: true, expireOnce: true });
    const bridge = createRemoteMcpBridge({ url: 'https://gh.example/mcp/x/all', prefix: 'gh_', label: 'GitHub', token: async () => 'github_pat_x', fetch: expiring.fetchStub });
    expect((await bridge.tools(signal())).map(({ name }) => name)).toEqual(['gh_issue_write']);
    expect(expiring.seen.filter(({ method }) => method === 'initialize')).toHaveLength(2);
    const down = createRemoteMcpBridge({ url: 'https://gh.example', prefix: 'gh_', label: 'GitHub', token: async () => 't', fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(await down.tools(signal())).toEqual([]);
    expect(await down.call('gh_x', {}, signal())).toMatchObject({ outcome: 'error' });
  });
});

describe('a server that scales from zero', () => {
  it('starts idle, reports starting while the first list loads and ready after, and warm() starts it without a search', async () => {
    const slow = server();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bridge = createRemoteMcpBridge({
      url: 'https://az.example', prefix: 'az_', label: 'Azure', token: async () => 't',
      fetch: (async (url: string, init: RequestInit) => { await gate; return slow.fetchStub(url, init); }) as unknown as typeof fetch,
    });
    expect(bridge.status()).toEqual({ state: 'idle' });
    bridge.warm();
    expect(await bridge.tools(signal(), 10)).toEqual([]);
    expect(bridge.status()).toEqual({ state: 'starting' });
    release();
    expect((await bridge.tools(signal(), 2_000)).map(({ name }) => name)).toEqual(['az_issue_write']);
    expect(bridge.status()).toEqual({ state: 'ready' });
  });

  it('names a failed first list and tries again at the next search instead of caching the failure', async () => {
    const ok = server();
    let calls = 0;
    const bridge = createRemoteMcpBridge({
      url: 'https://az.example', prefix: 'az_', label: 'Azure', token: async () => 't',
      fetch: (async (url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 1) return new Response('no', { status: 401 });
        return ok.fetchStub(url, init);
      }) as unknown as typeof fetch,
    });
    expect(await bridge.tools(signal(), 2_000)).toEqual([]);
    expect(bridge.status()).toEqual({ state: 'unreachable', reason: 'the server answered HTTP 401' });
    expect((await bridge.tools(signal(), 2_000)).map(({ name }) => name)).toEqual(['az_issue_write']);
    expect(bridge.status()).toEqual({ state: 'ready' });
  });
});

