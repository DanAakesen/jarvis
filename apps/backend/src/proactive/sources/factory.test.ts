import { describe, expect, it, vi } from 'vitest';
import type { TaskStore } from '../../factory/task-store.js';
import { defaultProactiveSettings } from '../store.js';
import type { SourceContext } from '../types.js';
import { createFactorySource } from './factory.js';

const now = new Date('2026-10-20T12:00:00.000Z');
const context: SourceContext = {
  now,
  signal: new AbortController().signal,
  settings: defaultProactiveSettings(),
};

describe('proactive Factory source', () => {
  it('returns no facts when the Factory has no tasks', async () => {
    const getProactiveSnapshot = vi.fn(async () => ({ runningCount: 0, tasks: [] }));
    const result = await createFactorySource({ getProactiveSnapshot }).read(context);
    expect(result).toMatchObject({ source: 'factory', state: 'ok', facts: [] });
    expect(getProactiveSnapshot).toHaveBeenCalledOnce();
  });

  it('reports attention, failures, review-waiting PRs and a running summary without task logs', async () => {
    const getProactiveSnapshot = vi.fn(async () => ({
      runningCount: 2,
      tasks: [
        {
          id: '41', projectName: 'Synthetic project', projectPolicy: 'complete_without_deployment' as const,
          title: 'Review a synthetic task', state: 'NeedsAttention' as const,
          createdAt: '2026-10-20T10:00:00.000Z', startedAt: '2026-10-20T11:00:00.000Z',
          pullRequestState: null, pullRequestOpenedAt: null, checks: null, latestSessionEndReason: null,
        },
        {
          id: '42', projectName: 'Another project', projectPolicy: 'complete_without_deployment' as const,
          title: 'Recover a synthetic task', state: 'NeedsAttention' as const,
          createdAt: '2026-10-20T08:00:00.000Z', startedAt: '2026-10-20T09:00:00.000Z',
          pullRequestState: null, pullRequestOpenedAt: null,
          checks: 'failed' as const, latestSessionEndReason: 'crashed' as const,
        },
        {
          id: '43', projectName: 'Delivery project', projectPolicy: 'deliver_pr' as const,
          title: 'Review the synthetic change', state: 'Done' as const,
          createdAt: '2026-10-19T10:00:00.000Z', startedAt: '2026-10-19T11:00:00.000Z',
          pullRequestState: 'open' as const, pullRequestOpenedAt: '2026-10-19T11:00:00.000Z',
          checks: 'passed' as const, latestSessionEndReason: 'done' as const,
        },
        {
          id: '44', projectName: 'Private project', projectPolicy: 'deliver_pr' as const,
          title: 'A running task', state: 'Running' as const,
          createdAt: '2026-10-19T10:00:00.000Z', startedAt: '2026-10-19T11:00:00.000Z',
          pullRequestState: null, pullRequestOpenedAt: null, checks: null, latestSessionEndReason: null,
        },
      ],
    }));
    const result = await createFactorySource({ getProactiveSnapshot }).read(context);

    expect(result.state).toBe('ok');
    expect(result.facts).toHaveLength(4);
    expect(result.facts.slice(0, 3).map(({ text }) => text)).toEqual([
      'Synthetic project: Review a synthetic task — needs attention; waited 1h',
      'Another project: Recover a synthetic task — needs attention; failed; waited 3h',
      'Delivery project: Review the synthetic change — open PR awaiting review; waited 25h',
    ]);
    expect(result.facts[0]).toMatchObject({ identity: 'factory-task:41', projectRelated: true });
    expect(result.facts.at(-1)).toMatchObject({
      ref: 'factory:running',
      text: '2 running tasks',
      observedAt: now.toISOString(),
    });
    expect(result.facts.every(({ text }) =>
      !text.includes('private prompt') && !text.includes('task event'))).toBe(true);
  });

  it('handles missing and failing task stores without throwing', async () => {
    await expect(createFactorySource().read(context)).resolves.toMatchObject({
      state: 'unavailable', reason: 'not_connected', facts: [],
    });
    const failing = { getProactiveSnapshot: vi.fn(async () => { throw new Error('synthetic'); }) };
    await expect(createFactorySource(failing as unknown as Pick<TaskStore, 'getProactiveSnapshot'>).read(context))
      .resolves.toMatchObject({ state: 'unavailable', reason: 'read_failed', facts: [] });
  });
});
