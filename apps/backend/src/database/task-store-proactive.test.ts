import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../core/event-hub.js';
import type { TaskEventMessage } from '../factory/task-store.js';
import { createTaskStore } from './task-store.js';

describe('Factory proactive task snapshot query', () => {
  it('reads bounded task/project/PR state and the running count without events or prompts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ recordset: [{ runningCount: 2 }] })
      .mockResolvedValueOnce({
        recordset: [{
          id: '41',
          projectName: 'Synthetic project',
          projectPolicy: 'deliver_pr',
          title: 'Synthetic task',
          state: 'NeedsAttention',
          createdAt: new Date('2026-10-20T10:00:00.000Z'),
          startedAt: new Date('2026-10-20T11:00:00.000Z'),
          pullRequestState: 'open',
          pullRequestOpenedAt: new Date('2026-10-20T11:30:00.000Z'),
          checks: 'pending',
          latestSessionEndReason: null,
        }],
      });
    const request = () => ({ input: vi.fn().mockReturnThis(), query });
    const pool = { request } as unknown as sql.ConnectionPool;
    const store = createTaskStore(pool, createEventHub<TaskEventMessage>());

    await expect(store.getProactiveSnapshot()).resolves.toEqual({
      runningCount: 2,
      tasks: [{
        id: '41',
        projectName: 'Synthetic project',
        projectPolicy: 'deliver_pr',
        title: 'Synthetic task',
        state: 'NeedsAttention',
        createdAt: '2026-10-20T10:00:00.000Z',
        startedAt: '2026-10-20T11:00:00.000Z',
        pullRequestState: 'open',
        pullRequestOpenedAt: '2026-10-20T11:30:00.000Z',
        checks: 'pending',
        latestSessionEndReason: null,
      }],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("WHERE state = N'Running'");
    expect(query.mock.calls[1]?.[0]).toContain('TOP (@limit)');
    expect(query.mock.calls[1]?.[0]).toContain('p.name AS projectName');
    expect(query.mock.calls[1]?.[0]).toContain('opened_at AS openedAt');
    const statusQuery = query.mock.calls[1]?.[0] as string;
    expect(statusQuery).not.toContain('task_events');
    expect(statusQuery).not.toContain('t.request');
    expect(statusQuery).not.toContain('payload');
  });
});
