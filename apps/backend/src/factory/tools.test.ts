import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectStore } from './projects.js';
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

function fixture(registeredProjects: readonly Project[] = [project]) {
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
    list: vi.fn(async () => [...registeredProjects]),
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
  const conversationMessages = [latestMessage];
  const conversationStore = {
    getHistory: vi.fn(async () => ({ messages: [latestMessage], nextCursor: null })),
    getDanMessagesAfter: vi.fn(async ({
      sessionId, after, limit,
    }: { sessionId: string; after: string; limit: number }) => conversationMessages
      .filter((message) => message.role === 'dan' && message.sessionId === sessionId &&
        BigInt(message.id) > BigInt(after))
      .sort((left, right) => Number(BigInt(left.id) - BigInt(right.id)))
      .slice(0, limit)
      .map(({ id, text }) => ({ id, text, language: 'en' as const }))),
  } as unknown as ConversationStore;
  const githubAppTokenIssuer = {
    issueForRepositoryRead: vi.fn(async () => 'read-token'),
    readInstallationPermissions: vi.fn(async () => ({ issues: 'write' as const, contents: 'write' as const })),
  };
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
    githubAppTokenIssuer: githubAppTokenIssuer as unknown as NonNullable<import('../app.js').BuildAppOptions['githubAppTokenIssuer']>,
    factoryBoardReader: { read: vi.fn(), searchIssues: vi.fn(async () => ({ numbers: [], incomplete: false })) },
    conversationStore,
    conversationAttachments: conversationAttachments as unknown as ConversationAttachmentStore,
    workspaceCommands: workspaceCommands as never,
    taskController,
    toolCallStore: { record },
  });
  apps.push(app);
  return {
    app, projectStore, taskStore, taskController, record, githubIssueClient, githubAppTokenIssuer,
    attachment, conversationAttachments, workspaceCommands,
    setLatestMessage: (message: ConversationMessage) => {
      latestMessage = message;
      const existing = conversationMessages.findIndex(({ id }) => id === message.id);
      if (existing === -1) conversationMessages.push(message);
      else conversationMessages[existing] = message;
    },
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Software Factory Jarvis tools', () => {
  async function confirm(test: ReturnType<typeof fixture>, draft: { confirmationCode: string }, text?: string) {
    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', model: null,
      text: text ?? 'yes', at: new Date(Date.now() + 2_000),
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

  it.each([false, true])('posts directly or safely stages comments with attachments=%s', async (withAttachment) => {
    const test = fixture();
    const staged = await test.app.inject({
      method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, text: 'Retry is still broken.', ...(withAttachment ? { attachmentIds: [test.attachment.id] } : {}) },
    });
    if (withAttachment) {
      expect(test.githubIssueClient.createComment).not.toHaveBeenCalled();
      expect((await confirm(test, staged.json().result)).json()).toMatchObject({ outcome: 'ok', result: { status: 'commented', number: 8 } });
    } else {
      expect(staged.json()).toMatchObject({ outcome: 'ok', result: { status: 'commented', number: 8 } });
    }
    expect(test.githubIssueClient.createComment).toHaveBeenCalledWith(project.repo, 8,
      withAttachment ? expect.stringContaining('Error: retry failed') : 'Retry is still broken.', expect.any(AbortSignal));
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
    expect((await confirm(test, draft, 'not yet')).json().outcome).toBe('refused');
    expect(test.githubIssueClient.publishIssueImage).not.toHaveBeenCalled();
    const result = await confirm(test, draft, 'approved');
    expect(result.json().outcome).toBe('ok');
    expect(test.githubIssueClient.publishIssueImage).toHaveBeenCalledOnce();
    const call = test.githubIssueClient.publishIssueImage.mock.calls[0]!;
    expect(call.slice(0, 2)).toEqual([project.repo, 8]);
    expect((await sharp(call[2]).metadata()).exif).toBeUndefined();
    expect(test.githubIssueClient.createComment).toHaveBeenCalledWith(project.repo, 8,
      expect.stringContaining('![broken.png](https://raw.githubusercontent.com/'), expect.any(AbortSignal));
    expect(JSON.stringify(test.record.mock.calls)).not.toContain('sig=private');
    expect((await confirm(test, draft, 'approved')).json().outcome).toBe('refused');
  });

  it('refuses same-message publication, missing previews, multiple files and public documents', async () => {
    const test = fixture();
    const payload = { issueNumber: 8, text: 'Attach it.', attachmentIds: [test.attachment.id], publish: 'public' };
    const staged = await test.app.inject({ method: 'POST', url: '/tools/issue_comment', headers, payload });
    const code = staged.json().result.confirmationCode;
    test.setLatestMessage({ id: '42', sessionId: 'session', role: 'dan', model: null,
      text: 'yes', at: new Date(Date.now() + 1_000) });
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
    expect((await confirm(test, draft, 'go ahead')).json().outcome).toBe('refused');
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
    const result = await confirm(test, staged.json().result, 'confirmed');
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
    test.attachment.content = '{"access_token":"do-not-publish-this"}';
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
      'github_capabilities', 'github_read', 'github_write',
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
    expect(capabilities).toContain('create a GitHub issue');
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
    const advertisedIssue = response.json().find(({ name }: { name: string }) => name === 'create_issue');
    expect(advertisedIssue.inputSchema.properties.project.description).toContain('active project ID');
  });

  it('creates a code-change issue directly when Dan asks', async () => {
    const { app, githubIssueClient } = fixture();
    const created = await app.inject({
      method: 'POST',
      url: '/tools/create_issue',
      headers,
      payload: {
        title: 'Fix retries',
        body: 'Problem: retries fail.\nAcceptance: retry succeeds.',
      },
    });
    expect(created.json()).toMatchObject({
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

  it.each([
    {
      language: 'English',
      message: 'Add a hello-world file to the test project and let me know when it’s ready',
      selector: 'the test project',
      reply: 'yes',
    },
    {
      language: 'Danish',
      message: 'Tilføj en hello-world-fil til testprojektet, og sig til, når den er klar',
      selector: 'testprojektet',
      reply: 'ja',
    },
  ])('continues a weak natural $language project clarification after a clear yes', async ({ message, selector, reply }) => {
    const registered = {
      ...project,
      id: '31',
      name: 'Greeting Runner',
      description: 'test project for hello-world changes',
      repo: 'synthetic/hello-world',
    };
    const test = fixture([registered]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan', text: message, model: null, at: new Date(),
    });

    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: {
        project: selector,
        title: 'Add hello-world file',
        body: 'Problem: the project needs a hello-world file.\nAcceptance: the file exists.',
      },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Do you mean project Greeting Runner') },
    });
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();

    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: reply,
      model: null, at: new Date(Date.now() + 10_000),
    });
    const selected = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: {
        project: registered.id, title: 'Add hello-world file',
        body: 'Problem: the project needs a hello-world file.\nAcceptance: the file exists.',
      },
    });
    expect(selected.json()).toMatchObject({ outcome: 'ok', result: { number: 9, taskCode: 'P11-01' } });
    expect(test.githubIssueClient.createIssue).toHaveBeenCalledOnce();
    expect(test.githubIssueClient.createIssue.mock.calls[0]?.[0]).toBe(registered.repo);
    expect(test.githubIssueClient.addLabels).toHaveBeenCalledOnce();
  });

  it('writes directly for a unique natural reference included in the original request', async () => {
    const registered = {
      ...project, id: '31', name: 'Greeting Runner', description: 'hello world project', repo: 'synthetic/hello-world',
    };
    const test = fixture([registered]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Add a hello-world file to the hello world project.', model: null, at: new Date(),
    });
    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: 'hello world project', title: 'Add hello-world file', body: 'Create the file.' },
    });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { number: 9 } });
    expect(test.githubIssueClient.createIssue).toHaveBeenCalledOnce();
    expect(test.githubIssueClient.createIssue.mock.calls[0]?.[0]).toBe(registered.repo);
  });

  it.each([
    { reply: 'No.', selector: '31', title: 'Add hello-world file' },
    { reply: 'Maybe the other one?', selector: '31', title: 'Add hello-world file' },
    { reply: 'No, not Greeting Runner please.', selector: 'Greeting Runner', title: 'Add hello-world file' },
    { reply: 'Maybe Greeting Runner instead.', selector: 'Greeting Runner', title: 'Add hello-world file' },
    { reply: 'Måske Greeting Runner?', selector: 'Greeting Runner', title: 'Add hello-world file' },
    { reply: 'yes', selector: '32', title: 'Add hello-world file' },
    { reply: 'yes', selector: '31', title: 'Create a different thing' },
  ])('does not continue project clarification for $reply or changed request/target', async ({ reply, selector, title }) => {
    const selected = { ...project, id: '31', name: 'Greeting Runner', description: 'test project', repo: 'synthetic/hello-world' };
    const other = { ...project, id: '32', name: 'Another Runner', description: 'other project', repo: 'synthetic/other' };
    const test = fixture([selected, other]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Add a hello-world file to the test project.', model: null, at: new Date(),
    });
    const first = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: 'the test project', title: 'Add hello-world file', body: 'Create the file.' },
    });
    expect(first.json().outcome).toBe('refused');

    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: reply, model: null, at: new Date(Date.now() + 10_000),
    });
    const continuation = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { project: selector, title, body: 'Create the file.' },
    });
    expect(continuation.json().outcome).toBe('refused');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('accepts a clear named project selection after clarification', async () => {
    const registered = { ...project, id: '31', name: 'Greeting Runner', description: 'test project', repo: 'synthetic/hello-world' };
    const other = { ...project, id: '32', name: 'Other Runner', description: 'test project for other fixtures', repo: 'synthetic/other' };
    const test = fixture([registered, other]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Add a file to the test project.', model: null, at: new Date(),
    });
    const payload = { project: 'the test project', title: 'Add a file', body: 'Create the file.' };
    const clarification = await test.app.inject({ method: 'POST', url: '/tools/create_issue', headers, payload });
    expect(clarification.json().result.refused).toContain('That could mean more than one project');

    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: 'I mean Greeting Runner.',
      model: null, at: new Date(Date.now() + 10_000),
    });
    const continuation = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { ...payload, project: registered.name },
    });

    expect(continuation.json()).toMatchObject({ outcome: 'ok', result: { number: 9 } });
    expect(test.githubIssueClient.createIssue).toHaveBeenCalledOnce();
    expect(test.githubIssueClient.createIssue.mock.calls[0]?.[0]).toBe(registered.repo);
  });

  it('does not treat yes as a selection when the clarification listed multiple projects', async () => {
    const first = { ...project, id: '31', name: 'Test fixture', repo: 'synthetic/hello-world', description: 'test project' };
    const second = { ...project, id: '32', name: 'Greeting fixture', repo: 'synthetic/greetings', description: 'another test project' };
    const test = fixture([first, second]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan', text: 'Add a file to the test project.',
      model: null, at: new Date(),
    });
    const firstCall = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: 'the test project', title: 'Add a file', body: 'Create the file.' },
    });
    expect(firstCall.json().result.refused).toContain('more than one project');

    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: 'yes', model: null, at: new Date(Date.now() + 10_000),
    });
    const continuation = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { project: '31', title: 'Add a file', body: 'Create the file.' },
    });
    expect(continuation.json().outcome).toBe('refused');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('rejects yes when another owner message intervened after the project question', async () => {
    const registered = { ...project, id: '31', name: 'Greeting Runner', description: 'test project', repo: 'synthetic/hello-world' };
    const test = fixture([registered]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Add a file to the test project.', model: null, at: new Date(),
    });
    await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: 'the test project', title: 'Add a file', body: 'Create the file.' },
    });
    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: 'Actually, never mind.',
      model: null, at: new Date(Date.now() + 10_000),
    });
    test.setLatestMessage({
      id: '44', sessionId: 'session', role: 'dan', text: 'yes',
      model: null, at: new Date(Date.now() + 20_000),
    });
    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '44' },
      payload: { project: '31', title: 'Add a file', body: 'Create the file.' },
    });
    expect(response.json().outcome).toBe('refused');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('revalidates the clarified project repository before writing', async () => {
    const registered = { ...project, id: '31', name: 'Greeting Runner', description: 'test project', repo: 'synthetic/hello-world' };
    const test = fixture([registered]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Add a file to the test project.', model: null, at: new Date(),
    });
    const payload = { project: 'the test project', title: 'Add a file', body: 'Create the file.' };
    const clarification = await test.app.inject({ method: 'POST', url: '/tools/create_issue', headers, payload });
    expect(clarification.json().outcome).toBe('refused');
    vi.mocked(test.projectStore.list)
      .mockResolvedValueOnce([registered])
      .mockResolvedValueOnce([{ ...registered, repo: 'synthetic/renamed' }]);
    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: 'yes',
      model: null, at: new Date(Date.now() + 10_000),
    });
    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { ...payload, project: registered.id },
    });
    expect(response.json()).toMatchObject({ outcome: 'refused' });
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('consumes an affirmative clarification once when continuation calls race or replay', async () => {
    const registered = { ...project, id: '31', name: 'Greeting Runner', description: 'test project', repo: 'synthetic/hello-world' };
    const test = fixture([registered]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Add a file to the test project.', model: null, at: new Date(),
    });
    const payload = { project: 'the test project', title: 'Add a file', body: 'Create the file.' };
    await test.app.inject({ method: 'POST', url: '/tools/create_issue', headers, payload });
    test.setLatestMessage({
      id: '43', sessionId: 'session', role: 'dan', text: 'yes',
      model: null, at: new Date(Date.now() + 10_000),
    });
    const continuation = { ...payload, project: registered.id };
    const results = await Promise.all([1, 2].map(() => test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: continuation,
    })));
    expect(results.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    expect(results.map(({ body }) => JSON.parse(body).outcome).sort()).toEqual(['ok', 'refused']);
    expect(test.githubIssueClient.createIssue).toHaveBeenCalledOnce();
    expect(test.githubIssueClient.addLabels).toHaveBeenCalledOnce();
  });

  it('keeps explicit unregistered repository issue comments working', async () => {
    const test = fixture([]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Comment on issue 8 in external-owner/external-repo.', model: null, at: new Date(),
    });
    const response = await test.app.inject({
      method: 'POST', url: '/tools/issue_comment', headers,
      payload: { issueNumber: 8, repository: 'external-owner/external-repo', text: 'The fix is ready.' },
    });
    expect(response.json()).toMatchObject({ outcome: 'ok', result: { status: 'commented', number: 8 } });
    expect(test.githubIssueClient.createComment).toHaveBeenCalledWith(
      'external-owner/external-repo', 8, 'The fix is ready.', expect.any(AbortSignal),
    );
    expect(test.projectStore.list).not.toHaveBeenCalled();

    const withAttachment = fixture([]);
    withAttachment.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan',
      text: 'Comment on issue 8 in external-owner/external-repo.', model: null, at: new Date(),
    });
    const staged = await withAttachment.app.inject({
      method: 'POST', url: '/tools/issue_comment', headers,
      payload: {
        issueNumber: 8, repository: 'external-owner/external-repo',
        text: 'The fix is ready.', attachmentIds: [withAttachment.attachment.id],
      },
    });
    expect(staged.json().result.status).toBe('awaiting_confirmation');
    const published = await confirm(withAttachment, staged.json().result);
    expect(published.json()).toMatchObject({ outcome: 'ok', result: { status: 'commented', number: 8 } });
    expect(withAttachment.githubIssueClient.createComment).toHaveBeenCalledWith(
      'external-owner/external-repo', 8, expect.stringContaining('The screen shows Error: retry failed.'),
      expect.any(AbortSignal),
    );
    expect(withAttachment.projectStore.list).not.toHaveBeenCalled();
  });

  it.each([
    'Add a hello-world file to the test project and let me know when it’s ready',
    'Tilføj en hello-world-fil til testprojektet, og sig til, når den er klar',
  ])('does not fall back to Jarvis when the source message names a project but the tool omits its selector', async (message) => {
    const test = fixture();
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan', text: message, model: null, at: new Date(),
    });

    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { title: 'Add hello-world file', body: 'Create the requested file.' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Which active project do you mean?') },
    });
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('clarifies ambiguous project names without writing, and continues only after a clear selection', async () => {
    const first = { ...project, id: '31', name: 'Test fixture', repo: 'synthetic/hello-world', description: 'test project' };
    const second = { ...project, id: '32', name: 'Greeting fixture', repo: 'synthetic/greetings', description: 'another test project' };
    const test = fixture([first, second]);
    const call = async (id: string, message: string, selector: string) => {
      test.setLatestMessage({ id, sessionId: 'session', role: 'dan', text: message, model: null, at: new Date() });
      return test.app.inject({
        method: 'POST', url: '/tools/create_issue',
        headers: { ...headers, 'x-jarvis-message-id': id },
        payload: { project: selector, title: 'Add hello-world file', body: 'Create the requested file.' },
      });
    };

    const ambiguous = await call('42', 'Add a hello-world file to the test project.', 'the test project');
    expect(ambiguous.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Which one do you mean?') },
    });
    expect(ambiguous.json().result.refused).toContain('Test fixture');
    expect(ambiguous.json().result.refused).toContain('Greeting fixture');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();

    const sameTurnRetry = await call('42', 'Add a hello-world file to the test project.', '32');
    expect(sameTurnRetry.json().outcome).toBe('refused');
    const declined = await call('43', 'No.', 'Greeting fixture');
    expect(declined.json().outcome).toBe('refused');
    const unclear = await call('44', 'Maybe the other one?', 'the test project');
    expect(unclear.json().outcome).toBe('refused');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();

    const selected = await call('45', 'Use Greeting fixture.', 'Greeting fixture');
    expect(selected.json().outcome).toBe('ok');
    expect(test.githubIssueClient.createIssue).toHaveBeenCalledOnce();
    expect(test.githubIssueClient.createIssue.mock.calls[0]?.[0]).toBe(second.repo);
    expect(test.githubIssueClient.addLabels).toHaveBeenCalledOnce();
  });

  it('refuses a missing explicit project without falling back to Jarvis or writing', async () => {
    const test = fixture();
    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: '999', title: 'Add hello-world file', body: 'Create the requested file.' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: expect.stringContaining('Project ID 999 is not in the active project registry') },
    });
    expect(response.json().result.refused).not.toMatch(/archived/iu);
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('bounds unknown-project candidate guidance through canonical dispatch', async () => {
    const candidates = Array.from({ length: 7 }, (_, index) => ({
      ...project,
      id: String(100 + index),
      name: `Synthetic Project ${index} ${'n'.repeat(100)}`,
      repo: `synthetic-owner-${index}/${'repository'.repeat(15)}`,
    }));
    const test = fixture(candidates);
    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: {
        project: 'unregistered mystery project', title: 'Add a file', body: 'Create the requested file.',
      },
    });

    expect(response.json().outcome).toBe('refused');
    expect(response.json().result.refused.length).toBeLessThanOrEqual(500);
    expect(response.json().result.refused).toContain('Synthetic Project 0');
    expect(response.json().result.refused).toContain('3 more');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('reports project registry read failure distinctly and performs no write', async () => {
    const test = fixture();
    vi.mocked(test.projectStore.list).mockRejectedValue(new Error('private database detail'));

    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: 'the test project', title: 'Add hello-world file', body: 'Create the requested file.' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'error',
      result: { error: expect.stringContaining('couldn’t read the active project registry') },
    });
    expect(JSON.stringify(response.json())).not.toContain('private database detail');
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.taskStore.create).not.toHaveBeenCalled();
  });

  it('keeps GitHub App permission denial after resolving a project name', async () => {
    const registered = { ...project, id: '31', name: 'Greeting Runner', repo: 'synthetic/hello-world' };
    const test = fixture([registered]);
    test.setLatestMessage({
      id: '42', sessionId: 'session', role: 'dan', text: 'Create an issue in Greeting Runner.',
      model: null, at: new Date(),
    });
    vi.mocked(test.githubAppTokenIssuer.readInstallationPermissions).mockResolvedValue({
      issues: 'read', contents: 'write',
    });

    const response = await test.app.inject({
      method: 'POST', url: '/tools/create_issue', headers,
      payload: { project: 'Greeting Runner', title: 'Add hello-world file', body: 'Create the requested file.' },
    });

    expect(response.json()).toMatchObject({
      outcome: 'refused',
      result: { refused: 'I can’t; my GitHub App lacks Issues: write.' },
    });
    expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
    expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
  });

  it.each(['archived', 'renamed'] as const)(
    'does not write if the selected project is %s between resolution and issue creation',
    async (change) => {
      const registered = { ...project, id: '31', name: 'Greeting Runner', repo: 'synthetic/hello-world' };
      const test = fixture([registered]);
      vi.mocked(test.projectStore.list)
        .mockResolvedValueOnce([registered])
        .mockResolvedValueOnce([registered])
        .mockResolvedValueOnce(change === 'archived' ? [] : [{ ...registered, repo: 'synthetic/renamed' }]);

      const response = await test.app.inject({
        method: 'POST', url: '/tools/create_issue', headers,
        payload: { project: 'Greeting Runner', title: 'Add hello-world file', body: 'Create the requested file.' },
      });

      expect(response.json().outcome).toBe('refused');
      expect(test.githubIssueClient.createIssue).not.toHaveBeenCalled();
      expect(test.githubIssueClient.addLabels).not.toHaveBeenCalled();
      expect(test.taskStore.create).not.toHaveBeenCalled();
    },
  );

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

    expect(projectStore.list).toHaveBeenCalledTimes(6);
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

  it('archives a project only after a later Dan message approves it', async () => {
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

    latestMessage = { ...latestMessage, text: 'yes', at: new Date(Date.now() + 1_000) };
    const sameMessage = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers,
      payload: { confirmationCode },
    });
    expect(sameMessage.json()).toMatchObject({ outcome: 'refused' });
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = {
      ...latestMessage, id: '43', text: 'yes, and also archive another project', at: new Date(Date.now() + 2_000),
    };
    const refused = await app.inject({
      method: 'POST',
      url: '/tools/confirm_project_archive',
      headers: { ...headers, 'x-jarvis-message-id': '43' },
      payload: { confirmationCode },
    });
    expect(refused.json()).toMatchObject({ outcome: 'refused' });
    expect(projectStore.archive).not.toHaveBeenCalled();

    latestMessage = { ...latestMessage, id: '44', text: 'yes', at: new Date(Date.now() + 3_000) };
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
