/**
 * Stub MCP servers for the GitHub and Azure bridges: a Streamable-HTTP JSON-RPC server behind a `fetch` stub, with controls to
 * make it slow, unreachable, stale, erroring or very chatty. No network is used. The catalogues are shaped like the real servers'
 * (tool names, a one-line description, a small schema) but are fixtures, not copies of the live lists.
 */

export interface StubRemoteTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const repoProps = {
  owner: { type: 'string', description: 'Repository owner' },
  repo: { type: 'string', description: 'Repository name' },
} as const;
const paging = { page: { type: 'number' }, perPage: { type: 'number' } } as const;

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): StubRemoteTool => ({
  name, description, inputSchema: { type: 'object', properties, required },
});

export const stubGithubTools: readonly StubRemoteTool[] = [
  tool('issue_read', 'Get information about a specific issue in a GitHub repository.',
    { method: { type: 'string', enum: ['get', 'get_comments', 'get_sub_issues', 'get_labels'] }, ...repoProps, issue_number: { type: 'number' } },
    ['method', 'owner', 'repo', 'issue_number']),
  tool('issue_write', 'Create a new or update an existing issue in a GitHub repository.',
    { method: { type: 'string', enum: ['create', 'update'] }, ...repoProps, title: { type: 'string' }, body: { type: 'string' } },
    ['method', 'owner', 'repo']),
  tool('list_issues', 'List issues in a GitHub repository. For pagination, use the endCursor from the previous response.',
    { ...repoProps, state: { type: 'string', enum: ['OPEN', 'CLOSED'] }, ...paging }, ['owner', 'repo']),
  tool('search_issues', 'Search for issues in GitHub repositories using issues search syntax already scoped to is:issue.',
    { query: { type: 'string' }, ...paging }, ['query']),
  tool('add_issue_comment', 'Add a comment to a specific issue in a GitHub repository.',
    { ...repoProps, issue_number: { type: 'number' }, body: { type: 'string' } }, ['owner', 'repo', 'issue_number', 'body']),
  tool('list_pull_requests', 'List pull requests in a GitHub repository.',
    { ...repoProps, state: { type: 'string', enum: ['open', 'closed', 'all'] }, ...paging }, ['owner', 'repo']),
  tool('pull_request_read', 'Get information on a specific pull request in a GitHub repository.',
    { method: { type: 'string', enum: ['get', 'get_diff', 'get_status', 'get_files', 'get_review_comments', 'get_reviews'] }, ...repoProps, pullNumber: { type: 'number' } },
    ['method', 'owner', 'repo', 'pullNumber']),
  tool('search_pull_requests', 'Search for pull requests in GitHub repositories using issues search syntax already scoped to is:pr.',
    { query: { type: 'string' }, ...paging }, ['query']),
  tool('create_pull_request', 'Create a new pull request in a GitHub repository.',
    { ...repoProps, title: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' }, body: { type: 'string' } },
    ['owner', 'repo', 'title', 'head', 'base']),
  tool('merge_pull_request', 'Merge a pull request in a GitHub repository.',
    { ...repoProps, pullNumber: { type: 'number' }, merge_method: { type: 'string', enum: ['merge', 'squash', 'rebase'] } },
    ['owner', 'repo', 'pullNumber']),
  tool('list_commits', 'Get list of commits of a branch in a GitHub repository.', { ...repoProps, sha: { type: 'string' }, ...paging }, ['owner', 'repo']),
  tool('list_branches', 'List branches in a GitHub repository.', { ...repoProps, ...paging }, ['owner', 'repo']),
  tool('get_file_contents', 'Get the contents of a file or directory from a GitHub repository.',
    { ...repoProps, path: { type: 'string' }, ref: { type: 'string' } }, ['owner', 'repo']),
  tool('search_code', 'Fast and precise code search across ALL GitHub repositories using GitHub’s native search engine.',
    { query: { type: 'string' }, ...paging }, ['query']),
  tool('search_repositories', 'Find GitHub repositories by name, description, readme, topics, or other metadata.',
    { query: { type: 'string' }, ...paging }, ['query']),
  tool('actions_list', 'Tools for listing GitHub Actions resources: workflows, workflow runs, jobs and artifacts.',
    { method: { type: 'string', enum: ['list_workflows', 'list_workflow_runs', 'list_workflow_jobs'] }, ...repoProps }, ['method', 'owner', 'repo']),
  tool('list_releases', 'List releases in a GitHub repository.', { ...repoProps, ...paging }, ['owner', 'repo']),
];

export const stubAzureTools: readonly StubRemoteTool[] = [
  tool('group_list', 'List all resource groups in a subscription.', { subscription: { type: 'string' } }, []),
  tool('group_resource_list', 'List all resources in a resource group.', { subscription: { type: 'string' }, 'resource-group': { type: 'string' } }, ['resource-group']),
  tool('subscription_list', 'List all Azure subscriptions available to the signed-in account.', {}, []),
  tool('containerapps_list', 'List the Azure Container Apps in a subscription or resource group.', { subscription: { type: 'string' }, 'resource-group': { type: 'string' } }, []),
  tool('monitor_metrics_query', 'Query Azure Monitor metrics for a resource over a time range.', { resource: { type: 'string' }, metric: { type: 'string' } }, ['resource', 'metric']),
  tool('cost_query', 'Query the cost of Azure resources for a billing period.', { subscription: { type: 'string' }, timeframe: { type: 'string' } }, ['subscription']),
];

export interface StubServerControls {
  /** While set, every request waits for it (a server that is still waking from sleep). */
  gate?: Promise<void> | undefined;
  /** `tools/list` answers with this HTTP status while set; `network` fails the connection. */
  listFailure?: number | 'network' | undefined;
  /** Name of the tool whose call returns `isError`, and the text it carries. */
  erroringTool?: { readonly name: string; readonly text: string } | undefined;
  /** `tools/call` of this name returns a text result of this many characters. */
  largeTool?: { readonly name: string; readonly characters: number } | undefined;
  /** Names of tools to hide from the list (an upstream catalogue change). */
  hidden?: ReadonlySet<string> | undefined;
}

export interface StubServer {
  readonly fetch: typeof fetch;
  readonly controls: StubServerControls;
  readonly seen: { method: string; tool?: string | undefined }[];
}

/** A JSON-RPC MCP server over `fetch`: initialize, tools/list (JSON or one SSE event) and tools/call. */
export function createStubMcpServer(tools: readonly StubRemoteTool[], options: { readonly sse?: boolean } = {}): StubServer {
  const controls: StubServerControls = {};
  const seen: StubServer['seen'] = [];
  const stub = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    seen.push({ method: body.method, tool: body.params?.name });
    if (controls.gate) {
      const aborted = new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
      await Promise.race([controls.gate, aborted]);
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list' && controls.listFailure === 'network') throw new TypeError('fetch failed');
    if (body.method === 'tools/list' && typeof controls.listFailure === 'number') return new Response('upstream failure', { status: controls.listFailure });
    let result: unknown;
    if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'stub', version: '1' } };
    else if (body.method === 'tools/list') result = { tools: tools.filter((entry) => !controls.hidden?.has(entry.name)) };
    else if (body.method === 'tools/call') {
      const name = body.params?.name ?? '';
      if (controls.erroringTool?.name === name) result = { isError: true, content: [{ type: 'text', text: controls.erroringTool.text }] };
      else if (controls.largeTool?.name === name) result = { content: [{ type: 'text', text: 'x'.repeat(controls.largeTool.characters) }] };
      else result = { content: [{ type: 'text', text: JSON.stringify({ ok: true, tool: name, echo: body.params?.arguments ?? {} }) }] };
    } else result = {};
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
    return options.sse
      ? new Response(`event: message\ndata: ${message}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'stub-session' } })
      : new Response(message, { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'stub-session' } });
  }) as unknown as typeof fetch;
  return { fetch: stub, controls, seen };
}
