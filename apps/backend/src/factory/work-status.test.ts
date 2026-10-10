import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { GitHubAppTokenIssuer } from '../github-app.js';
import type { GitHubIssueClient } from '../github/issues.js';
import { factoryModule } from './index.js';
import type { ProjectStore } from './projects.js';
import type { TaskDetail, TaskRecord, TaskStore } from './task-store.js';
import type { ReleaseViewRecords } from './release-view.js';
import { getWorkStatus, taskRestartReason } from './work-status.js';
import { factoryTools } from './tools.js';
import type { WorkPullRequest } from './board.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: `${['Bear', 'er'].join('')} ${['e30', 'e30', 'sig'].join('.')}`,
  'x-jarvis-message-id': '42' };
const project = { id: '7', name: 'Jarvis', repo: 'DanAakesen/jarvis', active: true,
  default_branch: 'main', default_agent: 'codex' as const, policy: 'deliver_pr' as const,
  merge_rules: null, sandbox_size: '1x2' as const, tech: 'node', max_parallel_tasks: 1 };
const task: TaskRecord = { id: '42', projectId: '7', issueNumber: 8, originMessageId: null,
  title: 'P9-50: Work status', request: 'private request', source: 'board', agent: 'codex',
  modelOverride: null, reasoningOverride: null, state: 'Running', activity: 'Building', priority: 0,
  attemptCount: 2, nextAttemptAt: null, branch: 'task', createdAt: '2026-10-10T00:00:00Z',
  startedAt: null, finishedAt: null };
const pull: WorkPullRequest = { number: 9, url: 'https://github.com/DanAakesen/jarvis/pull/9',
  state: 'merged', draft: false, checks: 'passed', mergeSha: 'a'.repeat(40), linkedIssues: [8] };
const records: ReleaseViewRecords = { releases: [{ id: '1', version: '1', sha: 'a'.repeat(40),
  status: 'released', createdAt: '2026-10-10T00:00:00Z', releasedAt: '2026-10-10T01:00:00Z' }],
pullRequests: [], workflowRuns: [], deployments: [{ id: '1', releaseId: '1', environment: 'production',
  status: 'success', at: '2026-10-10T01:00:00Z' }] };
const apps: ReturnType<typeof buildApp>[] = [];
function fixture(agent = false) {
  const issue = { number: 8, title: task.title, body: 'private issue body', state: 'closed' as 'open' | 'closed',
    url: 'https://github.com/DanAakesen/jarvis/issues/8', labels: [] as string[], isPullRequest: false };
  const tasks = [structuredClone(task)];
  const taskStore = { get: vi.fn(async (id: string, eventLimit: number) => {
    if (eventLimit < 1) throw new Error('Invalid archive event limit');
    const item = tasks.find((item) => item.id === id);
    return item ? { ...item, events: [], usage: [] } as TaskDetail : null;
  }), list: vi.fn(async () => tasks), create: vi.fn(), transition: vi.fn(),
  linkIssueNumberIfUnlinked: vi.fn() } as unknown as TaskStore;
  const github = { readIssue: vi.fn(async () => issue), createIssue: vi.fn(), addLabels: vi.fn(),
    createComment: vi.fn(), removeLabel: vi.fn() } as unknown as GitHubIssueClient;
  const board = { read: vi.fn(), searchIssues: vi.fn(async () => ({ numbers: [8], incomplete: false })),
    issuePullRequests: vi.fn(async () => [9]), readPullRequest: vi.fn(async () => structuredClone(pull)) };
  const releases = { read: vi.fn(async () => structuredClone(records)), projectForRelease: vi.fn() };
  const control = vi.fn(async () => ({ kind: 'ok' as const, task }));
  const persisted = vi.fn(async () => {});
  const token = { issueForRepositoryRead: vi.fn(async () => 'read-token'),
    issueForActions: vi.fn(async () => 'actions-token') } as unknown as GitHubAppTokenIssuer;
  const app = buildApp(config, undefined, { modules: [coreModule, factoryModule],
    auth: async () => agent
      ? { kind: 'jarvis-agent' as const, objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }
      : { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Dan' },
    projectStore: { list: vi.fn(async () => [project]) } as unknown as ProjectStore,
    taskStore, githubIssueClient: github, factoryBoardReader: board, releaseViewStore: releases,
    githubAppTokenIssuer: token, taskController: { control }, toolCallStore: { record: persisted } });
  apps.push(app);
  return { app, issue, tasks, taskStore, github, board, releases, control, persisted, token };
}
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('get_work_status evidence and restart safety', () => {
  it('is always discoverable, sensitive and strictly read-only with complete delivery evidence', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/tools/get_work_status', headers,
      payload: { issueNumber: 8 } });
    expect(response.json().result).toMatchObject({ verdict: 'delivered', partial: false,
      issue: { state: 'closed', labels: [] }, tasks: [{ state: 'Running', activity: 'Building', attemptCount: 2 }],
      pullRequests: [{ state: 'merged', draft: false, checks: 'passed', mergeSha: pull.mergeSha }],
      deployments: [{ sha: pull.mergeSha, status: 'verified', source: 'release' }] });
    expect(f.control).not.toHaveBeenCalled();
    expect(f.github.createIssue).not.toHaveBeenCalled();
    expect(f.github.createComment).not.toHaveBeenCalled();
    expect(f.github.addLabels).not.toHaveBeenCalled();
    expect(f.github.removeLabel).not.toHaveBeenCalled();
    expect(f.taskStore.create).not.toHaveBeenCalled();
    expect(f.taskStore.transition).not.toHaveBeenCalled();
    expect(f.taskStore.linkIssueNumberIfUnlinked).not.toHaveBeenCalled();
    expect(factoryTools.find((tool) => tool.name === 'get_work_status')).toMatchObject({
      sensitive: true, inputSchema: { type: 'object' } });
    const schema = factoryTools.find((tool) => tool.name === 'get_work_status')!.inputSchema;
    for (const combinator of ['oneOf', 'anyOf', 'allOf']) expect(schema).not.toHaveProperty(combinator);
    expect(JSON.stringify(f.persisted.mock.calls)).not.toContain('private issue body');
    expect(JSON.stringify(f.persisted.mock.calls)).not.toContain(task.title);
  });
  it.each([
    ['open', 'Running', [9], 'in_progress'],
    ['open', 'Ready', [], 'not_started'],
    ['open', 'NeedsAttention', [], 'needs_attention'],
    ['closed', 'Ready', [], 'needs_attention'],
  ] as const)('classifies %s issue with %s task as %s', async (state, taskState, numbers, verdict) => {
    const f = fixture(); f.issue.state = state; f.tasks[0]!.state = taskState;
    f.tasks[0]!.attemptCount = taskState === 'Ready' ? 0 : 2;
    f.board.issuePullRequests.mockResolvedValue([...numbers]);
    f.board.readPullRequest.mockResolvedValue({ ...pull, state: 'open', mergeSha: null, draft: true });
    expect((await getWorkStatus(f.app, { issueNumber: 8 })).verdict).toBe(verdict);
  });
  it('never delivers an open issue even with merged and deployed work', async () => {
    const f = fixture(); f.issue.state = 'open';
    expect((await getWorkStatus(f.app, { issueNumber: 8 })).verdict).toBe('needs_attention');
  });
  it.each(['failure', 'mismatch', 'unavailable', 'none'] as const)('does not use unrelated deployment: %s', async (mode) => {
    const f = fixture();
    f.releases.read.mockResolvedValue({ ...records, releases: [{ ...records.releases[0]!, sha: 'b'.repeat(40) }] });
    const fetcher = vi.fn(async () => {
      if (mode === 'unavailable') throw new Error('private token provider error');
      return Response.json({ total_count: mode === 'none' ? 0 : 1, workflow_runs: mode === 'none' ? [] : [{
        id: 44, path: '.github/workflows/deploy.yml', head_branch: 'main',
        head_sha: mode === 'mismatch' ? 'b'.repeat(40) : pull.mergeSha, status: 'completed',
        conclusion: mode === 'failure' ? 'failure' : 'success',
        created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T01:00:00Z',
      }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await getWorkStatus(f.app, { issueNumber: 8 });
    expect(result.verdict).toBe('needs_attention');
    expect(result.deployments[0]!.status).not.toBe('verified');
    expect(fetcher.mock.calls[0]?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('private token provider error');
  });
  it('can verify the exact merge SHA through Actions fallback', async () => {
    const f = fixture(); f.releases.read.mockResolvedValue({ releases: [], deployments: [], pullRequests: [], workflowRuns: [] });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain(`head_sha=${pull.mergeSha}`);
      return Response.json({ total_count: 1, workflow_runs: [{ id: 44, path: '.github/workflows/deploy.yml',
        head_branch: 'main', head_sha: pull.mergeSha, status: 'completed', conclusion: 'success',
        created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T01:00:00Z' }] });
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await getWorkStatus(f.app, { issueNumber: 8 })).verdict).toBe('delivered');
    expect(f.token.issueForActions).toHaveBeenCalledWith(project.repo);
  });
  it('unknown task and unknown issue give partial answers, never delivered', async () => {
    const f = fixture();
    expect(await getWorkStatus(f.app, { taskId: '99' })).toMatchObject({ verdict: 'needs_attention', partial: true,
      project: null, tasks: [], issue: null });
    expect(f.taskStore.list).not.toHaveBeenCalled();
    vi.mocked(f.github.readIssue).mockResolvedValue(null);
    expect(await getWorkStatus(f.app, { issueNumber: 99 })).toMatchObject({ verdict: 'needs_attention', partial: true });
  });
  it('reuses release PR task links when task summary and historical timeline omit the PR', async () => {
    const f = fixture(); f.board.issuePullRequests.mockResolvedValue([]);
    f.board.readPullRequest.mockResolvedValue({ ...pull, linkedIssues: [] });
    f.releases.read.mockResolvedValue({ ...records, pullRequests: [{
      id: '1', number: 9, branch: 'work', headSha: pull.mergeSha!, state: 'merged', checks: 'passed', taskId: '42',
    }] });
    expect(await getWorkStatus(f.app, { issueNumber: 8 })).toMatchObject({
      verdict: 'delivered', pullRequests: [{ number: 9, merged: true }],
    });
    expect(f.board.readPullRequest).toHaveBeenCalledWith(project.repo, 'read-token', 9);
  });
  it('warns on legacy tasks without fabricating a durable issue link', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    const status = await getWorkStatus(f.app, { taskId: '42' });
    expect(status).toMatchObject({ verdict: 'needs_attention', issue: null, tasks: [{ linked: false, issueNumber: null }] });
    expect(status.warnings.join(' ')).toContain('Legacy');
    expect(f.taskStore.linkIssueNumberIfUnlinked).not.toHaveBeenCalled();
    expect(await taskRestartReason(f.app, '42')).toBeNull();
  });
  it('blocks an unlinked task when same-project exact task-code peer was delivered', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    f.tasks.push({ ...task, id: '43', title: 'P9-50: New description', state: 'Done' });
    expect(await taskRestartReason(f.app, '42')).toBe('superseded_legacy_task');
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover' } });
    expect(response.statusCode).toBe(409); expect(f.control).not.toHaveBeenCalled();
  });
  it('blocks legacy peers with closed linked issues even without Done task state', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    f.tasks.push({ ...task, id: '43' });
    expect(await taskRestartReason(f.app, '42')).toBe('superseded_legacy_task');
  });
  it('blocks explicitly superseded legacy task despite different replacement title', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    f.issue.title = 'P11-01: Simpler approval for Google Calendar actions';
    f.issue.body = 'Supersedes Factory task 42, which failed before the runner fix in #584.';
    const status = await getWorkStatus(f.app, { taskId: '42' });
    expect(f.board.searchIssues).toHaveBeenCalledWith(project.repo, 'read-token', 'Supersedes Factory task 42', 'body');
    expect(status.issue).toBeNull();
    expect(status.warnings.join(' ')).toContain('explicitly references task 42');
    expect(await taskRestartReason(f.app, '42')).toBe('superseded_legacy_task');
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover' } });
    expect(response.statusCode).toBe(409); expect(f.control).not.toHaveBeenCalled();
    expect(f.taskStore.linkIssueNumberIfUnlinked).not.toHaveBeenCalled();
  });
  it('blocks explicit replacement when only linked PR has merged', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null; f.issue.state = 'open';
    f.issue.title = 'A different task';
    f.issue.body = 'Supersedes Factory task 42.';
    expect(await taskRestartReason(f.app, '42')).toBe('superseded_legacy_task');
  });
  it('does not infer explicit supersession from search hit or different task ID alone', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    f.issue.body = 'Supersedes Factory task 420.';
    expect(await taskRestartReason(f.app, '42')).toBeNull();
  });
  it('does not match fuzzy titles or peers from another project', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    f.tasks.push({ ...task, id: '43', projectId: '99', state: 'Done' },
      { ...task, id: '44', title: 'P9-51: Work status', state: 'Done' });
    expect(await taskRestartReason(f.app, '42')).toBeNull();
  });
  it.each(['true', 1, 'yes', null])('rejects invalid confirmation %j before controller', async (confirm) => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover', confirm } });
    expect(response.statusCode).toBe(400); expect(f.control).not.toHaveBeenCalled();
  });
  it.each(['recover', 'resume'])('refuses %s before controller; only explicit Dan true confirms', async (action) => {
    const f = fixture();
    const refused = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers, payload: { action } });
    expect(refused.statusCode).toBe(409); expect(refused.json().reason).toBe('issue_closed');
    expect(refused.json().error).toContain('linked issue is closed');
    expect(refused.json().error).toContain('confirm: true');
    expect(f.control).not.toHaveBeenCalled();
    const confirmed = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action, confirm: true } });
    expect(confirmed.statusCode).toBe(200); expect(f.control).toHaveBeenCalledWith('42', { action });
  });
  it('refuses merged-PR recovery for an open issue', async () => {
    const f = fixture(); f.issue.state = 'open';
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover', confirm: false } });
    expect(response.statusCode).toBe(409); expect(response.json().reason).toBe('pull_request_merged');
    expect(f.control).not.toHaveBeenCalled();
  });
  it.each(['closed', 'open'] as const)('retains restart blockers for %s issues when deployment lookup fails', async (state) => {
    const f = fixture(); f.issue.state = state;
    f.releases.read.mockRejectedValue(new Error('private release error'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private actions error'); }));
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().reason).toBe(state === 'closed' ? 'issue_closed' : 'pull_request_merged');
    expect(f.control).not.toHaveBeenCalled();
    expect(response.body).not.toContain('private');
  });
  it('returns 503 when historical PR safety cannot be verified', async () => {
    const f = fixture(); f.issue.state = 'open';
    f.board.issuePullRequests.mockRejectedValue(new Error('private provider error'));
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'resume', confirm: true } });
    expect(response.statusCode).toBe(503);
    expect(response.json().reason).toBe('work_status_unverified');
    expect(f.control).not.toHaveBeenCalled();
  });
  it('resume tool cannot bypass confirmation with model input', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/tools/resume_task', headers,
      payload: { taskId: '42' } });
    expect(response.json().outcome).toBe('refused'); expect(f.control).not.toHaveBeenCalled();
    const invalid = await f.app.inject({ method: 'POST', url: '/tools/resume_task', headers,
      payload: { taskId: '42', confirm: true } });
    expect(invalid.json().outcome).toBe('refused'); expect(f.control).not.toHaveBeenCalled();
  });
  it('does not give the agent access to Dan confirmation through the controls route', async () => {
    const f = fixture(true);
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover', confirm: true } });
    expect(response.statusCode).toBe(403); expect(f.control).not.toHaveBeenCalled();
  });
  it('redacts short query and returned title text from persistent tool records', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/tools/get_work_status', headers,
      payload: { query: task.title } });
    expect(response.json().outcome).toBe('ok');
    expect(f.persisted).toHaveBeenCalled();
    expect(JSON.stringify(f.persisted.mock.calls)).not.toContain(task.title);
    expect(JSON.stringify(f.persisted.mock.calls)).toContain('redacted');
  });
  it('requires project disambiguation rather than reading the default unrelated repository', async () => {
    const f = fixture();
    vi.mocked(f.app.projectStore!.list).mockResolvedValue([project, { ...project, id: '99', repo: 'DanAakesen/other' }]);
    expect(await getWorkStatus(f.app, { issueNumber: 8 })).toMatchObject({ partial: true, project: null });
    expect(f.github.readIssue).not.toHaveBeenCalled();
    expect((await getWorkStatus(f.app, { issueNumber: 8, project: project.repo })).verdict).toBe('delivered');
  });
  it('does not allow confirmation to override unavailable safety evidence', async () => {
    const f = fixture(); vi.mocked(f.github.readIssue).mockRejectedValue(new Error('private secret'));
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/42/controls', headers,
      payload: { action: 'recover', confirm: true } });
    expect(response.statusCode).toBe(503); expect(response.json().reason).toBe('work_status_unverified');
    expect(response.body).not.toContain('private secret'); expect(f.control).not.toHaveBeenCalled();
  });
  it('preserves 404 for unknown task controls without calling controller', async () => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/factory/tasks/99/controls', headers,
      payload: { action: 'recover', confirm: true } });
    expect(response.statusCode).toBe(404); expect(response.json().error).toBe('Task not found');
    expect(f.control).not.toHaveBeenCalled();
    expect(f.taskStore.list).not.toHaveBeenCalled();
  });
  it('uses positive event limits accepted by production task archive for status and restart safety', async () => {
    const f = fixture();
    expect((await getWorkStatus(f.app, { taskId: '42' })).issue?.number).toBe(8);
    expect(await taskRestartReason(f.app, '42')).toBe('issue_closed');
    const calls = vi.mocked(f.taskStore.get).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(call).toEqual(['42', 1, 0]);
  });
  it.each([{}, { issueNumber: 8, taskId: '42' }, { query: '' }, { issueNumber: 0 }, { taskId: '0' },
    { taskId: '9223372036854775808' }, { query: 'x'.repeat(101) }])('rejects invalid selector %j', async (payload) => {
    const f = fixture();
    const response = await f.app.inject({ method: 'POST', url: '/tools/get_work_status', headers, payload });
    // SQL bigint validation runs inside the reader; the schema enforces the remaining shape.
    expect(response.json().outcome === 'refused' || response.json().result?.verdict === 'needs_attention').toBe(true);
    expect(f.github.readIssue).not.toHaveBeenCalled();
  });
  it('uses query lookup but warns instead of selecting an ambiguous issue', async () => {
    const f = fixture(); f.tasks.splice(0);
    f.board.searchIssues.mockResolvedValue({ numbers: [8, 10], incomplete: false });
    expect(await getWorkStatus(f.app, { query: 'Work status' })).toMatchObject({ partial: true, issue: null });
    expect(f.github.readIssue).not.toHaveBeenCalled();
  });
  it('never lets a single search result override multiple locally linked issues', async () => {
    const f = fixture();
    f.tasks.push({ ...task, id: '43', issueNumber: 10 });
    const result = await getWorkStatus(f.app, { query: 'P9-50' });
    expect(result).toMatchObject({ partial: true, issue: null, verdict: 'needs_attention' });
    expect(f.board.searchIssues).not.toHaveBeenCalled();
    expect(f.github.readIssue).not.toHaveBeenCalled();
  });
  it('does not hide a newer merged undeployed attempt behind historical successful delivery', async () => {
    const f = fixture();
    f.board.issuePullRequests.mockResolvedValue([9, 10]);
    f.board.readPullRequest.mockImplementation(async (_repo, _token, number) =>
      ({ ...pull, number, mergeSha: number === 9 ? pull.mergeSha : 'b'.repeat(40) }));
    f.releases.read.mockResolvedValue({ ...records,
      releases: [...records.releases, { ...records.releases[0]!, id: '2', sha: 'b'.repeat(40),
        status: 'failed', createdAt: '2026-10-10T02:00:00Z' }],
    });
    expect(await getWorkStatus(f.app, { issueNumber: 8 })).toMatchObject({
      verdict: 'needs_attention', deployments: [{ status: 'verified' }, { status: 'failed' }],
    });
  });
  it('marks bounded task results incomplete', async () => {
    const f = fixture(); vi.mocked(f.taskStore.list).mockResolvedValue(Array.from({ length: 100 }, () => task));
    expect(await getWorkStatus(f.app, { issueNumber: 8 })).toMatchObject({ partial: true, verdict: 'needs_attention' });
    expect(f.taskStore.list).toHaveBeenCalledTimes(10);
  });
  it('returns promptly with sanitized partial evidence when cancelled', async () => {
    const f = fixture(); const abort = new AbortController();
    vi.mocked(f.taskStore.list).mockImplementation(() => new Promise(() => {}));
    const pending = getWorkStatus(f.app, { issueNumber: 8 }, abort.signal);
    abort.abort();
    expect(await pending).toMatchObject({ partial: true, verdict: 'needs_attention' });
  });
  it('unrelated PR on a legacy title match cannot establish issue delivery', async () => {
    const f = fixture(); f.tasks[0]!.issueNumber = null;
    f.tasks[0]!.pullRequest = { number: 9, url: pull.url, state: 'merged' };
    f.board.issuePullRequests.mockResolvedValue([]);
    f.board.readPullRequest.mockResolvedValue({ ...pull, linkedIssues: [99] });
    expect((await getWorkStatus(f.app, { issueNumber: 8 })).verdict).toBe('needs_attention');
  });
  it('failed release record is not overridden by a different successful run', async () => {
    const f = fixture();
    f.releases.read.mockResolvedValue({ ...records, releases: [{ ...records.releases[0]!, status: 'failed' }], deployments: [] });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const status = await getWorkStatus(f.app, { issueNumber: 8 });
    expect(status.deployments[0]?.status).toBe('failed'); expect(fetcher).not.toHaveBeenCalled();
  });
});
