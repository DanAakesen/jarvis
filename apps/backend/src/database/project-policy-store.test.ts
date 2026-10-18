import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createProjectPolicyStore } from './project-policy-store.js';
import { createTaskStore } from './task-store.js';
import { createEventHub } from '../core/event-hub.js';
import type { RecordTaskEventInput, TaskEventMessage } from '../factory/task-store.js';

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof sql }>();
  class FakeTransaction {
    constructor(readonly parent: {
      query: (text: string, inputs: Map<string, unknown>) => Promise<unknown>;
      events: string[];
    }) {}
    async begin() { this.parent.events.push('begin'); }
    async commit() { this.parent.events.push('commit'); }
    async rollback() { this.parent.events.push('rollback'); }
  }
  class FakeRequest {
    private readonly inputs = new Map<string, unknown>();
    constructor(private readonly transaction: FakeTransaction) {}
    input(name: string, _type: unknown, value: unknown) { this.inputs.set(name, value); return this; }
    query(text: string) { return this.transaction.parent.query(text, this.inputs); }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest } };
});

function fakePool(recordset: unknown[] = []) {
  const query = vi.fn<(text: string) => Promise<{ recordset: unknown[] }>>(async () => ({ recordset }));
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const pool = { request: vi.fn(() => request) } as unknown as sql.ConnectionPool;
  return { pool, input, query };
}

describe('SQL project policy store', () => {
  it.each([
    { state: 'Running', runnerCompleted: true, kind: 'active' },
    { state: 'NeedsAttention', runnerCompleted: true, kind: 'active' },
    { state: 'Running', runnerCompleted: false, kind: 'awaiting_runner' },
    { state: 'Cancelled', runnerCompleted: true, kind: 'inactive' },
  ])('guards policy work under the transaction-owned lock: $state/$runnerCompleted', async (row) => {
    const events: string[] = [];
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [{ result: 0 }] })
      .mockResolvedValueOnce({ recordset: [row] });
    const operation = vi.fn(async () => {
      events.push('operation');
      return 'done';
    });
    const pool = { query, events } as unknown as sql.ConnectionPool;

    await expect(createProjectPolicyStore(pool).withActiveTask('7', operation, 'a'.repeat(40)))
      .resolves.toEqual(row.kind === 'active' ? { kind: 'active', value: 'done' } : { kind: row.kind });

    expect(query.mock.calls[0]?.[0]).toContain("@LockOwner = N'Transaction'");
    expect(query.mock.calls[0]?.[1].get('resource')).toBe('jarvis.project-policy:7');
    expect(query.mock.calls[1]?.[0]).toContain('runner_completion_verified');
    expect(events).toEqual(row.kind === 'active' ? ['begin', 'operation', 'commit'] : ['begin', 'commit']);
    expect(operation).toHaveBeenCalledTimes(row.kind === 'active' ? 1 : 0);
  });

  it.each(['', 'a'.repeat(39), 'g'.repeat(40)])('refuses an invalid expected work commit before SQL: %s', async (sha) => {
    const { pool, query } = fakePool();
    const operation = vi.fn(async () => undefined);
    await expect(createProjectPolicyStore(pool).withActiveTask('7', operation, sha))
      .resolves.toEqual({ kind: 'awaiting_runner' });
    expect(operation).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  describe('SQL project policy blocked events', () => {
    const at = new Date('2026-10-18T08:00:00.000Z');
    const reason = 'Recorded GitHub checks are not green.';
    const blocked: RecordTaskEventInput = {
      taskId: '7', type: 'project_policy_blocked', source: 'backend', summary: reason, payload: { reason },
    };
    const previous = {
      id: '41', type: blocked.type, source: blocked.source, summary: reason,
      payload: JSON.stringify(blocked.payload), at,
    };

    function fixture(latest: unknown[] = [previous]) {
      const events: string[] = [];
      const query = vi.fn(async (text: string, inputs: Map<string, unknown>) => {
        if (text.includes('SELECT state FROM dbo.tasks')) return { recordset: [{ state: 'Running' }] };
        if (text.includes('SELECT TOP (1) CAST(id')) return { recordset: latest };
        if (text.includes('INSERT INTO dbo.task_events')) return { recordset: [{
          id: '42', type: inputs.get('type'), source: inputs.get('source'), summary: inputs.get('summary'),
          payload: inputs.get('payload'), at,
        }] };
        if (text.includes('INSERT INTO dbo.activity')) return { recordset: [] };
        throw new Error('Unexpected policy event SQL');
      });
      const hub = createEventHub<TaskEventMessage>();
      const publish = vi.spyOn(hub, 'publish').mockImplementation(() => {
        expect(events.at(-1)).toBe('commit');
      });
      const pool = { query, events } as unknown as sql.ConnectionPool;
      return { pool, query, events, publish, store: createTaskStore(pool, hub), hub };
    }

    it('returns the persisted event without timeline/activity inserts or publication, including a new store instance', async () => {
      const test = fixture();
      const first = await test.store.recordEvent(blocked);
      const restarted = createTaskStore(test.pool, test.hub);

      await expect(restarted.recordEvent(blocked)).resolves.toEqual(first);

      expect(first).toMatchObject({ id: '41', taskId: '7', payload: { reason } });
      expect(test.query.mock.calls[0]?.[0]).toContain('WITH (UPDLOCK, ROWLOCK)');
      expect(test.query.mock.calls[1]?.[0]).toContain("type = N'state_changed'");
      expect(test.query.mock.calls[1]?.[0]).toContain("type = N'project_policy_blocked'");
      expect(test.query.mock.calls[1]?.[0]).toContain('ORDER BY id DESC');
      expect(test.query.mock.calls.some(([text]) => text.includes('INSERT INTO'))).toBe(false);
      expect(test.publish).not.toHaveBeenCalled();
      expect(test.events).toEqual(['begin', 'commit', 'begin', 'commit']);
    });

    it('uses the latest persisted reason and resets suppression only after a state_changed event', async () => {
      const test = fixture([]);
      let latest: unknown[] = [];
      const execute = test.query.getMockImplementation()!;
      test.query.mockImplementation(async (text, inputs) => {
        if (text.includes('SELECT TOP (1) CAST(id')) return { recordset: latest };
        const result = await execute(text, inputs);
        if (text.includes('INSERT INTO dbo.task_events') &&
            ['project_policy_blocked', 'state_changed'].includes(String(inputs.get('type')))) {
          latest = result.recordset;
        }
        return result;
      });

      await test.store.recordEvent(blocked);
      await test.store.recordEvent(blocked);
      await test.store.recordEvent({ ...blocked, type: 'project_policy_merge_requested' });
      await test.store.recordEvent(blocked);
      await test.store.recordEvent({ ...blocked, payload: { reason: 'Changed reason' } });
      await test.store.recordEvent(blocked);
      await test.store.recordEvent({
        taskId: '7', type: 'state_changed', source: 'dan', payload: { from: 'Running', to: 'Paused' },
      });
      await test.store.recordEvent(blocked);
      await test.store.recordEvent(blocked);

      expect(test.publish.mock.calls.map(([event]) => event.type)).toEqual([
        'project_policy_blocked', 'project_policy_merge_requested',
        'project_policy_blocked', 'project_policy_blocked', 'state_changed', 'project_policy_blocked',
      ]);
      expect(test.query.mock.calls.filter(([text]) => text.includes('INSERT INTO dbo.task_events'))).toHaveLength(6);
      expect(test.query.mock.calls.filter(([text]) => text.includes('INSERT INTO dbo.activity'))).toHaveLength(6);
    });

    it.each([
      { name: 'no previous event', latest: [] },
      { name: 'changed reason', latest: [{ ...previous, payload: '{"reason":"Another reason"}' }] },
      { name: 'case-only reason change', latest: [{ ...previous, payload: JSON.stringify({ reason: reason.toLowerCase() }) }] },
      { name: 'trailing-space reason change', latest: [{ ...previous, payload: JSON.stringify({ reason: `${reason} ` }) }] },
      { name: 'intervening state change', latest: [{ ...previous, type: 'state_changed', payload: '{"from":"Paused","to":"Running"}' }] },
      { name: 'missing historical reason', latest: [{ ...previous, payload: '{}' }] },
    ])('records and publishes a policy block after $name', async ({ latest }) => {
      const test = fixture(latest);

      await expect(test.store.recordEvent(blocked)).resolves.toMatchObject({ id: '42', payload: { reason } });

      expect(test.query.mock.calls.filter(([text]) => text.includes('INSERT INTO dbo.task_events'))).toHaveLength(1);
      expect(test.query.mock.calls.filter(([text]) => text.includes('INSERT INTO dbo.activity'))).toHaveLength(1);
      expect(test.query.mock.calls.some(([text]) => text.includes('UPDATE dbo.tasks'))).toBe(false);
      expect(test.publish).toHaveBeenCalledOnce();
      expect(test.events).toEqual(['begin', 'commit']);
    });

    it('rolls back both writes without publication if activity persistence fails', async () => {
      const test = fixture([]);
      const execute = test.query.getMockImplementation()!;
      test.query.mockImplementation(async (text, inputs) => {
        if (text.includes('INSERT INTO dbo.activity')) throw new Error('synthetic persistence failure');
        return execute(text, inputs);
      });

      await expect(test.store.recordEvent(blocked)).rejects.toThrow('Task event persistence failed');

      expect(test.events).toEqual(['begin', 'rollback']);
      expect(test.publish).not.toHaveBeenCalled();
    });

    it('serializes direct state_changed events on the same task row without changing task state', async () => {
      const test = fixture();
      await test.store.recordEvent({
        taskId: '7', type: 'state_changed', source: 'backend', payload: { from: 'Paused', to: 'Running' },
      });

      expect(test.query.mock.calls[0]?.[0]).toContain('WITH (UPDLOCK, ROWLOCK)');
      expect(test.query.mock.calls.some(([text]) => text.includes('SELECT TOP (1) CAST(id'))).toBe(false);
      expect(test.query.mock.calls.some(([text]) => text.includes('UPDATE dbo.tasks'))).toBe(false);
      expect(test.publish).toHaveBeenCalledOnce();
    });

    it('does not suppress unrelated event types', async () => {
      const test = fixture();
      await test.store.recordEvent({ ...blocked, type: 'project_policy_merge_requested' });

      expect(test.query.mock.calls.some(([text]) => text.includes('SELECT'))).toBe(false);
      expect(test.publish).toHaveBeenCalledOnce();
    });
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
