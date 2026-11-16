import { describe, expect, it } from 'vitest';
import { createGithubBridge } from './github-bridge.js';

const signal = () => new AbortController().signal;

function server(options: { sse?: boolean; expireOnce?: boolean } = {}) {
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
      'tools/call': body.params?.name === 'broken'
        ? { isError: true, content: [{ type: 'text', text: 'Not Found' }] }
        : { content: [{ type: 'text', text: JSON.stringify({ number: 700, title: 'Hello' }) }] },
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
    const bridge = createGithubBridge({ url: 'https://gh.example/mcp/x/all', token: 'github_pat_x', fetch: fetchStub });
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
    const bridge = createGithubBridge({ url: 'https://gh.example/mcp/x/all', token: 'github_pat_x', fetch: fetchStub });
    expect(await bridge.call('gh_issue_read', { issue_number: 700 }, signal())).toEqual({ outcome: 'ok', result: { number: 700, title: 'Hello' } });
    expect(seen.at(-1)).toMatchObject({ method: 'tools/call', session: 's1' });
    expect(await bridge.call('gh_broken', {}, signal())).toEqual({ outcome: 'error', result: { error: 'Not Found' } });
    await expect(bridge.call('issue_read', {}, signal())).rejects.toThrow('not_a_github_tool');
  });

  it('opens a new session when the old one expired, and answers with an empty list instead of failing when GitHub is down', async () => {
    const expiring = server({ sse: true, expireOnce: true });
    const bridge = createGithubBridge({ url: 'https://gh.example/mcp/x/all', token: 'github_pat_x', fetch: expiring.fetchStub });
    expect((await bridge.tools(signal())).map(({ name }) => name)).toEqual(['gh_issue_write']);
    expect(expiring.seen.filter(({ method }) => method === 'initialize')).toHaveLength(2);
    const down = createGithubBridge({ url: 'https://gh.example', token: 't', fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(await down.tools(signal())).toEqual([]);
    expect(await down.call('gh_x', {}, signal())).toMatchObject({ outcome: 'error' });
  });
});
