import { describe, expect, it, vi } from 'vitest';
import type { ProjectStore } from './projects.js';
import type { TaskStore } from './task-store.js';
import type { GitHubIssueClient } from '../github/issues.js';
import { handleIssueLabel } from './issue-label.js';

describe('automatic issue startup refusal', () => {
  it('shows a retained alert for an oversized issue without starting a worker or recreating the issue', async () => {
    const tasks = { create: vi.fn(), findActiveByIssue: vi.fn(async () => null), findByIssueDelivery: vi.fn(async () => null) } as unknown as TaskStore;
    const github = { readIssue: vi.fn(async () => ({ number: 8, title: 'Synthetic large issue', state: 'open', body: 'a'.repeat(50_000) })),
      readComments: vi.fn(async () => []), readAgentRules: vi.fn(async () => 'Synthetic repository rules') } as unknown as GitHubIssueClient;
    const projects = { list: vi.fn(async () => [{ id: '7', repo: 'DanAakesen/jarvis', active: true }]) } as unknown as ProjectStore;
    const alerts = { record: vi.fn(async () => true) };
    expect(await handleIssueLabel({ tasks, github, projects, alerts, repository: 'DanAakesen/jarvis', issue: 8, deliveryId: 'synthetic-large' }))
      .toEqual({ kind: 'prompt-too-large' });
    expect(tasks.create).not.toHaveBeenCalled();
    expect(alerts.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_start_failure', dedupeKey: 'issue-start:synthetic-large',
      title: expect.stringContaining('coding work did not start') }));
  });
});
