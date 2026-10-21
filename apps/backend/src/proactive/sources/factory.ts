import type { TaskStore } from '../../factory/task-store.js';
import type { ProactiveSource, SourceContext, SourceFact, SourceResult } from '../types.js';
import { sanitizeFactText } from '../todo-file.js';

const maxFacts = 40;

function unavailable(now: Date, reason: string): SourceResult {
  return { source: 'factory', state: 'unavailable', reason, facts: [], observedAt: now.toISOString() };
}

function elapsedLabel(startedAt: string, now: Date): string | null {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - started) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

export function createFactorySource(taskStore?: Pick<TaskStore, 'getProactiveSnapshot'>): ProactiveSource {
  return {
    id: 'factory',
    label: 'Software Factory',
    async read({ now }: SourceContext): Promise<SourceResult> {
      if (!taskStore) return unavailable(now, 'not_connected');
      try {
        const snapshot = await taskStore.getProactiveSnapshot();
        const runningCount = Number.isSafeInteger(snapshot.runningCount) && snapshot.runningCount > 0
          ? snapshot.runningCount
          : 0;
        const facts: SourceFact[] = [];
        const taskLimit = runningCount > 0 ? maxFacts - 1 : maxFacts;
        for (const task of snapshot.tasks.slice(0, 100)) {
          const needsAttention = task.state === 'NeedsAttention';
          const failed = task.latestSessionEndReason === 'crashed' || task.checks === 'failed';
          const awaitingReview = task.projectPolicy === 'deliver_pr' && task.pullRequestState === 'open';
          if (!needsAttention && !failed && !awaitingReview) continue;
          const waited = elapsedLabel(
            awaitingReview
              ? task.pullRequestOpenedAt ?? task.startedAt ?? task.createdAt
              : task.startedAt ?? task.createdAt,
            now,
          );
          if (waited === null) continue;
          const status = [
            needsAttention ? 'needs attention' : '',
            failed ? 'failed' : '',
            awaitingReview ? 'open PR awaiting review' : '',
          ].filter(Boolean).join('; ');
          const projectName = Array.from(sanitizeFactText(task.projectName)).slice(0, 80).join('');
          const title = Array.from(sanitizeFactText(task.title)).slice(0, 120).join('');
          facts.push({
            ref: `factory:${facts.length + 1}`,
            identity: `factory-task:${task.id}`,
            projectRelated: true,
            kind: 'factory',
            label: 'Software Factory',
            text: sanitizeFactText(`${projectName}: ${title} — ${status}; waited ${waited}`),
            observedAt: now.toISOString(),
          });
          if (facts.length >= taskLimit) break;
        }
        if (runningCount > 0) {
          facts.push({
            ref: 'factory:running',
            kind: 'factory',
            label: 'Software Factory',
            text: `${runningCount} running tasks`,
            observedAt: now.toISOString(),
          });
        }
        return { source: 'factory', state: 'ok', reason: null, facts, observedAt: now.toISOString() };
      } catch {
        return unavailable(now, 'read_failed');
      }
    },
  };
}
