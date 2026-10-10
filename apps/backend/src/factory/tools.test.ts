import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStore } from './projects.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { capabilityInstructions } from '../core/capability-instructions.js';
import { coreModule } from '../core/index.js';
import { defaultSettings } from '../core/settings.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import type { TaskController, TaskDetail, TaskRecord, TaskStore } from './task-store.js';
import { factoryModule } from './index.js';
import type { ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import type { TokenVerifier } from '../auth/verify.js';
import type { GitHubIssueClient } from '../github/issues.js';
import sharp from 'sharp';
import type { ConversationAttachmentStore } from '../database/conversation-attachment-store.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const apps: ReturnType<typeof buildApp>[] = [];

const project = {
  id: '7',
  name: 'Jarvis',
  description: null,
  repo: 'DanAakesen/jarvis',
  default_branch: 'main',
  default_agent: 'codex' as const,
  policy: 'deliver_pr' as const,
  merge_rules: 'private project instructions',
  sandbox_size: '1x2' as const,
  tech: 'node',
  max_parallel_tasks: 2,
  active: true,
};

const task: TaskRecord = {
  id: '42',
  projectId: '7',
  originMessageId: null,
  title: 'Fix the bug',
  request: 'Find and fix it',
  source: 'board',
  agent: 'codex',
  modelOverride: null,
  reasoningOverride: null,
  state: 'Ready',
  activity: null,
  priority: 0,
  attemptCount: 0,
  nextAttemptAt: null,
  branch: null,
  createdAt: '2026-10-03T12:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

const detail: TaskDetail = {
  ...task,
  events: [{
    id: '19',
    type: 'runner_output',
    summary: 'Updated the implementation',
    payload: { text: 'private event payload' },
    payloadTruncated: false,
    source: 'runner',
    at: '2026-10-03T12:01:00.000Z',
  }],
  usage: [],
};

function fixture() {
  const attachment = {
    id: '7b96c6a9-9f80-4a8b-8a73-51517fe37512', name: 'broken.png',
    contentType: 'image/png', size: 100, status: 'ready' as const,
    content: 'The screen shows Error: retry failed.', offset: 0, nextOffset: null,
  };
  const conversationAttachments = {
    read: vi.fn(async (_owner: string, id: string) => id === attachment.id ? attachment : null),
    readUrl: vi.fn(async () => 'https://jarvisstorage.blob.core.windows.net/artifacts/attachments/image?sig=private'),
    readImageBytes: vi.fn(async () => sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    }).png().withExif({ IFD0: { Copyright: 'private metadata' } }).toBuffer()),
  };
  const workspaceCommands = { isConnected: vi.fn(() => true), execute: vi.fn(async () => {}), dispose: vi.fn() };
  const projectStore = {
    list: vi.fn(async () => [project]),
    update: vi.fn(async (id: string, fields: Partial<typeof project>) => id === project.id ? { ...project, ...fields } : null),
    archive: vi.fn(async (id: string) => id === project.id),
  } as unknown as ProjectStore;
  const taskStore = {
    create: vi.fn(async () => task),
    list: vi.fn(async () => [task]),
    get: vi.fn(async () => detail),
    findActiveByIssue: vi.fn(async () => null),
    updateModelConfig: vi.fn(async (_id, config) => ({
      kind: 'ok' as const,
      task: { ...task, ...config },
    })),
  } as unknown as TaskStore;
  const taskController: TaskController = {
    control: vi.fn(async () => ({ kind: 'ok' as const, task })),
  };
  const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
  const githubIssueClient = {
    readIssue: vi.fn(async () => ({
      number: 8, title: 'P10-02: Factory tasks', body: 'Issue request', state: 'open' as const,
      url: 'https://github.com/DanAakesen/jarvis/issues/8', labels: ['Codex'], isPullRequest: false,
    })),
    readComments: vi.fn(async () => [{ author: 'DanAakesen', body: 'Please implement it.' }]),
    readAgentRules: vi.fn(async () => 'Repository agent rules.'),
    listIssueTitles: vi.fn(async () => []),
    createIssue: vi.fn<GitHubIssueClient['createIssue']>(async () => ({ number: 9, url: 'https://github.com/DanAakesen/jarvis/issues/9' })),
    createComment: vi.fn(async () => {}),
    addLabels: vi.fn(async () => {}),
    removeLabel: vi.fn(async () => {}),
    publishIssueImage: vi.fn<NonNullable<GitHubIssueClient['publishIssueImage']>>(async () => 'https://raw.githubusercontent.com/DanAakesen/jarvis/issue-attachments/issue-attachments/8/image.png'),
  } satisfies GitHubIssueClient;
  let latestMessage: ConversationMessage = {
    id: '42', sessionId: 'session', role: 'dan', text: 'Start issue 8', model: null, at: new Date(),
  };
  const conversationStore = {
    getHistory: vi.fn(async () => ({ messages: [latestMessage], nextCursor: null })),
  } as unknown as ConversationStore;
  const app = buildApp(config, undefined, {
    modules: [coreModule, factoryModule],
    auth: (async () => ({
      kind: 'jarvis-agent',
      objectId: '00000000-0000-0000-0000-000000000001',
      tenantId: config.auth.tenantId,
    })) as TokenVerifier,
    projectStore,
    taskStore,
    githubIssueClient,
    githubAppTokenIssuer: { issueForRepositoryRead: vi.fn(async () => 'read-token') } as unknown as NonNullable<import('../app.js').BuildAppOptions['githubAppTokenIssuer']>,
    factoryBoardReader: { read: vi.fn(), searchIssues: vi.fn(async () => ({ numbers: [], incomplete: false })) },
    conversationStore,
    conversationAttachments: conversationAttachments as unknown as ConversationAttachmentStore,
    workspaceCommands: workspaceCommands as never,
    taskController,
    toolCallStore: { record },
  });
  apps.push(app);
  return {
    app, projectStore, taskStore, taskController, record, githubIssueClient,
    attachment, conversationAttachments, workspaceCommands,
    setLatestMessage: (message: ConversationMessage) => { latestMessage = message; },
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Software Factory Jarvis tools', () => {
  async function confirm(test: ReturnType<typeof fixture>, draft: { confirmationCode: string }, text?: string) {
    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', model: null,
      text: text ?? `confirm ${draft.confirmationCode}`, at: new Date(Date.now() + 2_000),
    });
    return test.app.inject({
      method: 'POST', url: '/tools/confirm_create_issue',
      headers: { ...headers, 'x-jarvis-message-id': '43' }, payload: { confirmationCode: draft.confirmationCode },
    });
  }

  it('creates a confirmed bug with private attachment description and error text, never an image', async () => {
    const test = fixture();
    const staged = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { title: 'Bug: broken screen', body: 'Problem: retry fails.\nAcceptance: retry works.', attachmentIds: [test.attachment.id] },
    });
    expect(staged.json().outcome).toBe('ok');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    const result = await confirm(test, staged.json().result);
    expect(result.json().outcome).toBe('ok');
    const body = test.githubIssueClient.createIssue.mock.calls[0]?.[2];
    expect(body).toContain('broken.png');
    expect(body).toContain('Error: retry failed');
    expect(body).not.toContain('![');
    expect(body).not.toContain('https://');
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
    expect(test.conversationAttachments.readImageBytes).not.toHaveBeenCalled();
    expect(test.record.mock.calls.every(([call]) => JSON.stringify(call).includes('retry failed') === false)).toBe(true);
  });

  it.each([false, true])('stages and confirms comments with attachments=%s', async (withAttachment) => {
    const test = fixture();
    const staged = await test.app.inject({
      method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Retry is still broken.', ...(withAttachment ? { attachmentIds: [test.attachment.id] } : {}) },
    });
    expect(test.githubIssueClient.createComment).not.toHaveBeenCalled();
    expect((await confirm(test, staged.json().result)).json()).toMatchObject({ outcome: 'ok', result: { status: 'commented', number: 8 } });
    expect(test.githubIssueClient.createComment).toHaveBeenCalledWith(project.repo, 8,
      withAttachment ? expect.stringContaining('Error: retry failed') : 'Retry is still broken.');
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
  });

  it('previews only one image, warns, and publishes EXIF-free bytes only after later file-named confirmation', async () => {
    const test = fixture();
    const staged = await test.app.inject({
      method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Confirmed screenshot.', attachmentIds: [test.attachment.id], publish: 'public' },
    });
    const draft = staged.json().result;
    expect(draft.warning).toContain('public');
    expect(draft.warning).toContain(test.attachment.name);
    expect(test.workspaceCommands.execute).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ view: expect.objectContaining({ renderer: 'image' }) }), expect.any(AbortSignal));
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
    expect((await confirm(test, draft)).json().outcome).toBe('refused');
    expect((await confirm(test, draft, `confirm ${draft.confirmationCode} publish other.png`)).json().outcome).toBe('refused');
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
    const result = await confirm(test, draft, `confirm ${draft.confirmationCode} publish ${test.attachment.name}`);
    expect(result.json().outcome).toBe('ok');
    expect(test.githubIssueClient.publishIssueImage).toHaveBeenCalledOnce();
    const call = test.githubIssueClient.publishIssueImage.mock.calls[0]!;
    expect(call.slice(0, 2)).toEqual([project.repo, 8]);
    expect((await sharp(call[2]).metadata()).exif).toBeUndefined();
    expect(test.githubIssueClient.createComment).toHaveBeenCalledWith(project.repo, 8,
      expect.stringContaining('![broken.png](https://raw.githubusercontent.com/'));
    expect(JSON.stringify(test.record.mock.calls)).not.toContain('sig=private');
    expect((await confirm(test, draft, `confirm ${draft.confirmationCode} publish ${test.attachment.name}`)).json().outcome).toBe('refused');
  });

  it('refuses same-message publication, missing previews, multiple files and public documents', async () => {
    const test = fixture();
    const payload = { issueNumber: 8, text: 'Attach it.', attachmentIds: [test.attachment.id], publish: 'public' };
    const staged = await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers, payload });
    const code = staged.json().result.confirmationCode;
    test.setLatestMessage({ id: '42', sessionId: 'session', role: 'dan', model: null,
      text: `confirm ${code} publish broken.png`, at: new Date(Date.now() + 1_000) });
    expect((await test.app.inject({ method: 'POST', url: '/tools/confirm_create_issue', headers, payload: { confirmationCode: code } })).json().outcome).toBe('refused');
    test.workspaceCommands.isConnected.mockReturnValue(false);
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers, payload })).json().outcome).toBe('refused');
    test.workspaceCommands.isConnected.mockReturnValue(true);
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { ...payload, attachmentIds: [] } })).json().outcome).toBe('refused');
    test.attachment.contentType = 'text/plain';
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers, payload })).json().outcome).toBe('refused');
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
  });

  it('cancels public publication without writes and cannot replay the declined action', async () => {
    const test = fixture();
    const staged = await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Screenshot', attachmentIds: [test.attachment.id], publish: 'public' } });
    const draft = staged.json().result;
    expect((await confirm(test, draft, 'no')).json().outcome).toBe('refused');
    expect((await confirm(test, draft, `confirm ${draft.confirmationCode} publish broken.png`)).json().outcome).toBe('refused');
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
    expect(test.githubIssueClient.createComment).not.toHaveBeenCalled();
  });

  it('checks secrets on subsequent document pages and fences file-derived Markdown', async () => {
    const test = fixture();
    test.conversationAttachments.read.mockResolvedValueOnce({ ...test.attachment,
      content: 'Safe first page', nextOffset: 4_000 } as never)
      .mockResolvedValueOnce({ ...test.attachment, content: 'access_token=do-not-publish-this', offset: 4_000 } as never);
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Details', attachmentIds: [test.attachment.id] } })).json().outcome).toBe('refused');
    test.attachment.content = '```text\n![image](https://example.invalid/private.png)\n<script>bad</script>';
    const staged = await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Details', attachmentIds: [test.attachment.id] } });
    expect(staged.json().result.body).toContain('````text\nFile: broken.png');
    expect(test.githubIssueClient.createComment).not.toHaveBeenCalled();
  });

  it('publishes a reviewed attachment on a newly created issue and surfaces partial embedding failure', async () => {
    const test = fixture();
    const staged = await test.app.inject({ method: 'POST', url: '/tools/create_issue', headers,
      payload: { title: 'Bug: retry', body: 'Problem and acceptance.', attachmentIds: [test.attachment.id], publish: 'public', executor: 'none' } });
    test.githubIssueClient.createComment.mockRejectedValueOnce(new Error('private provider detail'));
    const result = await confirm(test, staged.json().result, `confirm ${staged.json().result.confirmationCode} publish broken.png`);
    expect(result.json().outcome).toBe('error');
    expect(JSON.stringify(result.json())).toContain('was created');
    expect(JSON.stringify(result.json())).not.toContain('private provider detail');
    expect(test.githubIssueClient.publishIssueImage.mock.calls[0]?.slice(0, 2)).toEqual([project.repo, 9]);
  });

  it('refuses unknown issues, foreign files and secrets before any writes', async () => {
    const test = fixture();
    test.githubIssueClient.readIssue.mockResolvedValueOnce(null as never);
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 999, text: 'Details' } })).json().outcome).toBe('refused');
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Details', attachmentIds: ['00000000-0000-4000-8000-000000000000'] } })).json().outcome).toBe('refused');
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: ['password', '=do-not-publish-this'].join('') } })).json().outcome).toBe('refused');
    test.attachment.content = 'access_token=do-not-publish-this';
    expect((await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Details', attachmentIds: [test.attachment.id] } })).json().outcome).toBe('refused');
    expect(test.githubIssueClient.createComment).not.toHaveBeenCalled();
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
  });
  it('registers every project and task tool for discovery and English voice', async () => {
    const names = [
      'get_work_status',
      'create_issue', 'issue_comment', 'confirm_create_issue', 'start_issue',
      'list_projects', 'update_project', 'archive_project', 'confirm_project_archive',
      'list_tasks', 'get_task', 'list_releases', 'get_release', 'get_deployment_status',
      'create_task', 'set_task_model', 'retry_task', 'steer_task', 'pause_task', 'resume_task', 'cancel_task',
      'list_capabilities', 'repo_overview', 'repo_list', 'repo_read', 'repo_search', 'repo_issues',
      'pr_get', 'pr_diff', 'pr_reviews', 'checks_list', 'ci_log',
      'create_project', 'manage_repository',
    ];
    const repositoryNames = [
      'list_capabilities', 'repo_overview', 'repo_list', 'repo_read', 'repo_search', 'repo_issues',
      'pr_get', 'pr_diff', 'pr_reviews', 'checks_list', 'ci_log',
    ];
    expect(factoryModule.tools.map(({ name }) => name)).toEqual(names);
    const capabilities = capabilityInstructions(defaultSettings.memory);
    for (const name of names.filter((name) => !repositoryNames.includes(name))) {
      expect(capabilities).toContain(name);
    }
    expect(capabilities).toContain('repo_overview first');
    expect(capabilities).toContain('repo_search or repo_read');
    expect(capabilities).toContain('draft a GitHub issue');
    expect(capabilities).toContain('confirm_create_issue');
    expect(capabilities).toContain('set_jarvis_model');

    const { app } = fixture();
    const response = await app.inject({ url: '/tools', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual([
      ...coreModule.tools.map(({ name }) => name), ...names,
    ]);
    expect(response.json().every(({ inputSchema }: { inputSchema: { type: string } }) =>
      inputSchema.type === 'object')).toBe(true);
  });

  it('creates a code-change issue only after an exact confirmation in a later Dan message', async () => {
    const { app, githubIssueClient, setLatestMessage } = fixture();
    const draft = await app.inject({
      method: 'POST',
      url: '/tools/create_issue',
      headers,
      payload: {
        title: 'Fix retries',
        body: 'Problem: retries fail.\nAcceptance: retry succeeds.',
      },
    });
    expect(draft.json()).toMatchObject({
      outcome: 'ok',
      result: {
        status: 'awaiting_confirmation',
        taskCode: 'P11-01',
        title: 'P11-01: Fix retries',
        body: 'Problem: retries fail.\nAcceptance: retry succeeds.',
        executor: 'jarvis',
      },
    });
    const confirmationCode = draft.json().result.confirmationCode as string;
    expect(confirmationCode).toMatch(/^\d{8}$/u);
    expect(githubIssueClient.createIssue).not.toHaveBeenCalled();

    setLatestMessage({
      id: '42',
      sessionId: 'session',
      role: 'dan',
      text: `confirm ${confirmationCode}`,
      model: null,
      at: new Date(Date.now() + 1_000),
    });
    const sameMessage = await app.inject({
      method: 'POST',
      url: '/tools/confirm_create_issue',
      headers,
      payload: { confirmationCode },
    });
    expect(sameMessage.json()).toMatchObject({ outcome: 'refused' });
    expect(githubIssueClient.createIssue).not.toHaveBeenCalled();

    setLatestMessage({
      id: '43',
      sessionId: 'session',
      role: 'dan',
      text: `confirm ${confirmationCode}`,
      model: null,
      at: new Date(Date.now() + 2_000),
    });
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/confirm_create_issue',
      headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { confirmationCode },
    });
    expect(confirmed.json()).toMatchObject({
      outcome: 'ok',
      result: {
        number: 9,
        url: 'https://github.com/DanAakesen/jarvis/issues/9',
        taskCode: 'P11-01',
      },
    });
    expect(githubIssueClient.createIssue).toHaveBeenCalledWith(
      project.repo,
      'P11-01: Fix retries',
      'Problem: retries fail.\nAcceptance: retry succeeds.',
      { labels: ['P11', 'enhancement'] },
    );
    expect(githubIssueClient.addLabels).toHaveBeenCalledWith(project.repo, 9, ['Jarvis']);
  });

  it('executes all tools through their stores and records message-linked calls', async () => {
    const { app, projectStore, taskStore, taskController, record } = fixture();
    const calls: [string, Record<string, unknown>][] = [
      ['list_projects', {}],
      ['update_project', { projectId: '7', name: 'Jarvis updated', description: 'The project description', default_agent: 'copilot' }],
      ['list_tasks', { projectId: '7', agent: 'codex', state: 'Ready', limit: 10, offset: 2 }],
      ['get_task', { taskId: '42', eventLimit: 20, eventOffset: 1 }],
      ['create_task', {
        projectId: '7', prompt: 'Fix the bug\nMore details', agent: 'codex', model: 'default', reasoning: 'default',
      }],
      ['set_task_model', { taskId: '42', model: 'default', reasoning: 'default' }],
      ['steer_task', { taskId: '42', message: 'Keep the current approach.' }],
      ['pause_task', { taskId: '42' }],
      ['resume_task', { taskId: '42' }],
      ['cancel_task', { taskId: '42' }],
    ];

    for (const [index, [name, payload]] of calls.entries()) {
      const response = await app.inject({
        method: 'POST',
        url: `/tools/${name}`,
        headers: { ...headers, 'x-jarvis-message-id': String(index + 42) },
        payload,
      });
      expect(response.statusCode, name).toBe(200);
      expect(response.json()).toMatchObject({
        tool: name,
        outcome: 'ok',
        confirmation: `Done: ${name} succeeded.`,
      });
    }

    expect(projectStore.list).toHaveBeenCalledTimes(4);
    expect(projectStore.update).toHaveBeenCalledWith('7', {
      name: 'Jarvis updated', description: 'The project description', default_agent: 'copilot',
    });
    expect(record.mock.calls.find(([call]) => call.tool === 'update_project')?.[0])
      .toMatchObject({ arguments: { redacted: true }, result: { redacted: true } });
    expect(taskStore.list).toHaveBeenCalledWith({
      projectId: '7', agent: 'codex', state: 'Ready', limit: 10, offset: 2,
    });
    expect(taskStore.get).toHaveBeenCalledWith('42', 20, 1);
    expect(taskStore.create).toHaveBeenCalledWith({
      projectId: '7',
      issueNumber: 9,
      title: 'Fix the bug',
      request: 'Fix the bug\nMore details',
      source: 'chat',
      originMessageId: '46',
      agent: 'codex',
      modelOverride: 'default',
      reasoningOverride: 'default',
    });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'codex', modelOverride: 'default', reasoningOverride: 'default',
    });
    const modelChange = record.mock.calls.find(([call]) => call.tool === 'set_task_model')?.[0];
    expect(modelChange?.result).toEqual({
      taskId: '42', state: 'Ready', agent: 'codex', model: 'default', reasoning: 'default',
      applies: 'next task turn',
    });
    expect(JSON.stringify(modelChange?.result)).not.toContain(task.request);
    expect(taskController.control).toHaveBeenCalledTimes(4);
    expect(record).toHaveBeenCalledTimes(calls.length);
    expect(record.mock.calls.map(([call]) => call.messageId)).toEqual(
      calls.map((_call, index) => String(index + 42)),
    );

    const results = record.mock.calls.map(([call]) => JSON.stringify(call.result)).join('\n');
    expect(results).not.toContain('private project instructions');
    expect(results).not.toContain('private event payload');
    expect(results).toContain('"summary":"Updated the implementation"');
  });

  it('rejects invalid inputs before execution or tool-call recording', async () => {
    const { app, record, projectStore, taskStore, taskController } = fixture();
    const invalidCalls: [string, unknown][] = [
      ['list_projects', null],
      ['list_tasks', { state: 'running' }],
      ['get_task', { taskId: '0' }],
      ['create_task', { projectId: '7', prompt: '' }],
      ['update_project', { projectId: '7' }],
      ['update_project', { projectId: '7', description: 'x'.repeat(2001) }],
      ['set_task_model', { taskId: '42' }],
      ['steer_task', { taskId: '42', message: '   ' }],
      ['pause_task', {}],
      ['resume_task', {}],
      ['cancel_task', {}],
    ];

    for (const [name, payload] of invalidCalls) {
      const response = await app.inject({
        method: 'POST', url: `/tools/${name}`, headers, payload,
      });
      expect(response.statusCode, name).toBe(200);
      expect(response.json()).toMatchObject({
        outcome: 'refused', result: { refused: expect.stringContaining('Invalid arguments:') },
      });
    }
    expect(record).not.toHaveBeenCalled();
    expect(projectStore.list).not.toHaveBeenCalled();
    expect(taskStore.list).not.toHaveBeenCalled();
    expect(taskStore.get).not.toHaveBeenCalled();
    expect(taskStore.create).not.toHaveBeenCalled();
    expect(taskStore.updateModelConfig).not.toHaveBeenCalled();
    expect(taskController.control).not.toHaveBeenCalled();
  });

  it.each(['steer_task', 'pause_task', 'cancel_task'])('relays finishing and runtime reasons through %s', async (name) => {
    const { app, taskController } = fixture();
    const payload = { taskId: '42', ...(name === 'steer_task' ? { message: 'Stop' } : {}) };
    const reason = 'Delivery is finishing; try again when it completes';
    vi.mocked(taskController.control).mockResolvedValue({ kind: 'invalid-transition', reason });
    const conflict = await app.inject({ method: 'POST', url: `/tools/${name}`, headers, payload });
    expect(conflict.json()).toMatchObject({ outcome: 'refused', result: { refused: reason } });
    const failureReason = 'Task runtime could not be reached to cancel the active invocation';
    vi.mocked(taskController.control).mockResolvedValue({ kind: 'failed', reason: failureReason });
    const failure = await app.inject({ method: 'POST', url: `/tools/${name}`, headers, payload });
    expect(failure.json()).toMatchObject({ outcome: 'error', result: { error: failureReason } });
  });

  it('returns refused, reasoned outcomes for missing records and invalid lifecycle actions', async () => {
    const { app, taskStore, taskController, record, projectStore } = fixture();
    vi.mocked(taskStore.get).mockResolvedValue(null);
    vi.mocked(projectStore.list).mockResolvedValue([]);
    vi.mocked(taskController.control).mockResolvedValue({ kind: 'invalid-transition' });

    const missingTask = await app.inject({
      method: 'POST', url: '/tools/get_task', headers, payload: { taskId: '404' },
    });
    expect(missingTask.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Task not found.' },
      confirmation: 'Not done: get_task was refused. Task not found.',
    });

    const missingProject = await app.inject({
      method: 'POST', url: '/tools/create_task', headers, payload: { projectId: '7', prompt: 'Fix a bug' },
    });
    expect(missingProject.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Active project not found.' },
      confirmation: 'Not done: create_task was refused. Active project not found.',
    });

    const pauseReadyTask = await app.inject({
      method: 'POST', url: '/tools/pause_task', headers, payload: { taskId: '42' },
    });
    expect(pauseReadyTask.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Task state does not allow this action.' },
      confirmation: 'Not done: pause_task was refused. Task state does not allow this action.',
    });
    expect(taskController.control).toHaveBeenCalledWith('42', { action: 'pause' });
    expect(record.mock.calls.map(([call]) => call.outcome)).toEqual(['refused', 'refused', 'refused']);
  });

  it('archives a project only after an exact confirmation in a later Dan message', async () => {
    const record = vi.fn<(call: ToolCallRecord) => Promise<void>>(async () => {});
    let latestMessage: ConversationMessage = {
      id: '42',
      sessionId: 'session',
      role: 'dan',
      text: 'Archive the project',
      model: null,
      at: new Date(Date.now() - 1_000),
    };
    const conversationStore = {
      getHistory: vi.fn(async () => ({ messages: [latestMessage], nextCursor: null })),
    } as unknown as ConversationStore;
    const projectStore = {
      list: vi.fn(async () => [project]),
      update: vi.fn(async () => project),
      archive: vi.fn(async (id: string) => id === project.id),
    } as unknown as ProjectStore;
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule],
      auth: (async () => ({
        kind: 'jarvis-agent',
        objectId: '00000000-0000-0000-0000-000000000001',
        tenantId: config.auth.tenantId,
      })) as TokenVerifier,
      conversationStore,
      projectStore,
      toolCallStore: { record },
    });
    apps.push(app);

    const staged = await app.inject({
      method: 'POST', url: '/tools/archive_project', headers, payload: { projectId: '7' },
    });
    expect(staged.json()).toMatchObject({
      outcome: 'ok',
      result: { status: 'awaiting_confirmation', projectId: '7', repo: project.repo },
    });
    const confirmationCode = staged.json().result.confirmationCode as string;
    expect(confirmationCode).toMatch(/^\d{8}$/u);
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = { ...latestMessage, text: `confirm ${confirmationCode}`, at: new Date(Date.now() + 1_000) };
    const sameMessage = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers,
      payload: { confirmationCode },
    });
    expect(sameMessage.json()).toMatchObject({ outcome: 'refused' });
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = {
      ...latestMessage, id: '43', text: `confirm ${confirmationCode} extra`, at: new Date(Date.now() + 2_000),
    };
    const refused = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { confirmationCode },
    });
    expect(refused.json()).toMatchObject({ outcome: 'refused' });
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = { ...latestMessage, id: '44', text: `confirm ${confirmationCode}`, at: new Date(Date.now() + 3_000) };
    const confirmed = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers: { ...headers, 'x-jarvis-message-id': '44' },
      payload: { confirmationCode },
    });
    expect(confirmed.json()).toMatchObject({
      outcome: 'ok',
      result: { status: 'archived', projectId: '7', repo: project.repo },
    });
    expect(projectStore.archive).toHaveBeenCalledOnce();
  });

  it('refuses unverified task models and running-task changes with valid options', async () => {
    const { app, taskStore, record } = fixture();
    const invalid = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'copilot', model: 'unverified' },
    });
    expect(invalid.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Unsupported copilot model.') },
    });
    expect(taskStore.updateModelConfig).not.toHaveBeenCalled();

    vi.mocked(taskStore.get).mockResolvedValue({ ...detail, state: 'Running' });
    const running = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', model: 'default' },
    });
    expect(running.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('running tasks are refused') },
    });
    expect(taskStore.updateModelConfig).not.toHaveBeenCalled();
    expect(record.mock.calls.map(([call]) => call.outcome)).toEqual(['refused', 'refused']);
  });

  it('accepts supported Codex reasoning levels for ready tasks', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'codex', reasoning: 'high' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { agent: 'codex', reasoning: 'high', state: 'Ready' },
    });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'codex', modelOverride: null, reasoningOverride: 'high',
    });
  });

  it('accepts supported Copilot model and reasoning overrides for ready tasks', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'copilot', model: 'claude-sonnet-4.6', reasoning: 'high' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'ok',
      result: { agent: 'copilot', model: 'claude-sonnet-4.6', reasoning: 'high', state: 'Ready' },
    });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'copilot', modelOverride: 'claude-sonnet-4.6', reasoningOverride: 'high',
    });
  });

  it('clears provider-specific overrides when switching the agent', async () => {
    const { app, taskStore } = fixture();
    vi.mocked(taskStore.get).mockResolvedValue({
      ...detail, modelOverride: 'default', reasoningOverride: 'default',
    });
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', agent: 'copilot' },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(taskStore.updateModelConfig).toHaveBeenCalledWith('42', {
      agent: 'copilot', modelOverride: null, reasoningOverride: null,
    });
  });

  it('refuses a model update if the task stopped being Ready before persistence', async () => {
    const { app, taskStore } = fixture();
    vi.mocked(taskStore.updateModelConfig).mockResolvedValue({ kind: 'not-ready' });
    const response = await app.inject({
      method: 'POST', url: '/tools/set_task_model', headers,
      payload: { taskId: '42', model: 'default' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Task is no longer Ready. Model changes are accepted only while a task is Ready; the current turn is unchanged.' },
    });
  });

  it('refuses unverified model options when creating a task', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/create_task', headers,
      payload: { projectId: '7', prompt: 'Fix a bug', agent: 'codex', model: 'gpt-5' },
    });
    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Unsupported coding-agent model.') },
    });
    expect(taskStore.create).not.toHaveBeenCalled();
  });

  it('accepts supported Copilot model and reasoning on task creation', async () => {
    const { app, taskStore } = fixture();
    const response = await app.inject({
      method: 'POST', url: '/tools/create_task', headers,
      payload: {
        projectId: '7', prompt: 'Fix a bug', agent: 'copilot',
        model: 'gpt-5.4', reasoning: 'medium',
      },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'copilot', modelOverride: 'gpt-5.4', reasoningOverride: 'medium',
    }));
  });

  it('starts open issues as Codex tasks and refuses closed issues', async () => {
    const { app, taskStore, githubIssueClient } = fixture();
    const started = await app.inject({
      method: 'POST', url: '/tools/start_issue', headers, payload: { issue: 8 },
    });
    expect(started.json()).toMatchObject({
      outcome: 'ok',
      result: {
        task: { id: '42', agent: 'codex' },
        issue: { number: 8, url: 'https://github.com/DanAakesen/jarvis/issues/8' },
      },
    });
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      issueNumber: 8, agent: 'codex', projectId: '7',
    }));

    vi.mocked(githubIssueClient.readIssue).mockResolvedValue({
      number: 8, title: 'P10-02: Factory tasks', body: '', state: 'closed',
      url: 'https://github.com/DanAakesen/jarvis/issues/8', labels: [], isPullRequest: false,
    });
    const refused = await app.inject({
      method: 'POST', url: '/tools/start_issue', headers, payload: { issue: 8 },
    });
    expect(refused.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'Only open GitHub issues can be started.' },
    });
  });

  it('associates a chat-created task with its originating message', async () => {
    const { app, taskStore } = fixture();

    const response = await app.inject({
      method: 'POST', url: '/tools/create_task', headers,
      payload: { projectId: '7', prompt: 'Fix a bug', agent: 'codex' },
    });

    expect(response.json()).toMatchObject({ outcome: 'ok' });
    expect(taskStore.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: '7',
      source: 'chat',
      originMessageId: '42',
    }));
  });
});
