import sql from 'mssql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import { FoundryClientError } from '../foundry/client.js';
import { SandboxHeartbeat } from '../factory/heartbeat.js';
import type { TaskEventMessage } from '../factory/task-store.js';
import { createSandboxHeartbeatStore } from './sandbox-heartbeat-store.js';

const transactions = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('mssql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mssql')>();
  class FakeTransaction {
    constructor(readonly parent: unknown) {}
    async begin() { transactions.events.push('begin'); }
    async commit() { transactions.events.push('commit'); }
    async rollback() { transactions.events.push('rollback'); }
  }
  class FakeRequest {
    constructor(private readonly transaction: FakeTransaction) {}
    input() { return this; }
    query(text: string) {
      return (this.transaction.parent as { query: (text: string) => Promise<unknown> }).query(text);
    }
  }
  return { ...actual, default: { ...actual.default, Transaction: FakeTransaction, Request: FakeRequest } };
});

afterEach(() => { vi.useRealTimers(); });

describe('heartbeat expiry persistence', () => {
  it.each(['running', 'completed'])(
    'classifies the first failing poll using committed %s evidence rather than task state',
    async (turnStatus) => {
      vi.useFakeTimers();
      transactions.events.length = 0;
      const sandbox = {
        sandboxSessionId: '7', foundrySessionId: 'session', agentName: 'runner', invocationId: 'invocation',
      };
      const inserted = {
        id: '9', taskId: '42', type: turnStatus === 'completed' ? 'sandbox_idle_expired' : 'state_changed',
        summary: null, payload: null, payloadTruncated: false, source: 'backend',
        at: new Date('2026-10-04T17:06:33Z'),
      };
      const query = vi.fn()
        .mockResolvedValueOnce({ recordset: [{ taskId: '42' }] })
        .mockResolvedValueOnce({ recordset: [{ status: turnStatus, invocationId: sandbox.invocationId }] });
      if (turnStatus === 'running') query.mockResolvedValueOnce({ recordset: [{ state: 'Running' }] });
      query.mockResolvedValueOnce({ rowsAffected: [1], recordset: [] })
        .mockResolvedValueOnce({ recordset: [inserted] })
        .mockResolvedValue({ recordset: [] });
      const hub = createEventHub<TaskEventMessage>();
      const published: TaskEventMessage[] = [];
      hub.subscribe((event) => {
        expect(transactions.events.at(-1)).toBe('commit');
        published.push(event);
      });
      const store = createSandboxHeartbeatStore({ query } as unknown as sql.ConnectionPool, hub);
      vi.spyOn(store, 'listRunning').mockResolvedValue([sandbox]);
      const status = vi.fn(async () => { throw new FoundryClientError('http', 'status', 404); });
      const onDecision = vi.fn();
      const heartbeat = new SandboxHeartbeat(store, () => ({ status }), { onDecision });
      await heartbeat.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(query).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(status).toHaveBeenCalledTimes(2);
      expect(published).toHaveLength(1);
      expect(published[0]?.type).toBe(inserted.type);
      const decision = turnStatus === 'completed' ? 'idle_expired' : 'crashed';
      expect(onDecision).toHaveBeenLastCalledWith({
        sandboxSessionId: '7', invocationId: 'invocation', httpStatus: 404, decision,
      });
      if (turnStatus === 'completed') {
        expect(query.mock.calls.map(([text]) => text).join('\n')).not.toContain('UPDATE dbo.tasks');
      }
      await heartbeat.stop();
    },
  );

  it('ignores an old poll after a new invocation starts on the same session', async () => {
    transactions.events.length = 0;
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [{ taskId: '42' }] })
      .mockResolvedValueOnce({ recordset: [{ status: 'running', invocationId: 'new-invocation' }] });
    const hub = createEventHub<TaskEventMessage>();
    const publish = vi.spyOn(hub, 'publish');
    const store = createSandboxHeartbeatStore({ query } as unknown as sql.ConnectionPool, hub);
    await expect(store.markNeedsAttention('7', undefined, 'old-invocation', true)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(transactions.events).toEqual(['begin', 'rollback']);
    expect(publish).not.toHaveBeenCalled();
  });
});
