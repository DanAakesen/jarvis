import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { isSimpleApproval } from '../core/approval.js';
import { coreModule } from '../core/index.js';
import { factoryModule } from './index.js';
import { githubAppTools } from './github-app-tools.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', 'e30.e30.sig'].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

function fixture(fetchImpl: typeof fetch, permissions: Record<string, 'read' | 'write' | 'admin'> = {
  issues: 'read', pull_requests: 'write', contents: 'read', actions: 'read', checks: 'read',
}) {
  vi.stubGlobal('fetch', fetchImpl);
  const githubAppTokenIssuer = {
    readInstallationPermissions: vi.fn(async () => permissions),
    issueWithPermissions: vi.fn(async () => 'scoped-installation-token'),
  };
  const app = buildApp(config, undefined, {
    modules: [coreModule, factoryModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan',
    }),
    githubAppTokenIssuer: githubAppTokenIssuer as never,
    toolCallStore: { record: vi.fn(async () => {}) },
  });
  apps.push(app);
  return { app, githubAppTokenIssuer };
}

async function callTool(app: ReturnType<typeof buildApp>, name: string, payload: unknown) {
  return app.inject({ method: 'POST', url: `/tools/${name}`, headers, payload });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GitHub App capability tools', () => {
  it.each(['yes', 'approved', 'confirmed', 'go ahead', 'YES.', 'Go Ahead!', 'ok', 'yes please'])(
    'accepts only a simple later approval word: %s', (value) => {
      expect(isSimpleApproval(value)).toBe(true);
    },
  );

  it.each(['confirm 12345678 now please merge it', 'go ahead and merge', 'no'])(
    'rejects generated or ambiguous approval phrases: %s', (value) => {
      expect(isSimpleApproval(value)).toBe(false);
    },
  );

  it('registers every requested tool with a plain root object schema', () => {
    const names = githubAppTools.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining([
      'github_capabilities', 'issue_get', 'issue_comments', 'issue_search', 'pr_search',
      'pr_list', 'pr_comments', 'workflow_runs', 'repo_branches', 'repo_commits',
      'repo_compare', 'labels_list', 'milestones_list', 'issue_update', 'pr_create',
      'pr_update', 'pr_comment', 'pr_review', 'pr_merge', 'pr_ready', 'branch_create',
      'workflow_dispatch', 'workflow_rerun', 'file_write', 'label_create',
    ]));
    for (const tool of githubAppTools) {
      expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.inputSchema).not.toHaveProperty('oneOf');
      expect(tool.inputSchema).not.toHaveProperty('anyOf');
    }
  });

  it('reports the live permission map and derives operation access from it', async () => {
    const { app } = fixture(vi.fn<typeof fetch>());
    const response = await callTool(app, 'github_capabilities', {});

    expect(response.json().result).toMatchObject({
      repository: 'DanAakesen/jarvis',
      permissions: { issues: 'read', pull_requests: 'write', contents: 'read', actions: 'read', checks: 'read' },
      operations: {
        issue_get: true, issue_update: false, pr_create: true, file_write: false,
        pr_get: false, start_issue: true, get_work_status: false,
      },
    });
  });

  it('reads a real-shaped issue and returns its bounded body and safe metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      number: 700,
      title: 'P9-88: Full GitHub capability',
      body: 'Issue description '.repeat(2_000),
      state: 'open',
      state_reason: null,
      labels: [{ name: 'Jarvis' }, { name: 'backend' }],
      assignees: [{ login: 'DanAakesen' }],
      milestone: { number: 88, title: 'P9-88' },
      user: { login: 'DanAakesen' },
      html_url: 'https://github.com/DanAakesen/jarvis/issues/700',
    }));
    const { app, githubAppTokenIssuer } = fixture(fetchImpl);

    const response = await callTool(app, 'issue_get', { number: 700 });
    const result = response.json().result;

    expect(result).toMatchObject({
      number: 700, title: 'P9-88: Full GitHub capability', state: 'open',
      labels: ['Jarvis', 'backend'], assignees: ['DanAakesen'],
      milestone: { number: 88, title: 'P9-88' }, author: 'DanAakesen',
      url: 'https://github.com/DanAakesen/jarvis/issues/700', bodyTruncated: true,
    });
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(20 * 1024);
    expect(result.body).toContain('Issue description');
    expect(result.warning).toContain('untrusted data');
    expect(githubAppTokenIssuer.issueWithPermissions).toHaveBeenCalledWith(
      'DanAakesen/jarvis', { issues: 'read' },
    );
    expect(JSON.stringify(result)).not.toContain('scoped-installation-token');
  });

  it('refuses missing permission before minting a token and maps a GitHub 403 clearly', async () => {
    const denied = fixture(vi.fn<typeof fetch>(), { contents: 'read' });
    const missing = await callTool(denied.app, 'issue_get', { number: 700 });
    expect(missing.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('Issues: read') } });
    expect(denied.githubAppTokenIssuer.issueWithPermissions).not.toHaveBeenCalled();

    const forbidden = fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 })));
    const response = await callTool(forbidden.app, 'issue_get', { number: 700 });
    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('Issues: read') } });
  });

  it('refuses issue writes without Issues: write before minting a token', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app, githubAppTokenIssuer } = fixture(fetchImpl, { issues: 'read' });
    const response = await callTool(app, 'issue_update', { number: 700, title: 'Updated' });

    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('Issues: write') },
    });
    expect(githubAppTokenIssuer.issueWithPermissions).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves existing labels when adding or removing and refuses an oversized set', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      labels: Array.from({ length: 31 }, (_, index) => ({ name: `label-${index}` })),
    }));
    const { app } = fixture(fetchImpl, { issues: 'write' });
    const response = await callTool(app, 'issue_update', {
      number: 700, labelsAdd: ['new-label'],
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('complete existing label set') },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('includes the full existing label set when applying additions', async () => {
    const unicodeLabel = '🚀'.repeat(30);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        labels: [{ name: 'first' }, { name: 'second' }, { name: unicodeLabel }],
      }))
      .mockResolvedValueOnce(Response.json({ number: 700 }));
    const { app } = fixture(fetchImpl, { issues: 'write' });
    const response = await callTool(app, 'issue_update', {
      number: 700, labelsAdd: ['fourth'],
    });

    expect(response.json().outcome).toBe('ok');
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      labels: ['first', 'second', unicodeLabel, 'fourth'],
    });
  });

  it('does not close an issue without a later simple approval from a verified Dan message', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = fixture(fetchImpl, { issues: 'write' });
    const response = await callTool(app, 'issue_update', { number: 700, state: 'closed' });

    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('paginates within bounds and truncates untrusted comment bodies', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      { id: 1, user: { login: 'reviewer' }, body: 'x'.repeat(20_000), created_at: '2026-10-12T00:00:00Z' },
    ]));
    const { app } = fixture(fetchImpl);
    const response = await callTool(app, 'issue_comments', { number: 700, page: 2, perPage: 1 });

    expect(response.json().result).toMatchObject({ page: 2, perPage: 1, hasMore: true });
    expect(Buffer.byteLength(response.json().result.comments[0].body)).toBeLessThanOrEqual(8 * 1024);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('page=2');
    expect((await callTool(app, 'issue_comments', { number: 700, perPage: 31 })).json().outcome).toBe('refused');
  });

  it.each([
    ['issue_search', { query: 'P9', state: 'open', label: 'Jarvis', author: 'DanAakesen' }],
    ['pr_search', { query: 'P9', state: 'open', label: 'Jarvis', author: 'DanAakesen' }],
    ['pr_list', { state: 'all' }],
    ['pr_comments', { number: 700 }],
    ['workflow_runs', {}],
    ['workflow_runs', { runId: 42 }],
    ['repo_branches', {}],
    ['repo_commits', {}],
    ['repo_commits', { sha: 'a'.repeat(40) }],
    ['repo_compare', { base: 'main', head: 'feature/test' }],
    ['labels_list', {}],
    ['milestones_list', { state: 'all' }],
  ])('reads through %s with bounded fake GitHub responses', async (name, fields) => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith('/actions/runs')) {
        return Response.json({ workflow_runs: [{ id: 42 }], total_count: 1 });
      }
      if (url.pathname.endsWith('/actions/runs/42/jobs')) return Response.json({ jobs: [], total_count: 0 });
      if (url.pathname.endsWith('/actions/runs/42')) return Response.json({ id: 42, name: 'CI' });
      if (url.pathname.endsWith('/commits')) return Response.json([]);
      if (url.pathname.endsWith(`/commits/${'a'.repeat(40)}`)) {
        return Response.json({ sha: 'a'.repeat(40), commit: { message: 'change' }, files: [] });
      }
      if (url.pathname.includes('/compare/')) return Response.json({ status: 'ahead', commits: [], files: [] });
      if (url.pathname.endsWith('/search/issues')) return Response.json({ items: [], total_count: 0 });
      if (url.pathname.endsWith('/pulls')) return Response.json([]);
      return Response.json([]);
    });
    const { app } = fixture(fetchImpl, {
      issues: 'read', pull_requests: 'read', contents: 'read', actions: 'read',
    });

    const response = await callTool(app, name, { repository: 'someone/another-repo', ...fields });

    expect(response.json().outcome, name).toBe('ok');
    expect(response.json().result.repository, name).toBe('someone/another-repo');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it.each([
    ['issue_update', { number: 700, title: 'Updated issue' }, 'PATCH'],
    ['pr_create', { head: 'feature/test', base: 'main', title: 'New PR' }, 'POST'],
    ['pr_update', { number: 700, title: 'Updated PR' }, 'PATCH'],
    ['pr_comment', { number: 700, body: 'Plain comment' }, 'POST'],
    ['pr_review', { number: 700, event: 'COMMENT', body: 'Looks good' }, 'POST'],
    ['pr_ready', { number: 700 }, 'POST'],
    ['branch_create', { branch: 'feature/test', sha: 'a'.repeat(40) }, 'POST'],
    ['workflow_dispatch', { workflow: 'ci.yml', ref: 'main', inputs: {} }, 'POST'],
    ['workflow_rerun', { runId: 42 }, 'POST'],
    ['file_write', { path: 'notes.txt', branch: 'feature/test', content: 'hello', message: 'Update notes' }, 'PUT'],
    ['label_create', { name: 'Needs triage', color: 'aabbcc' }, 'POST'],
  ])('writes directly through %s when permission and approval are not required', async (name, fields, method) => {
    const fetchImpl = vi.fn<typeof fetch>(async (request, init) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith('/contents/notes.txt') && init?.method === 'GET') {
        return Response.json({ default_branch: 'main', private: true });
      }
      if (url.pathname.endsWith('/pulls/700') && init?.method === 'GET') {
        return Response.json({ node_id: 'PR_node_id' });
      }
      if (url.pathname === '/graphql') return Response.json({ data: {} });
      if (url.pathname.endsWith('/actions/workflows/ci.yml/dispatches')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/rerun')) return new Response(null, { status: 201 });
      return Response.json({ number: 700, title: 'Updated', html_url: 'https://github.com/someone/another-repo' });
    });
    const { app } = fixture(fetchImpl, {
      issues: 'write', pull_requests: 'write', contents: 'write', actions: 'write',
      checks: 'read', statuses: 'read',
    });

    const response = await callTool(app, name, { repository: 'someone/another-repo', ...fields });

    expect(response.json().outcome, name).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(name === 'pr_ready' ? '/graphql' : '/repos/someone/another-repo/'),
      expect.objectContaining({ method }),
    );
  });

  it('secret-scans outgoing write text before making the GitHub request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = fixture(fetchImpl, { issues: 'write' });
    const response = await callTool(app, 'issue_update', {
      number: 700, body: 'credential: ******',
    });

    expect(response.json()).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('secret') } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('bounds file writes and workflow dispatch inputs before GitHub requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { app } = fixture(fetchImpl, { contents: 'write', actions: 'write' });
    const oversizedFile = await callTool(app, 'file_write', {
      path: 'notes.txt', branch: 'feature/test', content: 'x'.repeat(700_001), message: 'Update notes',
    });
    const oversizedInputs = await callTool(app, 'workflow_dispatch', {
      workflow: 'ci.yml', ref: 'main',
      inputs: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`input${index}`, 'value'])),
    });

    expect(oversizedFile.json().outcome).toBe('refused');
    expect(oversizedInputs.json().outcome).toBe('refused');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires Checks and commit status read grants before considering a PR merge', async () => {
    const { app, githubAppTokenIssuer } = fixture(
      vi.fn<typeof fetch>(),
      { pull_requests: 'write', checks: 'read' },
    );
    const response = await callTool(app, 'pr_merge', {
      number: 700, expectedHeadSha: 'a'.repeat(40),
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('Statuses: read') },
    });
    expect(githubAppTokenIssuer.issueWithPermissions).not.toHaveBeenCalled();
  });

  it('refuses a PR merge when the check-run response is truncated', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith('/pulls/700')) {
        return Response.json({ head: { sha: 'a'.repeat(40) } });
      }
      if (url.pathname.endsWith('/check-runs')) {
        return Response.json({
          total_count: 31,
          check_runs: Array.from({ length: 30 }, (_, id) => ({ id, conclusion: 'success' })),
        });
      }
      return Response.json({ state: 'success' });
    });
    const { app } = fixture(fetchImpl, {
      pull_requests: 'write', checks: 'read', statuses: 'read',
    });
    const response = await callTool(app, 'pr_merge', {
      number: 700, expectedHeadSha: 'a'.repeat(40),
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused', result: { refused: expect.stringContaining('verify every check run') },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.some(([url, init]) =>
      String(url).endsWith('/pulls/700/merge') && init?.method === 'PUT')).toBe(false);
  });
});
