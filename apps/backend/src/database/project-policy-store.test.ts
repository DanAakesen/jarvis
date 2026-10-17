import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createProjectPolicyStore } from './project-policy-store.js';

function fakePool(recordset: unknown[] = []) {
  const query = vi.fn(async () => ({ recordset }));
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { pool, input, query };
}

describe('SQL project policy store', () => {
  it.each(['', 'a'.repeat(39), 'g'.repeat(40)])('refuses an invalid expected work commit before SQL: %s', async (sha) => {
    const { pool, query } = fakePool();
    const operation = vi.fn(async () => undefined);
    await expect(createProjectPolicyStore(pool).withActiveTask('7', operation, sha))
      .resolves.toEqual({ kind: 'awaiting_runner' });
    expect(operation).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('loads policy evidence for the task-linked pull request by repository and number', async () => {
    const row = {
      taskId: '7',
      taskState: 'Running',
      repository: 'DanAakesen/jarvis-test-target',
      policy: 'complete_without_deployment',
      number: 42,
      state: 'open',
      checks: 'passed',
      headSha: 'a'.repeat(40),
      openedAt: '2026-10-04T12:00:00.000Z',
    };
    const { pool, input, query } = fakePool([row]);

    await expect(createProjectPolicyStore(pool).getPullRequest(row.repository, row.number)).resolves.toEqual(row);

    expect(input).toHaveBeenNthCalledWith(1, 'repository', sql.NVarChar(140), row.repository);
    expect(input).toHaveBeenNthCalledWith(2, 'number', sql.Int, row.number);
    expect(query.mock.calls[0]?.[0]).toContain('INNER JOIN dbo.tasks AS t ON t.id = pr.task_id');
    expect(query.mock.calls[0]?.[0]).toContain('pr.opened_at');
    expect(query.mock.calls[0]?.[0]).toContain('WHERE p.repo = @repository AND pr.number = @number');
  });

  it('lists only live-policy open PRs for running or attention tasks', async () => {
    const row = {
      taskId: '7',
      taskState: 'Running',
      repository: 'DanAakesen/jarvis-test-target',
      policy: 'complete_without_deployment',
      number: 42,
      state: 'open',
      checks: 'passed',
      headSha: 'a'.repeat(40),
      openedAt: '2026-10-04T12:00:00.000Z',
    };
    const { pool, input, query } = fakePool([row]);

    await expect(createProjectPolicyStore(pool).listOpenPullRequests('42')).resolves.toEqual([row]);

    expect(input).toHaveBeenCalledWith('projectId', sql.BigInt, 42n);
    expect(query.mock.calls[0]?.[0]).toContain("p.policy = N'complete_without_deployment'");
    expect(query.mock.calls[0]?.[0]).toContain("pr.state = N'open'");
    expect(query.mock.calls[0]?.[0]).toContain("t.state IN (N'Running', N'NeedsAttention')");
    expect(query.mock.calls[0]?.[0]).toContain('AND p.id = @projectId');
  });

  it('returns null when no task-linked pull request exists', async () => {
    const { pool } = fakePool();

    await expect(createProjectPolicyStore(pool).getPullRequest('DanAakesen/jarvis-test-target', 42)).resolves.toBeNull();
  });
});
