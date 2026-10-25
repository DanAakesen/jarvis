import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ApprovalInterpretation, ApprovalInterpreter } from '../core/approval-interpreter.js';
import { approvalNotPending } from '../core/approval.js';
import { PendingAction } from '../core/pending-action.js';
import { factoryTools } from './tools.js';

const ttlMs = 10 * 60_000;

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
  const stage = (id = '10') => stageTool.execute(
    kind === 'archive' ? { projectId: '7' } :
      { repository: project.repo, issueNumber: 8, text: 'Reviewed comment', attachmentIds: ['attachment'] },
    request(id, 'Please prepare this'), new AbortController().signal,
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

describe.each(['archive', 'issue'] as const)('Factory %s confirmation lifecycle', (kind) => {
  it.each(['expiry', 'abort'] as const)('checks %s again at the shared execution boundary', async (boundary) => {
    const f = fixture(kind);
    const draft = await f.stage();
    vi.setSystemTime(Date.now() + 1_000);
    const controller = new AbortController();
    const consume = PendingAction.prototype.consume;
    const execute = vi.spyOn(PendingAction.prototype, 'execute');
    vi.spyOn(PendingAction.prototype, 'consume').mockImplementation(function (this: PendingAction, ...args) {
      const verdict = consume.apply(this, args);
      if (boundary === 'expiry') vi.setSystemTime(Date.now() + ttlMs);
      else controller.abort();
      return verdict;
    });
    await expect(f.confirm(draft.confirmationCode, '11', controller.signal)).rejects.toThrow(approvalNotPending);
    expect(execute).toHaveBeenCalledOnce();
    expect(f.write).not.toHaveBeenCalled();
  });

  it('cancels a replaced proposal while its interpreter is awaiting and keeps the replacement usable', async () => {
    const f = fixture(kind);
    const decision = vi.spyOn(PendingAction.prototype, 'decision');
    const entered = deferred<void>();
    const verdict = deferred<ApprovalInterpretation>();
    f.interpreter.mockImplementationOnce(() => { entered.resolve(); return verdict.promise; });
    const first = await f.stage();
    vi.setSystemTime(Date.now() + 1_000);
    const result = f.confirm(first.confirmationCode);
    const rejected = expect(result).rejects.toThrow(approvalNotPending);
    await entered.promise;
    const original = decision.mock.contexts[0]!;
    vi.setSystemTime(Date.now() + 1_000);
    const replacement = await f.stage('12');
    expect(original.pending).toBe(false);
    verdict.resolve({ verdict: 'approve', path: 'model' });
    await rejected;
    expect(f.write).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 1_000);
    await f.confirm(replacement.confirmationCode, '13');
    expect(f.write).toHaveBeenCalledOnce();
  });

  it('refuses an approval that finishes at the exact expiry boundary', async () => {
    const f = fixture(kind);
    const entered = deferred<void>();
    const verdict = deferred<ApprovalInterpretation>();
    f.interpreter.mockImplementationOnce(() => { entered.resolve(); return verdict.promise; });
    const stagedAt = Date.now();
    const draft = await f.stage();
    vi.setSystemTime(stagedAt + 1_000);
    const rejected = expect(f.confirm(draft.confirmationCode)).rejects.toThrow(approvalNotPending);
    await entered.promise;
    vi.setSystemTime(stagedAt + ttlMs);
    verdict.resolve({ verdict: 'approve', path: 'model' });
    await rejected;
    expect(f.write).not.toHaveBeenCalled();
  });

  it('does not let an awaited approval override a concurrent decline', async () => {
    const f = fixture(kind);
    const entered = deferred<void>();
    const verdict = deferred<ApprovalInterpretation>();
    f.interpreter.mockImplementationOnce(() => { entered.resolve(); return verdict.promise; })
      .mockResolvedValueOnce({ verdict: 'decline', path: 'model' });
    const draft = await f.stage();
    vi.setSystemTime(Date.now() + 1_000);
    const rejected = expect(f.confirm(draft.confirmationCode)).rejects.toThrow(approvalNotPending);
    await entered.promise;
    await expect(f.confirm(draft.confirmationCode, '12')).rejects.toThrow('Cancelled');
    verdict.resolve({ verdict: 'approve', path: 'model' });
    await rejected;
    expect(f.write).not.toHaveBeenCalled();
  });

  it('uses the immutable staged summary rather than changed project metadata', async () => {
    const f = fixture(kind);
    const draft = await f.stage();
    f.project.name = 'Changed project';
    vi.setSystemTime(Date.now() + 1_000);
    await f.confirm(draft.confirmationCode);
    expect(f.interpreter.mock.calls[0]![0].summary).toBe(kind === 'archive'
      ? 'Archive the Software Factory project "Original project" (example/project).'
      : 'Add a comment to issue #8 in example/project.');
  });
});

it('rechecks issue cancellation after awaiting GitHub permissions', async () => {
  const f = fixture('issue');
  const entered = deferred<void>();
  const permission = deferred<{ issues: string }>();
  f.permissions.mockImplementationOnce(() => { entered.resolve(); return permission.promise; });
  const draft = await f.stage();
  vi.setSystemTime(Date.now() + 1_000);
  const rejected = expect(f.confirm(draft.confirmationCode)).rejects.toThrow(approvalNotPending);
  await entered.promise;
  await f.stage('12');
  permission.resolve({ issues: 'write' });
  await rejected;
  expect(f.write).not.toHaveBeenCalled();
});
