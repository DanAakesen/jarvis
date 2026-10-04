import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookDeliveryStore } from './webhook-delivery-store.js';

const transactionEvents = vi.hoisted(() => ({ values: [] as string[] }));

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: unknown) {}
    async begin(isolationLevel: number) { transactionEvents.values.push(`begin:${isolationLevel}`); }
    async commit() { transactionEvents.values.push('commit'); }
    async rollback() { transactionEvents.values.push('rollback'); }
  }
  class FakeRequest {
    private readonly parameters: unknown[] = [];
    constructor(private readonly transaction: FakeTransaction) {}
    input(...values: unknown[]) {
      this.parameters.push(values);
      return this;
    }
    query(query: string) {
      const pool = this.transaction.parent as { query: (sql: string, parameters: unknown[]) => Promise<unknown> };
      return pool.query(query, this.parameters);
    }
  }
  return {
    ...actual,
    default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest },
  };
});

describe('webhook delivery store', () => {
  it('inserts a new delivery in a serializable transaction and commits', async () => {
    transactionEvents.values.length = 0;
    const query = vi.fn().mockResolvedValue({ rowsAffected: [1] });
    const pool = { query } as unknown as sql.ConnectionPool;
    const store = createWebhookDeliveryStore(pool);
    const input = { deliveryId: 'delivery-1', event: 'push', outcome: 'ok' as const };

    await expect(store.record(input)).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO dbo.webhook_deliveries');
    expect(query.mock.calls[0]?.[1]).toEqual([
      ['deliveryId', sql.NVarChar(100), input.deliveryId],
      ['event', sql.NVarChar(64), input.event],
      ['outcome', sql.NVarChar(8), input.outcome],
    ]);
    expect(transactionEvents.values).toEqual([`begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit']);
  });

  it('creates and links a main release by project and SHA when webhook events arrive out of order', async () => {
    transactionEvents.values.length = 0;
    const query = vi.fn().mockResolvedValue({ rowsAffected: [1] });
    const store = createWebhookDeliveryStore({ query } as unknown as sql.ConnectionPool);
    const sha = 'a'.repeat(40);
    const at = '2026-10-04T12:00:00.000Z';

    await store.record({
      deliveryId: 'workflow-before-push',
      event: 'workflow_run',
      outcome: 'ok',
      mapping: {
        kind: 'workflow_run', repository: 'DanAakesen/jarvis', id: 100, name: 'Release', event: 'push',
        branch: 'main', headSha: sha, runNumber: 7, pullRequestNumbers: [], status: 'completed',
        conclusion: 'success', startedAt: at, completedAt: at,
      },
    });
    await store.record({
      deliveryId: 'push-after-workflow',
      event: 'push',
      outcome: 'ok',
      mapping: { kind: 'push', repository: 'DanAakesen/jarvis', ref: 'refs/heads/main', sha, at },
    });
    await store.record({
      deliveryId: 'deployment-by-sha',
      event: 'deployment_status',
      outcome: 'ok',
      mapping: {
        kind: 'deployment_status', repository: 'DanAakesen/jarvis', id: 101, sha, environment: 'production',
        status: 'success', at,
      },
    });

    const workflowRunSql = query.mock.calls[1]?.[0];
    expect(workflowRunSql).toContain("IF @releaseId IS NULL AND @workflow = N'Release' AND @trigger = N'push'");
    expect(workflowRunSql).toContain('default_branch = @branch');
    expect(workflowRunSql).toContain('VALUES (@projectId, CONVERT(nvarchar(100), @runNumber), @headSha');
    expect(workflowRunSql).toContain('release_id = COALESCE(@releaseId, release_id)');

    const pushSql = query.mock.calls[3]?.[0];
    expect(pushSql).toContain('WHERE project_id = @projectId AND sha = @sha');
    expect(pushSql).toContain('UPDATE dbo.workflow_runs SET release_id = @releaseId');
    expect(pushSql).toContain('WHERE project_id = @projectId AND head_sha = @sha AND release_id IS NULL');

    const deploymentSql = query.mock.calls[5]?.[0];
    expect(deploymentSql).toContain('WHERE project_id = @projectId AND sha = @sha');
    expect(deploymentSql).toContain('INSERT INTO dbo.deployments');
    expect(query.mock.calls[1]?.[1]).toContainEqual(['runNumber', sql.Int, 7]);
    expect(transactionEvents.values).toEqual([
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit',
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit',
      `begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'commit',
    ]);
  });

  it.each([2601, 2627])('reports SQL Server duplicate-key error %i as already recorded', async (number) => {
    transactionEvents.values.length = 0;
    const query = vi.fn().mockRejectedValue({ number });
    const store = createWebhookDeliveryStore({ query } as unknown as sql.ConnectionPool);

    await expect(store.record({ deliveryId: 'delivery-1', event: 'push', outcome: 'ok' })).resolves.toBe(false);
    expect(transactionEvents.values).toEqual([`begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'rollback']);
  });

  it('does not hide mapping errors as duplicate deliveries', async () => {
    transactionEvents.values.length = 0;
    const error = { number: 2627 };
    const query = vi.fn()
      .mockResolvedValueOnce({ rowsAffected: [1] })
      .mockRejectedValueOnce(error);
    const store = createWebhookDeliveryStore({ query } as unknown as sql.ConnectionPool);

    await expect(store.record({
      deliveryId: 'delivery-1',
      event: 'push',
      outcome: 'ok',
      mapping: {
        kind: 'push',
        repository: 'DanAakesen/jarvis',
        ref: 'refs/heads/main',
        sha: 'a'.repeat(40),
        at: '2026-10-04T12:00:00.000Z',
      },
    })).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(2);
    expect(transactionEvents.values).toEqual([`begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'rollback']);
  });

  it('does not hide non-duplicate database errors', async () => {
    transactionEvents.values.length = 0;
    const error = { number: 1205 };
    const query = vi.fn().mockRejectedValue(error);
    const store = createWebhookDeliveryStore({ query } as unknown as sql.ConnectionPool);

    await expect(store.record({ deliveryId: 'delivery-1', event: 'push', outcome: 'ok' })).rejects.toBe(error);
    expect(transactionEvents.values).toEqual([`begin:${sql.ISOLATION_LEVEL.SERIALIZABLE}`, 'rollback']);
  });
});
