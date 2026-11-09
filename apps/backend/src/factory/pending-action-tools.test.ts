import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ApprovalInterpreter } from '../core/approval-interpreter.js';
import { approvalNotPending } from '../core/approval.js';
import { factoryTools } from './tools.js';


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(kind: 'archive' | 'issue') {
  const archive = vi.fn(async () => true);
  const createComment = vi.fn(async () => {});
  const permissions = vi.fn(async () => ({ issues: 'write' }));
  const interpreter = vi.fn<ApprovalInterpreter>(async () => ({ verdict: 'approve', path: 'model' }));
  const project = { id: '7', name: 'Original project', repo: 'example/project' };
  const server = {
    projectStore: { list: async () => [project], archive },
    githubIssueClient: { readIssue: async () => ({ isPullRequest: false, url: 'https://example.invalid/8' }), createComment },
    githubAppTokenIssuer: { readInstallationPermissions: permissions },
    conversationAttachments: {
      read: async () => ({ id: 'attachment', name: 'details.txt', contentType: 'text/plain',
        content: 'Reviewed details', status: 'ready', nextOffset: null }),
    },
    approvalInterpreter: interpreter,
  };
  const request = (id: string, text: string) => ({
    server, principal: { id: 'dan' },
    jarvisConversationMessage: { id, text, role: 'dan', sessionId: 'session', at: new Date() },
  }) as unknown as FastifyRequest;
  const stageTool = factoryTools.find(({ name }) => name === (kind === 'archive' ? 'archive_project' : 'issue_comment'))!;
  const confirmTool = factoryTools.find(({ name }) => name === (kind === 'archive' ? 'confirm_project_archive' : 'confirm_create_issue'))!;
  const stage = (id = '10', signal = new AbortController().signal) => stageTool.execute(
    kind === 'archive' ? { projectId: '7' } :
      { repository: project.repo, issueNumber: 8, text: 'Reviewed comment', attachmentIds: ['attachment'] },
    request(id, 'Execute this requested action'), signal,
  ) as Promise<{ confirmationCode: string }>;
  const confirm = (code: string, id = '11', signal = new AbortController().signal) =>
    confirmTool.execute({ confirmationCode: code }, request(id, 'looks good, do it'), signal);
  return { stage, confirm, interpreter, permissions, project, write: kind === 'archive' ? archive : createComment };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(['archive', 'issue'] as const)('direct Factory %s actions', kind => {
  it('executes without consulting a second approval interpreter', async () => {
    const f = fixture(kind);
    await f.stage();
    expect(f.write).toHaveBeenCalledOnce();
    expect(f.interpreter).not.toHaveBeenCalled();
    await expect(f.confirm('12345678')).rejects.toThrow(approvalNotPending);
    expect(f.write).toHaveBeenCalledOnce();
  });
});

it('deduplicates concurrent requested attachment comments', async () => {
  const f = fixture('issue');
  await Promise.all([f.stage(), f.stage()]);
  expect(f.write).toHaveBeenCalledOnce();
});

it('honors cancellation while GitHub permissions are being checked', async () => {
  const f = fixture('issue');
  const entered = deferred<void>();
  const permission = deferred<{ issues: string }>();
  f.permissions.mockImplementationOnce(() => { entered.resolve(); return permission.promise; });
  const controller = new AbortController();
  const result = f.stage('10', controller.signal);
  const rejected = expect(result).rejects.toThrow();
  await entered.promise;
  controller.abort(); permission.resolve({ issues: 'write' });
  await rejected;
  expect(f.write).not.toHaveBeenCalled();
});
