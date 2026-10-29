import type { AlertActivityStore } from '../database/alert-store.js';
import type { GitHubIssueClient } from '../github/issues.js';
import { startIssueTask } from './issues.js';
import type { ProjectStore } from './projects.js';
import type { TaskStore } from './task-store.js';

/** The automatic label path reports refused startup without recreating the issue. */
export async function handleIssueLabel(options: {
  projects: ProjectStore;
  tasks: TaskStore;
  github: GitHubIssueClient;
  alerts: AlertActivityStore | null;
  repository: string;
  issue: number;
  deliveryId?: string;
}) {
  const result = await startIssueTask(options);
  if (result.kind !== 'prompt-too-large') return result;
  if (!options.alerts) throw new Error('Issue startup alert unavailable');
  await options.alerts.record({
    type: 'task_start_failure',
    dedupeKey: `issue-start:${options.deliveryId ?? `${options.repository}:${options.issue}`}`,
    title: `Issue #${options.issue} exists, but coding work did not start: the issue, comments and repository instructions exceed the worker prompt limit. Shorten the issue and request a new start; do not recreate it.`,
    link: '/factory/kanban',
  });
  return result;
}
